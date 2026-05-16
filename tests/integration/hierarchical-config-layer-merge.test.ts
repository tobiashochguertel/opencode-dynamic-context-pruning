import assert from "node:assert/strict"
import test from "node:test"
import type { PluginConfig } from "../../lib/config"

// Replicate the merge logic to test provider merging across layers
import { getResolvedCompressValue } from "../../lib/config"

function makeConfig(overrides: Partial<PluginConfig["compress"]>): PluginConfig {
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
            ...overrides,
        },
        strategies: {
            deduplication: { enabled: true, protectedTools: [] },
            purgeErrors: { enabled: true, turns: 4, protectedTools: [] },
        },
    }
}

test("global-level providers merge when second layer adds new provider", () => {
    const global = makeConfig({
        providers: { "opencode-go": { nudgeFrequency: 10 } },
    })
    const project = makeConfig({
        providers: { "google": { nudgeFrequency: 8 } },
    })

    // Simulate mergeLayer-like behavior: project overrides global
    global.compress.providers = {
        ...global.compress.providers,
        ...project.compress.providers,
    }

    const opencodeVal = getResolvedCompressValue(global, "opencode-go", undefined, "nudgeFrequency")
    assert.equal(opencodeVal, 10)

    const googleVal = getResolvedCompressValue(global, "google", undefined, "nudgeFrequency")
    assert.equal(googleVal, 8)
})

test("project-level provider overrides global-level same provider", () => {
    const global = makeConfig({
        providers: { "opencode-go": { nudgeFrequency: 10 } },
    })
    const project = makeConfig({
        providers: { "opencode-go": { nudgeFrequency: 3 } },
    })

    global.compress.providers = {
        ...global.compress.providers,
        ...project.compress.providers,
    }

    const val = getResolvedCompressValue(global, "opencode-go", undefined, "nudgeFrequency")
    assert.equal(val, 3)
})

test("project-level model overrides global-level same model", () => {
    const global = makeConfig({
        providers: {
            "opencode-go": {
                nudgeFrequency: 10,
                models: { flash: { nudgeFrequency: 8 } },
            },
        },
    })
    const project = makeConfig({
        providers: {
            "opencode-go": {
                models: { flash: { nudgeFrequency: 2 } },
            },
        },
    })

    const mergedProviders = { ...global.compress.providers! }
    for (const [k, v] of Object.entries(project.compress.providers!)) {
        mergedProviders[k] = { ...mergedProviders[k], ...v }
        if (v.models) {
            mergedProviders[k].models = { ...mergedProviders[k]?.models, ...v.models }
        }
    }
    const config = { ...global, compress: { ...global.compress, providers: mergedProviders } }

    const val = getResolvedCompressValue(config, "opencode-go", "flash", "nudgeFrequency")
    assert.equal(val, 2)
})
