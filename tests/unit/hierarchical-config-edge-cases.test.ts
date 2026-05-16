import assert from "node:assert/strict"
import test from "node:test"
import { getResolvedCompressValue } from "../../lib/config"
import type { PluginConfig } from "../../lib/config"

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
            maxContextLimit: 100000, minContextLimit: 50000,
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

test("no user message — globals used", () => {
    const config = baseConfig({ "opencode-go": { nudgeFrequency: 10 } })
    const result = getResolvedCompressValue(config, undefined, undefined, "nudgeFrequency")
    assert.equal(result, undefined)
})

test("provider config is empty object — no overrides", () => {
    const config = baseConfig({ "opencode-go": {} })
    const result = getResolvedCompressValue(config, "opencode-go", undefined, "nudgeFrequency")
    assert.equal(result, undefined)
})

test("model config is empty object — inherits from provider", () => {
    const config = baseConfig({
        "opencode-go": { nudgeFrequency: 10, models: { flash: {} } },
    })
    const result = getResolvedCompressValue(config, "opencode-go", "flash", "nudgeFrequency")
    assert.equal(result, 10)
})

test("zero providers — no overrides", () => {
    const config = baseConfig({})
    const result = getResolvedCompressValue(config, "opencode-go", undefined, "nudgeFrequency")
    assert.equal(result, undefined)
})

test("unknown field in provider silently ignored", () => {
    const config = baseConfig({ "opencode-go": { nudgeFrequency: 10 } as any })
    ;(config.compress.providers!["opencode-go"] as any).unknownField = "test"
    const result = getResolvedCompressValue(config, "opencode-go", undefined, "nudgeFrequency")
    assert.equal(result, 10)
})

test("wildcard-only applies to any provider", () => {
    const config = baseConfig({ "*": { nudgeFrequency: 3 } })
    const result = getResolvedCompressValue(config, "random-provider", undefined, "nudgeFrequency")
    assert.equal(result, 3)
})

test("inherits through chain: global → provider → model", () => {
    const config = baseConfig({
        "opencode-go": {
            models: { flash: { maxContextLimit: 200000 } },
        },
    })
    const nudgeResult = getResolvedCompressValue(config, "opencode-go", "flash", "nudgeFrequency")
    assert.equal(nudgeResult, undefined)

    const maxResult = getResolvedCompressValue(config, "opencode-go", "flash", "maxContextLimit")
    assert.equal(maxResult, 200000)
})

test("protectedTools merge additively through layers", () => {
    const config = baseConfig({
        "opencode-go": {
            protectedTools: ["tool-b"],
            models: { flash: { protectedTools: ["tool-c"] } },
        },
    })
    const providerTools = getResolvedCompressValue<string[]>(config, "opencode-go", undefined, "protectedTools")
    assert.deepEqual(providerTools, ["tool-b"])

    const modelTools = getResolvedCompressValue<string[]>(config, "opencode-go", "flash", "protectedTools")
    assert.deepEqual(modelTools, ["tool-c"])
})
