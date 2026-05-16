import assert from "node:assert/strict"
import test from "node:test"
import { getInvalidConfigKeys, validateConfigTypes } from "../../lib/config"

function cfg(data: Record<string, any>) {
    return { compress: { mode: "range", nudgeFrequency: 5, ...(data.compress || {}), providers: data.providers } }
}

test("validation accepts valid provider structure", () => {
    const errors = validateConfigTypes(cfg({
        providers: {
            "opencode-go": {
                nudgeFrequency: 10,
                models: {
                    "deepseek-v4-flash": { maxContextLimit: 200000 },
                },
            },
        },
    }))
    assert.equal(errors.length, 0)
})

test("validation rejects non-object provider value", () => {
    const errors = validateConfigTypes(cfg({
        providers: ["not-an-object"],
    }))
    assert.ok(errors.some((e) => e.key === "compress.providers"), "should report providers issue")
})

test("validation rejects invalid nudgeFrequency in provider", () => {
    const errors = validateConfigTypes(cfg({
        providers: {
            "opencode-go": { nudgeFrequency: "abc" },
        },
    }))
    assert.ok(errors.some((e) => e.key === "compress.providers.opencode-go.nudgeFrequency"))
})

test("validation rejects invalid permission in provider", () => {
    const errors = validateConfigTypes(cfg({
        providers: {
            "opencode-go": { permission: "forbid" },
        },
    }))
    assert.ok(errors.some((e) => e.key === "compress.providers.opencode-go.permission"))
})

test("validation rejects invalid maxContextLimit pattern in model", () => {
    const errors = validateConfigTypes(cfg({
        providers: {
            "opencode-go": {
                models: {
                    "flash": { maxContextLimit: "invalid%" },
                },
            },
        },
    }))
    assert.ok(errors.some((e) => e.key.includes("maxContextLimit")))
})

test("validation rejects non-object model entry", () => {
    const errors = validateConfigTypes(cfg({
        providers: {
            "opencode-go": {
                models: {
                    "flash": "not-an-object",
                },
            },
        },
    }))
    assert.ok(errors.some((e) => e.key === "compress.providers.opencode-go.models.flash"))
})

test("validation rejects invalid protectedTools in provider", () => {
    const errors = validateConfigTypes(cfg({
        providers: {
            "opencode-go": { protectedTools: "not-an-array" },
        },
    }))
    assert.ok(errors.some((e) => e.key === "compress.providers.opencode-go.protectedTools"))
})

test("deprecated modelMaxLimits does not trigger unknown key error", () => {
    const keys = getInvalidConfigKeys(cfg({
        modelMaxLimits: { "opencode-go/flash": 200000 },
    }))
    assert.equal(keys.filter((k) => k.includes("modelMaxLimits")).length, 0)
})

test("deprecated modelMinLimits does not trigger unknown key error", () => {
    const keys = getInvalidConfigKeys(cfg({
        modelMinLimits: { "opencode-go/flash": "50%" },
    }))
    assert.equal(keys.filter((k) => k.includes("modelMinLimits")).length, 0)
})
