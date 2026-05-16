import assert from "node:assert/strict"
import test from "node:test"
import { getResolvedCompressValue, getInvalidConfigKeys, validateConfigTypes } from "../../lib/config"
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

// --- No providers key ---

test("getResolvedCompressValue returns undefined when compress.providers is absent", () => {
    const config = baseConfig()
    delete (config.compress as any).providers
    const result = getResolvedCompressValue(config, "opencode-go", "flash", "nudgeFrequency")
    assert.equal(result, undefined)
})

test("getResolvedCompressValue returns undefined when compress.providers is undefined", () => {
    const config = baseConfig()
    config.compress.providers = undefined as any
    const result = getResolvedCompressValue(config, "opencode-go", "flash", "nudgeFrequency")
    assert.equal(result, undefined)
})

test("getResolvedCompressValue returns undefined when compress.providers is empty object", () => {
    const config = baseConfig({})
    const result = getResolvedCompressValue(config, "opencode-go", "flash", "nudgeFrequency")
    assert.equal(result, undefined)
})

test("getInvalidConfigKeys does not complain when compress.providers is absent", () => {
    const config = { enabled: true, compress: { mode: "range", nudgeFrequency: 5 } }
    const keys = getInvalidConfigKeys(config as any)
    assert.equal(keys.length, 0)
})

test("validateConfigTypes accepts config without providers key", () => {
    const errors = validateConfigTypes({
        compress: { mode: "range", nudgeFrequency: 5 },
    })
    assert.equal(errors.length, 0)
})

// --- Deprecated modelMaxLimits / modelMinLimits ---

test("deprecated modelMaxLimits is a valid config key (no unknown key warning)", () => {
    const config = {
        compress: {
            modelMaxLimits: { "opencode-go/flash": 200000 },
        },
    }
    const keys = getInvalidConfigKeys(config as any)
    assert.equal(keys.filter((k) => k.includes("modelMaxLimits")).length, 0)
})

test("deprecated modelMinLimits is a valid config key (no unknown key warning)", () => {
    const config = {
        compress: {
            modelMinLimits: { "opencode-go/flash": "50%" },
        },
    }
    const keys = getInvalidConfigKeys(config as any)
    assert.equal(keys.filter((k) => k.includes("modelMinLimits")).length, 0)
})

test("deprecated modelMaxLimits with numeric values passes validation", () => {
    const errors = validateConfigTypes({
        compress: {
            modelMaxLimits: { "opencode-go/flash": 200000, "opencode-go/pro": 500000 },
        },
    })
    assert.equal(errors.length, 0)
})

test("deprecated modelMinLimits with percentage values passes validation", () => {
    const errors = validateConfigTypes({
        compress: {
            modelMinLimits: { "opencode-go/flash": "25%", "opencode-go/pro": "50%" },
        },
    })
    assert.equal(errors.length, 0)
})

test("deprecated modelMaxLimits with invalid entries reports validation errors", () => {
    const errors = validateConfigTypes({
        compress: {
            modelMaxLimits: { "opencode-go/flash": "invalid" },
        },
    })
    assert.ok(errors.some((e) => e.key.includes("modelMaxLimits")))
})

test("deprecated modelMinLimits with non-object fails validation", () => {
    const errors = validateConfigTypes({
        compress: {
            modelMinLimits: "invalid",
        },
    })
    assert.ok(errors.some((e) => e.key === "compress.modelMinLimits"))
})

test("deprecated modelMaxLimits with array fails validation", () => {
    const errors = validateConfigTypes({
        compress: {
            modelMaxLimits: ["not-an-object"],
        },
    })
    assert.ok(errors.some((e) => e.key === "compress.modelMaxLimits"))
})

// --- modelMaxLimits / modelMinLimits ignored at runtime ---

test("deprecated modelMaxLimits values are NOT applied at runtime (fall back to global)", () => {
    const config = baseConfig()
    config.compress.modelMaxLimits = { "opencode-go/flash": 10 }
    const result = getResolvedCompressValue(config, "opencode-go", "flash", "maxContextLimit")
    assert.equal(result, undefined, "modelMaxLimits is deprecated and ignored by getResolvedCompressValue")
})

test("deprecated modelMinLimits values are NOT applied at runtime (fall back to global)", () => {
    const config = baseConfig()
    config.compress.modelMinLimits = { "opencode-go/flash": "10%" }
    const result = getResolvedCompressValue(config, "opencode-go", "flash", "minContextLimit")
    assert.equal(result, undefined, "modelMinLimits is deprecated and ignored by getResolvedCompressValue")
})

// --- modelMaxLimits + providers together ---

test("deprecated modelMaxLimits and new providers together pass validation", () => {
    const errors = validateConfigTypes({
        compress: {
            mode: "range",
            nudgeFrequency: 5,
            modelMaxLimits: { "opencode-go/flash": 200000 },
            providers: {
                "opencode-go": {
                    nudgeFrequency: 10,
                    models: { "flash": { maxContextLimit: 150000 } },
                },
            },
        },
    })
    assert.equal(errors.filter((e) => !e.key.includes("showCompression")).length, 0)
})

test("deprecated modelMaxLimits and providers together: both keys recognized as valid", () => {
    const config = {
        compress: {
            modelMaxLimits: { "opencode-go/flash": 200000 },
            providers: {
                "opencode-go": { nudgeFrequency: 10 },
            },
        },
    }
    const keys = getInvalidConfigKeys(config as any)
    assert.equal(keys.length, 0, "both modelMaxLimits and providers should be valid keys")
})

test("new providers key works when deprecated modelMaxLimits also present", () => {
    const config = baseConfig({
        "opencode-go": { nudgeFrequency: 10 },
    })
    config.compress.modelMaxLimits = { "opencode-go/flash": 200000 }
    const result = getResolvedCompressValue(config, "opencode-go", "flash", "nudgeFrequency")
    assert.equal(result, 10, "providers should work despite modelMaxLimits being present")
})

// --- Runtime fallback behavior ---

test("no providers: getNudgeFrequency returns global default", () => {
    const config = baseConfig()
    delete (config.compress as any).providers
    const getNudgeFrequency = (cfg: PluginConfig, _p?: string, _m?: string) => {
        const resolved = getResolvedCompressValue(cfg, _p, _m, "nudgeFrequency")
        return Math.max(1, Math.floor(resolved ?? cfg.compress.nudgeFrequency))
    }
    assert.equal(getNudgeFrequency(config, "opencode-go", "flash"), 5)
})

test("no providers: getIterationNudgeThreshold returns global default", () => {
    const config = baseConfig()
    delete (config.compress as any).providers
    const getThreshold = (cfg: PluginConfig, _p?: string, _m?: string) => {
        const resolved = getResolvedCompressValue(cfg, _p, _m, "iterationNudgeThreshold")
        return Math.max(1, Math.floor(resolved ?? cfg.compress.iterationNudgeThreshold))
    }
    assert.equal(getThreshold(config, "opencode-go", "flash"), 15)
})

test("no providers: isContextOverLimits uses global maxContextLimit", () => {
    const config = baseConfig()
    delete (config.compress as any).providers

    const parseLimitValue = (limit: number | `${number}%` | undefined, ctx: number): number | undefined => {
        if (limit === undefined) return undefined
        if (typeof limit === "number") return limit
        if (!limit.endsWith("%")) return undefined
        const pct = parseFloat(limit.slice(0, -1))
        if (isNaN(pct)) return undefined
        return Math.round((Math.max(0, Math.min(100, Math.round(pct))) / 100) * ctx)
    }

    const globalMax = parseLimitValue(config.compress.maxContextLimit, 200000)
    assert.equal(globalMax, 100000)
})

// --- Empty providers object scenarios ---

test("empty providers object with models: empty models inside - no resolution", () => {
    const config = baseConfig({
        "opencode-go": { models: {} },
    })
    const result = getResolvedCompressValue(config, "opencode-go", "flash", "nudgeFrequency")
    assert.equal(result, undefined)
})

test("empty providers object with no models key at all - no resolution", () => {
    const config = baseConfig({
        "opencode-go": {},
    })
    const result = getResolvedCompressValue(config, "opencode-go", "flash", "nudgeFrequency")
    assert.equal(result, undefined)
})

// --- Config with only modelMaxLimits (no providers) - full load path ---

test("config with only modelMaxLimits has no invalid keys", () => {
    const config = {
        enabled: true,
        debug: false,
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
            modelMaxLimits: { "opencode-go/flash": 200000 },
        },
    }
    const keys = getInvalidConfigKeys(config as any)
    assert.equal(keys.length, 0, "modelMaxLimits should not trigger invalid keys: " + keys.join(", "))
})

test("config with only deprecated modelMinLimits has no invalid keys", () => {
    const config = {
        enabled: true,
        compress: {
            mode: "range",
            nudgeFrequency: 5,
            modelMinLimits: { "anthropic/claude-sonnet-4-6": "30%" },
        },
    }
    const keys = getInvalidConfigKeys(config as any)
    assert.equal(keys.length, 0, "modelMinLimits should not trigger invalid keys")
})

// --- Merge backward compat (via direct state check) ---

test("providers survive after overriding other compress fields", () => {
    const config = baseConfig({ "opencode-go": { nudgeFrequency: 10 } })
    const compress = config.compress
    assert.ok(compress.providers !== undefined, "providers should be set")
    assert.ok("opencode-go" in compress.providers!, "existing provider should be present")
})

test("setting other compress fields does not clear providers", () => {
    const config = baseConfig({ "opencode-go": { nudgeFrequency: 10 } })
    config.compress.showCompression = true
    assert.ok(config.compress.providers !== undefined, "providers should not be cleared")
    assert.ok("opencode-go" in config.compress.providers!, "provider should survive")
})

test("old-style config without providers still resolves compress defaults", () => {
    const config = baseConfig()
    delete (config.compress as any).providers
    assert.equal(config.compress.mode, "range")
    assert.equal(config.compress.nudgeFrequency, 5)
    assert.equal(config.compress.maxContextLimit, 100000)
})
