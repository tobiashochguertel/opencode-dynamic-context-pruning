import { Plugin } from "@opencode/plugin"
import { getConfig } from "./lib/config"
import { createCompressMessageTool, createCompressRangeTool } from "./lib/compress"
import {
    compressDisabledByOpencode,
    resolveEffectiveCompressPermission,
} from "./lib/host-permissions"
import { Logger } from "./lib/logger"
import { createSessionState } from "./lib/state"
import { PromptStore } from "./lib/prompts/store"
import {
    createChatMessageTransformHandler,
    createCommandExecuteHandler,
    createCompressTimingHooks,
    createSystemPromptHandler,
} from "./lib/hooks"
import { isSecureMode } from "./lib/auth"
import { startAutoUpdate } from "./lib/update"
import { adaptModelMessages } from "./lib/v2/adapter"
import { createClientShim } from "./lib/v2/client"
import { readHostPermissions } from "./lib/v2/host-config"
import type { PluginHost } from "./lib/v2/host"

const COMPRESS_PERMISSION_ACTIONS = new Set(["compress", "tool.compress", "tool:compress"])

export default Plugin.define({
    id: "dcp",
    async setup(ctx) {
        const host: PluginHost = {
            directory: ctx.location.directory,
            notify: (title, message) => console.warn(`[dcp] ${title}: ${message}`),
        }

        const config = getConfig(host)
        if (!config.enabled) {
            return
        }

        const logger = new Logger(config.debug)
        host.notify = (title, message) => logger.warn(`${title}: ${message}`)

        const state = createSessionState()
        const prompts = new PromptStore(logger, host.directory, config.experimental.customPrompts)
        const client = createClientShim({ ctx, notify: host.notify })

        // V1 read the host permission map through the `config` hook; V2 has no
        // config hook, so the snapshot is read from the same config files.
        const hostPermissions = readHostPermissions(host)
        if (
            config.compress.permission !== "deny" &&
            compressDisabledByOpencode(
                hostPermissions.global,
                ...Object.values(hostPermissions.agents),
            )
        ) {
            config.compress.permission = "deny"
        }

        if (isSecureMode()) {
            logger.info("Secure mode detected; V2 handles server auth internally")
        }

        logger.info("DCP initialized", {
            strategies: config.strategies,
        })

        startAutoUpdate(host, config.autoUpdate)

        const compressToolContext = {
            client,
            state,
            logger,
            config,
            prompts,
        }

        const systemHandler = createSystemPromptHandler(state, logger, config, prompts)
        const messagesHandler = createChatMessageTransformHandler(
            client,
            state,
            logger,
            config,
            prompts,
            hostPermissions,
        )

        // Combined V2 equivalent of `experimental.chat.system.transform` +
        // `experimental.chat.messages.transform`.
        await ctx.session.hook("context", async (event: any) => {
            try {
                const models = await ctx.model.list()
                const ref = event.model
                const info = (models?.data ?? []).find(
                    (m: any) =>
                        m.providerID === ref?.providerID &&
                        (m.modelID === ref?.modelID || m.id === ref?.modelID),
                )
                const contextLimit = info?.limit?.context
                const sysStrings: string[] = (event.system ?? []).map((p: any) => p?.text ?? "")
                await systemHandler(
                    {
                        sessionID: event.sessionID,
                        model: { limit: { context: contextLimit ?? 0 } },
                    },
                    { system: sysStrings },
                )
                for (let i = 0; i < sysStrings.length; i++) {
                    if (i < (event.system?.length ?? 0)) {
                        event.system[i].text = sysStrings[i]
                    } else {
                        event.system.push({ type: "text", text: sysStrings[i] })
                    }
                }

                const adapted = adaptModelMessages(event.messages ?? [], event.sessionID)
                await messagesHandler({}, { messages: adapted.withParts })
                adapted.commit()
            } catch (err: any) {
                logger.error("DCP context hook failed", { error: err?.message ?? String(err) })
            }
        })

        // compress tool — V1 registered it through the `tool` map.
        if (config.compress.permission !== "deny") {
            const compressTool =
                config.compress.mode === "message"
                    ? createCompressMessageTool(compressToolContext)
                    : createCompressRangeTool(compressToolContext)
            await ctx.tool.transform((editor: any) => {
                editor.add(compressTool as any)
            })
        }

        // /dcp command — V1 registered it through the `config` hook and
        // intercepted execution via `command.execute.before`.
        if (config.commands.enabled && config.compress.permission !== "deny") {
            const commandHandler = createCommandExecuteHandler(
                client,
                state,
                logger,
                config,
                host.directory,
                hostPermissions,
            )
            await ctx.command.transform((editor: any) => {
                editor.add({
                    name: "dcp",
                    description: "Show available DCP commands",
                    execute: async (invocation: any) => {
                        const rawText: string = invocation?.prompt?.text ?? ""
                        const argsText = rawText.replace(/^\s*\/?dcp\b/, "").trim()
                        const output = { parts: [] as any[] }
                        try {
                            await commandHandler(
                                {
                                    command: "dcp",
                                    sessionID: invocation.sessionID,
                                    arguments: argsText,
                                },
                                output,
                            )
                            // The `compress` subcommand rewrites the prompt
                            // through output.parts (V1 behavior).
                            const rewritten = output.parts
                                .filter((p) => p?.type === "text" && typeof p.text === "string")
                                .map((p) => p.text)
                                .join("\n")
                            if (rewritten && invocation?.prompt) {
                                try {
                                    ;(invocation.prompt as any).text = rewritten
                                } catch {
                                    await ctx.session.synthetic({
                                        sessionID: invocation.sessionID,
                                        text: rewritten,
                                    } as any)
                                }
                            }
                        } catch (err: any) {
                            // Handled subcommands threw __DCP_*_HANDLED__ in V1
                            // to suppress the default prompt; in V2 the
                            // command's execute() is the whole behavior, so
                            // the throw is just control flow.
                            if (typeof err?.message === "string" && err.message.includes("__DCP_")) {
                                if (invocation?.prompt) {
                                    try {
                                        ;(invocation.prompt as any).text = ""
                                    } catch {}
                                }
                                return
                            }
                            throw err
                        }
                    },
                })
            })
        }

        // Enforce the configured compress permission — replaces the V1
        // `config` hook's `permission.compress` default.
        await ctx.permission.hook("evaluate", (input: any) => {
            const action = typeof input?.action === "string" ? input.action : ""
            if (!COMPRESS_PERMISSION_ACTIONS.has(action) && !action.endsWith(".compress")) return
            const resolved = resolveEffectiveCompressPermission(
                config.compress.permission,
                hostPermissions,
                input.agent,
            )
            if (resolved === "deny" || input.effect !== "deny") {
                input.effect = resolved
            }
        })

        // Compression timing — V1 used an `event` hook on message.part.updated;
        // V2 tool hooks carry the lifecycle directly.
        const timing = createCompressTimingHooks(state, logger)
        await ctx.tool.hook("execute.before", (event: any) => timing.onBefore(event))
        await ctx.tool.hook("execute.after", (event: any) => timing.onAfter(event))

        // NOTE: V1's `experimental.text.complete` hook (stripped hallucinated
        // DCP tags from generated text) has no V2 equivalent and is dropped.
    },
})
