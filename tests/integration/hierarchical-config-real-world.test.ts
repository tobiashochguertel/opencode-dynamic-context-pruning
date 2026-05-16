import assert from "node:assert/strict"
import test from "node:test"
import type { PluginConfig } from "../../lib/config"
import { isContextOverLimits } from "../../lib/messages/inject/utils"
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

function msg(user: string, assistant: string, provider: string, model: string, ctx: number, inputTokens: number): WithParts[] {
    return [
        {
            info: {
                id: "msg-" + user, role: "user" as const,
                sessionID: "ses_real", agent: "assistant",
                time: { created: 1 },
                model: { providerID: provider, modelID: model, limit: { context: ctx } },
            } as any,
            parts: [{ id: "p-user", messageID: "msg-" + user, sessionID: "ses_real", type: "text" as const, text: user }],
        },
        {
            info: {
                id: "msg-" + assistant, role: "assistant" as const,
                sessionID: "ses_real", agent: "assistant",
                time: { created: 2 },
                tokens: { input: inputTokens, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
            } as any,
            parts: [{ id: "p-assist", messageID: "msg-" + assistant, sessionID: "ses_real", type: "text" as const, text: assistant }],
        },
    ]
}

function createTest(
    name: string,
    provider: string,
    model: string,
    context: number,
    providerCfg: Record<string, any>,
    inputTokens: number,
    expectMin: boolean,
    expectMax: boolean,
) {
    test(name, () => {
        const state = createSessionState()
        state.modelContextLimit = context

        const config = baseConfig(providerCfg)
        const messages = msg("user", "assistant", provider, model, context, inputTokens)
        const result = isContextOverLimits(config, state, provider, model, messages)
        assert.equal(result.overMinLimit, expectMin, `${name}: overMinLimit should be ${expectMin}`)
        assert.equal(result.overMaxLimit, expectMax, `${name}: overMaxLimit should be ${expectMax}`)
    })
}

// --- opencode-go deepseek-v4-flash (1M context) ---
const deepseekFlash: Record<string, any> = {
    "opencode-go": { maxContextLimit: "90%", minContextLimit: "10%",
        models: { "deepseek-v4-flash": {} },
    },
}
createTest("deepseek-v4-flash at 15K (below min)", "opencode-go", "deepseek-v4-flash", 1_000_000, deepseekFlash, 15_000, false, false)
createTest("deepseek-v4-flash at 500K (above min, below max)", "opencode-go", "deepseek-v4-flash", 1_000_000, deepseekFlash, 500_000, true, false)
createTest("deepseek-v4-flash at 950K (above both)", "opencode-go", "deepseek-v4-flash", 1_000_000, deepseekFlash, 950_000, true, true)

// --- opencode-go deepseek-v4-pro (1M context, lower max) ---
const deepseekPro: Record<string, any> = {
    "opencode-go": { maxContextLimit: "80%", minContextLimit: "10%",
        models: { "deepseek-v4-pro": {} },
    },
}
createTest("deepseek-v4-pro at 15K (below min)", "opencode-go", "deepseek-v4-pro", 1_000_000, deepseekPro, 15_000, false, false)
createTest("deepseek-v4-pro at 750K (above min, below max)", "opencode-go", "deepseek-v4-pro", 1_000_000, deepseekPro, 750_000, true, false)
createTest("deepseek-v4-pro at 850K (above both)", "opencode-go", "deepseek-v4-pro", 1_000_000, deepseekPro, 850_000, true, true)

// --- opencode-go qwen3-6-plus (1M context, medium max) ---
const qwen36: Record<string, any> = {
    "opencode-go": { maxContextLimit: "85%", minContextLimit: "10%",
        models: { "qwen3-6-plus": {} },
    },
}
createTest("qwen3-6-plus at 200K (above min, below max)", "opencode-go", "qwen3-6-plus", 1_000_000, qwen36, 200_000, true, false)
createTest("qwen3-6-plus at 900K (above both)", "opencode-go", "qwen3-6-plus", 1_000_000, qwen36, 900_000, true, true)

// --- opencode-go qwen3-5-plus (1M context, high max, high min) ---
const qwen35: Record<string, any> = {
    "opencode-go": { maxContextLimit: "90%", minContextLimit: "40%",
        models: { "qwen3-5-plus": {} },
    },
}
createTest("qwen3-5-plus at 50K (below min)", "opencode-go", "qwen3-5-plus", 1_000_000, qwen35, 50_000, false, false)
createTest("qwen3-5-plus at 500K (above min, below max)", "opencode-go", "qwen3-5-plus", 1_000_000, qwen35, 500_000, true, false)

// --- opencode-go kimi-k2-5 (1M context, conservative limits) ---
const kimi25: Record<string, any> = {
    "opencode-go": { maxContextLimit: "85%", minContextLimit: "15%",
        models: { "kimi-k2-5": {} },
    },
}
createTest("kimi-k2-5 at 100K (below min)", "opencode-go", "kimi-k2-5", 1_000_000, kimi25, 100_000, false, false)
createTest("kimi-k2-5 at 800K (above min, below max)", "opencode-go", "kimi-k2-5", 1_000_000, kimi25, 800_000, true, false)

// --- Non-opencode providers ---

// gemini-3-pro (200K context)
const gemini: Record<string, any> = {
    "google": { maxContextLimit: "90%", minContextLimit: "25%",
        models: { "gemini-3-pro": {} },
    },
}
createTest("gemini-3-pro at 10K (below min)", "google", "gemini-3-pro", 200_000, gemini, 10_000, false, false)
createTest("gemini-3-pro at 100K (above min, below max)", "google", "gemini-3-pro", 200_000, gemini, 100_000, true, false)
createTest("gemini-3-pro at 190K (above both)", "google", "gemini-3-pro", 200_000, gemini, 190_000, true, true)

// claude-sonnet-4-6 (200K context)
const claude: Record<string, any> = {
    "anthropic": { maxContextLimit: "80%", minContextLimit: "30%",
        models: { "claude-sonnet-4-6": {} },
    },
}
createTest("claude-sonnet-4-6 at 50K (below min)", "anthropic", "claude-sonnet-4-6", 200_000, claude, 50_000, false, false)
createTest("claude-sonnet-4-6 at 150K (above min, below max)", "anthropic", "claude-sonnet-4-6", 200_000, claude, 150_000, true, false)
createTest("claude-sonnet-4-6 at 170K (above both)", "anthropic", "claude-sonnet-4-6", 200_000, claude, 170_000, true, true)

// gpt-5.3-codex (272K context)
const gpt53: Record<string, any> = {
    "openai": { maxContextLimit: "85%", minContextLimit: "20%",
        models: { "gpt-5.3-codex": {} },
    },
}
createTest("gpt-5.3-codex at 40K (below min)", "openai", "gpt-5.3-codex", 272_000, gpt53, 40_000, false, false)
createTest("gpt-5.3-codex at 200K (above min, below max)", "openai", "gpt-5.3-codex", 272_000, gpt53, 200_000, true, false)
createTest("gpt-5.3-codex at 240K (above both)", "openai", "gpt-5.3-codex", 272_000, gpt53, 240_000, true, true)

// --- Per-model override over provider ---
test("model overrides provider maxContextLimit — deepseek-v4-pro with lower max", () => {
    const state = createSessionState()
    state.modelContextLimit = 1_000_000

    const config = baseConfig({
        "opencode-go": {
            maxContextLimit: "90%",
            models: { "deepseek-v4-pro": { maxContextLimit: "70%" } },
        },
    })
    const messages = msg("user", "assistant", "opencode-go", "deepseek-v4-pro", 1_000_000, 750_000)
    const result = isContextOverLimits(config, state, "opencode-go", "deepseek-v4-pro", messages)
    assert.equal(result.overMinLimit, true, "750K above 10% default min (100K)")
    assert.equal(result.overMaxLimit, true, "750K above 70% model max (700K)")
})

test("model inherits provider min when model only overrides max", () => {
    const state = createSessionState()
    state.modelContextLimit = 1_000_000

    const config = baseConfig({
        "opencode-go": {
            minContextLimit: "10%",
            maxContextLimit: "90%",
            models: { "deepseek-v4-pro": { maxContextLimit: "70%" } },
        },
    })
    const messages = msg("user", "assistant", "opencode-go", "deepseek-v4-pro", 1_000_000, 50_000)
    const result = isContextOverLimits(config, state, "opencode-go", "deepseek-v4-pro", messages)
    assert.equal(result.overMinLimit, false, "50K below 10% provider min (100K)")
    assert.equal(result.overMaxLimit, false, "50K below 70% model max (700K)")
})
