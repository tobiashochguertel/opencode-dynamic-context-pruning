/**
 * Host permission snapshot for V2.
 *
 * V1 exposed the effective opencode config to plugins via the `config` hook;
 * DCP used it to learn the host's `permission` map (global + per-agent) so it
 * could detect an explicit `compress: deny`. V2 has no config hook, so we read
 * the same config files directly and normalize both shapes:
 *
 *   V1: permission: { compress: "deny", bash: { "*": "allow" } }
 *   V2: permissions: [ { action: "compress", resource: "*", effect: "deny" } ]
 *
 * Both normalize to the V1 `PermissionConfig` map the engine expects.
 */

import { existsSync, readFileSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import { parse } from "jsonc-parser"
import type { HostPermissionSnapshot, PermissionConfig } from "../host-permissions"
import type { PluginHost } from "./host"

const GLOBAL_CONFIG_DIR = process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "opencode")
    : join(homedir(), ".config", "opencode")

function findOpencodeDir(startDir: string): string | null {
    let current = startDir
    while (current !== "/") {
        const candidate = join(current, ".opencode")
        if (existsSync(candidate)) {
            return candidate
        }
        const parent = dirname(current)
        if (parent === current) break
        current = parent
    }
    return null
}

function readJsonc(path: string): Record<string, any> | null {
    try {
        const data = parse(readFileSync(path, "utf-8"))
        return data && typeof data === "object" ? data : null
    } catch {
        return null
    }
}

/** V1 permission map → unchanged. V2 rules array → V1-style map. */
function normalizePermission(raw: unknown): PermissionConfig {
    if (!raw || typeof raw !== "object") return undefined
    if (Array.isArray(raw)) {
        const map: Record<string, any> = {}
        for (const rule of raw) {
            if (!rule || typeof rule !== "object") continue
            const { action, resource, effect } = rule as Record<string, any>
            if (typeof action !== "string" || typeof effect !== "string") continue
            if (resource === "*" || resource === undefined) {
                map[action] = effect
            } else {
                const existing = map[action]
                map[action] = {
                    ...(existing && typeof existing === "object" ? existing : {}),
                    [resource]: effect,
                }
            }
        }
        return map
    }
    return raw as PermissionConfig
}

/**
 * Read the host's permission configuration from the same config files
 * opencode loads (global config dir + project `.opencode/`). Returns the
 * `HostPermissionSnapshot` the engine already understands.
 */
export function readHostPermissions(host: PluginHost): HostPermissionSnapshot {
    const snapshot: HostPermissionSnapshot = { global: undefined, agents: {} }

    const files: string[] = []
    for (const name of ["opencode.jsonc", "opencode.json"]) {
        const p = join(GLOBAL_CONFIG_DIR, name)
        if (existsSync(p)) files.push(p)
    }
    const configDir = process.env.OPENCODE_CONFIG_DIR
    if (configDir) {
        for (const name of ["opencode.jsonc", "opencode.json"]) {
            const p = join(configDir, name)
            if (existsSync(p)) files.push(p)
        }
    }
    const projectDir = findOpencodeDir(host.directory)
    if (projectDir) {
        for (const name of ["opencode.jsonc", "opencode.json"]) {
            const p = join(projectDir, name)
            if (existsSync(p)) files.push(p)
        }
    }

    for (const file of files) {
        const config = readJsonc(file)
        if (!config) continue

        const permission = normalizePermission(config.permissions ?? config.permission)
        if (permission) snapshot.global = { ...(snapshot.global ?? {}), ...permission }

        const agents = (config.agents ?? config.agent ?? {}) as Record<string, any>
        for (const [name, agent] of Object.entries(agents)) {
            if (!agent || typeof agent !== "object") continue
            const agentPermission = normalizePermission(agent.permissions ?? agent.permission)
            if (agentPermission) {
                snapshot.agents[name] = { ...(snapshot.agents[name] ?? {}), ...agentPermission }
            }
        }
    }

    return snapshot
}
