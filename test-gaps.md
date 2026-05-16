# Test Coverage Gaps — Hierarchical Config

This document catalogs all known test coverage gaps identified after implementing the
hierarchical provider/model configuration for the DCP plugin (39 test files, 201 tests:
90 unit + 111 integration). Use it to prioritize further testing efforts.

## Completed Coverage

| Area | Count | What's covered |
|------|-------|----------------|
| Resolution order | 12 | All hierarchy levels (model > provider > wildcard > global) |
| Validation + deprecation | 9 | Type checking, deprecated modelMaxLimits/modelMinLimits |
| Edge cases + inheritance | 8 | Empty configs, wildcards, inheritance chains, additive merges |
| Per-field overrides | 41 | All 12 override fields at provider and model levels |
| Pipeline integration | 15 | getNudgeFrequency, getIterationNudgeThreshold, isContextOverLimits |
| Real-world configs | 22 | 6 provider/model combos with varying context windows |
| Nudge pipeline | 7 | Nudge integration with hierarchical config resolution |
| Layer merge | 3 | Global -> configDir -> project cascade |

## Remaining Gaps

### Priority 1: Negative / Failure Tests (HIGH)

| # | Gap | Description | Risk |
|---|-----|-------------|------|
| 1 | Null/undefined config | getResolvedCompressValue/validateConfigTypes with null/undefined | Crash |
| 2 | Empty provider ID | providerId = "" should not match any provider | Wrong value fallback |
| 3 | Empty model ID | modelId = "" should not match any model | Silent fallback |
| 4 | Malformed percentages | "%-5", "%%50", "50%extra", "%50", "50 %" rejected | Parse errors |
| 5 | Out-of-range percentages | maxContextLimit: "150%" or "-10%" clamped/rejected? | Undefined behavior |
| 6 | Non-finite numeric values | Infinity, -Infinity, NaN as numeric fields | NaN propagation |
| 7 | Null field values | Each override field set to null should be ignored | Type errors |
| 8 | Negative nudge at model level | Negative nudgeFrequency in model override | Clamping untested |
| 9 | Unknown keys in provider/model | Extra keys silently ignored or reported? | Validation gap |
| 10 | validateConfigTypes missing compress | Config with no compress key | Undefined access |
| 11 | Provider named "*" literally | Is "*" treated as wildcard or exact match? | Ambiguity |
| 12 | Deeply nested invalid structures | Provider inside provider, models inside models | Recursion issues |

### Priority 2: Wildcard Matching (HIGH)

| # | Gap | Description | Risk |
|---|-----|-------------|------|
| 1 | Model-level wildcard * inside provider | provider: { models: { "*": {...} } } | Core feature gap |
| 2 | Model-level wildcard beats exact provider | Wildcard model vs provider-level override | Resolution order |
| 3 | Wildcard + exact same field at different levels | Wildcard sets X, exact sets Y, model expects X or Y? | Inheritance |
| 4 | Wildcard-only fallthrough | Only wildcard exists, no exact provider matches | Integration gap |
| 5 | Provider named "**" | Double-star treated as wildcard or exact? | Ambiguity |
| 6 | Wildcard with empty models | "*": { models: {} } | Noise in resolution |
| 7 | Wildcard + deprecated modelMaxLimits together | Both active simultaneously | Precedence |

### Priority 3: Backward Compatibility (MEDIUM)

| # | Gap | Description | Risk |
|---|-----|-------------|------|
| 1 | No providers key | Config without compress.providers falls to globals | Regression |
| 2 | providers explicitly undefined | providers: undefined treated as absent | Type handling |
| 3 | Deprecated modelMaxLimits still valid | Old configs continue working | Silent breakage |
| 4 | modelMaxLimits + providers together | Both present | Confusion |

### Priority 4: Config Merge / Immutability (MEDIUM)

| # | Gap | Description | Risk |
|---|-----|-------------|------|
| 1 | mergeCompress mutates base | Must not modify base config | Side-effect bugs |
| 2 | deepCloneConfig independence | Fully independent copy | Reference sharing |
| 3 | Global -> configDir -> project cascade with providers | Multi-layer merge correct | Wrong final config |
| 4 | Project overrides configDir providers | Lower layer wins over higher | Wrong override direction |

### Priority 5: Edge Cases / Integration (LOW)

| # | Gap | Description | Risk |
|---|-----|-------------|------|
| 1 | 50+ providers | Performance degradation | Slow startup |
| 2 | Special chars in IDs | "my-provider/v2", "model@1.0", "org/model:variant" | Matching errors |
| 3 | Unicode provider/model IDs | CJK/emoji in IDs | Encoding issues |
| 4 | Case sensitivity | "OpenCode-Go" vs "opencode-go" | Inconsistent matching |

### Priority 6: Documentation (LOW)

| # | Gap | Description |
|---|------|-------------|
| 1 | Resolution order flowchart | Visual decision tree for model > provider > wildcard > global |
| 2 | API docs for config.ts exports | Each exported function documented with params/returns |
| 3 | Test matrix in README | Document which test files cover which scenarios |

---

## Legend

- **Risk**: Likely consequence if gap is not addressed
- **Priority**: 1 = highest, 6 = lowest
