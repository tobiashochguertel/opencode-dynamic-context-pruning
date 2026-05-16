import assert from "node:assert/strict"
import test from "node:test"
import type { PluginConfig } from "../../lib/config"
import { getNudgeFrequency, getIterationNudgeThreshold, isContextOverLimits } from "../../lib/messages/inject/utils"
import { getCurrentTokenUsage } from "../../lib/token-utils"
import { createSessionState, type WithParts } from "../../lib/state"

function baseConfig(providerOverrides?: Record<string, any>): PluginConfig {
    return {
        enabled: true,
        debug: false,
        pruneNotification: "off",
        pruneNotificationType: "chat",
        commands: { enabled: true, protectedTools: [] },
        manualMode: { enabled: false, automaticStrategies: true },
        turnProtection: { enabled: false, turns: 4 },
        experimental: { allowSubAgents: false, customPrompts: false },
        protectedFilePatterns: [],
        compress: {
            mode: "range",
            permission: "allow",
            showCompression: false,
            summaryBuffer: true,
            maxContextLimit: 100000,
            minContextLimit: 50000,
            nudgeFrequency: 5,
            iterationNudgeThreshold: 15,
            nudgeForce: "soft",
            protectedTools: ["task"],
            protectTags: false,
            protectUserMessages: false,
            providers: providerOverrides,
        },
        strategies: {
            deduplication: { enabled: true, protectedTools: [] },
            purgeErrors: { enabled: true, turns: 4, protectedTools: [] },
        },
    }
}

function textPart(id: string, messageID: string, sessionID: string, text: string) {
    return { id, messageID, sessionID, type: "text" as const, text }
}

function modelInfo(providerID: string, modelID: string, contextLimit: number) {
    return {
        model: { providerID, modelID },
        limit: { context: contextLimit },
    }
}

function userMessage(id: string, sessionID: string, text: string, model: Record<string, any>): WithParts {
    return {
        info: {
            id,
            role: "user",
            sessionID,
            agent: "assistant",
            time: { created: 1 },
            model,
        } as WithParts["info"],
        parts: [textPart(`${id}-part`, id, sessionID, text)],
    }
}

function assistantMessage(id: string, sessionID: string, text: string, tokens?: { input: number; output: number }): WithParts {
    return {
        info: {
            id,
            role: "assistant",
            sessionID,
            agent: "assistant",
            time: { created: 2 },
            tokens: tokens ?? { input: 50, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
        } as WithParts["info"],
        parts: [textPart(`${id}-part`, id, sessionID, text)],
    }
}

// --- getNudgeFrequency ---

test("getNudgeFrequency returns global default when no per-model override", () => {
    const config = baseConfig({ "opencode-go": { nudgeFrequency: 10 } })
    assert.equal(getNudgeFrequency(config, "other-provider", undefined), 5)
})

test("getNudgeFrequency returns provider override", () => {
    const config = baseConfig({ "opencode-go": { nudgeFrequency: 10 } })
    assert.equal(getNudgeFrequency(config, "opencode-go", undefined), 10)
})

test("getNudgeFrequency returns model override above provider", () => {
    const config = baseConfig({
        "opencode-go": {
            nudgeFrequency: 10,
            models: { "deepseek-v4-pro": { nudgeFrequency: 3 } },
        },
    })
    assert.equal(getNudgeFrequency(config, "opencode-go", "deepseek-v4-pro"), 3)
})

test("getNudgeFrequency supports wildcard provider", () => {
    const config = baseConfig({
        "*": { nudgeFrequency: 7 },
    })
    assert.equal(getNudgeFrequency(config, "any-provider", undefined), 7)
})

test("getNudgeFrequency clamps to minimum of 1", () => {
    const config = baseConfig({
        "opencode-go": { nudgeFrequency: 0 },
    })
    assert.equal(getNudgeFrequency(config, "opencode-go", undefined), 1)
})

// --- getIterationNudgeThreshold ---

test("getIterationNudgeThreshold returns global default when no per-model override", () => {
    const config = baseConfig()
    assert.equal(getIterationNudgeThreshold(config, undefined, undefined), 15)
})

test("getIterationNudgeThreshold returns provider override", () => {
    const config = baseConfig({ "opencode-go": { iterationNudgeThreshold: 30 } })
    assert.equal(getIterationNudgeThreshold(config, "opencode-go", undefined), 30)
})

test("getIterationNudgeThreshold returns model override above provider", () => {
    const config = baseConfig({
        "opencode-go": {
            iterationNudgeThreshold: 30,
            models: { "deepseek-v4-pro": { iterationNudgeThreshold: 50 } },
        },
    })
    assert.equal(getIterationNudgeThreshold(config, "opencode-go", "deepseek-v4-pro"), 50)
})

test("getIterationNudgeThreshold clamps to minimum of 1", () => {
    const config = baseConfig({ "opencode-go": { iterationNudgeThreshold: -5 } })
    assert.equal(getIterationNudgeThreshold(config, "opencode-go", undefined), 1)
})

// --- isContextOverLimits with hierarchical config ---

test("isContextOverLimits uses provider-level maxContextLimit override", () => {
    const state = createSessionState()
    state.modelContextLimit = 200000

    const config = baseConfig({
        "opencode-go": {
            maxContextLimit: "50%",
            minContextLimit: "10%",
        },
    })

    const messages: WithParts[] = [
        userMessage("msg-user", "ses_hier", "hello", modelInfo("opencode-go", "deepseek-v4-flash", 200000)),
        assistantMessage("msg-assistant", "ses_hier", "hi there"),
    ]

    const result = isContextOverLimits(config, state, "opencode-go", "deepseek-v4-flash", messages)
    assert.equal(result.overMinLimit, false)
    assert.equal(result.overMaxLimit, false)
})

test("isContextOverLimits uses model-level override above provider", () => {
    const state = createSessionState()
    state.modelContextLimit = 200000

    const config = baseConfig({
        "opencode-go": {
            maxContextLimit: "80%",
            models: {
                "deepseek-v4-flash": { maxContextLimit: 10 },
            },
        },
    })

    const messages: WithParts[] = [
        userMessage("msg-user", "ses_hier", "hello", modelInfo("opencode-go", "deepseek-v4-flash", 200000)),
        assistantMessage("msg-assistant", "ses_hier", "hi there", { input: 30, output: 5 }),
    ]

    const totalTokens = getCurrentTokenUsage(state, messages)
    assert.ok(totalTokens > 0, "should have token count")

    const result = isContextOverLimits(config, state, "opencode-go", "deepseek-v4-flash", messages)
    assert.equal(result.overMaxLimit, true, "model max limit 10 should be exceeded by reported tokens")
})

test("isContextOverLimits ignores provider overrides for different provider", () => {
    const state = createSessionState()
    state.modelContextLimit = 200000

    const config = baseConfig({
        "opencode-go": {
            maxContextLimit: "10%",
            minContextLimit: "5%",
        },
    })

    const messages: WithParts[] = [
        userMessage("msg-user", "ses_hier", "hello", modelInfo("other", "other-model", 200000)),
        assistantMessage("msg-assistant", "ses_hier", "hi there"),
    ]

    const result = isContextOverLimits(config, state, "other", "other-model", messages)
    assert.equal(result.overMinLimit, false)
    assert.equal(result.overMaxLimit, false)
})

test("isContextOverLimits applies wildcard provider to any provider", () => {
    const state = createSessionState()
    state.modelContextLimit = 200000

    const config = baseConfig({
        "*": {
            maxContextLimit: 10,
        },
    })

    const messages: WithParts[] = [
        userMessage("msg-user", "ses_hier", "hello", modelInfo("unknown", "unknown-model", 200000)),
        assistantMessage("msg-assistant", "ses_hier", "hi there", { input: 30, output: 5 }),
    ]

    const totalTokens = getCurrentTokenUsage(state, messages)
    assert.ok(totalTokens > 0, "should have token count")

    const result = isContextOverLimits(config, state, "unknown", "unknown-model", messages)
    assert.equal(result.overMaxLimit, true, "wildcard max limit 10 should be exceeded by reported tokens")
})

test("isContextOverLimits picks exact provider over wildcard", () => {
    const state = createSessionState()
    state.modelContextLimit = 200000

    const config = baseConfig({
        "*": {
            maxContextLimit: "10%",
            minContextLimit: "5%",
        },
        "opencode-go": {
            maxContextLimit: "90%",
            minContextLimit: "80%",
        },
    })

    const messages: WithParts[] = [
        userMessage("msg-user", "ses_hier", "hello", modelInfo("opencode-go", "deepseek-v4-flash", 200000)),
        assistantMessage("msg-assistant", "ses_hier", "hi there"),
    ]

    const result = isContextOverLimits(config, state, "opencode-go", "deepseek-v4-flash", messages)
    assert.equal(result.overMinLimit, false)
    assert.equal(result.overMaxLimit, false)
})
