import assert from "node:assert/strict"
import test from "node:test"
import { getResolvedCompressValue } from "../../lib/config"
import type { PluginConfig } from "../../lib/config"

function baseConfig(overrides?: Partial<PluginConfig["compress"]>): PluginConfig {
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
            ...overrides,
        },
        strategies: {
            deduplication: { enabled: true, protectedTools: [] },
            purgeErrors: { enabled: true, turns: 4, protectedTools: [] },
        },
    }
}

test("returns global default when no provider or model matches", () => {
    const config = baseConfig()
    const result = getResolvedCompressValue(config, undefined, undefined, "nudgeFrequency")
    assert.equal(result, undefined)
})

test("returns provider-level override when provider matches", () => {
    const config = baseConfig({
        providers: {
            "opencode-go": { nudgeFrequency: 10 },
        },
    })
    const result = getResolvedCompressValue<number>(config, "opencode-go", undefined, "nudgeFrequency")
    assert.equal(result, 10)
})

test("returns model-level override when model matches", () => {
    const config = baseConfig({
        providers: {
            "opencode-go": {
                models: {
                    "deepseek-v4-pro": { nudgeFrequency: 3 },
                },
            },
        },
    })
    const result = getResolvedCompressValue<number>(
        config, "opencode-go", "deepseek-v4-pro", "nudgeFrequency",
    )
    assert.equal(result, 3)
})

test("model-level beats provider-level when both match", () => {
    const config = baseConfig({
        providers: {
            "opencode-go": {
                nudgeFrequency: 10,
                models: {
                    "deepseek-v4-pro": { nudgeFrequency: 3 },
                },
            },
        },
    })
    const result = getResolvedCompressValue<number>(
        config, "opencode-go", "deepseek-v4-pro", "nudgeFrequency",
    )
    assert.equal(result, 3)
})

test("wildcard provider * applies to all providers", () => {
    const config = baseConfig({
        providers: {
            "*": { nudgeFrequency: 8 },
        },
    })
    const result = getResolvedCompressValue<number>(
        config, "unknown-provider", undefined, "nudgeFrequency",
    )
    assert.equal(result, 8)
})

test("exact provider beats wildcard provider", () => {
    const config = baseConfig({
        providers: {
            "*": { nudgeFrequency: 8 },
            "opencode-go": { nudgeFrequency: 12 },
        },
    })
    const result = getResolvedCompressValue<number>(
        config, "opencode-go", undefined, "nudgeFrequency",
    )
    assert.equal(result, 12)
})

test("wildcard provider model beats exact provider global", () => {
    const config = baseConfig({
        providers: {
            "*": {
                nudgeFrequency: 8,
                models: {
                    "deepseek-v4-flash": { nudgeFrequency: 2 },
                },
            },
            "opencode-go": {
                nudgeFrequency: 12,
            },
        },
    })
    const result = getResolvedCompressValue<number>(
        config, "opencode-go", "deepseek-v4-flash", "nudgeFrequency",
    )
    assert.equal(result, 2)
})

test("exact provider model beats wildcard provider model", () => {
    const config = baseConfig({
        providers: {
            "*": {
                models: {
                    "deepseek-v4-flash": { nudgeFrequency: 1 },
                },
            },
            "opencode-go": {
                models: {
                    "deepseek-v4-flash": { nudgeFrequency: 99 },
                },
            },
        },
    })
    const result = getResolvedCompressValue<number>(
        config, "opencode-go", "deepseek-v4-flash", "nudgeFrequency",
    )
    assert.equal(result, 99)
})

test("returns undefined when provider exists but field not set at any level", () => {
    const config = baseConfig({
        providers: {
            "opencode-go": {
                nudgeFrequency: 10,
            },
        },
    })
    const result = getResolvedCompressValue<number>(
        config, "opencode-go", undefined, "iterationNudgeThreshold",
    )
    assert.equal(result, undefined)
})

test("resolves percentage context limits from provider level", () => {
    const config = baseConfig({
        maxContextLimit: "90%",
        providers: {
            "google": {
                maxContextLimit: "80%",
                models: {
                    "gemini-2.5-pro": { maxContextLimit: 200000 },
                },
            },
        },
    })
    const providerResult = getResolvedCompressValue<number | `${number}%`>(
        config, "google", undefined, "maxContextLimit",
    )
    assert.equal(providerResult, "80%")

    const modelResult = getResolvedCompressValue<number | `${number}%`>(
        config, "google", "gemini-2.5-pro", "maxContextLimit",
    )
    assert.equal(modelResult, 200000)
})

test("nudgeForce can be overridden per provider", () => {
    const config = baseConfig({
        nudgeForce: "soft",
        providers: {
            "opencode-go": {
                nudgeForce: "strong",
            },
        },
    })
    const result = getResolvedCompressValue<"strong" | "soft">(
        config, "opencode-go", undefined, "nudgeForce",
    )
    assert.equal(result, "strong")
})

test("protectUserMessages can be overridden per model", () => {
    const config = baseConfig({
        protectUserMessages: false,
        providers: {
            "opencode-go": {
                models: {
                    "deepseek-v4-pro": { protectUserMessages: true },
                },
            },
        },
    })
    const result = getResolvedCompressValue<boolean>(
        config, "opencode-go", "deepseek-v4-pro", "protectUserMessages",
    )
    assert.equal(result, true)
})
