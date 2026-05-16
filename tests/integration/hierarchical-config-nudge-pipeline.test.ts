import assert from "node:assert/strict"
import test from "node:test"
import type { PluginConfig, } from "../../lib/config"
import { getNudgeFrequency, getIterationNudgeThreshold, getModelInfo, isContextOverLimits } from "../../lib/messages/inject/utils"
import { createSessionState, type WithParts } from "../../lib/state"

function baseConfig(providers?: Record<string, any>): PluginConfig {
    return {
        enabled: true, debug: false,
        pruneNotification: "off", pruneNotificationType: "chat",
        commands: { enabled: true, protectedTools: [] },
        manualMode: { enabled: false, automaticStrategies: true },
        turnProtection: { enabled: false, turns: 4 },
        experimental: { allowSubAgents: false, customPrompts: false },
        protectedFilePatterns: [],
        compress: {
            mode: "range", permission: "allow",
            showCompression: false, summaryBuffer: true,
            maxContextLimit: "90%", minContextLimit: "25%",
            nudgeFrequency: 5, iterationNudgeThreshold: 15,
            nudgeForce: "soft", protectedTools: ["task"],
            protectTags: false, protectUserMessages: false,
            providers,
        },
        strategies: {
            deduplication: { enabled: true, protectedTools: [] },
            purgeErrors: { enabled: true, turns: 4, protectedTools: [] },
        },
    }
}

function userMsg(id: string, text: string, provider: string, model: string): WithParts {
    return {
        info: {
            id, role: "user" as const, sessionID: "ses_nudge",
            agent: "assistant", time: { created: 1 },
            model: { providerID: provider, modelID: model, limit: { context: 200000 } },
        } as any,
        parts: [{ id: id + "-p", messageID: id, sessionID: "ses_nudge", type: "text" as const, text }],
    }
}

function assistMsg(id: string, text: string, inputTokens = 1000): WithParts {
    return {
        info: {
            id, role: "assistant" as const, sessionID: "ses_nudge",
            agent: "assistant", time: { created: 2 },
            tokens: { input: inputTokens, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
        } as any,
        parts: [{ id: id + "-p", messageID: id, sessionID: "ses_nudge", type: "text" as const, text }],
    }
}

test("getModelInfo extracts providerId and modelId from last user message", () => {
    const messages = [
        userMsg("u1", "hello", "opencode-go", "deepseek-v4-flash"),
        assistMsg("a1", "hi"),
    ]
    const info = getModelInfo(messages)
    assert.equal(info.providerId, "opencode-go")
    assert.equal(info.modelId, "deepseek-v4-flash")
})

test("getNudgeFrequency with provider override in nudge pipeline", () => {
    const config = baseConfig({ "opencode-go": { nudgeFrequency: 2 } })
    assert.equal(getNudgeFrequency(config, "opencode-go", undefined), 2)
})

test("getNudgeFrequency with model override in nudge pipeline", () => {
    const config = baseConfig({
        "opencode-go": {
            nudgeFrequency: 10,
            models: { "deepseek-v4-flash": { nudgeFrequency: 3 } },
        },
    })
    assert.equal(getNudgeFrequency(config, "opencode-go", "deepseek-v4-flash"), 3)
})

test("getIterationNudgeThreshold with provider override", () => {
    const config = baseConfig({ "opencode-go": { iterationNudgeThreshold: 30 } })
    assert.equal(getIterationNudgeThreshold(config, "opencode-go", undefined), 30)
})

test("getIterationNudgeThreshold with model override", () => {
    const config = baseConfig({
        "opencode-go": {
            iterationNudgeThreshold: 30,
            models: { "deepseek-v4-pro": { iterationNudgeThreshold: 50 } },
        },
    })
    assert.equal(getIterationNudgeThreshold(config, "opencode-go", "deepseek-v4-pro"), 50)
})

test("isContextOverLimits respects model override when provider also has limits", () => {
    const state = createSessionState()
    state.modelContextLimit = 1_000_000

    const config = baseConfig({
        "opencode-go": {
            minContextLimit: "10%",
            maxContextLimit: "90%",
            models: {
                "deepseek-v4-pro": {
                    maxContextLimit: 500_000,
                    minContextLimit: 100_000,
                },
            },
        },
    })

    const overMin = assistMsg("a1", "response", 150_000)
    const messages = [userMsg("u1", "hello", "opencode-go", "deepseek-v4-pro"), overMin]
    const result = isContextOverLimits(config, state, "opencode-go", "deepseek-v4-pro", messages)
    assert.equal(result.overMinLimit, true)
    assert.equal(result.overMaxLimit, false)

    const overMax = assistMsg("a2", "response", 600_000)
    const messages2 = [userMsg("u2", "hello", "opencode-go", "deepseek-v4-pro"), overMax]
    const result2 = isContextOverLimits(config, state, "opencode-go", "deepseek-v4-pro", messages2)
    assert.equal(result2.overMinLimit, true)
    assert.equal(result2.overMaxLimit, true)
})
