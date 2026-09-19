import type { SessionState, WithParts } from "./state"
import type { Logger } from "./logger"
import type { PluginConfig } from "./config"
import { assignMessageRefs } from "./message-ids"
import {
    buildPriorityMap,
    buildToolIdList,
    injectCompressNudges,
    injectExtendedSubAgentResults,
    injectMessageIds,
    prune,
    stripHallucinations,
    stripStaleMetadata,
    syncCompressionBlocks,
} from "./messages"
import { renderSystemPrompt, type PromptStore } from "./prompts"
import { buildProtectedToolsExtension } from "./prompts/extensions/system"
import {
    applyPendingCompressionDurations,
    buildCompressionTimingKey,
    consumeCompressionStart,
    resolveCompressionDuration,
} from "./compress/timing"
import { filterMessages, filterMessagesInPlace } from "./messages/shape"
import {
    applyPendingManualTrigger,
    handleContextCommand,
    handleDecompressCommand,
    handleHelpCommand,
    handleManualToggleCommand,
    handleManualTriggerCommand,
    handleRecompressCommand,
    handleStatsCommand,
    handleSweepCommand,
} from "./commands"
import { type HostPermissionSnapshot } from "./host-permissions"
import { compressPermission, syncCompressPermissionState } from "./compress-permission"
import { checkSession, ensureSessionInitialized, saveSessionState, syncToolCache } from "./state"
import { cacheSystemPromptTokens } from "./ui/utils"

const INTERNAL_AGENT_SIGNATURES = [
    "You are a title generator",
    "You are a helpful AI assistant tasked with summarizing conversations",
    "You are an anchored context summarization assistant for coding sessions",
    "Summarize what was done in this conversation",
]

export function createSystemPromptHandler(
    state: SessionState,
    logger: Logger,
    config: PluginConfig,
    prompts: PromptStore,
) {
    return async (
        input: { sessionID?: string; model: { limit: { context: number } } },
        output: { system: string[] },
    ) => {
        if (input.model?.limit?.context) {
            state.modelContextLimit = input.model.limit.context
            logger.debug("Cached model context limit", { limit: state.modelContextLimit })
        }

        if (state.isSubAgent && !config.experimental.allowSubAgents) {
            return
        }

        const systemText = output.system.join("\n")
        if (INTERNAL_AGENT_SIGNATURES.some((sig) => systemText.includes(sig))) {
            logger.info("Skipping DCP system prompt injection for internal agent")
            return
        }

        const effectivePermission =
            input.sessionID && state.sessionId === input.sessionID
                ? compressPermission(state, config)
                : config.compress.permission

        if (effectivePermission === "deny") {
            return
        }

        prompts.reload()
        const runtimePrompts = prompts.getRuntimePrompts()
        const newPrompt = renderSystemPrompt(
            runtimePrompts,
            buildProtectedToolsExtension(config.compress.protectedTools),
            !!state.manualMode,
            state.isSubAgent && config.experimental.allowSubAgents,
        )
        if (output.system.length > 0) {
            output.system[output.system.length - 1] += "\n\n" + newPrompt
        } else {
            output.system.push(newPrompt)
        }
    }
}

export function createChatMessageTransformHandler(
    client: any,
    state: SessionState,
    logger: Logger,
    config: PluginConfig,
    prompts: PromptStore,
    hostPermissions: HostPermissionSnapshot,
) {
    return async (input: {}, output: { messages: WithParts[] }) => {
        const receivedMessages = Array.isArray(output.messages) ? output.messages.length : 0
        const messages = filterMessagesInPlace(output.messages)
        if (messages.length !== receivedMessages) {
            logger.warn("Skipping messages with unexpected shape during chat transform", {
                received: receivedMessages,
                usable: messages.length,
            })
        }

        await checkSession(client, state, logger, output.messages, config.manualMode.enabled)

        syncCompressPermissionState(state, config, hostPermissions, output.messages)

        if (state.isSubAgent && !config.experimental.allowSubAgents) {
            return
        }

        stripHallucinations(output.messages)
        cacheSystemPromptTokens(state, output.messages)
        assignMessageRefs(state, output.messages)
        syncCompressionBlocks(state, logger, output.messages)
        syncToolCache(state, config, logger, output.messages)
        buildToolIdList(state, output.messages)
        prune(state, logger, config, output.messages)
        await injectExtendedSubAgentResults(
            client,
            state,
            logger,
            output.messages,
            config.experimental.allowSubAgents,
        )
        const compressionPriorities = buildPriorityMap(config, state, output.messages)
        prompts.reload()
        injectCompressNudges(
            state,
            config,
            logger,
            output.messages,
            prompts.getRuntimePrompts(),
            compressionPriorities,
        )
        injectMessageIds(state, config, output.messages, compressionPriorities)
        applyPendingManualTrigger(state, output.messages, logger)
        stripStaleMetadata(output.messages)

        if (state.sessionId) {
            await logger.saveContext(state.sessionId, output.messages)
        }
    }
}

export function createCommandExecuteHandler(
    client: any,
    state: SessionState,
    logger: Logger,
    config: PluginConfig,
    workingDirectory: string,
    hostPermissions: HostPermissionSnapshot,
) {
    return async (
        input: { command: string; sessionID: string; arguments: string },
        output: { parts: any[] },
    ) => {
        if (!config.commands.enabled) {
            return
        }

        if (input.command === "dcp") {
            const messagesResponse = await client.session.messages({
                path: { id: input.sessionID },
            })
            const messages = filterMessages(messagesResponse.data || messagesResponse)

            await ensureSessionInitialized(
                client,
                state,
                input.sessionID,
                logger,
                messages,
                config.manualMode.enabled,
            )

            syncCompressPermissionState(state, config, hostPermissions, messages)

            const effectivePermission = compressPermission(state, config)
            if (effectivePermission === "deny") {
                return
            }

            const args = (input.arguments || "").trim().split(/\s+/).filter(Boolean)
            const subcommand = args[0]?.toLowerCase() || ""
            const subArgs = args.slice(1)

            const commandCtx = {
                client,
                state,
                config,
                logger,
                sessionId: input.sessionID,
                messages,
            }

            if (subcommand === "context") {
                await handleContextCommand(commandCtx)
                throw new Error("__DCP_CONTEXT_HANDLED__")
            }

            if (subcommand === "stats") {
                await handleStatsCommand(commandCtx)
                throw new Error("__DCP_STATS_HANDLED__")
            }

            if (subcommand === "sweep") {
                await handleSweepCommand({
                    ...commandCtx,
                    args: subArgs,
                    workingDirectory,
                })
                throw new Error("__DCP_SWEEP_HANDLED__")
            }

            if (subcommand === "manual") {
                await handleManualToggleCommand(commandCtx, subArgs[0]?.toLowerCase())
                throw new Error("__DCP_MANUAL_HANDLED__")
            }

            if (subcommand === "compress") {
                const userFocus = subArgs.join(" ").trim()
                const prompt = await handleManualTriggerCommand(commandCtx, "compress", userFocus)
                if (!prompt) {
                    throw new Error("__DCP_MANUAL_TRIGGER_BLOCKED__")
                }

                state.manualMode = "compress-pending"
                state.pendingManualTrigger = {
                    sessionId: input.sessionID,
                    prompt,
                }
                const rawArgs = (input.arguments || "").trim()
                output.parts.length = 0
                output.parts.push({
                    type: "text",
                    text: rawArgs ? `/dcp ${rawArgs}` : `/dcp ${subcommand}`,
                })
                return
            }

            if (subcommand === "decompress") {
                await handleDecompressCommand({
                    ...commandCtx,
                    args: subArgs,
                })
                throw new Error("__DCP_DECOMPRESS_HANDLED__")
            }

            if (subcommand === "recompress") {
                await handleRecompressCommand({
                    ...commandCtx,
                    args: subArgs,
                })
                throw new Error("__DCP_RECOMPRESS_HANDLED__")
            }

            await handleHelpCommand(commandCtx)
            throw new Error("__DCP_HELP_HANDLED__")
        }
    }
}

/**
 * V2 compression-timing hooks.
 *
 * V1 scraped `message.part.updated` events; V2 exposes tool lifecycle hooks
 * directly, which is simpler and more reliable. `onBefore` records the start
 * timestamp for a `compress` call; `onAfter` resolves the duration and
 * attaches it to the pending compression blocks.
 */
export function createCompressTimingHooks(state: SessionState, logger: Logger) {
    const isCompress = (event: { tool?: unknown }) => event.tool === "compress"

    const onBefore = (event: { tool: string; id: string; messageID: string }) => {
        if (!isCompress(event)) return
        const startedAt = Date.now()
        const key = buildCompressionTimingKey(event.messageID, event.id)
        if (state.compressionTiming.startsByCallId.has(key)) return
        state.compressionTiming.startsByCallId.set(key, startedAt)
        logger.debug("Recorded compression start", {
            messageID: event.messageID,
            callID: event.id,
            startedAt,
        })
    }

    const onAfter = async (event: {
        tool: string
        id: string
        messageID: string
        status: "completed" | "error"
    }) => {
        if (!isCompress(event)) return
        if (event.status !== "completed") {
            state.compressionTiming.startsByCallId.delete(
                buildCompressionTimingKey(event.messageID, event.id),
            )
            return
        }

        const key = buildCompressionTimingKey(event.messageID, event.id)
        const start = consumeCompressionStart(state, event.messageID, event.id)
        const durationMs = resolveCompressionDuration(start, Date.now(), undefined)
        if (typeof durationMs !== "number") return

        state.compressionTiming.pendingByCallId.set(key, {
            messageId: event.messageID,
            callId: event.id,
            durationMs,
        })

        const updates = applyPendingCompressionDurations(state)
        if (updates === 0) return

        await saveSessionState(state, logger)

        logger.info("Attached compression time to blocks", {
            messageID: event.messageID,
            callID: event.id,
            blocks: updates,
            durationMs,
        })
    }

    return { onBefore, onAfter }
}
