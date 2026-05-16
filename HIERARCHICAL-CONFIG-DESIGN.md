# Hierarchical Compress Configuration Design

## Problem

The current `compress` configuration uses a flat structure where most settings are global and per-model overrides are handled by parallel keys (`modelMaxLimits`, `modelMinLimits`). This approach has several issues:

1. **Doesn't scale** — every new per-model setting requires a new `model*` key
2. **No provider-level grouping** — users with many models from the same provider must duplicate entries (issue #505)
3. **Inconsistent** — `nudgeFrequency`, `iterationNudgeThreshold`, `nudgeForce` have no per-model override
4. **Flat is noisy** — the config object gets cluttered with parallel `model*` keys

## Proposed Structure

Replace the flat `modelMaxLimits`/`modelMinLimits` keys with a nested `providers` hierarchy:

```jsonc
{
  "compress": {
    // Plugin-level defaults (lowest priority)
    "mode": "range",
    "permission": "allow",
    "maxContextLimit": "90%",
    "minContextLimit": "25%",
    "nudgeFrequency": 5,
    "iterationNudgeThreshold": 20,
    "nudgeForce": "soft",

    // Provider-level overrides (medium priority)
    "providers": {
      "google": {
        "maxContextLimit": "80%",
        "nudgeFrequency": 10,
        "iterationNudgeThreshold": 30

        // Model-level overrides (highest priority)
        "models": {
          "gemini-2.5-pro": {
            "maxContextLimit": 200000,
            "nudgeFrequency": 3
          }
        }
      },

      // Wildcard provider matches ANY provider not explicitly listed
      // Lower priority than explicit provider, higher than plugin defaults
      "*": {
        "nudgeFrequency": 6
        "models": {
          "claude-sonnet-4-6": {
            "nudgeFrequency": 2
          }
        }
      }
    }
  }
}
```

## Resolution Order

For any given config field (e.g., `nudgeFrequency`), the resolved value is determined by checking layers in order — the **last non-undefined value wins**:

```
1. compress.providers[providerId].models[modelId].nudgeFrequency
2. compress.providers["*"].models[modelId].nudgeFrequency
3. compress.providers[providerId].nudgeFrequency
4. compress.providers["*"].nudgeFrequency
5. compress.nudgeFrequency (global default)
```

### Explanation

- **Exact model** overrides always win
- **Exact provider** applies to all models under that provider
- **Wildcard provider `*`** serves as a fallback for providers not explicitly configured
- **Plugin-level global** is the lowest-priority default

This naturally covers the `google/*` wildcard use case from issue #505 — just set `compress.providers["google"].maxContextLimit` and all Google models inherit it.

## Supported Fields at Each Level

All levels (global, provider, model) accept the same set of override-able fields:

| Field                      | Type                      | Description                                  |
| -------------------------- | ------------------------- | -------------------------------------------- |
| `mode`                       | `"range" \| "message"`      | Compression mode                             |
| `permission`                 | `"ask" \| "allow" \| "deny"` | Tool permission                              |
| `showCompression`            | `boolean`                 | Show compression summaries                   |
| `summaryBuffer`              | `boolean`                 | Extend max limit with summary tokens        |
| `maxContextLimit`            | `number \| "${number}%"`    | Soft upper context threshold                 |
| `minContextLimit`            | `number \| "${number}%"`    | Soft lower context threshold                 |
| `nudgeFrequency`             | `number`                  | Context-limit nudge interval                 |
| `iterationNudgeThreshold`    | `number`                  | Messages after user msg before iteration nudges |
| `nudgeForce`                 | `"strong" \| "soft"`       | Compression likelihood control               |
| `protectedTools`             | `string[]`                | Tools protected from pruning                 |
| `protectTags`                | `boolean`                 | Preserve `<protect>` tags                   |
| `protectUserMessages`        | `boolean`                 | Never lose user messages                     |

Note: `protectedTools` at provider/model level **adds to** (does not replace) the parent level's list. All other fields override the parent value.

## Backward Compatibility

The old `modelMaxLimits` and `modelMinLimits` keys are **removed**. To aid migration:

1. During the transition, the plugin detects if `modelMaxLimits`/`modelMinLimits` are present and emits a warning toast suggesting migration
2. The new `providers` structure is strictly additive — any field not set at a given level inherits from the level above

### Migration Example

**Before (flat):**
```jsonc
{
  "compress": {
    "maxContextLimit": "90%",
    "modelMaxLimits": {
      "google/gemini-2.5-pro": 200000,
      "anthropic/claude-opus-4-6": "70%"
    }
  }
}
```

**After (hierarchical):**
```jsonc
{
  "compress": {
    "maxContextLimit": "90%",
    "providers": {
      "google": {
        "models": {
          "gemini-2.5-pro": { "maxContextLimit": 200000 }
        }
      },
      "anthropic": {
        "models": {
          "claude-opus-4-6": { "maxContextLimit": "70%" }
        }
      }
    }
  }
}
```

## Implementation Plan

### Phase 1: Schema (`dcp.schema.json`)
- Add `compress.providers` object with `additionalProperties` for provider IDs
- Each provider has the same sub-schema as `compress`
- Each provider has optional `models` object with per-model overrides
- Mark `modelMaxLimits`/`modelMinLimits` as deprecated

### Phase 2: Config Type & Parsing (`lib/config.ts`)
- Update `PluginConfig` and `CompressConfig` interfaces
- Add `providers: Record<string, ProviderOverrides>` field
- `ProviderOverrides` mirrors `CompressConfig` fields + optional `models`
- `mergeCompress()` handles nested merge across three levels
- Validation warns on `modelMaxLimits`/`modelMinLimits` usage
- `VALID_CONFIG_KEYS` includes new hierarchical paths

### Phase 3: Resolution (`lib/messages/inject/utils.ts`)
- Create `resolveEffectiveConfig()` function that walks the hierarchy:
  ```typescript
  function resolveEffectiveConfig(
    config: PluginConfig,
    providerId: string | undefined,
    modelId: string | undefined,
  ): ResolvedCompressConfig
  ```
- Cache resolved config per (providerId, modelId) pair
- `getNudgeFrequency()`, `getIterationNudgeThreshold()`, etc. accept resolved config

### Phase 4: Integration (`lib/messages/inject/inject.ts`)
- `injectCompressNudges()` calls `resolveEffectiveConfig()` once
- Passes resolved config instead of raw config to all downstream helpers

### Phase 5: Build & Docs
- `bun run build` to produce updated `dist/`
- Update `README.md` with new hierarchical config examples

## Open Questions

1. Should the resolution cache invalidate on session change?
   - Yes — resolved config should be recomputed per session
2. Should `protectedTools` merge or replace at each level?
   - Merge (additive) — provider adds to plugin defaults, model adds to provider
3. Should overrides in `providers["*"].models[modelId]` beat exact `providers[providerId]` globals?
   - Yes — model-level always beats provider-level, even through wildcard
