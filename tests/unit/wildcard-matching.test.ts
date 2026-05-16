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

// --- Model-level wildcard ---

test("model-level wildcard * inside exact provider applies to any model", () => {
    const config = baseConfig({
        "opencode-go": {
            models: {
                "*": { nudgeFrequency: 3 },
            },
        },
    })
    const result = getResolvedCompressValue(config, "opencode-go", "any-model", "nudgeFrequency")
    assert.equal(result, 3)
})

test("model-level wildcard applies to unknown model under known provider", () => {
    const config = baseConfig({
        "opencode-go": {
            nudgeFrequency: 10,
            models: {
                "*": { nudgeFrequency: 3 },
            },
        },
    })
    const result = getResolvedCompressValue(config, "opencode-go", "unknown-model", "nudgeFrequency")
    assert.equal(result, 3)
})

test("exact model beats model-level wildcard under same provider", () => {
    const config = baseConfig({
        "opencode-go": {
            models: {
                "*": { nudgeFrequency: 3 },
                "exact-model": { nudgeFrequency: 99 },
            },
        },
    })
    const exactResult = getResolvedCompressValue(config, "opencode-go", "exact-model", "nudgeFrequency")
    assert.equal(exactResult, 99)
})

test("model-level wildcard does not apply to different provider", () => {
    const config = baseConfig({
        "opencode-go": {
            models: {
                "*": { nudgeFrequency: 3 },
            },
        },
    })
    const result = getResolvedCompressValue(config, "other-provider", "any-model", "nudgeFrequency")
    assert.equal(result, undefined)
})

// --- Wildcard provider + wildcard model combinations ---

test("wildcard provider * with wildcard model * applies to any provider+model", () => {
    const config = baseConfig({
        "*": {
            nudgeFrequency: 7,
            models: {
                "*": { nudgeFrequency: 2 },
            },
        },
    })
    const result = getResolvedCompressValue(config, "random-provider", "random-model", "nudgeFrequency")
    assert.equal(result, 2)
})

test("wildcard provider model beats specific provider global", () => {
    const config = baseConfig({
        "*": {
            models: {
                "common-model": { nudgeFrequency: 2 },
            },
        },
        "exact-provider": {
            nudgeFrequency: 10,
        },
    })
    const result = getResolvedCompressValue(config, "exact-provider", "common-model", "nudgeFrequency")
    assert.equal(result, 2)
})

test("specific provider model beats wildcard provider model", () => {
    const config = baseConfig({
        "*": {
            models: {
                "shared-model": { nudgeFrequency: 1 },
            },
        },
        "opencode-go": {
            models: {
                "shared-model": { nudgeFrequency: 99 },
            },
        },
    })
    const result = getResolvedCompressValue(config, "opencode-go", "shared-model", "nudgeFrequency")
    assert.equal(result, 99)
})

// --- Wildcard fallthrough ---

test("wildcard-only config applies to any unlisted provider", () => {
    const config = baseConfig({
        "*": { nudgeFrequency: 5 },
    })
    const result1 = getResolvedCompressValue(config, "unknown-provider", undefined, "nudgeFrequency")
    assert.equal(result1, 5)
    const result2 = getResolvedCompressValue(config, "opencode-go", undefined, "nudgeFrequency")
    assert.equal(result2, 5)
})

test("wildcard-only config does not override when exact provider also set", () => {
    const config = baseConfig({
        "*": { nudgeFrequency: 5 },
        "opencode-go": { nudgeFrequency: 10 },
    })
    const result = getResolvedCompressValue(config, "opencode-go", undefined, "nudgeFrequency")
    assert.equal(result, 10)
})

test("wildcard-only config field not set at wildcard level falls through to global", () => {
    const config = baseConfig({
        "*": { nudgeFrequency: 5 },
    })
    const result = getResolvedCompressValue(config, "unknown-provider", undefined, "iterationNudgeThreshold")
    assert.equal(result, undefined)
})

// --- Wildcard field specificity ---

test("wildcard provider sets maxContextLimit, specific provider does not override - wildcard applies", () => {
    const config = baseConfig({
        "*": { maxContextLimit: "50%" },
        "opencode-go": { nudgeFrequency: 10 },
    })
    const result = getResolvedCompressValue(config, "opencode-go", undefined, "maxContextLimit")
    assert.equal(result, "50%")
})

test("wildcard provider model field not overridden by specific provider global", () => {
    const config = baseConfig({
        "*": {
            models: {
                "m1": { nudgeFrequency: 3 },
            },
        },
        "opencode-go": {
            nudgeFrequency: 10,
        },
    })
    const result = getResolvedCompressValue(config, "opencode-go", "m1", "nudgeFrequency")
    assert.equal(result, 3)
})

// --- Wildcard with specific provider having empty models ---

test("wildcard model applies when exact provider has empty models object", () => {
    const config = baseConfig({
        "*": {
            models: {
                "flash": { nudgeFrequency: 1 },
            },
        },
        "opencode-go": {
            models: {},
        },
    })
    const result = getResolvedCompressValue(config, "opencode-go", "flash", "nudgeFrequency")
    assert.equal(result, 1)
})

test("wildcard model applies when exact provider has no models key", () => {
    const config = baseConfig({
        "*": {
            models: {
                "flash": { nudgeFrequency: 1 },
            },
        },
        "opencode-go": {},
    })
    const result = getResolvedCompressValue(config, "opencode-go", "flash", "nudgeFrequency")
    assert.equal(result, 1)
})

// --- Resolution chain with wildcards ---

test("full resolution chain: exact model > exact provider > wildcard model > wildcard provider > global", () => {
    const config = baseConfig({
        "*": {
            nudgeFrequency: 1,
            models: {
                "shared-model": { nudgeFrequency: 2 },
            },
        },
        "opencode-go": {
            nudgeFrequency: 3,
            models: {
                "shared-model": { nudgeFrequency: 4 },
                "flash": { nudgeFrequency: 5 },
            },
        },
    })

    assert.equal(getResolvedCompressValue(config, "opencode-go", "flash", "nudgeFrequency"), 5,
        "exact model flash should win")
    assert.equal(getResolvedCompressValue(config, "opencode-go", "shared-model", "nudgeFrequency"), 4,
        "exact model shared-model under exact provider should win over wildcard model")
    assert.equal(getResolvedCompressValue(config, "opencode-go", "other-model", "nudgeFrequency"), 3,
        "exact provider should win over wildcard provider")
    assert.equal(getResolvedCompressValue(config, "unknown-provider", "shared-model", "nudgeFrequency"), 2,
        "wildcard model under wildcard provider should apply")
    assert.equal(getResolvedCompressValue(config, "unknown-provider", "other-model", "nudgeFrequency"), 1,
        "wildcard provider should apply")
    assert.equal(getResolvedCompressValue(config, "other", "nonexistent", "nudgeFrequency"), 1,
        "wildcard provider should apply to any unmatched")
})

// --- Provider IDs with special characters ---

test("provider ID with slash matches exactly via wildcard", () => {
    const config = baseConfig({
        "*": { nudgeFrequency: 3 },
    })
    const result = getResolvedCompressValue(config, "provider/v2", undefined, "nudgeFrequency")
    assert.equal(result, 3)
})

test("model ID with slash matches wildcard model", () => {
    const config = baseConfig({
        "*": {
            models: {
                "*": { nudgeFrequency: 7 },
            },
        },
    })
    const result = getResolvedCompressValue(config, "any-provider", "org/model:variant", "nudgeFrequency")
    assert.equal(result, 7)
})

test("model ID with colon and slash matches exact model with wildcard provider", () => {
    const config = baseConfig({
        "*": {
            models: {
                "org/model:variant": { nudgeFrequency: 42 },
            },
        },
    })
    const result = getResolvedCompressValue(config, "any-provider", "org/model:variant", "nudgeFrequency")
    assert.equal(result, 42)
})

// --- Case sensitivity ---

test("provider matching is case-sensitive", () => {
    const config = baseConfig({
        "opencode-go": { nudgeFrequency: 10 },
        "*": { nudgeFrequency: 1 },
    })
    const resultLower = getResolvedCompressValue(config, "opencode-go", undefined, "nudgeFrequency")
    assert.equal(resultLower, 10)
    const resultUpper = getResolvedCompressValue(config, "OpenCode-Go", undefined, "nudgeFrequency")
    assert.equal(resultUpper, 1, "case mismatch should fall through to wildcard")
})

// --- Wildcard field inheritance: field set at wildcard model but not at wildcard provider ---

test("field only at wildcard model level, not at wildcard provider, returns correctly", () => {
    const config = baseConfig({
        "*": {
            models: {
                "flash": { protectUserMessages: true },
            },
        },
    })
    const result = getResolvedCompressValue(config, "unknown-provider", "flash", "protectUserMessages")
    assert.equal(result, true)
})
