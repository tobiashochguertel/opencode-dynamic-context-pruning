# Hierarchical Config Test Matrix

## Resolution Order (getResolvedCompressValue)

These tests verify that fields are resolved in the correct priority order.

| # | Test Case | Config | Provider ID | Model ID | Expected |
|---|---|---|---|---|---|
| 1 | Global default | compress.nudgeFrequency = 5 | undefined | undefined | 5 |
| 2 | Provider override | opencode-go.nudgeFrequency = 10 | opencode-go | undefined | 10 |
| 3 | Model override | opencode-go.models.deepseek-v4-flash.nudgeFrequency = 3 | opencode-go | deepseek-v4-flash | 3 |
| 4 | Model beats provider | opencode-go: 10 + model: 3 | opencode-go | deepseek-v4-flash | 3 |
| 5 | Wildcard \* | \*.nudgeFrequency = 8 | unknown | undefined | 8 |
| 6 | Exact beats wildcard | \*: 8 + opencode-go: 12 | opencode-go | undefined | 12 |
| 7 | Wildcard model beats provider global | \*.models.deepseek.mode: 2 + opencode-go: 12 | opencode-go | deepseek-v4-flash | 2 |
| 8 | Exact model beats wildcard model | \*.models.deepseek: 1 + opencode-go.models.deepseek: 99 | opencode-go | deepseek-v4-flash | 99 |
| 9 | Provider exists but field unset | opencode-go.nudgeFrequency = 10 | opencode-go | undefined | undefined (caller uses global) |
| 10 | Neither provider nor model match | compress.nudgeFrequency = 5 | unknown | unknown | undefined (caller uses global) |

## All Overridable Fields

Each field type must be tested at all three levels.

| # | Field | Global Type | Provider Override | Model Override |
|---|---|---|---|---|
| 11 | mode | range → message | range | message |
| 12 | permission | allow → deny | ask | deny |
| 13 | showCompression | false → true | true | false |
| 14 | summaryBuffer | true → false | false | true |
| 15 | maxContextLimit | 100000 → "90%" | 200000 | "80%" |
| 16 | minContextLimit | 50000 → "25%" | "10%" | 5000 |
| 17 | nudgeFrequency | 5 → 10 | 3 | 1 |
| 18 | iterationNudgeThreshold | 15 → 30 | 50 | 100 |
| 19 | nudgeForce | soft → strong | soft | strong |
| 20 | protectTags | false → true | true | false |
| 21 | protectUserMessages | false → true | true | false |
| 22 | protectedTools (merge) | [task] → [skill] | [todowrite] | [todoread] |

## Real-World Provider/Model Configs

Full integration tests with realistic context windows and percentage limits.

### opencode-go subscription

| # | Model | Context | Min | Max | Tokens (input) | overMinLimit | overMaxLimit |
|---|---|---|---|---|---|---|---|
| 23 | deepseek-v4-flash | 1,000,000 | 10% (100K) | 90% (900K) | 15_000 | false | false |
| 24 | deepseek-v4-flash | 1,000,000 | 10% (100K) | 90% (900K) | 500_000 | true | false |
| 25 | deepseek-v4-flash | 1,000,000 | 10% (100K) | 90% (900K) | 950_000 | true | true |
| 26 | deepseek-v4-pro | 1,000,000 | 10% (100K) | 80% (800K) | 850_000 | true | true |
| 27 | deepseek-v4-pro | 1,000,000 | 10% (100K) | 80% (800K) | 750_000 | true | false |
| 28 | qwen3-6-plus | 1,000,000 | 10% (100K) | 85% (850K) | 200_000 | true | false |
| 29 | qwen3-5-plus | 1,000,000 | 10% (100K) | 90% (900K) | 50_000 | false | false |
| 30 | kimi-k2-5 | 1,000,000 | 15% (150K) | 85% (850K) | 100_000 | false | false |

### Per-model overrides

| # | Model | Provider Min | Model Max | Tokens | overMinLimit | overMaxLimit |
|---|---|---|---|---|---|---|
| 31 | deepseek-v4-flash | opencode-go: 10% | model: 85% | 870_000 | true | false |
| 32 | deepseek-v4-pro | opencode-go: 10% | model: 70% | 750_000 | true | true |
| 33 | deepseek-v4-pro | opencode-go: 10% | model: 70% | 650_000 | true | false |

### Non-opencode providers

| # | Provider | Model | Context | Min | Max | Tokens | overMinLimit | overMaxLimit |
|---|---|---|---|---|---|---|---|---|
| 34 | google | gemini-3-pro | 200,000 | 25% (50K) | 90% (180K) | 10_000 | false | false |
| 35 | google | gemini-3-pro | 200,000 | 25% (50K) | 90% (180K) | 100_000 | true | false |
| 36 | google | gemini-3-pro | 200,000 | 25% (50K) | 90% (180K) | 190_000 | true | true |
| 37 | anthropic | claude-sonnet-4-6 | 200,000 | 30% (60K) | 80% (160K) | 170_000 | true | true |
| 38 | anthropic | claude-sonnet-4-6 | 200,000 | 30% (60K) | 80% (160K) | 150_000 | true | false |
| 39 | openai | gpt-5.3-codex | 272,000 | 20% (54.4K) | 85% (231.2K) | 240_000 | true | true |
| 40 | openai | gpt-5.3-codex | 272,000 | 20% (54.4K) | 85% (231.2K) | 200_000 | true | false |

## Wildcard Provider Tests

| # | Config (compress.providers) | Provider ID | Model ID | Field | Expected |
|---|---|---|---|---|---|
| 41 | \*: { nudgeFrequency: 7 } | any | undefined | nudgeFrequency | 7 |
| 42 | \*: { nudgeFrequency: 7 }, opencode-go: {} | opencode-go | undefined | nudgeFrequency | 7 |
| 43 | \*: { nudgeFrequency: 7 }, opencode-go: { nudgeFrequency: 12 } | opencode-go | undefined | nudgeFrequency | 12 |
| 44 | \*: { models: { flash: { nudgeFrequency: 2 } } } | opencode-go | flash | nudgeFrequency | 2 |
| 45 | \*: { models: { flash: { nudgeFrequency: 2 } } }, opencode-go: { nudgeFrequency: 10 } | opencode-go | flash | nudgeFrequency | 2 |
| 46 | \*: { models: { flash: { nudgeFrequency: 2 } } }, opencode-go: { models: { flash: { nudgeFrequency: 5 } } } | opencode-go | flash | nudgeFrequency | 5 |

## Inheritance & Merging

| # | Scenario | Config | Expected |
|---|---|---|---|
| 47 | Provider inherits global | compress.nudgeFrequency = 5, provider sets nothing | model gets 5 |
| 48 | Model inherits from provider | provider.nudgeFrequency = 10, model sets nothing | model gets 10 |
| 49 | Model inherits from global through provider | provider sets maxLimit, model sets nudge only — nudge comes from global | nudge = 5 |
| 50 | protectedTools merge additive | global: [a], provider: [b], model: [c] | model tools = [a, b, c] |

## Edge Cases

| # | Scenario | Input | Expected |
|---|---|---|---|
| 51 | No user message (model info absent) | messages = [] | providerId = undefined, modelId = undefined, globals used |
| 52 | User message without model info | info.model missing | providerId = undefined, modelId = undefined |
| 53 | Provider config is empty object | opencode-go: {} | no overrides, globals used |
| 54 | Model config is empty object | opencode-go: { models: { flash: {} } } | no overrides, inherits provider/global |
| 55 | Zero provider | compress.providers = {} | no providers, globals used |
| 56 | Unknown field in provider | opencode-go: { unknownField: 5 } | should not cause error (unknown keys warn) |
| 57 | Wildcard only, no explicit provider | \*: { nudgeFrequency: 3 } | any provider gets 3 |

## Nudge Pipeline Integration

| # | Test | Config | Messages | Expected |
|---|---|---|---|---|
| 58 | injectCompressNudges passes providerId/modelId | opencode-go: { nudgeFrequency: 2 } | 1 user + 1 assistant | nudge uses 2 (not global 5) |
| 59 | injectCompressNudges uses model override | opencode-go.models.flash: { nudgeFrequency: 1 } | 1 user + 1 assistant | nudge uses 1 |
| 60 | injectCompressNudges wildcard model | \*.models.flash: { nudgeFrequency: 3 } | 1 user + 1 assistant | nudge uses 3 |

## Validation

| # | Input | Expected Warning |
|---|---|---|
| 61 | compress.providers["opencode-go"].nudgeFrequency = "abc" | type error: expected number |
| 62 | compress.providers["opencode-go"].models["flash"].maxContextLimit = "invalid%" | type error: invalid pattern |
| 63 | compress.providers["opencode-go"].permission = "forbid" | type error: expected ask/allow/deny |
| 64 | compress.providers["opencode-go"].protectedTools = "not-an-array" | type error: expected string[] |
| 65 | compress.providers = ["not-an-object"] | type error: expected object |

## Backward Compatibility (modelMaxLimits / modelMinLimits)

| # | Test | Old Key | Value | New Equivalent |
|---|---|---|---|---|
| 66 | modelMaxLimits still parsed | modelMaxLimits | { "opencode-go/deepseek-v4-flash": 200000 } | compress.providers.opencode-go.models.deepseek-v4-flash.maxContextLimit = 200000 |
| 67 | modelMinLimits still parsed | modelMinLimits | { "opencode-go/deepseek-v4-flash": "25%" } | compress.providers.opencode-go.models.deepseek-v4-flash.minContextLimit = "25%" |

## Implementation Status

| Layer merge (global→project) | 3 | ✅ covered (providers merge cross-layer, project overrides global) | `tests/integration/hierarchical-config-layer-merge.test.ts` |
| Config key path recursion | 2 | ✅ covered (providers and modelMaxLimits skipped) | `tests/unit/hierarchical-config-override-fields.test.ts` |
| Null/undefined safety | 2 | ✅ covered (providers null or undefined does not throw) | `tests/unit/hierarchical-config-override-fields.test.ts` |
| Test Range | Count | Status | Files |
|---|---|---|---|---|
| Resolution order (1–10) | 10 | ✅ covered | `tests/unit/hierarchical-config.test.ts` |
| All override fields (11–22) | 12 | ✅ covered (each of 12 fields at both provider and model level, plus 4 structural tests) | `tests/unit/hierarchical-config-override-fields.test.ts` |
| Real-world configs (23–40) | 18 | ✅ covered (deepseek-v4-flash/pro, qwen3-6-plus/3-5-plus, kimi-k2-5, gemini-3-pro, claude-sonnet-4-6, gpt-5.3-codex) | `tests/integration/hierarchical-config-real-world.test.ts` |
| Wildcard (41–46) | 6 | ✅ covered | `tests/unit/hierarchical-config.test.ts`, `tests/unit/hierarchical-config-edge-cases.test.ts` |
| Inheritance (47–50) | 4 | ✅ covered (empty model inherits provider, empty provider inherits global, additive protectedTools) | `tests/unit/hierarchical-config-edge-cases.test.ts` |
| Edge cases (51–57) | 7 | ✅ covered (no model info, empty provider, empty model, zero providers, unknown field, wildcard-only) | `tests/unit/hierarchical-config-edge-cases.test.ts` |
| Nudge pipeline (58–60) | 3 | ✅ covered (getModelInfo, getNudgeFrequency, getIterationNudgeThreshold, isContextOverLimits with model info) | `tests/integration/hierarchical-config-nudge-pipeline.test.ts` |
| Validation (61–65) | 5 | ✅ covered (non-object, invalid nudge, invalid permission, invalid percent pattern, non-object model) | `tests/unit/hierarchical-config-validation.test.ts` |
| Backward compat (66–67) | 2 | ✅ covered (modelMaxLimits and modelMinLimits accepted without unknown-key error) | `tests/unit/hierarchical-config-validation.test.ts` |
