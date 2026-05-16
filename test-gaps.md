# Test Coverage — Hierarchical Config

## Current Status

**356 tests** (245 unit + 111 integration), **0 failures**, **0 skipped**.

All priority categories 1–5 are **implemented**. Only Priority 6 (Documentation) remains as defined below.

## Completed Coverage

| Area | File(s) | Count |
|------|---------|-------|
| Resolution order | `hierarchical-config.test.ts` | 12 |
| Validation + deprecation | `hierarchical-config-validation.test.ts` | 9 |
| Edge cases + inheritance | `hierarchical-config-edge-cases.test.ts` | 8 |
| Per-field overrides (all 12 fields) | `hierarchical-config-override-fields.test.ts` | 41 |
| Negative / failure | `hierarchical-config-negative.test.ts` | 45 |
| Wildcard matching | `wildcard-matching.test.ts` | 22 |
| Backward compatibility | `hierarchical-config-backward-compat.test.ts` | 27 |
| Merge / immutability | `hierarchical-config-merge-immutability.test.ts` | 26 |
| Edge cases / integration | `hierarchical-config-edge-integration.test.ts` | 37 |
| Pipeline integration | `hierarchical-config-resolution.test.ts` | 15 |
| Real-world configs | `hierarchical-config-real-world.test.ts` | 22 |
| Nudge pipeline | `hierarchical-config-nudge-pipeline.test.ts` | 7 |
| Layer merge | `hierarchical-config-layer-merge.test.ts` | 3 |

## Test Matrix

| Test file | Type | Covers | Hierarchical? |
|-----------|------|--------|:---:|
| `hierarchical-config.test.ts` | unit | Resolution order, wildcard, percentages | Yes |
| `hierarchical-config-validation.test.ts` | unit | Type checking, deprecated keys | Yes |
| `hierarchical-config-edge-cases.test.ts` | unit | Empty configs, inheritance, wildcard fallthrough | Yes |
| `hierarchical-config-override-fields.test.ts` | unit | All 12 fields at provider and model level | Yes |
| `hierarchical-config-negative.test.ts` | unit | Null/undefined, malformed values, type errors | Yes |
| `wildcard-matching.test.ts` | unit | Model-level wildcard, fallthrough, chain, special chars | Yes |
| `hierarchical-config-backward-compat.test.ts` | unit | No providers, modelMaxLimits, runtime fallback | Yes |
| `hierarchical-config-merge-immutability.test.ts` | unit | deepCloneConfig, mergeCompress, no mutation | Yes |
| `hierarchical-config-edge-integration.test.ts` | unit | Unicode, long IDs, performance, extreme values | Yes |
| `hierarchical-config-resolution.test.ts` | integration | getNudgeFrequency, isContextOverLimits | Yes |
| `hierarchical-config-real-world.test.ts` | integration | 6 provider/model combos with context windows | Yes |
| `hierarchical-config-nudge-pipeline.test.ts` | integration | Nudge integration with hierarchical resolution | Yes |
| `hierarchical-config-layer-merge.test.ts` | integration | Global -> configDir -> project cascade | Yes |
| `compression-targets.test.ts` | unit | Compression block grouping | No |
| `compress-range-placeholders.test.ts` | unit | Block placeholder parsing/injection | No |
| `host-permissions.test.ts` | unit | Permission resolution | No |
| `message-ids.test.ts` | unit | Message reference assignment | No |
| `message-utils.test.ts` | unit | Ignored user message detection | No |
| `token-counting.test.ts` | unit | Token counting utilities | No |
| `token-usage.test.ts` | unit | Context limit checking | No |
| `compression-groups.test.ts` | integration | Compression grouping flow | No |
| `compress-message.test.ts` | integration | Compress message tool | No |
| `compress-range.test.ts` | integration | Compress range tool | No |
| `hooks-permission.test.ts` | integration | OpenCode hooks | No |
| `message-priority.test.ts` | integration | Priority/prune/inject pipeline | No |
| `prompts.test.ts` | integration | PromptStore with file I/O | No |
| `update.test.ts` | integration | Update/remove operations | No |

## Remaining Gap

### Priority 6: Documentation

| # | Item | Description |
|---|------|-------------|
| 1 | Resolution order flowchart | Visual decision tree for model > provider > wildcard > global |
| 2 | Test matrix in README | This table, included in a project README section |
| 3 | API docs for config.ts exports | JSDoc for each exported function |

---

## Legend

- **Hierarchical?** — Whether the test specifically covers the hierarchical provider/model config feature
- **Priority**: 1–6 (all 1–5 completed)
