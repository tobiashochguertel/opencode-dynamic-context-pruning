/**
 * V1-client-shaped facade over the V2 plugin context.
 *
 * The DCP engine calls a handful of `ctx.client.*` methods using the V1 SDK
 * signatures (`{ path: { id }, body: {...} }`, `{data}` responses). V2 replaces
 * `ctx.client` with domain APIs on the plugin context. This shim reproduces
 * just the surface DCP uses.
 */

import { storedToWithParts } from "./adapter"
import type { WithParts } from "../state"

interface V2Context {
    session: {
        context: (input: { sessionID: string }) => Promise<any[]>
        get: (input: { sessionID: string }) => Promise<any>
        prompt: (input: any) => Promise<any>
        synthetic: (input: any) => Promise<any>
    }
}

export interface ShimDeps {
    /** V2 plugin context (only the domains we need). */
    ctx: V2Context
    /** Toast sink — V2 server plugins have no TUI bridge. */
    notify: (title: string, message: string) => void
}

export function createClientShim({ ctx, notify }: ShimDeps) {
    return {
        session: {
            /** V1 `session.messages({path:{id}})` → `{data: WithParts[]}`. */
            messages: async (input: { path: { id: string } }) => {
                const stored = await ctx.session.context({ sessionID: input.path.id })
                return { data: storedToWithParts(stored ?? [], input.path.id) }
            },
            /** V1 `session.get({path:{id}})` → `{data: {parentID?...}}`. */
            get: async (input: { path: { id: string } }) => {
                const data = await ctx.session.get({ sessionID: input.path.id })
                return { data }
            },
            /**
             * V1 `session.prompt({path, body})`.
             *
             * DCP only uses this for `noReply: true` + `ignored: true` text
             * notifications — V2's `session.synthetic` is the equivalent.
             * A real (non-ignored) prompt goes through `session.prompt`.
             */
            prompt: async (input: { path: { id: string }; body: any }) => {
                const body = input.body ?? {}
                const parts: any[] = body.parts ?? []
                const ignored = parts.every((p) => p?.ignored === true) || body.noReply === true
                const text = parts
                    .filter((p) => p?.type === "text" && typeof p.text === "string")
                    .map((p) => p.text)
                    .join("\n")

                if (ignored) {
                    return {
                        data: await ctx.session.synthetic({
                            sessionID: input.path.id,
                            text,
                            metadata: {
                                agent: body.agent,
                                model: body.model,
                                variant: body.variant,
                            },
                        }),
                    }
                }
                return {
                    data: await ctx.session.prompt({
                        sessionID: input.path.id,
                        text,
                        files: body.files,
                        agents: body.agents,
                        skills: body.skills,
                    }),
                }
            },
        },
        tui: {
            showToast: async (input: { body?: { title?: string; message?: string } }) => {
                notify(input?.body?.title ?? "DCP", input?.body?.message ?? "")
            },
        },
    }
}

export type ClientShim = ReturnType<typeof createClientShim>
