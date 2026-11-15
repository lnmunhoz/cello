// `cello install claude` / `cello uninstall claude` (CEL-15): Cello's hooks in a Claude Code settings
// file, merged with whatever is there. Settings shape from https://code.claude.com/docs/en/hooks:
//
//   { "hooks": { "<Event>": [ { "matcher"?: "…", "hooks": [ { "type": "command", "command": "…", "timeout"?: s } ] } ] } }
//
// Cello adds its own matcher group per event and recognises its handlers by their command
// (`cello hook claude …`), so installing twice changes nothing and uninstalling takes out only Cello's.
// The file keeps its key order and indentation, and is replaced atomically: a temp file in the same
// folder, fsynced, then renamed over it, with the old bytes kept in `<file>.bak`. A settings file that
// is a symlink (dotfiles, chezmoi) stays one; the file it points at is the one replaced.
import * as fs from "node:fs"
import * as path from "node:path"

/** Seconds Claude Code waits for a hook before cancelling it; the hook itself gives up much sooner. */
export const HOOK_TIMEOUT = 10

/**
 * Cello's hooks: the comment hooks (CEL-15) and the artifact guard (CEL-57). The guard is
 * `projectOnly`: it's for Cello projects, so user settings (every project, Cello or not) don't get it.
 * Its matcher has only letters, so Claude Code matches it against the tool name exactly.
 */
export const CELLO_HOOKS = [
  { event: "Stop", matcher: undefined, command: "cello hook claude stop", projectOnly: false },
  { event: "PostToolUse", matcher: "*", command: "cello hook claude post-tool-use", projectOnly: false },
  { event: "PreToolUse", matcher: "Artifact", command: "cello hook claude pre-tool-use", projectOnly: true },
] as const

export type CelloHook = (typeof CELLO_HOOKS)[number]

/** The hooks a settings file gets: a project's (local or shared) all of them, the user's all but the project-only ones. */
export const celloHooksFor = (scope: "project" | "user"): ReadonlyArray<CelloHook> =>
  CELLO_HOOKS.filter((hook) => scope === "project" || !hook.projectOnly)

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

/** `settings` with `hooks` replaced where it is (or added at the end), or removed with `undefined`; other keys keep their order. */
const withHooks = (settings: Json, hooks: Json | undefined): Json => {
  if (!("hooks" in settings)) return hooks === undefined ? settings : { ...settings, hooks }
  return Object.fromEntries(
    Object.entries(settings).flatMap(([key, value]) => (key !== "hooks" ? [[key, value]] : hooks === undefined ? [] : [[key, hooks]])),
  )
}

export interface Merged {
  readonly settings: Json
  readonly changed: boolean
}

/** Settings with Cello's hooks (`wanted`, all of them by default) added where they're missing. Doesn't change its input. */
export const addCelloHooks = (settings: unknown, wanted: ReadonlyArray<CelloHook> = CELLO_HOOKS): Merged => {
  const hooks = { ...hooksOf(settings) }
  let changed = false
  for (const { event, matcher, command } of wanted) {
    const groups = (hooks[event] ?? []) as ReadonlyArray<unknown>
    const present = groups.some((group) => groupHandlers(group).some((h) => isCelloHandler(h) && (h as Json).command === command))
    if (present) continue
    hooks[event] = [...groups, { ...(matcher === undefined ? {} : { matcher }), hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT }] }]
    changed = true
  }
  return changed ? { settings: withHooks(settings as Json, hooks), changed } : { settings: settings as Json, changed }
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
  return { settings: withHooks(settings as Json, Object.keys(next).length === 0 ? undefined : next), changed }
}

/** How a settings file is laid out, so writing it back changes as little as possible. */
export interface Format {
  readonly indent: string
  readonly newline: string
}

/** The indentation of the first indented line (two spaces when there is none) and whether it ends with a newline. */
export const detectFormat = (raw: string): Format => ({
  indent: /^([ \t]+)\S/m.exec(raw)?.[1] ?? "  ",
  newline: raw === "" || raw.endsWith("\n") ? "\n" : "",
})

export const formatSettings = (settings: Json, format: Format): string => `${JSON.stringify(settings, null, format.indent)}${format.newline}`

export interface SettingsFile {
  /** The parsed JSON; a missing or empty file is `{}`. */
  readonly settings: unknown
  readonly format: Format
}

export const readSettingsFile = (file: string): SettingsFile => {
  const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
  if (raw.trim() === "") return { settings: {}, format: detectFormat("") }
  try {
    return { settings: JSON.parse(raw), format: detectFormat(raw) }
  } catch {
    throw new Error("it isn't valid JSON")
  }
}

/** Where `cello install claude` writes: the project's file for this machine, the committed one, and the user's (null without HOME). */
export const settingsPaths = (options: { readonly projectRoot: string; readonly home: string | undefined }) => ({
  local: path.join(options.projectRoot, ".claude", "settings.local.json"),
  shared: path.join(options.projectRoot, ".claude", "settings.json"),
  user: options.home ? path.join(options.home, ".claude", "settings.json") : null,
})

/**
 * Replaces `file` with `text` so a crash or a full disk never leaves it half written: the new bytes go
 * to `<file>.cello-<pid>.tmp` beside it, are fsynced, and the temp file is renamed over the original,
 * keeping its mode. The old bytes are kept in `<file>.bak`. Returns the file written (a symlink's
 * target) and the backup, if there was an old file. `io` is for tests that fail the write.
 */
export const writeFileAtomically = (
  file: string,
  text: string,
  io: { readonly writeSync: (fd: number, data: string) => unknown } = fs,
): { readonly target: string; readonly backup: string | null } => {
  const target = fs.existsSync(file) ? fs.realpathSync(file) : file
  const folder = path.dirname(target)
  fs.mkdirSync(folder, { recursive: true })
  const old = fs.existsSync(target) ? { bytes: fs.readFileSync(target), mode: fs.statSync(target).mode & 0o7777 } : null
  const temp = path.join(folder, `${path.basename(target)}.cello-${process.pid}.tmp`)
  try {
    const fd = fs.openSync(temp, "w", old?.mode ?? 0o644)
    try {
      io.writeSync(fd, text)
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    if (old) fs.chmodSync(temp, old.mode)
    if (old) fs.writeFileSync(`${target}.bak`, old.bytes, { mode: old.mode })
    fs.renameSync(temp, target)
  } catch (error) {
    fs.rmSync(temp, { force: true })
    throw error
  }
  // The rename itself is durable once the folder is synced; not every system allows that.
  try {
    const dir = fs.openSync(folder, "r")
    fs.fsyncSync(dir)
    fs.closeSync(dir)
  } catch {
    // Best effort.
  }
  return { target, backup: old ? `${target}.bak` : null }
}

/**
 * Makes git ignore `relative` (a path inside `repoRoot`): when git doesn't already ignore it (its own
 * .gitignore files, the user's global excludes), appends it to `<repoRoot>/.gitignore`. Returns that
 * .gitignore when it added the line, else null. `env` is what git runs with (HOME decides the global excludes).
 */
export const ensureGitIgnored = (repoRoot: string, relative: string, env: Readonly<Record<string, string | undefined>>): string | null => {
  const check = Bun.spawnSync(["git", "check-ignore", "-q", relative], { cwd: repoRoot, env, stdout: "ignore", stderr: "ignore" })
  // 0: ignored; 1: not ignored; anything else: not a repository, nothing to do.
  if (check.exitCode !== 1) return null
  const gitignore = path.join(repoRoot, ".gitignore")
  const current = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, "utf8") : ""
  fs.writeFileSync(gitignore, `${current}${current === "" || current.endsWith("\n") ? "" : "\n"}${relative}\n`)
  return gitignore
}
