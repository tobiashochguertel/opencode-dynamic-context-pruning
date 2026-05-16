import assert from "node:assert/strict"
import test from "node:test"
import { getResolvedCompressValue, getInvalidConfigKeys } from "../../lib/config"
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

function assertOverride(field: string, providerVal: any, modelVal: any, globalVal: any) {
    const cfg = (p: any) => baseConfig({ "test-provider": { ...p, models: { "test-model": p.models?.["test-model"] ?? {} } } })

    test(`${field} — provider override works`, () => {
        const config = cfg({ [field]: providerVal })
        const result = getResolvedCompressValue(config, "test-provider", undefined, field as any)
        assert.deepEqual(result, providerVal)
    })

    test(`${field} — model override beats provider`, () => {
        const config = cfg({ [field]: providerVal, models: { "test-model": { [field]: modelVal } } })
        const result = getResolvedCompressValue(config, "test-provider", "test-model", field as any)
        assert.deepEqual(result, modelVal)
    })

    test(`${field} — unset at both levels returns undefined`, () => {
        const config = cfg({})
        const result = getResolvedCompressValue(config, "test-provider", "test-model", field as any)
        assert.equal(result, undefined)
    })
}

assertOverride("mode", "message", "range", "range")
assertOverride("permission", "deny", "ask", "allow")
assertOverride("showCompression", true, false, false)
assertOverride("summaryBuffer", false, true, true)
assertOverride("maxContextLimit", 50000, "75%", 100000)
assertOverride("minContextLimit", 25000, "10%", 50000)
assertOverride("nudgeFrequency", 10, 3, 5)
assertOverride("iterationNudgeThreshold", 30, 50, 15)
assertOverride("nudgeForce", "strong", "soft", "soft")
assertOverride("protectTags", true, false, false)
assertOverride("protectUserMessages", true, false, false)

test("protectedTools — provider overrides global (replaces, not merges in getResolvedCompressValue)", () => {
    const config = baseConfig({ "test-provider": { protectedTools: ["tool-x"] } })
    const result = getResolvedCompressValue(config, "test-provider", undefined, "protectedTools")
    assert.deepEqual(result, ["tool-x"])
})

test("protectedTools — model overrides provider", () => {
    const config = baseConfig({
        "test-provider": {
            protectedTools: ["tool-x"],
            models: { "test-model": { protectedTools: ["tool-y"] } },
        },
    })
    const result = getResolvedCompressValue(config, "test-provider", "test-model", "protectedTools")
    assert.deepEqual(result, ["tool-y"])
})

test("getConfigKeyPaths skips compress.providers recursively", () => {
    const config = {
        compress: {
            providers: {
                "opencode-go": {
                    nudgeFrequency: 10,
                    models: { flash: { maxContextLimit: 100 } },
                },
            },
        },
    }
    const invalid = getInvalidConfigKeys(config as any)
    const providerKeys = invalid.filter((k) => k.includes("compress.providers"))
    assert.equal(providerKeys.length, 0, `should not report any provider keys, got: ${providerKeys.join(", ")}`)
})

test("getConfigKeyPaths skips compress.modelMaxLimits and modelMinLimits recursively", () => {
    const config = {
        compress: {
            modelMaxLimits: { "opencode-go/flash": 200000 },
            modelMinLimits: { "opencode-go/flash": "50%" },
        },
    }
    const invalid = getInvalidConfigKeys(config as any)
    const limitKeys = invalid.filter((k) => k.includes("modelMaxLimits") || k.includes("modelMinLimits"))
    assert.equal(limitKeys.length, 0)
})

test("getResolvedCompressValue with undefined compress.providers does not throw", () => {
    const config = baseConfig()
    config.compress.providers = undefined as any
    assert.doesNotThrow(() => {
        getResolvedCompressValue(config, "test", "test", "nudgeFrequency")
    })
})

test("getResolvedCompressValue with null compress.providers does not throw", () => {
    const config = baseConfig()
    config.compress.providers = null as any
    assert.doesNotThrow(() => {
        getResolvedCompressValue(config, "test", "test", "nudgeFrequency")
    })
})
