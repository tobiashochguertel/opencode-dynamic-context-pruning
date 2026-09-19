import type { WithParts } from "../state"
import { ensureSessionInitialized } from "../state"
import { saveSessionState } from "../state/persistence"
import { assignMessageRefs } from "../message-ids"
import { isIgnoredUserMessage } from "../messages/query"
import { deduplicate, purgeErrors } from "../strategies"
import { getCurrentParams, getCurrentTokenUsage } from "../token-utils"
import { sendCompressNotification } from "../ui/notification"
import type { ToolContext } from "./types"
import { buildSearchContext, fetchSessionMessages } from "./search"
import type { SearchContext } from "./types"
import { applyPendingCompressionDurations } from "./timing"

interface RunContext {
    /** V2 tool context: call id (V1 `callID`). */
    id?: string
    /** V2 tool context: progress/metadata updates (V1 `metadata()`). */
    progress?(input: Record<string, unknown>): Promise<void> | void
    sessionID: string
    messageID: string
}

export interface NotificationEntry {
    blockId: number
    runId: number
    summary: string
    summaryTokens: number
}

export interface PreparedSession {
    rawMessages: WithParts[]
    searchContext: SearchContext
}

export async function prepareSession(
    ctx: ToolContext,
    toolCtx: RunContext,
    title: string,
): Promise<PreparedSession> {
    if (ctx.state.manualMode && ctx.state.manualMode !== "compress-pending") {
        throw new Error(
            "Manual mode: compress blocked. Do not retry until `<compress triggered manually>` appears in user context.",
        )
    }

    // V1 called toolCtx.ask({permission: "compress"}) here. In V2 the
    // permission is enforced declaratively via the tool's
    // `options.permission` + the permission.evaluate hook.
    await toolCtx.progress?.({ title })

    const rawMessages = await fetchSessionMessages(ctx.client, toolCtx.sessionID)

    await ensureSessionInitialized(
        ctx.client,
        ctx.state,
        toolCtx.sessionID,
        ctx.logger,
        rawMessages,
        ctx.config.manualMode.enabled,
    )

    assignMessageRefs(ctx.state, rawMessages)

    deduplicate(ctx.state, ctx.logger, ctx.config, rawMessages)
    purgeErrors(ctx.state, ctx.logger, ctx.config, rawMessages)

    return {
        rawMessages,
        searchContext: buildSearchContext(ctx.state, rawMessages),
    }
}

export async function finalizeSession(
    ctx: ToolContext,
    toolCtx: RunContext,
    rawMessages: WithParts[],
    entries: NotificationEntry[],
    batchTopic: string | undefined,
): Promise<void> {
    ctx.state.manualMode = ctx.state.manualMode ? "active" : false
    applyPendingCompressionDurations(ctx.state)
    await saveSessionState(ctx.state, ctx.logger)

    const params = getCurrentParams(ctx.state, rawMessages, ctx.logger)
    const sessionMessageIds = rawMessages
        .filter((msg) => !isIgnoredUserMessage(msg))
        .map((msg) => msg.info.id)

    await sendCompressNotification(
        ctx.client,
        ctx.logger,
        ctx.config,
        ctx.state,
        toolCtx.sessionID,
        entries,
        batchTopic,
        sessionMessageIds,
        params,
    )
}
