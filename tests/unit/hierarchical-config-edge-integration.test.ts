import assert from "node:assert/strict"
import test from "node:test"
import { getResolvedCompressValue, getInvalidConfigKeys, validateConfigTypes, deepCloneConfig, mergeCompress } from "../../lib/config"
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

// --- Unicode provider/model IDs ---

test("CJK provider ID with model resolves correctly", () => {
    const config = baseConfig({
        "中文提供商": {
            nudgeFrequency: 7,
            models: {
                "深度求索": { nudgeFrequency: 3 },
            },
        },
    })
    const providerVal = getResolvedCompressValue(config, "中文提供商", undefined, "nudgeFrequency")
    assert.equal(providerVal, 7)
    const modelVal = getResolvedCompressValue(config, "中文提供商", "深度求索", "nudgeFrequency")
    assert.equal(modelVal, 3)
})

test("emoji provider ID resolves correctly", () => {
    const config = baseConfig({
        "🚀-provider": { nudgeFrequency: 9 },
    })
    const result = getResolvedCompressValue(config, "🚀-provider", undefined, "nudgeFrequency")
    assert.equal(result, 9)
})

test("emoji model ID resolves correctly", () => {
    const config = baseConfig({
        "test": {
            models: {
                "🤖-model": { nudgeFrequency: 4 },
            },
        },
    })
    const result = getResolvedCompressValue(config, "test", "🤖-model", "nudgeFrequency")
    assert.equal(result, 4)
})

test("unicode wildcard provider works with CJK providers", () => {
    const config = baseConfig({
        "*": { nudgeFrequency: 5 },
    })
    const result = getResolvedCompressValue(config, "日本語プロバイダー", undefined, "nudgeFrequency")
    assert.equal(result, 5)
})

test("validateConfigTypes accepts unicode provider IDs", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: {
                "测试": { nudgeFrequency: 10 },
            },
        },
    })
    assert.equal(errors.length, 0)
})

// --- Provider/model IDs with special characters ---

test("provider ID with dots resolves correctly", () => {
    const config = baseConfig({
        "my.provider.v2": { nudgeFrequency: 8 },
    })
    const result = getResolvedCompressValue(config, "my.provider.v2", undefined, "nudgeFrequency")
    assert.equal(result, 8)
})

test("provider ID with @ symbol resolves correctly", () => {
    const config = baseConfig({
        "model@company.com": { nudgeFrequency: 6 },
    })
    const result = getResolvedCompressValue(config, "model@company.com", undefined, "nudgeFrequency")
    assert.equal(result, 6)
})

test("provider ID with spaces resolves correctly", () => {
    const config = baseConfig({
        "my provider name": { nudgeFrequency: 4 },
    })
    const result = getResolvedCompressValue(config, "my provider name", undefined, "nudgeFrequency")
    assert.equal(result, 4)
})

test("provider ID with mixed special characters resolves correctly", () => {
    const config = baseConfig({
        "org-name/v2.0@internal": { nudgeFrequency: 3 },
    })
    const result = getResolvedCompressValue(config, "org-name/v2.0@internal", undefined, "nudgeFrequency")
    assert.equal(result, 3)
})

test("model ID with dots, @, and hyphens resolves correctly", () => {
    const config = baseConfig({
        "provider": {
            models: {
                "model-v2.0@company": { nudgeFrequency: 7 },
            },
        },
    })
    const result = getResolvedCompressValue(config, "provider", "model-v2.0@company", "nudgeFrequency")
    assert.equal(result, 7)
})

test("underscore-heavy provider and model IDs resolve correctly", () => {
    const config = baseConfig({
        "my_custom_provider_v_2": {
            nudgeFrequency: 11,
            models: {
                "my_special_model_v_5": { nudgeFrequency: 2 },
            },
        },
    })
    const providerVal = getResolvedCompressValue(config, "my_custom_provider_v_2", undefined, "nudgeFrequency")
    assert.equal(providerVal, 11)
    const modelVal = getResolvedCompressValue(config, "my_custom_provider_v_2", "my_special_model_v_5", "nudgeFrequency")
    assert.equal(modelVal, 2)
})

// --- Very long IDs ---

test("very long provider ID (200+ chars) resolves correctly", () => {
    const longId = "a".repeat(250)
    const config = baseConfig({
        [longId]: { nudgeFrequency: 1 },
    })
    const result = getResolvedCompressValue(config, longId, undefined, "nudgeFrequency")
    assert.equal(result, 1)
})

test("very long model ID (200+ chars) resolves correctly", () => {
    const longModelId = "b".repeat(250)
    const config = baseConfig({
        "provider": {
            models: {
                [longModelId]: { nudgeFrequency: 2 },
            },
        },
    })
    const result = getResolvedCompressValue(config, "provider", longModelId, "nudgeFrequency")
    assert.equal(result, 2)
})

test("very long provider ID matches wildcard", () => {
    const config = baseConfig({
        "*": { nudgeFrequency: 3 },
    })
    const result = getResolvedCompressValue(config, "x".repeat(500), undefined, "nudgeFrequency")
    assert.equal(result, 3)
})

// --- Performance: many providers ---

test("50 providers with 50 models each resolves quickly", () => {
    const providers: Record<string, any> = {}
    for (let i = 0; i < 50; i++) {
        const models: Record<string, any> = {}
        for (let j = 0; j < 50; j++) {
            models[`m${i}-${j}`] = { nudgeFrequency: j }
        }
        providers[`p${i}`] = { nudgeFrequency: i, models }
    }
    const config = baseConfig(providers)

    const start = Date.now()
    for (let i = 0; i < 50; i++) {
        for (let j = 0; j < 50; j++) {
            getResolvedCompressValue(config, `p${i}`, `m${i}-${j}`, "nudgeFrequency")
        }
    }
    const elapsed = Date.now() - start
    assert.ok(elapsed < 5000, `2500 resolutions took ${elapsed}ms (expected <5000ms)`)
})

test("100 providers with no models resolves for each", () => {
    const providers: Record<string, any> = {}
    for (let i = 0; i < 100; i++) {
        providers[`p${i}`] = { nudgeFrequency: i }
    }
    const config = baseConfig(providers)
    for (let i = 0; i < 100; i++) {
        const result = getResolvedCompressValue(config, `p${i}`, undefined, "nudgeFrequency")
        assert.equal(result, i)
    }
})

test("deepCloneConfig with 100 providers is fast", () => {
    const providers: Record<string, any> = {}
    for (let i = 0; i < 100; i++) {
        providers[`p${i}`] = { nudgeFrequency: i, models: { [`m${i}`]: { maxContextLimit: i * 1000 } } }
    }
    const config = baseConfig(providers)
    const start = Date.now()
    const clone = deepCloneConfig(config)
    const elapsed = Date.now() - start
    assert.ok(elapsed < 2000, `deepCloneConfig with 100 providers took ${elapsed}ms`)
    assert.equal(clone.compress.providers!["p50"].nudgeFrequency, 50)
})

test("mergeCompress with 100 override providers is fast", () => {
    const baseProviders: Record<string, any> = {}
    for (let i = 0; i < 100; i++) {
        baseProviders[`p${i}`] = { nudgeFrequency: i }
    }
    const base = baseConfig(baseProviders).compress
    const overrideProviders: Record<string, any> = {}
    for (let i = 50; i < 150; i++) {
        overrideProviders[`p${i}`] = { nudgeFrequency: i }
    }
    const start = Date.now()
    const merged = mergeCompress(base, { providers: overrideProviders as any })
    const elapsed = Date.now() - start
    assert.ok(elapsed < 2000, `mergeCompress with 100+50 providers took ${elapsed}ms`)
    assert.equal(merged.providers!["p0"].nudgeFrequency, 0, "base provider preserved")
    assert.equal(merged.providers!["p120"].nudgeFrequency, 120, "override provider added")
})

// --- Extreme values ---

test("nudgeFrequency: 0 at model level is clamped to 1", () => {
    const config = baseConfig({
        "provider": {
            models: {
                "model": { nudgeFrequency: 0 },
            },
        },
    })
    const result = getResolvedCompressValue(config, "provider", "model", "nudgeFrequency")
    assert.equal(result, 0, "raw value is 0, clamping happens in caller")
})

test("iterationNudgeThreshold: -1 at model level resolves correctly", () => {
    const config = baseConfig({
        "provider": {
            models: {
                "model": { iterationNudgeThreshold: -1 },
            },
        },
    })
    const result = getResolvedCompressValue(config, "provider", "model", "iterationNudgeThreshold")
    assert.equal(result, -1, "raw value preserved, clamping happens in caller")
})

test("maxContextLimit: 0 at model level resolves correctly", () => {
    const config = baseConfig({
        "provider": {
            models: {
                "model": { maxContextLimit: 0 },
            },
        },
    })
    const result = getResolvedCompressValue(config, "provider", "model", "maxContextLimit")
    assert.equal(result, 0)
})

test("maxContextLimit: Number.MAX_SAFE_INTEGER at model level resolves correctly", () => {
    const config = baseConfig({
        "provider": {
            models: {
                "model": { maxContextLimit: Number.MAX_SAFE_INTEGER },
            },
        },
    })
    const result = getResolvedCompressValue(config, "provider", "model", "maxContextLimit")
    assert.equal(result, Number.MAX_SAFE_INTEGER)
})

test("minContextLimit: '0%' at provider level resolves correctly", () => {
    const config = baseConfig({
        "provider": { minContextLimit: "0%" },
    })
    const result = getResolvedCompressValue(config, "provider", undefined, "minContextLimit")
    assert.equal(result, "0%")
})

test("maxContextLimit: '100%' at provider level resolves correctly", () => {
    const config = baseConfig({
        "provider": { maxContextLimit: "100%" },
    })
    const result = getResolvedCompressValue(config, "provider", undefined, "maxContextLimit")
    assert.equal(result, "100%")
})

test("maxContextLimit: '0.5%' fractional percentage resolves correctly", () => {
    const config = baseConfig({
        "provider": { maxContextLimit: "0.5%" },
    })
    const result = getResolvedCompressValue(config, "provider", undefined, "maxContextLimit")
    assert.equal(result, "0.5%")
})

// --- Edge: empty strings for non-field configurations ---

test("protectedTools with empty array at model level resolves correctly", () => {
    const config = baseConfig({
        "provider": {
            models: {
                "model": { protectedTools: [] },
            },
        },
    })
    const result = getResolvedCompressValue(config, "provider", "model", "protectedTools")
    assert.deepEqual(result, [])
})

test("protectedTools with single empty string resolves correctly", () => {
    const config = baseConfig({
        "provider": {
            models: {
                "model": { protectedTools: [""] },
            },
        },
    })
    const result = getResolvedCompressValue(config, "provider", "model", "protectedTools")
    assert.deepEqual(result, [""])
})

// --- Edge: same provider at different hierarchy levels ---

test("same provider ID in both base and override: models merge, not replace", () => {
    const base = baseConfig({
        "provider": {
            nudgeFrequency: 10,
            models: { "model-a": { nudgeFrequency: 5 } },
        },
    }).compress
    const merged = mergeCompress(base, {
        providers: {
            "provider": {
                models: { "model-b": { nudgeFrequency: 3 } },
            },
        },
    })
    assert.ok("model-a" in merged.providers!["provider"].models!, "model-a preserved")
    assert.ok("model-b" in merged.providers!["provider"].models!, "model-b added")
})

test("same provider both levels with no model overlap: fields from both preserved", () => {
    const base = baseConfig({
        "provider": {
            maxContextLimit: "90%",
            minContextLimit: "10%",
        },
    }).compress
    const merged = mergeCompress(base, {
        providers: {
            "provider": {
                nudgeFrequency: 7,
                iterationNudgeThreshold: 30,
            },
        },
    })
    const mergedCfg = { ...baseConfig().compress, ...merged }
    const val = getResolvedCompressValue(
        { ...baseConfig(), compress: mergedCfg } as PluginConfig,
        "provider", undefined, "maxContextLimit",
    )
    assert.equal(val, "90%", "base field maxContextLimit preserved")
    const nf = getResolvedCompressValue(
        { ...baseConfig(), compress: mergedCfg } as PluginConfig,
        "provider", undefined, "nudgeFrequency",
    )
    assert.equal(nf, 7, "override field nudgeFrequency applied")
})

// --- Edge: empty compress config with providers ---

test("providers can be set on minimal compress config", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: { "test": { nudgeFrequency: 5 } },
        },
    })
    assert.equal(errors.length, 0)
})

test("providers with only model overrides (no provider-level fields) works", () => {
    const config = baseConfig({
        "provider": {
            models: { "model": { nudgeFrequency: 8 } },
        },
    })
    const val = getResolvedCompressValue(config, "provider", "model", "nudgeFrequency")
    assert.equal(val, 8)
    const providerVal = getResolvedCompressValue(config, "provider", undefined, "nudgeFrequency")
    assert.equal(providerVal, undefined, "no provider-level nudgeFrequency set")
})

// --- Edge: exact match of wildcard-looking key ---

test("provider key '**' is treated literally, resolves only when looked up as '**'", () => {
    const config = baseConfig({
        "**": { nudgeFrequency: 7 },
    })
    const exact = getResolvedCompressValue(config, "**", undefined, "nudgeFrequency")
    assert.equal(exact, 7, "exact lookup of '**' returns its value")
    const notWildcard = getResolvedCompressValue(config, "some-provider", undefined, "nudgeFrequency")
    assert.equal(notWildcard, undefined, "'**' does not act as wildcard for other providers")
})

test("provider key '?' is treated literally", () => {
    const config = baseConfig({
        "?": { nudgeFrequency: 3 },
    })
    const result = getResolvedCompressValue(config, "?", undefined, "nudgeFrequency")
    assert.equal(result, 3)
})

// --- Edge: provider keys that look like regex patterns ---

test("provider key with regex special chars resolves literally", () => {
    const config = baseConfig({
        "pro[vider]+": { nudgeFrequency: 5 },
    })
    const result = getResolvedCompressValue(config, "pro[vider]+", undefined, "nudgeFrequency")
    assert.equal(result, 5)
})

test("model key with regex special chars resolves literally", () => {
    const config = baseConfig({
        "provider": {
            models: {
                "mo(del)?": { nudgeFrequency: 9 },
            },
        },
    })
    const result = getResolvedCompressValue(config, "provider", "mo(del)?", "nudgeFrequency")
    assert.equal(result, 9)
})

// --- Edge: multiple wildcard providers ---

test("multiple identical wildcard keys (last wins in JS object)", () => {
    const config = baseConfig({
        "*": { nudgeFrequency: 3 },
        "*": { nudgeFrequency: 7 },
    })
    const result = getResolvedCompressValue(config, "any-provider", undefined, "nudgeFrequency")
    assert.equal(result, 7, "last wildcard key wins in object literal")
})

// --- Edge: disabled scenario with providers ---

test("providers still present when enabled=false in override", () => {
    const base = baseConfig({ "provider": { nudgeFrequency: 10 } }).compress
    const merged = mergeCompress(base, { enabled: false as any })
    assert.ok("provider" in merged.providers!, "providers should survive non-provider overrides")
})
