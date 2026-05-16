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

test("getResolvedCompressValue with undefined providerId returns undefined", () => {
    const config = baseConfig({ "opencode-go": { nudgeFrequency: 10 } })
    const result = getResolvedCompressValue(config, undefined, undefined, "nudgeFrequency")
    assert.equal(result, undefined)
})

test("getResolvedCompressValue with empty string providerId returns undefined", () => {
    const config = baseConfig({ "": { nudgeFrequency: 10 } })
    const result = getResolvedCompressValue(config, "", undefined, "nudgeFrequency")
    assert.equal(result, undefined)
})

test("getResolvedCompressValue with empty string modelId does not match", () => {
    const config = baseConfig({ "opencode-go": { models: { "": { nudgeFrequency: 99 } } } })
    const result = getResolvedCompressValue(config, "opencode-go", "", "nudgeFrequency")
    assert.equal(result, undefined)
})

test("getResolvedCompressValue with null config throws TypeError", () => {
    assert.throws(() => {
        getResolvedCompressValue(null as any, "opencode-go", "model", "nudgeFrequency")
    }, TypeError)
})

test("getResolvedCompressValue with undefined config throws TypeError", () => {
    assert.throws(() => {
        getResolvedCompressValue(undefined as any, "opencode-go", "model", "nudgeFrequency")
    }, TypeError)
})

test("getResolvedCompressValue with compress.providers set to array returns undefined", () => {
    const config = baseConfig()
    config.compress.providers = [] as any
    const result = getResolvedCompressValue(config, "opencode-go", "model", "nudgeFrequency")
    assert.equal(result, undefined)
})

test("getResolvedCompressValue with compress.providers set to null returns undefined", () => {
    const config = baseConfig()
    config.compress.providers = null as any
    const result = getResolvedCompressValue(config, "opencode-go", "model", "nudgeFrequency")
    assert.equal(result, undefined)
})

test("getResolvedCompressValue with compress.providers set to string returns undefined", () => {
    const config = baseConfig()
    config.compress.providers = "not-an-object" as any
    const result = getResolvedCompressValue(config, "opencode-go", "model", "nudgeFrequency")
    assert.equal(result, undefined)
})

test("getInvalidConfigKeys reports unknown keys inside compress.providers (non-recursive mode)", () => {
    const config = {
        compress: {
            providers: {
                "opencode-go": { unknownField: 10 },
            },
        },
    }
    const keys = getInvalidConfigKeys(config as any)
    assert.ok(keys.every((k) => !k.startsWith("compress.providers.")),
        "should skip compress.providers recursively: " + keys.join(", "))
})

test("validateConfigTypes rejects compress.providers as array", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: ["not-an-object"],
        },
    })
    assert.ok(errors.some((e) => e.key === "compress.providers"))
})

test("validateConfigTypes rejects compress.providers as null", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: null,
        },
    })
    assert.ok(errors.some((e) => e.key === "compress.providers"))
})

test("validateConfigTypes rejects compress.providers as string", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: "invalid",
        },
    })
    assert.ok(errors.some((e) => e.key === "compress.providers"))
})

test("validateConfigTypes rejects compress.providers entry as null", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: {
                "opencode-go": null,
            },
        },
    })
    assert.ok(errors.some((e) => e.key === "compress.providers.opencode-go"))
})

test("validateConfigTypes rejects compress.providers entry as array", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: {
                "opencode-go": ["not-an-object"],
            },
        },
    })
    assert.ok(errors.some((e) => e.key === "compress.providers.opencode-go"))
})

test("validateConfigTypes rejects compress.providers entry as string", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: {
                "opencode-go": "invalid",
            },
        },
    })
    assert.ok(errors.some((e) => e.key === "compress.providers.opencode-go"))
})

test("validateConfigTypes rejects compress.providers.model entry as null", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: {
                "opencode-go": {
                    models: {
                        "flash": null,
                    },
                },
            },
        },
    })
    assert.ok(errors.some((e) => e.key === "compress.providers.opencode-go.models.flash"))
})

test("validateConfigTypes rejects compress.providers.model entry as string", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: {
                "opencode-go": {
                    models: {
                        "flash": "invalid",
                    },
                },
            },
        },
    })
    assert.ok(errors.some((e) => e.key === "compress.providers.opencode-go.models.flash"))
})

test("validateConfigTypes with missing compress key does not throw", () => {
    const errors = validateConfigTypes({})
    assert.equal(errors.length, 0)
})

test("validateConfigTypes with null compress key reports one error", () => {
    const errors = validateConfigTypes({ compress: null })
    assert.equal(errors.length, 1)
    assert.ok(errors.some((e) => e.key === "compress"))
})

test("validateConfigTypes with non-object compress reports one error", () => {
    const errors = validateConfigTypes({ compress: "invalid" })
    assert.equal(errors.length, 1)
    assert.ok(errors.some((e) => e.key === "compress"))
})

test("validateConfigTypes with no compress key but other keys is valid", () => {
    const errors = validateConfigTypes({ enabled: true, debug: false })
    assert.equal(errors.length, 0)
})

test("validateConfigTypes rejects negative percentage values", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: {
                "opencode-go": { maxContextLimit: "-10%" },
            },
        },
    })
    assert.ok(errors.some((e) => e.key.includes("maxContextLimit")),
        "should reject negative percentage, got: " + JSON.stringify(errors))
})

test("validateConfigTypes rejects percentage over 100%", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: {
                "opencode-go": { maxContextLimit: "150%" },
            },
        },
    })
    assert.equal(errors.filter((e) => e.key.includes("maxContextLimit")).length, 0,
        "150% should pass format validation, clamp happens at runtime")
})

test("validateConfigTypes rejects malformed percentage - double percent", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: {
                "opencode-go": { maxContextLimit: "50%%" },
            },
        },
    })
    assert.ok(errors.some((e) => e.key.includes("maxContextLimit")),
        "should reject double percent")
})

test("validateConfigTypes rejects malformed percentage - percent first", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: {
                "opencode-go": { maxContextLimit: "%50" },
            },
        },
    })
    assert.ok(errors.some((e) => e.key.includes("maxContextLimit")),
        "should reject percent-first format")
})

test("validateConfigTypes rejects malformed percentage - no number", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: {
                "opencode-go": { maxContextLimit: "%" },
            },
        },
    })
    assert.ok(errors.some((e) => e.key.includes("maxContextLimit")),
        "should reject bare percent")
})

test("validateConfigTypes rejects malformed percentage - space before percent", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: {
                "opencode-go": { maxContextLimit: "50 %" },
            },
        },
    })
    assert.ok(errors.some((e) => e.key.includes("maxContextLimit")),
        "should reject space before percent")
})

test("validateConfigTypes rejects percentage with suffix text", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: {
                "opencode-go": { maxContextLimit: "50%extra" },
            },
        },
    })
    assert.ok(errors.some((e) => e.key.includes("maxContextLimit")),
        "should reject percentage with suffix")
})

test("validateConfigTypes rejects nudgeForce with invalid value at provider level", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: {
                "opencode-go": { nudgeForce: "aggressive" },
            },
        },
    })
    assert.ok(errors.some((e) => e.key === "compress.providers.opencode-go.nudgeForce"))
})

test("validateConfigTypes rejects nudgeForce with invalid value at model level", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: {
                "opencode-go": {
                    models: {
                        "flash": { nudgeForce: "medium" },
                    },
                },
            },
        },
    })
    assert.ok(errors.some((e) => e.key === "compress.providers.opencode-go.models.flash.nudgeForce"))
})

test("validateConfigTypes rejects showCompression with non-boolean at model level", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: {
                "opencode-go": {
                    models: {
                        "flash": { showCompression: "yes" },
                    },
                },
            },
        },
    })
    assert.ok(errors.some((e) => e.key === "compress.providers.opencode-go.models.flash.showCompression"))
})

test("validateConfigTypes rejects protectTags with non-boolean at model level", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: {
                "opencode-go": {
                    models: {
                        "flash": { protectTags: 1 },
                    },
                },
            },
        },
    })
    assert.ok(errors.some((e) => e.key === "compress.providers.opencode-go.models.flash.protectTags"))
})

test("validateConfigTypes rejects protectUserMessages with non-boolean at model level", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: {
                "opencode-go": {
                    models: {
                        "flash": { protectUserMessages: "true" },
                    },
                },
            },
        },
    })
    assert.ok(errors.some((e) => e.key === "compress.providers.opencode-go.models.flash.protectUserMessages"))
})

test("validateConfigTypes rejects nudgeFrequency with non-number at model level", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: {
                "opencode-go": {
                    models: {
                        "flash": { nudgeFrequency: "often" },
                    },
                },
            },
        },
    })
    assert.ok(errors.some((e) => e.key === "compress.providers.opencode-go.models.flash.nudgeFrequency"))
})

test("validateConfigTypes rejects iterationNudgeThreshold with non-number at model level", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: {
                "opencode-go": {
                    models: {
                        "flash": { iterationNudgeThreshold: "many" },
                    },
                },
            },
        },
    })
    assert.ok(errors.some((e) => e.key === "compress.providers.opencode-go.models.flash.iterationNudgeThreshold"))
})

test("validateConfigTypes rejects summaryBuffer with non-boolean at model level", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: {
                "opencode-go": {
                    models: {
                        "flash": { summaryBuffer: 0 },
                    },
                },
            },
        },
    })
    assert.ok(errors.some((e) => e.key === "compress.providers.opencode-go.models.flash.summaryBuffer"))
})

test("validateConfigTypes rejects protectedTools with non-array at model level", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: {
                "opencode-go": {
                    models: {
                        "flash": { protectedTools: "not-array" },
                    },
                },
            },
        },
    })
    assert.ok(errors.some((e) => e.key === "compress.providers.opencode-go.models.flash.protectedTools"))
})

test("validateConfigTypes rejects permission with invalid value at model level", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: {
                "opencode-go": {
                    models: {
                        "flash": { permission: "grant" },
                    },
                },
            },
        },
    })
    assert.ok(errors.some((e) => e.key === "compress.providers.opencode-go.models.flash.permission"))
})

test("validateConfigTypes rejects mode with invalid value at provider level", () => {
    const errors = validateConfigTypes({
        compress: {
            providers: {
                "opencode-go": { mode: "hybrid" },
            },
        },
    })
    assert.ok(errors.some((e) => e.key === "compress.providers.opencode-go.mode"))
})

test("validateConfigTypes with large number of providers does not blow up", () => {
    const providers: Record<string, any> = {}
    for (let i = 1; i <= 100; i++) {
        providers[`provider-${i}`] = { nudgeFrequency: i, models: { [`model-${i}`]: { maxContextLimit: i * 1000 } } }
    }
    const errors = validateConfigTypes({ compress: { providers } })
    assert.equal(errors.length, 0, "100 valid providers should have no errors")
})

test("getInvalidConfigKeys with deeply nested provider structure skips all", () => {
    const providers: Record<string, any> = {}
    for (let i = 0; i < 50; i++) {
        providers[`p${i}`] = { nudgeFrequency: i, models: { [`m${i}`]: { maxContextLimit: i * 100 } } }
    }
    const config = { compress: { providers } }
    const keys = getInvalidConfigKeys(config as any)
    const providerKeys = keys.filter((k) => k.startsWith("compress.providers"))
    assert.equal(providerKeys.length, 0, "all provider keys should be skipped")
})

test("getResolvedCompressValue with provider named exactly * returns wildcard value", () => {
    const config = baseConfig({ "*": { nudgeFrequency: 7 } })
    const result = getResolvedCompressValue(config, "*", undefined, "nudgeFrequency")
    assert.equal(result, 7)
})

test("getResolvedCompressValue with provider named ** returns undefined (no wildcard support for **)", () => {
    const config = baseConfig({ "**": { nudgeFrequency: 5 } })
    const result = getResolvedCompressValue(config, "test-provider", undefined, "nudgeFrequency")
    assert.equal(result, undefined)
})

test("getResolvedCompressValue with provider named ** returns ** value (exact match)", () => {
    const config = baseConfig({ "**": { nudgeFrequency: 5 } })
    const result = getResolvedCompressValue(config, "**", undefined, "nudgeFrequency")
    assert.equal(result, 5, "** is an exact key, not a wildcard pattern")
})

test("getResolvedCompressValue ignores provider with null override entry", () => {
    const config = baseConfig()
    config.compress.providers = { "opencode-go": null as any }
    const result = getResolvedCompressValue(config, "opencode-go", undefined, "nudgeFrequency")
    assert.equal(result, undefined)
})
