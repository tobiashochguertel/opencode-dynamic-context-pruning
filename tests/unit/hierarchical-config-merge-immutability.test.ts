import assert from "node:assert/strict"
import test from "node:test"
import { getResolvedCompressValue, deepCloneConfig, mergeCompress, validateConfigTypes, getInvalidConfigKeys } from "../../lib/config"
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

// --- deepCloneConfig independence ---

test("deepCloneConfig creates independent shallow copy at top level", () => {
    const config = baseConfig()
    const clone = deepCloneConfig(config)
    clone.enabled = false
    assert.equal(config.enabled, true, "original should be unchanged")
})

test("deepCloneConfig creates independent copy of commands.protectedTools", () => {
    const config = baseConfig()
    const clone = deepCloneConfig(config)
    clone.commands.protectedTools.push("new-tool")
    assert.equal(config.commands.protectedTools.length, 0, "original protectedTools should be unchanged")
})

test("deepCloneConfig creates independent compress.providers (deep clone)", () => {
    const config = baseConfig({
        "opencode-go": {
            nudgeFrequency: 10,
            models: { flash: { maxContextLimit: 200000 } },
        },
    })
    const clone = deepCloneConfig(config)
    clone.compress.providers!["opencode-go"].nudgeFrequency = 99
    const original = config.compress.providers!["opencode-go"].nudgeFrequency
    assert.equal(original, 10, "original provider override should be unchanged")
})

test("deepCloneConfig creates independent nested model overrides", () => {
    const config = baseConfig({
        "opencode-go": {
            models: { flash: { maxContextLimit: 200000 } },
        },
    })
    const clone = deepCloneConfig(config)
    clone.compress.providers!["opencode-go"].models!["flash"].maxContextLimit = 999
    assert.equal(
        config.compress.providers!["opencode-go"].models!["flash"].maxContextLimit,
        200000,
        "original model override should be unchanged",
    )
})

test("deepCloneConfig with undefined providers does not throw", () => {
    const config = baseConfig()
    config.compress.providers = undefined as any
    assert.doesNotThrow(() => deepCloneConfig(config))
})

test("deepCloneConfig preserves provider values after clone", () => {
    const config = baseConfig({ "opencode-go": { nudgeFrequency: 10 } })
    const clone = deepCloneConfig(config)
    const result = getResolvedCompressValue(clone, "opencode-go", undefined, "nudgeFrequency")
    assert.equal(result, 10)
})

// --- mergeCompress immutability ---

test("mergeCompress does not mutate base argument", () => {
    const base = baseConfig({ "opencode-go": { nudgeFrequency: 10 } }).compress
    const baseProvidersCopy = JSON.parse(JSON.stringify(base.providers))
    mergeCompress(base, { maxContextLimit: 99999 })
    assert.deepEqual(base.providers, baseProvidersCopy, "base providers should be unchanged")
})

test("mergeCompress does not mutate base.mode", () => {
    const base = baseConfig({ "opencode-go": { nudgeFrequency: 10 } }).compress
    const originalMode = base.mode
    mergeCompress(base, { mode: "message" })
    assert.equal(base.mode, originalMode, "base mode should be unchanged")
})

test("mergeCompress returns new object, not same reference", () => {
    const base = baseConfig().compress
    const result = mergeCompress(base, { nudgeFrequency: 99 })
    assert.notEqual(result, base, "should return a new object")
})

test("mergeCompress returns base when no override given", () => {
    const base = baseConfig().compress
    const result = mergeCompress(base, undefined)
    assert.equal(result, base, "should return base unchanged when no override")
})

test("mergeCompress returns base when empty override given", () => {
    const base = baseConfig().compress
    const result = mergeCompress(base, {})
    assert.notEqual(result, base, "empty override returns new object")
    assert.equal(result.mode, base.mode, "values should match base")
})

// --- mergeCompress provider merging ---

test("mergeCompress merges providers from override into base", () => {
    const base = baseConfig({ "opencode-go": { nudgeFrequency: 10 } }).compress
    const result = mergeCompress(base, {
        providers: { "google": { nudgeFrequency: 8 } },
    })
    assert.ok("opencode-go" in result.providers!, "base provider should be preserved")
    assert.ok("google" in result.providers!, "override provider should be added")
})

test("mergeCompress override provider wins for same provider", () => {
    const base = baseConfig({ "opencode-go": { nudgeFrequency: 10 } }).compress
    const result = mergeCompress(base, {
        providers: { "opencode-go": { nudgeFrequency: 99 } },
    })
    const val = result.providers!["opencode-go"].nudgeFrequency
    assert.equal(val, 99, "override nudgeFrequency should win")
})

test("mergeCompress merges models from override into existing provider", () => {
    const base = baseConfig({
        "opencode-go": {
            nudgeFrequency: 10,
            models: { flash: { nudgeFrequency: 3 } },
        },
    }).compress
    const result = mergeCompress(base, {
        providers: {
            "opencode-go": {
                models: { pro: { nudgeFrequency: 1 } },
            },
        },
    })
    assert.ok("flash" in result.providers!["opencode-go"].models!, "existing model should be preserved")
    assert.ok("pro" in result.providers!["opencode-go"].models!, "new model should be added")
})

test("mergeCompress override provider model wins for same model", () => {
    const base = baseConfig({
        "opencode-go": {
            nudgeFrequency: 10,
            models: { flash: { nudgeFrequency: 3 } },
        },
    }).compress
    const result = mergeCompress(base, {
        providers: {
            "opencode-go": {
                models: { flash: { nudgeFrequency: 99 } },
            },
        },
    })
    assert.equal(result.providers!["opencode-go"].models!["flash"].nudgeFrequency, 99)
})

test("mergeCompress non-overlapping fields from override provider do not erase base provider fields", () => {
    const base = baseConfig({
        "opencode-go": {
            nudgeFrequency: 10,
            maxContextLimit: "90%",
        },
    }).compress
    const result = mergeCompress(base, {
        providers: {
            "opencode-go": { nudgeFrequency: 99 },
        },
    })
    assert.equal(result.providers!["opencode-go"].nudgeFrequency, 99)
    assert.equal(result.providers!["opencode-go"].maxContextLimit, "90%",
        "maxContextLimit from base should be preserved")
})

// --- mergeCompress protectedTools additivity ---

test("mergeCompress protectedTools are additive across layers", () => {
    const base = baseConfig().compress
    base.protectedTools = ["tool-a"]
    const result = mergeCompress(base, { protectedTools: ["tool-b"] })
    assert.deepEqual(result.protectedTools.sort(), ["tool-a", "tool-b"])
})

// --- Immutability of resolution functions ---

test("getResolvedCompressValue does not mutate config", () => {
    const config = baseConfig({ "opencode-go": { nudgeFrequency: 10 } })
    const configJson = JSON.stringify(config)
    getResolvedCompressValue(config, "opencode-go", "flash", "nudgeFrequency")
    assert.equal(JSON.stringify(config), configJson, "config should be unchanged")
})

test("getResolvedCompressValue called multiple times returns consistent result", () => {
    const config = baseConfig({ "opencode-go": { nudgeFrequency: 10 } })
    const r1 = getResolvedCompressValue(config, "opencode-go", undefined, "nudgeFrequency")
    const r2 = getResolvedCompressValue(config, "opencode-go", undefined, "nudgeFrequency")
    assert.equal(r1, r2)
})

test("validateConfigTypes does not mutate config", () => {
    const config = { compress: { mode: "range", nudgeFrequency: 5, providers: { test: { nudgeFrequency: 10 } } } }
    const configJson = JSON.stringify(config)
    validateConfigTypes(config as any)
    assert.equal(JSON.stringify(config), configJson, "config should be unchanged")
})

test("getInvalidConfigKeys does not mutate config", () => {
    const config = { compress: { mode: "range", nudgeFrequency: 5 } }
    const configJson = JSON.stringify(config)
    getInvalidConfigKeys(config as any)
    assert.equal(JSON.stringify(config), configJson, "config should be unchanged")
})

// --- Multiple calls with same config ---

test("resolution with same config multiple times for different fields is consistent", () => {
    const config = baseConfig({
        "opencode-go": {
            nudgeFrequency: 10,
            iterationNudgeThreshold: 30,
            models: { flash: { nudgeFrequency: 3 } },
        },
    })
    const nf = getResolvedCompressValue(config, "opencode-go", "flash", "nudgeFrequency")
    assert.equal(nf, 3)
    const it = getResolvedCompressValue(config, "opencode-go", "flash", "iterationNudgeThreshold")
    assert.equal(it, 30)
    const nf2 = getResolvedCompressValue(config, "opencode-go", "flash", "nudgeFrequency")
    assert.equal(nf2, 3, "second call for nudgeFrequency should match first")
})

// --- Layer cascade merge behavior ---

test("two layers with different providers merge correctly", () => {
    const globalCfg = baseConfig({ "opencode-go": { nudgeFrequency: 10 } })
    const projectCfg = baseConfig({ "google": { nudgeFrequency: 8 } })
    const merged = mergeCompress(
        globalCfg.compress,
        { providers: projectCfg.compress.providers as any },
    )
    assert.ok("opencode-go" in merged.providers!, "global provider should survive")
    assert.ok("google" in merged.providers!, "project provider should be added")
})

test("project layer overrides global for same provider field", () => {
    const globalCfg = baseConfig({ "opencode-go": { nudgeFrequency: 10 } })
    const projectCfg = baseConfig({ "opencode-go": { nudgeFrequency: 3 } })
    const merged = mergeCompress(
        globalCfg.compress,
        { providers: projectCfg.compress.providers as any },
    )
    assert.equal(merged.providers!["opencode-go"].nudgeFrequency, 3)
})

test("three layers cascade correctly (global -> configDir -> project)", () => {
    const global = baseConfig({ "opencode-go": { nudgeFrequency: 10 } })
    const configDir = baseConfig({ "opencode-go": { nudgeFrequency: 5 }, "google": { nudgeFrequency: 8 } })
    const project = baseConfig({ "opencode-go": { nudgeFrequency: 3 } })

    let merged = mergeCompress(global.compress, compress(global.compress, configDir))
    merged = mergeCompress(merged, compress(merged, project))

    assert.equal(merged.providers!["opencode-go"].nudgeFrequency, 3, "project should win for opencode-go")
    assert.equal(merged.providers!["google"].nudgeFrequency, 8, "configDir provider should survive")
})

function compress(base: PluginConfig["compress"], layer: PluginConfig): Partial<PluginConfig["compress"]> {
    return {
        providers: layer.compress.providers as any,
    }
}

// --- Large config immutability ---

test("deepCloneConfig with 50 providers creates independent copy", () => {
    const providers: Record<string, any> = {}
    for (let i = 0; i < 50; i++) {
        providers[`p${i}`] = { nudgeFrequency: i, models: { [`m${i}`]: { maxContextLimit: i * 1000 } } }
    }
    const config = baseConfig(providers)
    const clone = deepCloneConfig(config)
    clone.compress.providers!["p0"].nudgeFrequency = 999
    assert.equal(config.compress.providers!["p0"].nudgeFrequency, 0, "original should be unchanged")
})
