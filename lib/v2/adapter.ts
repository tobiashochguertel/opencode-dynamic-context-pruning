/**
 * V2 adapter layer.
 *
 * DCP's engine was built against the OpenCode V1 message model:
 * `WithParts = { info: Message, parts: Part[] }` where tool calls and their
 * results share one `tool` part (`state.input`/`state.output`).
 *
 * OpenCode V2 exposes two different shapes:
 *  - `ctx.session.context()` returns stored `SessionMessageInfo[]` records
 *    (typed messages: user / assistant / tool content with `state`).
 *  - `ctx.session.hook("context")` receives model-facing `Message[]` from
 *    `@opencode/ai` (role + flat content parts; tool results are separate
 *    `tool`-role messages).
 *
 * This module converts both shapes into `WithParts[]` for the engine, and
 * reconciles engine mutations back into the model-facing array.
 */

import type { WithParts } from "../state"

type AnyRecord = Record<string, any>

let syntheticCounter = 0
const synthId = (prefix: string) => `${prefix}_v2_${++syntheticCounter}`

/* ------------------------------------------------------------------ */
/* shared helpers                                                      */
/* ------------------------------------------------------------------ */

function extractText(content: unknown): string {
    if (typeof content === "string") return content
    if (!Array.isArray(content)) {
        if (content === undefined || content === null) return ""
        try {
            return JSON.stringify(content)
        } catch {
            return String(content)
        }
    }
    return content
        .map((c: AnyRecord) => {
            if (!c || typeof c !== "object") return String(c ?? "")
            if (c.type === "text") return c.text ?? ""
            if (c.type === "file") return `[file: ${c.name ?? c.uri ?? ""}]`
            return c.text ?? ""
        })
        .join("\n")
}

function toolStateToV1(state: AnyRecord | undefined): AnyRecord {
    if (!state || typeof state !== "object") {
        return { status: "pending", input: {} }
    }
    const status = state.status ?? "pending"
    const out: AnyRecord = {
        status,
        input: state.input ?? {},
    }
    if (state.time) out.time = state.time
    if (status === "completed") {
        // V2 stores tool results as a structured content array; the engine
        // expects a string in state.output.
        out.output = extractText(state.content ?? state.output)
        if (state.title) out.title = state.title
        if (state.metadata) out.metadata = state.metadata
    } else if (status === "error") {
        const err = state.error
        out.error = typeof err === "string" ? err : (err?.message ?? JSON.stringify(err ?? "error"))
        if (state.content) out.output = extractText(state.content)
        if (state.metadata) out.metadata = state.metadata
    }
    return out
}

/* ------------------------------------------------------------------ */
/* Stored messages (session.context API) -> WithParts                  */
/* ------------------------------------------------------------------ */

/**
 * Convert stored `SessionMessageInfo[]` (from `session.context`) to
 * engine-facing `WithParts[]`.
 */
export function storedToWithParts(messages: AnyRecord[], sessionID: string): WithParts[] {
    const out: WithParts[] = []

    for (const msg of messages) {
        if (!msg || typeof msg !== "object") continue
        const type = msg.type as string | undefined
        const timeCreated = typeof msg.time?.created === "number" ? msg.time.created : Date.now()

        if (type === "user" || type === "synthetic" || type === "system" || type === "skill") {
            const parts: AnyRecord[] = []
            const text = typeof msg.text === "string" ? msg.text : ""
            if (text.length > 0) {
                parts.push({
                    id: synthId("prt"),
                    sessionID,
                    messageID: msg.id,
                    type: "text",
                    text,
                    ...(type === "synthetic" ? { synthetic: true, ignored: true } : {}),
                })
            }
            for (const f of msg.files ?? []) {
                parts.push({
                    id: synthId("prt"),
                    sessionID,
                    messageID: msg.id,
                    type: "file",
                    url: f.uri,
                    mime: f.mime ?? "text/plain",
                    filename: f.name,
                })
            }
            out.push({
                info: {
                    id: msg.id ?? synthId("msg"),
                    sessionID,
                    role: "user",
                    time: { created: timeCreated },
                    ...(type === "synthetic" ? { synthetic: true } : {}),
                    ...(msg.metadata ? { metadata: msg.metadata } : {}),
                },
                parts,
            })
            continue
        }

        if (type === "assistant") {
            const parts: AnyRecord[] = []
            for (const part of msg.content ?? []) {
                if (part?.type === "text") {
                    parts.push({
                        id: part.id ?? synthId("prt"),
                        sessionID,
                        messageID: msg.id,
                        type: "text",
                        text: part.text ?? "",
                        ...(part.metadata ? { metadata: part.metadata } : {}),
                    })
                } else if (part?.type === "reasoning") {
                    parts.push({
                        id: part.id ?? synthId("prt"),
                        sessionID,
                        messageID: msg.id,
                        type: "reasoning",
                        text: part.text ?? "",
                    })
                } else if (part?.type === "tool") {
                    parts.push({
                        id: part.id ?? synthId("prt"),
                        sessionID,
                        messageID: msg.id,
                        type: "tool",
                        callID: part.id,
                        tool: part.name,
                        state: toolStateToV1(part.state),
                        ...(part.metadata ? { metadata: part.metadata } : {}),
                    })
                }
            }
            const modelRef = msg.model
            out.push({
                info: {
                    id: msg.id ?? synthId("msg"),
                    sessionID,
                    role: "assistant",
                    time: {
                        created: timeCreated,
                        ...(msg.time?.completed ? { completed: msg.time.completed } : {}),
                    },
                    agent: msg.agent,
                    providerID: modelRef?.providerID,
                    modelID: modelRef?.modelID,
                    model: modelRef,
                    tokens: msg.tokens,
                    cost: msg.cost,
                    finish: msg.finish,
                    error: msg.error,
                    ...(msg.metadata ? { metadata: msg.metadata } : {}),
                },
                parts,
            })
            continue
        }

        if (type === "compaction") {
            // V1 marked compaction as assistant messages with info.summary=true.
            out.push({
                info: {
                    id: msg.id ?? synthId("msg"),
                    sessionID,
                    role: "assistant",
                    time: { created: timeCreated },
                    summary: true,
                    ...(msg.metadata ? { metadata: msg.metadata } : {}),
                },
                parts: [
                    {
                        id: synthId("prt"),
                        sessionID,
                        messageID: msg.id,
                        type: "compaction",
                        text: typeof msg.summary === "string" ? msg.summary : "",
                    },
                ],
            })
            continue
        }

        if (type === "shell") {
            out.push({
                info: {
                    id: msg.id ?? synthId("msg"),
                    sessionID,
                    role: "assistant",
                    time: { created: timeCreated },
                    ...(msg.metadata ? { metadata: msg.metadata } : {}),
                },
                parts: [
                    {
                        id: synthId("prt"),
                        sessionID,
                        messageID: msg.id,
                        type: "tool",
                        callID: msg.id ?? synthId("call"),
                        tool: "bash",
                        state: toolStateToV1(msg.state),
                    },
                ],
            })
            continue
        }

        // agent_selected / model_selected / location_switched / idle — not
        // model content; skip.
    }

    return out
}

/* ------------------------------------------------------------------ */
/* Model-facing messages (session "context" hook) -> WithParts          */
/* ------------------------------------------------------------------ */

interface PartBacking {
    /** The V2 assistant/user message holding the source content part. */
    message: AnyRecord
    /** Index of the backing content part inside message.content. */
    index: number
    /** For tool parts: the tool-result part and its message, if merged. */
    resultMessage?: AnyRecord
    resultPart?: AnyRecord
}

export interface AdaptedMessages {
    /** Engine-facing view. Mutate freely. */
    withParts: WithParts[]
    /** Write engine mutations back into the original V2 array, in place. */
    commit(): void
}

/**
 * Convert the model-facing `Message[]` from the `context` hook into
 * `WithParts[]`. `tool-result` parts (on `tool`-role messages) are merged into
 * the matching `tool-call` parts on assistant messages via the shared `id`.
 *
 * `commit()` writes all engine mutations back into `v2messages` in place,
 * preserving chronological order: result messages stay right after the
 * assistant message carrying their call.
 */
export function adaptModelMessages(v2messages: AnyRecord[], sessionID: string): AdaptedMessages {
    const backing = new Map<object, PartBacking>()
    const msgBacking = new Map<object, AnyRecord>()
    const resultByCallId = new Map<string, { message: AnyRecord; part: AnyRecord }>()

    // First pass: index tool-result parts by call id.
    for (const msg of v2messages) {
        if (msg?.role !== "tool" || !Array.isArray(msg.content)) continue
        for (const part of msg.content) {
            if (part?.type === "tool-result" && typeof part.id === "string") {
                resultByCallId.set(part.id, { message: msg, part })
            }
        }
    }

    const withParts: WithParts[] = []

    for (const msg of v2messages) {
        if (!msg || typeof msg !== "object" || msg.role === "tool") continue

        const info: AnyRecord = {
            id: msg.id ?? synthId("msg"),
            sessionID,
            role: msg.role === "assistant" ? "assistant" : "user",
            time: { created: Date.now() },
            ...(msg.metadata ? { metadata: msg.metadata } : {}),
        }
        const parts: AnyRecord[] = []
        const base = {
            sessionID,
            messageID: info.id,
        }
        ;(msg.content ?? []).forEach((part: AnyRecord, index: number) => {
            let v1: AnyRecord | null = null
            switch (part?.type) {
                case "text":
                    v1 = {
                        id: synthId("prt"),
                        ...base,
                        type: "text",
                        text: part.text ?? "",
                        ...(part.metadata ? { metadata: part.metadata } : {}),
                    }
                    break
                case "reasoning":
                    v1 = { id: synthId("prt"), ...base, type: "reasoning", text: part.text ?? "" }
                    break
                case "media":
                    v1 = {
                        id: synthId("prt"),
                        ...base,
                        type: "file",
                        mime: part.mediaType,
                        url: part.data,
                        filename: part.filename,
                    }
                    break
                case "tool-call":
                    v1 = {
                        id: synthId("prt"),
                        ...base,
                        type: "tool",
                        callID: part.id,
                        tool: part.name,
                        state: { status: "running", input: part.input ?? {}, time: {} },
                    }
                    break
                case "compaction":
                    v1 = { id: synthId("prt"), ...base, type: "compaction", text: part.text ?? "" }
                    break
                case "effort":
                    v1 = {
                        id: synthId("prt"),
                        ...base,
                        type: "step-start",
                        metadata: { effort: part.effort },
                    }
                    break
            }
            if (!v1) return
            parts.push(v1)
            backing.set(v1, { message: msg, index })

            if (v1.type === "tool" && typeof v1.callID === "string") {
                const res = resultByCallId.get(v1.callID)
                if (res) {
                    const isError = res.part.result?.type === "error"
                    v1.state.status = isError ? "error" : "completed"
                    if (isError) {
                        v1.state.error =
                            typeof res.part.result.value === "string"
                                ? res.part.result.value
                                : JSON.stringify(res.part.result?.value ?? "error")
                    } else {
                        v1.state.output =
                            res.part.result?.type === "content"
                                ? extractText(res.part.result.value)
                                : typeof res.part.result?.value === "string"
                                  ? res.part.result.value
                                  : JSON.stringify(res.part.result?.value ?? "")
                    }
                    backing.get(v1)!.resultMessage = res.message
                    backing.get(v1)!.resultPart = res.part
                }
            }
        })

        const wp: WithParts = { info, parts }
        msgBacking.set(wp, msg)
        withParts.push(wp)
    }

    const commit = () => {
        // callID -> result message, so results can be re-emitted right after
        // the assistant message carrying their call.
        const resultMsgByCallId = new Map<string, AnyRecord>()
        for (const [callId, res] of resultByCallId) {
            resultMsgByCallId.set(callId, res.message)
        }

        const emittedResults = new Set<AnyRecord>()
        const nextV2: AnyRecord[] = []

        const emitResultsFor = (msg: WithParts) => {
            for (const part of msg.parts) {
                if (part.type !== "tool" || typeof part.callID !== "string") continue
                const resMsg = resultMsgByCallId.get(part.callID)
                if (resMsg && !emittedResults.has(resMsg)) {
                    emittedResults.add(resMsg)
                    nextV2.push(resMsg)
                }
            }
        }

        for (const msg of withParts) {
            const v2msg = msgBacking.get(msg)
            if (!v2msg) {
                for (const m of v1MessageToV2(msg)) nextV2.push(m)
                continue
            }

            const content: AnyRecord[] = Array.isArray(v2msg.content) ? v2msg.content : []
            const keep = new Array<boolean>(content.length).fill(false)
            const append: AnyRecord[] = []

            for (const part of msg.parts) {
                const b = backing.get(part)
                if (!b) {
                    const converted = v1PartToV2(part)
                    if (converted) append.push(converted)
                    continue
                }
                keep[b.index] = true
                syncBackedPart(part, b, content)
            }

            v2msg.content = content.filter((_, i) => keep[i]).concat(append)
            nextV2.push(v2msg)
            emitResultsFor(msg)
        }

        // Orphaned result messages (call part removed by the engine) are kept
        // at the end rather than dropped — losing a result entirely is worse
        // than imperfect ordering.
        for (const [, res] of resultByCallId) {
            if (!emittedResults.has(res.message)) {
                emittedResults.add(res.message)
                nextV2.push(res.message)
            }
        }

        v2messages.length = 0
        v2messages.push(...nextV2)
    }

    return { withParts, commit }
}

function syncBackedPart(part: AnyRecord, b: PartBacking, content: AnyRecord[]) {
    const target = content[b.index]
    if (!target) return

    if (part.type === "text" && target.type === "text") {
        target.text = part.text ?? ""
        if (part.metadata) target.metadata = part.metadata
        return
    }
    if (part.type === "reasoning" && target.type === "reasoning") {
        target.text = part.text ?? ""
        return
    }
    if (part.type === "file" && target.type === "media") {
        target.data = part.url ?? target.data
        return
    }
    if (part.type === "tool" && target.type === "tool-call") {
        if (part.metadata) target.metadata = part.metadata
        const state = part.state ?? {}
        const resPart = b.resultPart
        if (resPart?.type === "tool-result") {
            if (state.status === "error") {
                resPart.result = { type: "error", value: state.error ?? "error" }
            } else if (typeof state.output === "string") {
                resPart.result = { type: "text", value: state.output }
            }
            if (part.metadata) resPart.metadata = part.metadata
        }
        return
    }
}

function v1PartToV2(part: AnyRecord): AnyRecord | null {
    switch (part.type) {
        case "text":
            return {
                type: "text",
                text: part.text ?? "",
                ...(part.metadata ? { metadata: part.metadata } : {}),
            }
        case "reasoning":
            return { type: "reasoning", text: part.text ?? "" }
        case "file":
            return {
                type: "media",
                mediaType: part.mime ?? "application/octet-stream",
                data: part.url ?? "",
                filename: part.filename,
            }
        case "tool":
            return {
                type: "tool-call",
                id: part.callID ?? synthId("call"),
                name: part.tool ?? "tool",
                input: part.state?.input ?? {},
                ...(part.metadata ? { metadata: part.metadata } : {}),
            }
        default:
            return null
    }
}

/** Convert an engine-created message into V2 messages (a `tool` part may
 *  produce an assistant tool-call plus a following tool-result message). */
function v1MessageToV2(msg: WithParts): AnyRecord[] {
    const role = msg.info.role === "assistant" ? "assistant" : "user"
    const content: AnyRecord[] = []
    const results: AnyRecord[] = []

    for (const part of msg.parts) {
        if (part.type === "tool") {
            const state = part.state ?? {}
            content.push(v1PartToV2(part)!)
            if (state.status === "completed" || state.status === "error") {
                results.push({
                    type: "tool-result",
                    id: part.callID ?? synthId("call"),
                    name: part.tool ?? "tool",
                    result:
                        state.status === "error"
                            ? { type: "error", value: state.error ?? "error" }
                            : { type: "text", value: state.output ?? "" },
                    ...(part.metadata ? { metadata: part.metadata } : {}),
                })
            }
            continue
        }
        const converted = v1PartToV2(part)
        if (converted) content.push(converted)
    }

    const out: AnyRecord[] = [
        {
            id: msg.info.id,
            role,
            content,
            ...(msg.info.metadata ? { metadata: msg.info.metadata } : {}),
        },
    ]
    if (results.length > 0) {
        out.push({ role: "tool", content: results })
    }
    return out
}
