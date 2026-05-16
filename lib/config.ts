import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import { parse } from "jsonc-parser"
import type { PluginInput } from "@opencode-ai/plugin"

type Permission = "ask" | "allow" | "deny"
type CompressMode = "range" | "message"

export interface Deduplication {
    enabled: boolean
    protectedTools: string[]
}

export interface CompressOverrides {
    mode?: CompressMode
    permission?: Permission
    showCompression?: boolean
    summaryBuffer?: boolean
    maxContextLimit?: number | `${number}%`
    minContextLimit?: number | `${number}%`
    nudgeFrequency?: number
    iterationNudgeThreshold?: number
    nudgeForce?: "strong" | "soft"
    protectedTools?: string[]
    protectTags?: boolean
    protectUserMessages?: boolean
}

export interface ModelOverrides extends CompressOverrides {
}

export interface ProviderOverrides extends CompressOverrides {
    models?: Record<string, ModelOverrides>
}

export interface CompressConfig extends CompressOverrides {
    mode: CompressMode
    permission: Permission
    showCompression: boolean
    summaryBuffer: boolean
    maxContextLimit: number | `${number}%`
    minContextLimit: number | `${number}%`
    nudgeFrequency: number
    iterationNudgeThreshold: number
    nudgeForce: "strong" | "soft"
    protectedTools: string[]
    protectTags: boolean
    protectUserMessages: boolean
    providers?: Record<string, ProviderOverrides>
}

export type ResolvedCompressConfig = CompressConfig

export interface Commands {
    enabled: boolean
    protectedTools: string[]
}

export interface ManualModeConfig {
    enabled: boolean
    automaticStrategies: boolean
}

export interface PurgeErrors {
    enabled: boolean
    turns: number
    protectedTools: string[]
}

export interface TurnProtection {
    enabled: boolean
    turns: number
}

export interface ExperimentalConfig {
    allowSubAgents: boolean
    customPrompts: boolean
}

export interface PluginConfig {
    enabled: boolean
    autoUpdate: boolean
    debug: boolean
    pruneNotification: "off" | "minimal" | "detailed"
    pruneNotificationType: "chat" | "toast"
    commands: Commands
    manualMode: ManualModeConfig
    turnProtection: TurnProtection
    experimental: ExperimentalConfig
    protectedFilePatterns: string[]
    compress: CompressConfig
    strategies: {
        deduplication: Deduplication
        purgeErrors: PurgeErrors
    }
}

const DEFAULT_PROTECTED_TOOLS = [
    "task",
    "skill",
    "todowrite",
    "todoread",
    "compress",
    "batch",
    "plan_enter",
    "plan_exit",
    "write",
    "edit",
]

const COMPRESS_DEFAULT_PROTECTED_TOOLS = ["task", "skill", "todowrite", "todoread"]

export const VALID_CONFIG_KEYS = new Set([
    "$schema",
    "enabled",
    "autoUpdate",
    "debug",
    "showUpdateToasts",
    "pruneNotification",
    "pruneNotificationType",
    "turnProtection",
    "turnProtection.enabled",
    "turnProtection.turns",
    "experimental",
    "experimental.allowSubAgents",
    "experimental.customPrompts",
    "protectedFilePatterns",
    "commands",
    "commands.enabled",
    "commands.protectedTools",
    "manualMode",
    "manualMode.enabled",
    "manualMode.automaticStrategies",
    "compress",
    "compress.mode",
    "compress.permission",
    "compress.showCompression",
    "compress.summaryBuffer",
    "compress.maxContextLimit",
    "compress.minContextLimit",
    "compress.nudgeFrequency",
    "compress.iterationNudgeThreshold",
    "compress.nudgeForce",
    "compress.protectedTools",
    "compress.protectTags",
    "compress.protectUserMessages",
    "compress.providers",
    "compress.modelMaxLimits",
    "compress.modelMinLimits",
    "strategies",
    "strategies.deduplication",
    "strategies.deduplication.enabled",
    "strategies.deduplication.protectedTools",
    "strategies.purgeErrors",
    "strategies.purgeErrors.enabled",
    "strategies.purgeErrors.turns",
    "strategies.purgeErrors.protectedTools",
])

function getConfigKeyPaths(obj: Record<string, any>, prefix = ""): string[] {
    const keys: string[] = []
    for (const key of Object.keys(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key
        keys.push(fullKey)

        if (fullKey === "compress.modelMaxLimits" || fullKey === "compress.modelMinLimits") {
            continue
        }

        if (fullKey === "compress.providers") {
            continue
        }

        if (obj[key] && typeof obj[key] === "object" && !Array.isArray(obj[key])) {
            keys.push(...getConfigKeyPaths(obj[key], fullKey))
        }
    }
    return keys
}

export function getInvalidConfigKeys(userConfig: Record<string, any>): string[] {
    const userKeys = getConfigKeyPaths(userConfig)
    return userKeys.filter((key) => !VALID_CONFIG_KEYS.has(key))
}

interface ValidationError {
    key: string
    expected: string
    actual: string
}

export function validateConfigTypes(config: Record<string, any>): ValidationError[] {
    const errors: ValidationError[] = []

    if (config.enabled !== undefined && typeof config.enabled !== "boolean") {
        errors.push({ key: "enabled", expected: "boolean", actual: typeof config.enabled })
    }

    if (config.autoUpdate !== undefined && typeof config.autoUpdate !== "boolean") {
        errors.push({ key: "autoUpdate", expected: "boolean", actual: typeof config.autoUpdate })
    }

    if (config.debug !== undefined && typeof config.debug !== "boolean") {
        errors.push({ key: "debug", expected: "boolean", actual: typeof config.debug })
    }

    if (config.pruneNotification !== undefined) {
        const validValues = ["off", "minimal", "detailed"]
        if (!validValues.includes(config.pruneNotification)) {
            errors.push({
                key: "pruneNotification",
                expected: '"off" | "minimal" | "detailed"',
                actual: JSON.stringify(config.pruneNotification),
            })
        }
    }

    if (config.pruneNotificationType !== undefined) {
        const validValues = ["chat", "toast"]
        if (!validValues.includes(config.pruneNotificationType)) {
            errors.push({
                key: "pruneNotificationType",
                expected: '"chat" | "toast"',
                actual: JSON.stringify(config.pruneNotificationType),
            })
        }
    }

    if (config.protectedFilePatterns !== undefined) {
        if (!Array.isArray(config.protectedFilePatterns)) {
            errors.push({
                key: "protectedFilePatterns",
                expected: "string[]",
                actual: typeof config.protectedFilePatterns,
            })
        } else if (!config.protectedFilePatterns.every((v: unknown) => typeof v === "string")) {
            errors.push({
                key: "protectedFilePatterns",
                expected: "string[]",
                actual: "non-string entries",
            })
        }
    }

    if (config.turnProtection) {
        if (
            config.turnProtection.enabled !== undefined &&
            typeof config.turnProtection.enabled !== "boolean"
        ) {
            errors.push({
                key: "turnProtection.enabled",
                expected: "boolean",
                actual: typeof config.turnProtection.enabled,
            })
        }

        if (
            config.turnProtection.turns !== undefined &&
            typeof config.turnProtection.turns !== "number"
        ) {
            errors.push({
                key: "turnProtection.turns",
                expected: "number",
                actual: typeof config.turnProtection.turns,
            })
        }
        if (typeof config.turnProtection.turns === "number" && config.turnProtection.turns < 1) {
            errors.push({
                key: "turnProtection.turns",
                expected: "positive number (>= 1)",
                actual: `${config.turnProtection.turns}`,
            })
        }
    }

    const experimental = config.experimental
    if (experimental !== undefined) {
        if (
            typeof experimental !== "object" ||
            experimental === null ||
            Array.isArray(experimental)
        ) {
            errors.push({
                key: "experimental",
                expected: "object",
                actual: typeof experimental,
            })
        } else {
            if (
                experimental.allowSubAgents !== undefined &&
                typeof experimental.allowSubAgents !== "boolean"
            ) {
                errors.push({
                    key: "experimental.allowSubAgents",
                    expected: "boolean",
                    actual: typeof experimental.allowSubAgents,
                })
            }

            if (
                experimental.customPrompts !== undefined &&
                typeof experimental.customPrompts !== "boolean"
            ) {
                errors.push({
                    key: "experimental.customPrompts",
                    expected: "boolean",
                    actual: typeof experimental.customPrompts,
                })
            }
        }
    }

    const commands = config.commands
    if (commands !== undefined) {
        if (typeof commands !== "object" || commands === null || Array.isArray(commands)) {
            errors.push({
                key: "commands",
                expected: "object",
                actual: typeof commands,
            })
        } else {
            if (commands.enabled !== undefined && typeof commands.enabled !== "boolean") {
                errors.push({
                    key: "commands.enabled",
                    expected: "boolean",
                    actual: typeof commands.enabled,
                })
            }
            if (commands.protectedTools !== undefined && !Array.isArray(commands.protectedTools)) {
                errors.push({
                    key: "commands.protectedTools",
                    expected: "string[]",
                    actual: typeof commands.protectedTools,
                })
            }
        }
    }

    const manualMode = config.manualMode
    if (manualMode !== undefined) {
        if (typeof manualMode !== "object" || manualMode === null || Array.isArray(manualMode)) {
            errors.push({
                key: "manualMode",
                expected: "object",
                actual: typeof manualMode,
            })
        } else {
            if (manualMode.enabled !== undefined && typeof manualMode.enabled !== "boolean") {
                errors.push({
                    key: "manualMode.enabled",
                    expected: "boolean",
                    actual: typeof manualMode.enabled,
                })
            }

            if (
                manualMode.automaticStrategies !== undefined &&
                typeof manualMode.automaticStrategies !== "boolean"
            ) {
                errors.push({
                    key: "manualMode.automaticStrategies",
                    expected: "boolean",
                    actual: typeof manualMode.automaticStrategies,
                })
            }
        }
    }

    const compress = config.compress
    if (compress !== undefined) {
        if (typeof compress !== "object" || compress === null || Array.isArray(compress)) {
            errors.push({
                key: "compress",
                expected: "object",
                actual: typeof compress,
            })
        } else {
            const validateCompressOverrides = (
                keyPrefix: string,
                overrides: Record<string, any>,
                allowMode: boolean,
            ): void => {
                if (allowMode && overrides.mode !== undefined) {
                    if (overrides.mode !== "range" && overrides.mode !== "message") {
                        errors.push({
                            key: `${keyPrefix}.mode`,
                            expected: '"range" | "message"',
                            actual: JSON.stringify(overrides.mode),
                        })
                    }
                }

                if (overrides.permission !== undefined) {
                    const validValues = ["ask", "allow", "deny"]
                    if (!validValues.includes(overrides.permission)) {
                        errors.push({
                            key: `${keyPrefix}.permission`,
                            expected: '"ask" | "allow" | "deny"',
                            actual: JSON.stringify(overrides.permission),
                        })
                    }
                }

                if (overrides.summaryBuffer !== undefined && typeof overrides.summaryBuffer !== "boolean") {
                    errors.push({
                        key: `${keyPrefix}.summaryBuffer`,
                        expected: "boolean",
                        actual: typeof overrides.summaryBuffer,
                    })
                }

                if (overrides.showCompression !== undefined && typeof overrides.showCompression !== "boolean") {
                    errors.push({
                        key: `${keyPrefix}.showCompression`,
                        expected: "boolean",
                        actual: typeof overrides.showCompression,
                    })
                }

                if (overrides.nudgeFrequency !== undefined && typeof overrides.nudgeFrequency !== "number") {
                    errors.push({
                        key: `${keyPrefix}.nudgeFrequency`,
                        expected: "number",
                        actual: typeof overrides.nudgeFrequency,
                    })
                }

                if (typeof overrides.nudgeFrequency === "number" && overrides.nudgeFrequency < 1) {
                    errors.push({
                        key: `${keyPrefix}.nudgeFrequency`,
                        expected: "positive number (>= 1)",
                        actual: `${overrides.nudgeFrequency} (will be clamped to 1)`,
                    })
                }

                if (overrides.iterationNudgeThreshold !== undefined && typeof overrides.iterationNudgeThreshold !== "number") {
                    errors.push({
                        key: `${keyPrefix}.iterationNudgeThreshold`,
                        expected: "number",
                        actual: typeof overrides.iterationNudgeThreshold,
                    })
                }

                if (typeof overrides.iterationNudgeThreshold === "number" && overrides.iterationNudgeThreshold < 1) {
                    errors.push({
                        key: `${keyPrefix}.iterationNudgeThreshold`,
                        expected: "positive number (>= 1)",
                        actual: `${overrides.iterationNudgeThreshold} (will be clamped to 1)`,
                    })
                }

                if (overrides.nudgeForce !== undefined && overrides.nudgeForce !== "strong" && overrides.nudgeForce !== "soft") {
                    errors.push({
                        key: `${keyPrefix}.nudgeForce`,
                        expected: '"strong" | "soft"',
                        actual: JSON.stringify(overrides.nudgeForce),
                    })
                }

                if (overrides.protectedTools !== undefined && !Array.isArray(overrides.protectedTools)) {
                    errors.push({
                        key: `${keyPrefix}.protectedTools`,
                        expected: "string[]",
                        actual: typeof overrides.protectedTools,
                    })
                }

                if (overrides.protectTags !== undefined && typeof overrides.protectTags !== "boolean") {
                    errors.push({
                        key: `${keyPrefix}.protectTags`,
                        expected: "boolean",
                        actual: typeof overrides.protectTags,
                    })
                }

                if (overrides.protectUserMessages !== undefined && typeof overrides.protectUserMessages !== "boolean") {
                    errors.push({
                        key: `${keyPrefix}.protectUserMessages`,
                        expected: "boolean",
                        actual: typeof overrides.protectUserMessages,
                    })
                }

                const validateLimitValue = (key: string, value: unknown): void => {
                    const isValidNumber = typeof value === "number"
                    const isPercentString = typeof value === "string" && /^\d+(?:\.\d+)?%$/.test(value)

                    if (!isValidNumber && !isPercentString) {
                        errors.push({
                            key,
                            expected: 'number | "${number}%"',
                            actual: JSON.stringify(value),
                        })
                    }
                }

                if (overrides.maxContextLimit !== undefined) {
                    validateLimitValue(`${keyPrefix}.maxContextLimit`, overrides.maxContextLimit)
                }

                if (overrides.minContextLimit !== undefined) {
                    validateLimitValue(`${keyPrefix}.minContextLimit`, overrides.minContextLimit)
                }

                if (overrides.models && typeof overrides.models === "object" && !Array.isArray(overrides.models)) {
                    for (const [modelId, modelOverrides] of Object.entries(overrides.models)) {
                        if (modelOverrides && typeof modelOverrides === "object" && !Array.isArray(modelOverrides)) {
                            validateCompressOverrides(`${keyPrefix}.models.${modelId}`, modelOverrides as Record<string, any>, false)
                        } else {
                            errors.push({
                                key: `${keyPrefix}.models.${modelId}`,
                                expected: "object",
                                actual: typeof modelOverrides,
                            })
                        }
                    }
                }
            }

            if (compress.providers !== undefined) {
                if (typeof compress.providers !== "object" || compress.providers === null || Array.isArray(compress.providers)) {
                    errors.push({
                        key: "compress.providers",
                        expected: "object",
                        actual: Array.isArray(compress.providers) ? "array" : typeof compress.providers,
                    })
                }
            }

            if (compress.providers && typeof compress.providers === "object" && !Array.isArray(compress.providers)) {
                for (const [providerId, providerOverrides] of Object.entries(compress.providers)) {
                    if (providerOverrides && typeof providerOverrides === "object" && !Array.isArray(providerOverrides)) {
                        validateCompressOverrides(`compress.providers.${providerId}`, providerOverrides as Record<string, any>, true)
                    } else {
                        errors.push({
                            key: `compress.providers.${providerId}`,
                            expected: "object",
                            actual: typeof providerOverrides,
                        })
                    }
                }
            }

            validateCompressOverrides("compress", compress, true)

            const validateModelLimits = (
                key: "compress.modelMaxLimits" | "compress.modelMinLimits",
                limits: unknown,
            ): void => {
                if (limits === undefined) {
                    return
                }

                if (typeof limits !== "object" || limits === null || Array.isArray(limits)) {
                    errors.push({
                        key,
                        expected: "Record<string, number | ${number}%>",
                        actual: typeof limits,
                    })
                    return
                }

                for (const [providerModelKey, limit] of Object.entries(limits)) {
                    const isValidNumber = typeof limit === "number"
                    const isPercentString =
                        typeof limit === "string" && /^\d+(?:\.\d+)?%$/.test(limit)
                    if (!isValidNumber && !isPercentString) {
                        errors.push({
                            key: `${key}.${providerModelKey}`,
                            expected: 'number | "${number}%"',
                            actual: JSON.stringify(limit),
                        })
                    }
                }
            }

            validateModelLimits("compress.modelMaxLimits", compress.modelMaxLimits)
            validateModelLimits("compress.modelMinLimits", compress.modelMinLimits)

            const validValues = ["ask", "allow", "deny"]
            if (compress.permission !== undefined && !validValues.includes(compress.permission)) {
                errors.push({
                    key: "compress.permission",
                    expected: '"ask" | "allow" | "deny"',
                    actual: JSON.stringify(compress.permission),
                })
            }

            if (
                compress.showCompression !== undefined &&
                typeof compress.showCompression !== "boolean"
            ) {
                errors.push({
                    key: "compress.showCompression",
                    expected: "boolean",
                    actual: typeof compress.showCompression,
                })
            }
        }
    }

    const strategies = config.strategies
    if (strategies) {
        if (
            strategies.deduplication?.enabled !== undefined &&
            typeof strategies.deduplication.enabled !== "boolean"
        ) {
            errors.push({
                key: "strategies.deduplication.enabled",
                expected: "boolean",
                actual: typeof strategies.deduplication.enabled,
            })
        }

        if (
            strategies.deduplication?.protectedTools !== undefined &&
            !Array.isArray(strategies.deduplication.protectedTools)
        ) {
            errors.push({
                key: "strategies.deduplication.protectedTools",
                expected: "string[]",
                actual: typeof strategies.deduplication.protectedTools,
            })
        }

        if (strategies.purgeErrors) {
            if (
                strategies.purgeErrors.enabled !== undefined &&
                typeof strategies.purgeErrors.enabled !== "boolean"
            ) {
                errors.push({
                    key: "strategies.purgeErrors.enabled",
                    expected: "boolean",
                    actual: typeof strategies.purgeErrors.enabled,
                })
            }

            if (
                strategies.purgeErrors.turns !== undefined &&
                typeof strategies.purgeErrors.turns !== "number"
            ) {
                errors.push({
                    key: "strategies.purgeErrors.turns",
                    expected: "number",
                    actual: typeof strategies.purgeErrors.turns,
                })
            }
            if (
                typeof strategies.purgeErrors.turns === "number" &&
                strategies.purgeErrors.turns < 1
            ) {
                errors.push({
                    key: "strategies.purgeErrors.turns",
                    expected: "positive number (>= 1)",
                    actual: `${strategies.purgeErrors.turns} (will be clamped to 1)`,
                })
            }
            if (
                strategies.purgeErrors.protectedTools !== undefined &&
                !Array.isArray(strategies.purgeErrors.protectedTools)
            ) {
                errors.push({
                    key: "strategies.purgeErrors.protectedTools",
                    expected: "string[]",
                    actual: typeof strategies.purgeErrors.protectedTools,
                })
            }
        }
    }

    return errors
}

function showConfigWarnings(
    ctx: PluginInput,
    configPath: string,
    configData: Record<string, any>,
    isProject: boolean,
): void {
    const invalidKeys = getInvalidConfigKeys(configData)
    const typeErrors = validateConfigTypes(configData)

    if (invalidKeys.length === 0 && typeErrors.length === 0) {
        return
    }

    const configType = isProject ? "project config" : "config"
    const messages: string[] = []

    if (invalidKeys.length > 0) {
        const keyList = invalidKeys.slice(0, 3).join(", ")
        const suffix = invalidKeys.length > 3 ? ` (+${invalidKeys.length - 3} more)` : ""
        messages.push(`Unknown keys: ${keyList}${suffix}`)
    }

    if (typeErrors.length > 0) {
        for (const err of typeErrors.slice(0, 2)) {
            messages.push(`${err.key}: expected ${err.expected}, got ${err.actual}`)
        }
        if (typeErrors.length > 2) {
            messages.push(`(+${typeErrors.length - 2} more type errors)`)
        }
    }

    setTimeout(() => {
        try {
            ctx.client.tui.showToast({
                body: {
                    title: `DCP: ${configType} warning`,
                    message: `${configPath}\n${messages.join("\n")}`,
                    variant: "warning",
                    duration: 7000,
                },
            })
        } catch {}
    }, 7000)
}

const defaultConfig: PluginConfig = {
    enabled: true,
    autoUpdate: true,
    debug: false,
    pruneNotification: "detailed",
    pruneNotificationType: "chat",
    commands: {
        enabled: true,
        protectedTools: [...DEFAULT_PROTECTED_TOOLS],
    },
    manualMode: {
        enabled: false,
        automaticStrategies: true,
    },
    turnProtection: {
        enabled: false,
        turns: 4,
    },
    experimental: {
        allowSubAgents: false,
        customPrompts: false,
    },
    protectedFilePatterns: [],
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
        protectedTools: [...COMPRESS_DEFAULT_PROTECTED_TOOLS],
        protectTags: false,
        protectUserMessages: false,
    },
    strategies: {
        deduplication: {
            enabled: true,
            protectedTools: [],
        },
        purgeErrors: {
            enabled: true,
            turns: 4,
            protectedTools: [],
        },
    },
}

const GLOBAL_CONFIG_DIR = process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "opencode")
    : join(homedir(), ".config", "opencode")
const GLOBAL_CONFIG_PATH_JSONC = join(GLOBAL_CONFIG_DIR, "dcp.jsonc")
const GLOBAL_CONFIG_PATH_JSON = join(GLOBAL_CONFIG_DIR, "dcp.json")

function findOpencodeDir(startDir: string): string | null {
    let current = startDir
    while (current !== "/") {
        const candidate = join(current, ".opencode")
        if (existsSync(candidate) && statSync(candidate).isDirectory()) {
            return candidate
        }
        const parent = dirname(current)
        if (parent === current) {
            break
        }
        current = parent
    }
    return null
}

function getConfigPaths(ctx?: PluginInput): {
    global: string | null
    configDir: string | null
    project: string | null
} {
    const global = existsSync(GLOBAL_CONFIG_PATH_JSONC)
        ? GLOBAL_CONFIG_PATH_JSONC
        : existsSync(GLOBAL_CONFIG_PATH_JSON)
          ? GLOBAL_CONFIG_PATH_JSON
          : null

    let configDir: string | null = null
    const opencodeConfigDir = process.env.OPENCODE_CONFIG_DIR
    if (opencodeConfigDir) {
        const configJsonc = join(opencodeConfigDir, "dcp.jsonc")
        const configJson = join(opencodeConfigDir, "dcp.json")
        configDir = existsSync(configJsonc)
            ? configJsonc
            : existsSync(configJson)
              ? configJson
              : null
    }

    let project: string | null = null
    if (ctx?.directory) {
        const opencodeDir = findOpencodeDir(ctx.directory)
        if (opencodeDir) {
            const projectJsonc = join(opencodeDir, "dcp.jsonc")
            const projectJson = join(opencodeDir, "dcp.json")
            project = existsSync(projectJsonc)
                ? projectJsonc
                : existsSync(projectJson)
                  ? projectJson
                  : null
        }
    }

    return { global, configDir, project }
}

function createDefaultConfig(): void {
    if (!existsSync(GLOBAL_CONFIG_DIR)) {
        mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true })
    }

    const configContent = `{
  "$schema": "https://raw.githubusercontent.com/Opencode-DCP/opencode-dynamic-context-pruning/master/dcp.schema.json"
}
`
    writeFileSync(GLOBAL_CONFIG_PATH_JSONC, configContent, "utf-8")
}

interface ConfigLoadResult {
    data: Record<string, any> | null
    parseError?: string
}

function loadConfigFile(configPath: string): ConfigLoadResult {
    let fileContent = ""
    try {
        fileContent = readFileSync(configPath, "utf-8")
    } catch {
        return { data: null }
    }

    try {
        const parsed = parse(fileContent, undefined, { allowTrailingComma: true })
        if (parsed === undefined || parsed === null) {
            return { data: null, parseError: "Config file is empty or invalid" }
        }
        return { data: parsed }
    } catch (error: any) {
        return { data: null, parseError: error.message || "Failed to parse config" }
    }
}

function mergeStrategies(
    base: PluginConfig["strategies"],
    override?: Partial<PluginConfig["strategies"]>,
): PluginConfig["strategies"] {
    if (!override) {
        return base
    }

    return {
        deduplication: {
            enabled: override.deduplication?.enabled ?? base.deduplication.enabled,
            protectedTools: [
                ...new Set([
                    ...base.deduplication.protectedTools,
                    ...(override.deduplication?.protectedTools ?? []),
                ]),
            ],
        },
        purgeErrors: {
            enabled: override.purgeErrors?.enabled ?? base.purgeErrors.enabled,
            turns: override.purgeErrors?.turns ?? base.purgeErrors.turns,
            protectedTools: [
                ...new Set([
                    ...base.purgeErrors.protectedTools,
                    ...(override.purgeErrors?.protectedTools ?? []),
                ]),
            ],
        },
    }
}

function mergeProviderOverrides(
    baseCompress: CompressConfig,
    providerOverrides: ProviderOverrides,
): ProviderOverrides {
    const merged: ProviderOverrides = {}

    if (providerOverrides.mode !== undefined) merged.mode = providerOverrides.mode
    if (providerOverrides.permission !== undefined) merged.permission = providerOverrides.permission
    if (providerOverrides.showCompression !== undefined) merged.showCompression = providerOverrides.showCompression
    if (providerOverrides.summaryBuffer !== undefined) merged.summaryBuffer = providerOverrides.summaryBuffer
    if (providerOverrides.maxContextLimit !== undefined) merged.maxContextLimit = providerOverrides.maxContextLimit
    if (providerOverrides.minContextLimit !== undefined) merged.minContextLimit = providerOverrides.minContextLimit
    if (providerOverrides.nudgeFrequency !== undefined) merged.nudgeFrequency = providerOverrides.nudgeFrequency
    if (providerOverrides.iterationNudgeThreshold !== undefined) merged.iterationNudgeThreshold = providerOverrides.iterationNudgeThreshold
    if (providerOverrides.nudgeForce !== undefined) merged.nudgeForce = providerOverrides.nudgeForce
    if (providerOverrides.protectedTools !== undefined) {
        merged.protectedTools = providerOverrides.protectedTools
    }
    if (providerOverrides.protectTags !== undefined) merged.protectTags = providerOverrides.protectTags
    if (providerOverrides.protectUserMessages !== undefined) merged.protectUserMessages = providerOverrides.protectUserMessages
    if (providerOverrides.models !== undefined) merged.models = providerOverrides.models

    return merged
}

function mergeCompress(
    base: PluginConfig["compress"],
    override?: Partial<PluginConfig["compress"]>,
): PluginConfig["compress"] {
    if (!override) {
        return base
    }

    const mergedProviders: Record<string, ProviderOverrides> = {}
    if (override.providers) {
        for (const [providerId, providerOverrides] of Object.entries(override.providers)) {
            if (providerOverrides && typeof providerOverrides === "object") {
                mergedProviders[providerId] = mergeProviderOverrides(base, providerOverrides)
            }
        }
    }

    const baseProviders = base.providers ? { ...base.providers } : undefined
    const finalProviders = baseProviders || mergedProviders
    if (Object.keys(mergedProviders).length > 0) {
        for (const [key, val] of Object.entries(mergedProviders)) {
            finalProviders[key] = val
        }
    }

    return {
        mode: override.mode ?? base.mode,
        permission: override.permission ?? base.permission,
        showCompression: override.showCompression ?? base.showCompression,
        summaryBuffer: override.summaryBuffer ?? base.summaryBuffer,
        maxContextLimit: override.maxContextLimit ?? base.maxContextLimit,
        minContextLimit: override.minContextLimit ?? base.minContextLimit,
        nudgeFrequency: override.nudgeFrequency ?? base.nudgeFrequency,
        iterationNudgeThreshold: override.iterationNudgeThreshold ?? base.iterationNudgeThreshold,
        nudgeForce: override.nudgeForce ?? base.nudgeForce,
        protectedTools: [...new Set([...base.protectedTools, ...(override.protectedTools ?? [])])],
        protectTags: override.protectTags ?? base.protectTags,
        protectUserMessages: override.protectUserMessages ?? base.protectUserMessages,
        providers: Object.keys(finalProviders).length > 0 ? finalProviders : undefined,
    }
}

function mergeCommands(
    base: PluginConfig["commands"],
    override?: Partial<PluginConfig["commands"]>,
): PluginConfig["commands"] {
    if (!override) {
        return base
    }

    return {
        enabled: override.enabled ?? base.enabled,
        protectedTools: [...new Set([...base.protectedTools, ...(override.protectedTools ?? [])])],
    }
}

function mergeManualMode(
    base: PluginConfig["manualMode"],
    override?: Partial<PluginConfig["manualMode"]>,
): PluginConfig["manualMode"] {
    if (override === undefined) return base

    return {
        enabled: override.enabled ?? base.enabled,
        automaticStrategies: override.automaticStrategies ?? base.automaticStrategies,
    }
}

function mergeExperimental(
    base: PluginConfig["experimental"],
    override?: Partial<PluginConfig["experimental"]>,
): PluginConfig["experimental"] {
    if (override === undefined) return base

    return {
        allowSubAgents: override.allowSubAgents ?? base.allowSubAgents,
        customPrompts: override.customPrompts ?? base.customPrompts,
    }
}

function deepCloneConfig(config: PluginConfig): PluginConfig {
    return {
        ...config,
        commands: {
            enabled: config.commands.enabled,
            protectedTools: [...config.commands.protectedTools],
        },
        manualMode: {
            enabled: config.manualMode.enabled,
            automaticStrategies: config.manualMode.automaticStrategies,
        },
        turnProtection: { ...config.turnProtection },
        experimental: { ...config.experimental },
        protectedFilePatterns: [...config.protectedFilePatterns],
        compress: {
            ...config.compress,
            protectedTools: [...config.compress.protectedTools],
            providers: config.compress.providers
                ? JSON.parse(JSON.stringify(config.compress.providers))
                : undefined,
        },
        strategies: {
            deduplication: {
                ...config.strategies.deduplication,
                protectedTools: [...config.strategies.deduplication.protectedTools],
            },
            purgeErrors: {
                ...config.strategies.purgeErrors,
                protectedTools: [...config.strategies.purgeErrors.protectedTools],
            },
        },
    }
}

function mergeLayer(config: PluginConfig, data: Record<string, any>): PluginConfig {
    return {
        enabled: data.enabled ?? config.enabled,
        autoUpdate: data.autoUpdate ?? config.autoUpdate,
        debug: data.debug ?? config.debug,
        pruneNotification: data.pruneNotification ?? config.pruneNotification,
        pruneNotificationType: data.pruneNotificationType ?? config.pruneNotificationType,
        commands: mergeCommands(config.commands, data.commands as any),
        manualMode: mergeManualMode(config.manualMode, data.manualMode as any),
        turnProtection: {
            enabled: data.turnProtection?.enabled ?? config.turnProtection.enabled,
            turns: data.turnProtection?.turns ?? config.turnProtection.turns,
        },
        experimental: mergeExperimental(config.experimental, data.experimental as any),
        protectedFilePatterns: [
            ...new Set([...config.protectedFilePatterns, ...(data.protectedFilePatterns ?? [])]),
        ],
        compress: mergeCompress(config.compress, data.compress as any),
        strategies: mergeStrategies(config.strategies, data.strategies as any),
    }
}

function scheduleParseWarning(ctx: PluginInput, title: string, message: string): void {
    setTimeout(() => {
        try {
            ctx.client.tui.showToast({
                body: {
                    title,
                    message,
                    variant: "warning",
                    duration: 7000,
                },
            })
        } catch {}
    }, 7000)
}

export function getConfig(ctx: PluginInput): PluginConfig {
    let config = deepCloneConfig(defaultConfig)
    const configPaths = getConfigPaths(ctx)

    if (!configPaths.global) {
        createDefaultConfig()
    }

    const layers: Array<{ path: string | null; name: string; isProject: boolean }> = [
        { path: configPaths.global, name: "config", isProject: false },
        { path: configPaths.configDir, name: "configDir config", isProject: true },
        { path: configPaths.project, name: "project config", isProject: true },
    ]

    for (const layer of layers) {
        if (!layer.path) {
            continue
        }

        const result = loadConfigFile(layer.path)
        if (result.parseError) {
            scheduleParseWarning(
                ctx,
                `DCP: Invalid ${layer.name}`,
                `${layer.path}\n${result.parseError}\nUsing previous/default values`,
            )
            continue
        }

        if (!result.data) {
            continue
        }

        showConfigWarnings(ctx, layer.path, result.data, layer.isProject)
        config = mergeLayer(config, result.data)
    }

    return config
}

export function getResolvedCompressValue<T>(
    config: PluginConfig,
    providerId: string | undefined,
    modelId: string | undefined,
    field: keyof CompressOverrides,
): T | undefined {
    const compress = config.compress

    const extract = (obj: CompressOverrides | undefined): T | undefined => {
        return obj && field in obj ? (obj as any)[field] : undefined
    }

    if (providerId && modelId && compress.providers) {
        const exactProvider = compress.providers[providerId]
        if (exactProvider) {
            const exactModel = exactProvider.models?.[modelId]
            if (exactModel && field in exactModel) {
                return extract(exactModel)
            }

            const modelWildcard = exactProvider.models?.["*"]
            if (modelWildcard && field in modelWildcard) {
                return extract(modelWildcard)
            }
        }

        const wildcardProvider = compress.providers["*"]
        if (wildcardProvider) {
            const wildcardModel = wildcardProvider.models?.[modelId]
            if (wildcardModel && field in wildcardModel) {
                return extract(wildcardModel)
            }

            const wildcardModelWildcard = wildcardProvider.models?.["*"]
            if (wildcardModelWildcard && field in wildcardModelWildcard) {
                return extract(wildcardModelWildcard)
            }
        }
    }

    if (providerId && compress.providers) {
        const exactProvider = compress.providers[providerId]
        if (exactProvider && field in exactProvider) {
            return extract(exactProvider)
        }

        const wildcardProviderVal = compress.providers["*"]
        if (wildcardProviderVal && field in wildcardProviderVal) {
            const val = extract(wildcardProviderVal)
            return val as T
        }
    }

    return undefined
}
