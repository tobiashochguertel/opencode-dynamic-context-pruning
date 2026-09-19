import assert from "node:assert/strict"
import test from "node:test"
import type { PluginConfig } from "../../lib/config"
import {
    createChatMessageTransformHandler,
    createCommandExecuteHandler,
    createCompressTimingHooks,
    createSystemPromptHandler,
} from "../../lib/hooks"
import { stripHallucinationsFromString } from "../../lib/messages"
import { Logger } from "../../lib/logger"
import {
    createSessionState,
    ensureSessionInitialized,
    saveSessionState,
    type WithParts,
} from "../../lib/state"

function buildConfig(permission: "allow" | "ask" | "deny" = "allow"): PluginConfig {
    return {
        enabled: true,
        debug: false,
        pruneNotification: "off",
        pruneNotificationType: "chat",
        commands: {
            enabled: true,
            protectedTools: [],
        },
        manualMode: {
            enabled: false,
            automaticStrategies: true,
        },
        turnProtection: {
            enabled: false,
            turns: 4,
        },
        experimental: {
            allowSubAgents: false,
            customPrompts: false,
        },
        protectedFilePatterns: [],
        compress: {
            mode: "message",
            permission,
            showCompression: false,
            maxContextLimit: 150000,
            minContextLimit: 50000,
            nudgeFrequency: 5,
            iterationNudgeThreshold: 15,
            nudgeForce: "soft",
            protectedTools: ["task"],
            protectTags: false,
            protectUserMessages: false,
        },
        strategies: {
            deduplication: {
                enabled: true,
                protectedTools: [],
            },
            purgeErrors: {
                enabled: true,
                turns: 4,
                protectedTools: [],
            },
        },
    }
}

function buildMessage(id: string, role: "user" | "assistant", text: string): WithParts {
    return {
        info: {
            id,
            role,
            sessionID: "session-1",
            agent: "assistant",
            time: { created: 1 },
        } as WithParts["info"],
        parts: [
            {
                id: `${id}-part`,
                messageID: id,
                sessionID: "session-1",
                type: "text",
                text,
            },
        ],
    }
}

test("system prompt handler caches full model context for percentage thresholds", async () => {
    const state = createSessionState()
    const handler = createSystemPromptHandler(state, new Logger(false), buildConfig("deny"), {
        reload() {},
        getRuntimePrompts() {
            return {} as any
        },
    } as any)

    await handler(
        {
            sessionID: "session-1",
            model: {
                limit: {
                    context: 200000,
                    output: 131072,
                },
            },
        } as any,
        { system: ["base system"] },
    )

    assert.equal(state.modelContextLimit, 200000)
})

test("chat message transform strips hallucinated tags even when compress is denied", async () => {
    const state = createSessionState()
    const logger = new Logger(false)
    const config = buildConfig("deny")
    const handler = createChatMessageTransformHandler(
        { session: { get: async () => ({}) } } as any,
        state,
        logger,
        config,
        {
            reload() {},
            getRuntimePrompts() {
                return {} as any
            },
        } as any,
        { global: undefined, agents: {} },
    )
    const output = {
        messages: [buildMessage("assistant-1", "assistant", "alpha <dcp>beta</dcp> omega")],
    }

    await handler({}, output)

    assert.equal(output.messages[0]?.parts[0]?.type, "text")
    assert.equal((output.messages[0]?.parts[0] as any).text, "alpha  omega")
})

test("chat message transform drops messages without info instead of crashing", async () => {
    const state = createSessionState()
    const logger = new Logger(false)
    const config = buildConfig("deny")
    const handler = createChatMessageTransformHandler(
        { session: { get: async () => ({}) } } as any,
        state,
        logger,
        config,
        {
            reload() {},
            getRuntimePrompts() {
                return {} as any
            },
        } as any,
        { global: undefined, agents: {} },
    )
    const output = {
        messages: [
            {
                role: "user",
                time: 1,
                parts: [
                    {
                        type: "text",
                        text: "Carica le skill di laravel",
                    },
                ],
            } as any,
        ],
    }

    await handler({}, output as any)

    assert.equal(state.sessionId, null)
    assert.equal(output.messages.length, 0)
})

test("command execute exits after effective permission resolves to deny", async () => {
    let sessionMessagesCalls = 0
    const output = { parts: [] as any[] }
    const handler = createCommandExecuteHandler(
        {
            session: {
                messages: async () => {
                    sessionMessagesCalls += 1
                    return { data: [] }
                },
            },
        } as any,
        createSessionState(),
        new Logger(false),
        buildConfig("deny"),
        "/tmp",
        { global: undefined, agents: {} },
    )

    await handler({ command: "dcp", sessionID: "session-1", arguments: "context" }, output)

    assert.equal(sessionMessagesCalls, 1)
    assert.deepEqual(output.parts, [])
})

// V1 had a dedicated `experimental.text.complete` hook that stripped
// hallucinated DCP tags from generated text; V2 has no equivalent hook, so
// the stripping helper is exercised directly here.
test("text stripping removes hallucinated metadata tags", () => {
    assert.equal(stripHallucinationsFromString("alpha <dcp>beta</dcp> omega"), "alpha  omega")
})

function compressBlock(
    blockId: number,
    compressMessageId: string,
    compressCallId: string,
    topic: string,
    createdAt: number,
) {
    return {
        blockId,
        runId: blockId,
        active: true,
        deactivatedByUser: false,
        compressedTokens: 0,
        summaryTokens: 0,
        durationMs: 0,
        mode: "message" as const,
        topic,
        batchTopic: topic,
        startId: `m000${blockId}`,
        endId: `m000${blockId}`,
        anchorMessageId: `msg-${topic}`,
        compressMessageId,
        compressCallId,
        includedBlockIds: [],
        consumedBlockIds: [],
        parentBlockIds: [],
        directMessageIds: [],
        directToolIds: [],
        effectiveMessageIds: [`msg-${topic}`],
        effectiveToolIds: [],
        createdAt,
        summary: topic,
    }
}

test("compress timing hooks attach durations to matching blocks by message and call id", async () => {
    const state = createSessionState()
    state.sessionId = "session-1"
    const timing = createCompressTimingHooks(state, new Logger(false))
    const originalNow = Date.now

    try {
        Date.now = () => 100
        timing.onBefore({ tool: "compress", id: "call-1", messageID: "message-1" })
        timing.onBefore({ tool: "compress", id: "call-2", messageID: "message-1" })

        state.prune.messages.blocksById.set(1, compressBlock(1, "message-1", "call-1", "one", 1))
        state.prune.messages.blocksById.set(2, compressBlock(2, "message-1", "call-2", "two", 2))

        Date.now = () => 500
        await timing.onAfter({
            tool: "compress",
            id: "call-2",
            messageID: "message-1",
            status: "completed",
        })

        Date.now = () => 700
        await timing.onAfter({
            tool: "compress",
            id: "call-1",
            messageID: "message-1",
            status: "completed",
        })
    } finally {
        Date.now = originalNow
    }

    assert.equal(state.prune.messages.blocksById.get(1)?.durationMs, 600)
    assert.equal(state.prune.messages.blocksById.get(2)?.durationMs, 400)
})

test("compress timing hooks record no duration when no start was seen", async () => {
    const state = createSessionState()
    state.sessionId = "session-1"
    const timing = createCompressTimingHooks(state, new Logger(false))

    state.prune.messages.blocksById.set(1, compressBlock(1, "message-1", "call-3", "one", 1))

    await timing.onAfter({
        tool: "compress",
        id: "call-3",
        messageID: "message-1",
        status: "completed",
    })

    // No execute.before was observed for this call: pendingToRunning is
    // undefined, so nothing is attached.
    assert.equal(state.prune.messages.blocksById.get(1)?.durationMs, 0)
    assert.equal(state.compressionTiming.pendingByCallId.has("message-1:call-3"), false)
})

test("compress timing hooks queue duration updates until the matching session is loaded", async () => {
    const logger = new Logger(false)
    const targetSessionId = `session-target-${process.pid}-${Date.now()}`
    const otherSessionId = `session-other-${process.pid}-${Date.now()}`
    const persistedState = createSessionState()
    persistedState.sessionId = targetSessionId
    persistedState.prune.messages.blocksById.set(
        1,
        compressBlock(1, "message-1", "call-remote", "one", 1),
    )
    await saveSessionState(persistedState, logger)

    const liveState = createSessionState()
    liveState.sessionId = otherSessionId
    const timing = createCompressTimingHooks(liveState, logger)
    const originalNow = Date.now

    try {
        Date.now = () => 100
        timing.onBefore({ tool: "compress", id: "call-remote", messageID: "message-1" })
        Date.now = () => 500
        await timing.onAfter({
            tool: "compress",
            id: "call-remote",
            messageID: "message-1",
            status: "completed",
        })
    } finally {
        Date.now = originalNow
    }

    assert.equal(liveState.compressionTiming.pendingByCallId.has("message-1:call-remote"), true)
    assert.equal(liveState.compressionTiming.startsByCallId.has("message-1:call-remote"), false)

    await ensureSessionInitialized(
        {
            session: {
                get: async () => ({ data: { parentID: null } }),
            },
        } as any,
        liveState,
        targetSessionId,
        logger,
        [
            {
                info: {
                    id: "msg-user-1",
                    role: "user",
                    sessionID: targetSessionId,
                    agent: "assistant",
                    time: { created: 1 },
                } as WithParts["info"],
                parts: [],
            },
        ],
        false,
    )

    assert.equal(liveState.prune.messages.blocksById.get(1)?.durationMs, 400)
    assert.equal(liveState.compressionTiming.pendingByCallId.has("message-1:call-remote"), false)
})

test("compress timing hooks keep same call id distinct across message ids", async () => {
    const state = createSessionState()
    state.sessionId = "session-1"
    const timing = createCompressTimingHooks(state, new Logger(false))
    const originalNow = Date.now

    state.prune.messages.blocksById.set(1, compressBlock(1, "message-1", "shared-call", "one", 1))
    state.prune.messages.blocksById.set(2, compressBlock(2, "message-2", "shared-call", "two", 2))

    try {
        Date.now = () => 100
        timing.onBefore({ tool: "compress", id: "shared-call", messageID: "message-1" })
        Date.now = () => 200
        timing.onBefore({ tool: "compress", id: "shared-call", messageID: "message-2" })
        Date.now = () => 500
        await timing.onAfter({
            tool: "compress",
            id: "shared-call",
            messageID: "message-2",
            status: "completed",
        })
        Date.now = () => 700
        await timing.onAfter({
            tool: "compress",
            id: "shared-call",
            messageID: "message-1",
            status: "completed",
        })
    } finally {
        Date.now = originalNow
    }

    assert.equal(state.prune.messages.blocksById.get(1)?.durationMs, 600)
    assert.equal(state.prune.messages.blocksById.get(2)?.durationMs, 300)
})
