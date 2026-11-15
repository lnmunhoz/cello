// `cello install claude` / `cello uninstall claude` (CEL-15): Cello's hooks in a Claude Code settings
// file, merged with whatever is there. Settings shape from https://code.claude.com/docs/en/hooks:
//
//   { "hooks": { "<Event>": [ { "matcher"?: "…", "hooks": [ { "type": "command", "command": "…", "timeout"?: s } ] } ] } }
//
// Cello adds its own matcher group per event and recognises its handlers by their command
// (`cello hook claude …`), so installing twice changes nothing and uninstalling takes out only Cello's.
import * as fs from "node:fs"
import * as path from "node:path"

/** Seconds Claude Code waits for a hook before cancelling it; the hook itself gives up much sooner. */
export const HOOK_TIMEOUT = 10

export const CELLO_HOOKS = [
  { event: "Stop", matcher: undefined, command: "cello hook claude stop" },
  { event: "PostToolUse", matcher: "*", command: "cello hook claude post-tool-use" },
] as const

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => value !== null && typeof value === "object" && !Array.isArray(value)

const isCelloHandler = (handler: unknown) =>
  isObject(handler) && typeof handler.command === "string" && /^\s*cello\s+hook\s+claude(\s|$)/.test(handler.command)

/** The `hooks` object and each event's list, checked: anything Cello can't merge into is an error (a sentence), never overwritten. */
const hooksOf = (settings: unknown): Json => {
  if (!isObject(settings)) throw new Error("it isn't a JSON object")
  if (settings.hooks === undefined) return {}
  if (!isObject(settings.hooks)) throw new Error("\"hooks\" isn't an object")
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) throw new Error(`"hooks.${event}" isn't a list`)
  }
  return settings.hooks
}

const groupHandlers = (group: unknown): ReadonlyArray<unknown> => (isObject(group) && Array.isArray(group.hooks) ? group.hooks : [])

export interface Merged {
  readonly settings: Json
  readonly changed: boolean
}

/** Settings with Cello's hooks added where they're missing. Doesn't change its input. */
export const addCelloHooks = (settings: unknown): Merged => {
  const hooks = { ...hooksOf(settings) }
  let changed = false
  for (const { event, matcher, command } of CELLO_HOOKS) {
    const groups = (hooks[event] ?? []) as ReadonlyArray<unknown>
    const present = groups.some((group) => groupHandlers(group).some((h) => isCelloHandler(h) && (h as Json).command === command))
    if (present) continue
    hooks[event] = [...groups, { ...(matcher === undefined ? {} : { matcher }), hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT }] }]
    changed = true
  }
  return changed ? { settings: { ...(settings as Json), hooks }, changed } : { settings: settings as Json, changed }
}

/** Settings without Cello's handlers, and without the groups and events that leaves empty. */
export const removeCelloHooks = (settings: unknown): Merged => {
  const hooks = hooksOf(settings)
  let changed = false
  const next: Json = {}
  for (const [event, groups] of Object.entries(hooks)) {
    const kept = (groups as ReadonlyArray<unknown>).flatMap((group) => {
      const handlers = groupHandlers(group)
      const others = handlers.filter((h) => !isCelloHandler(h))
      if (others.length === handlers.length) return [group]
      changed = true
      return others.length === 0 ? [] : [{ ...(group as Json), hooks: others }]
    })
    if (kept.length > 0) next[event] = kept
  }
  if (!changed) return { settings: settings as Json, changed }
  const { hooks: _old, ...rest } = settings as Json
  return { settings: Object.keys(next).length === 0 ? rest : { ...rest, hooks: next }, changed }
}

/** `~/.claude/settings.json` with --user, else the project's `.claude/settings.json` (its git top level, or the folder). */
export const settingsPath = (options: { readonly user: boolean; readonly home: string | undefined; readonly cwd: string }): string => {
  if (options.user) {
    if (!options.home) throw new Error("HOME isn't set, so there's no ~/.claude/settings.json to write")
    return path.join(options.home, ".claude", "settings.json")
  }
  const top = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { cwd: options.cwd, stdout: "pipe", stderr: "ignore" })
  const root = top.exitCode === 0 ? top.stdout.toString().trim() : options.cwd
  return path.join(root, ".claude", "settings.json")
}

/** A settings file's JSON; a missing file is empty settings. */
export const readSettings = (file: string): unknown => {
  if (!fs.existsSync(file)) return {}
  const raw = fs.readFileSync(file, "utf8")
  if (raw.trim() === "") return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error("it isn't valid JSON")
  }
}

export const writeSettings = (file: string, settings: Json): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`)
}
