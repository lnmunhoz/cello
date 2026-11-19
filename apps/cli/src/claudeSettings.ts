// `cello install claude` / `cello uninstall claude` (CEL-15): Cello's hooks in a Claude Code settings
// file, merged with whatever is there. Settings shape from https://code.claude.com/docs/en/hooks:
//
//   { "hooks": { "<Event>": [ { "matcher"?: "…", "hooks": [ { "type": "command", "command": "…", "timeout"?: s } ] } ] } }
//
// Cello adds its own matcher group per event and recognises its handlers by their command
// (`cello hook claude …`), so installing twice changes nothing and uninstalling takes out only Cello's.
// The same goes for its Claude Code plugin's two entries (CEL-64) and its `Bash(cello:*)` rule (CEL-90), below.
// The file keeps its key order and indentation unit, and nothing in it is lost, but it's written back with
// JSON.stringify: a list or object someone wrote on one line comes back one item per line, and a file
// that ends without a newline keeps doing so. It's replaced atomically: a temp file in the same
// folder, fsynced, then renamed over it, with the old bytes kept in `<file>.bak`. A settings file that
// is a symlink (dotfiles, chezmoi) stays one; the file it points at is the one replaced.
import * as fs from "node:fs"
import * as path from "node:path"
import { isRecord } from "@cello/domain/record"

/** Seconds Claude Code waits for a hook before cancelling it; the hook itself gives up much sooner. */
export const HOOK_TIMEOUT = 10

/**
 * Cello's hooks: the comment hooks (CEL-15) and the PreToolUse guards, one command that routes by tool:
 * the artifact guard (CEL-57), the AskUserQuestion guard (CEL-124) and the claim guard on the edit
 * tools (CEL-61). The guards are
 * `projectOnly`: they're for Cello projects, so user settings (every project, Cello or not) don't get
 * them. The matcher has only letters and `|`, so Claude Code reads it as a list of exact tool names.
 * The subagent hooks (CEL-55) tell the board when a subagent starts and finishes; SubagentStart also
 * hands it the --agent its `cello` commands need, which is Cello-project talk, so it's project-only.
 * Test runs (CEL-134) follow Bash too: PreToolUse says a test command starts (it does nothing else for
 * Bash, and asks the server only for a test command), PostToolUseFailure that one failed; project-only.
 */
export const CELLO_HOOKS = [
  { event: "Stop", matcher: undefined, command: "cello hook claude stop", projectOnly: false },
  { event: "PostToolUse", matcher: "*", command: "cello hook claude post-tool-use", projectOnly: false },
  { event: "PreToolUse", matcher: "Artifact|AskUserQuestion|Edit|Write|NotebookEdit|Bash", command: "cello hook claude pre-tool-use", projectOnly: true },
  { event: "PostToolUseFailure", matcher: "Bash", command: "cello hook claude post-tool-use-failure", projectOnly: true },
  { event: "SubagentStart", matcher: undefined, command: "cello hook claude subagent-start", projectOnly: true },
  { event: "SubagentStop", matcher: undefined, command: "cello hook claude subagent-stop", projectOnly: false },
] as const

export type CelloHook = (typeof CELLO_HOOKS)[number]

/** The hooks a settings file gets: a project's (local or shared) all of them, the user's all but the project-only ones. */
export const celloHooksFor = (scope: "project" | "user"): ReadonlyArray<CelloHook> =>
  CELLO_HOOKS.filter((hook) => scope === "project" || !hook.projectOnly)

type Json = Record<string, unknown>


const isCelloHandler = (handler: unknown) =>
  isRecord(handler) && typeof handler.command === "string" && /^\s*cello\s+hook\s+claude(\s|$)/.test(handler.command)

/** The `hooks` object and each event's list, checked: anything Cello can't merge into is an error (a sentence), never overwritten. */
const hooksOf = (settings: unknown): Json => {
  if (!isRecord(settings)) throw new Error("it isn't a JSON object")
  if (settings.hooks === undefined) return {}
  if (!isRecord(settings.hooks)) throw new Error("\"hooks\" isn't an object")
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) throw new Error(`"hooks.${event}" isn't a list`)
  }
  return settings.hooks
}

const groupHandlers = (group: unknown): ReadonlyArray<unknown> => (isRecord(group) && Array.isArray(group.hooks) ? group.hooks : [])

/** `settings` with `key` replaced where it is (or added at the end), or removed with `undefined`; other keys keep their order. */
const withKey = (settings: Json, key: string, value: unknown): Json => {
  if (!(key in settings)) return value === undefined ? settings : { ...settings, [key]: value }
  return Object.fromEntries(
    Object.entries(settings).flatMap(([k, v]) => (k !== key ? [[k, v]] : value === undefined ? [] : [[k, value]])),
  )
}

const withHooks = (settings: Json, hooks: Json | undefined): Json => withKey(settings, "hooks", hooks)

export interface Merged {
  readonly settings: Json
  readonly changed: boolean
}

const isHandlerFor = (command: string) => (handler: unknown) => isCelloHandler(handler) && (handler as Json).command === command

/**
 * Settings with Cello's hooks (`wanted`, all of them by default) added where they're missing. A Cello
 * handler under another matcher (an older install's, like the artifact guard's "Artifact" before the
 * claim guard widened it, or "Artifact|Edit|Write|NotebookEdit" before AskUserQuestion joined it) is
 * taken out and the hook added again with today's. Doesn't change its input.
 */
export const addCelloHooks = (settings: unknown, wanted: ReadonlyArray<CelloHook> = CELLO_HOOKS): Merged => {
  const hooks = { ...hooksOf(settings) }
  let changed = false
  for (const { event, matcher, command } of wanted) {
    const groups = (hooks[event] ?? []) as ReadonlyArray<unknown>
    const ours = isHandlerFor(command)
    const present = groups.some((group) => (group as Json).matcher === matcher && groupHandlers(group).some(ours))
    if (present) continue
    const others = groups.flatMap((group) => {
      const handlers = groupHandlers(group)
      const kept = handlers.filter((h) => !ours(h))
      return kept.length === handlers.length ? [group] : kept.length === 0 ? [] : [{ ...(group as Json), hooks: kept }]
    })
    hooks[event] = [...others, { ...(matcher === undefined ? {} : { matcher }), hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT }] }]
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

// ── the Claude Code plugin (CEL-64) ─────────────────────────────────────────────────────────────
//
// Cello's plugin is enabled through settings, like its hooks (https://code.claude.com/docs/en/settings-reference):
//
//   { "extraKnownMarketplaces": { "cello": { "source": { "source": "directory", "path": "<folder>" } } },
//     "enabledPlugins": { "cello@cello": true } }
//
// Claude Code loads a plugin from a local-folder marketplace in place at session start, and records the
// marketplace in its own state in the background, with no prompt. `claude plugin marketplace add` and
// `claude plugin install` write the same two keys, but they reformat the whole file (indentation, key
// order), so Cello merges them itself with the same keep-everything-else machinery as the hooks.

/** The marketplace's name and the plugin's id in `enabledPlugins`. */
export const CELLO_MARKETPLACE = "cello"
export const CELLO_PLUGIN_ID = "cello@cello"

/** `extraKnownMarketplaces.cello` when it is Cello's own: a local-folder source at exactly `folder` (pluginFolder). Extra keys don't matter. */
const isCelloMarketplace = (entry: unknown, folder: string) => {
  if (!isRecord(entry) || !isRecord(entry.source)) return false
  const { source, path: at } = entry.source
  return source === "directory" && typeof at === "string" && path.resolve(at) === path.resolve(folder)
}

/** `settings[key]`, checked: missing is `{}`, anything but an object is an error (a sentence), never overwritten. */
const objectAt = (settings: unknown, key: string): Json => {
  if (!isRecord(settings)) throw new Error("it isn't a JSON object")
  const value = settings[key]
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error(`"${key}" isn't an object`)
  return value
}

export interface PluginWanted {
  /** Cello's plugin folder (pluginFolder): the only `cello` marketplace Cello declares or accepts. */
  readonly folder: string
  /** Whether to declare the folder as the `cello` marketplace here; --shared's committed file doesn't. */
  readonly declare: boolean
  /** Whether to enable cello@cello here. */
  readonly enable: boolean
}

/** A plugin change; `off` says cello@cello is explicitly false here, which Cello leaves alone. */
export interface PluginMerged extends Merged {
  readonly off: boolean
}

/**
 * Settings with Cello's marketplace declared and cello@cello enabled, as asked. A `cello` marketplace
 * that isn't exactly Cello's folder is refused, never replaced, also when only enabling (it would
 * enable someone else's plugin). An explicit `"cello@cello": false` stays. Doesn't change its input.
 */
export const addCelloPlugin = (settings: unknown, wanted: PluginWanted): PluginMerged => {
  const marketplaces = objectAt(settings, "extraKnownMarketplaces")
  const plugins = objectAt(settings, "enabledPlugins")
  const current = marketplaces[CELLO_MARKETPLACE]
  if (current !== undefined && !isCelloMarketplace(current, wanted.folder)) {
    throw new Error(`"extraKnownMarketplaces.${CELLO_MARKETPLACE}" is another marketplace, not Cello's folder`)
  }
  let next = settings as Json
  if (wanted.declare && current === undefined) {
    next = withKey(next, "extraKnownMarketplaces", { ...marketplaces, [CELLO_MARKETPLACE]: { source: { source: "directory", path: wanted.folder } } })
  }
  const off = wanted.enable && plugins[CELLO_PLUGIN_ID] === false
  if (wanted.enable && plugins[CELLO_PLUGIN_ID] === undefined) next = withKey(next, "enabledPlugins", { ...plugins, [CELLO_PLUGIN_ID]: true })
  return { settings: next, changed: next !== settings, off }
}

/**
 * Settings without Cello's own marketplace (exactly `folder`) and without cello@cello, unless the file
 * declares a `cello` marketplace that isn't Cello's (then cello@cello is that one's); keys left empty go too.
 */
export const removeCelloPlugin = (settings: unknown, folder: string | null): Merged => {
  const marketplaces = objectAt(settings, "extraKnownMarketplaces")
  const plugins = objectAt(settings, "enabledPlugins")
  const current = marketplaces[CELLO_MARKETPLACE]
  const ours = folder !== null && isCelloMarketplace(current, folder)
  let next = settings as Json
  const without = (object: Json, key: string) => {
    const { [key]: _, ...rest } = object
    return Object.keys(rest).length === 0 ? undefined : rest
  }
  if (ours) next = withKey(next, "extraKnownMarketplaces", without(marketplaces, CELLO_MARKETPLACE))
  if ((ours || current === undefined) && CELLO_PLUGIN_ID in plugins) next = withKey(next, "enabledPlugins", without(plugins, CELLO_PLUGIN_ID))
  return { settings: next, changed: next !== settings }
}

// ── allowing `cello` commands (CEL-90) ──────────────────────────────────────────────────────────
//
// Agents reach the board only through `cello`, so a Claude Code permission check that fails (auto
// mode's classifier erroring for minutes, Nov 16) cut them off it. A rule in `permissions.allow`
// (https://code.claude.com/docs/en/permissions) lets `cello …` commands run without that check:
//
//   { "permissions": { "allow": [ "Bash(cello:*)" ] } }
//
// Cello adds its rule after the user's own and recognises it by its exact text, so uninstalling takes
// out only that entry; `deny` and `ask` are never touched (a deny rule still wins over it).

/** The rule Cello adds to `permissions.allow`: every Bash command that starts with `cello`. */
export const CELLO_PERMISSION = "Bash(cello:*)"

/** The same rule in Claude Code's newer spelling; when it's there, Cello's would add nothing. */
const SAME_RULES: ReadonlyArray<string> = [CELLO_PERMISSION, "Bash(cello *)"]

/** `permissions` and its `allow` list, checked: anything Cello can't merge into is an error (a sentence), never overwritten. */
const allowOf = (settings: unknown): { readonly permissions: Json; readonly allow: ReadonlyArray<unknown> } => {
  const permissions = objectAt(settings, "permissions")
  if (permissions.allow === undefined) return { permissions, allow: [] }
  if (!Array.isArray(permissions.allow)) throw new Error("\"permissions.allow\" isn't a list")
  return { permissions, allow: permissions.allow }
}

/** Settings with Bash(cello:*) at the end of `permissions.allow`, unless that rule is already allowed. Doesn't change its input. */
export const addCelloPermission = (settings: unknown): Merged => {
  const { permissions, allow } = allowOf(settings)
  if (allow.some((rule) => typeof rule === "string" && SAME_RULES.includes(rule))) return { settings: settings as Json, changed: false }
  return { settings: withKey(settings as Json, "permissions", withKey(permissions, "allow", [...allow, CELLO_PERMISSION])), changed: true }
}

/**
 * Settings without Bash(cello:*), and without the `allow` list and `permissions` object that leaves empty.
 * A `permissions` or `allow` Cello couldn't have written its rule into has nothing of Cello's in it, so
 * it's left alone rather than refused: that mustn't stop uninstall taking out the hooks and the plugin.
 */
export const removeCelloPermission = (settings: unknown): Merged => {
  const unchanged = { settings: settings as Json, changed: false }
  if (!isRecord(settings) || !isRecord(settings.permissions) || !Array.isArray(settings.permissions.allow)) return unchanged
  const { permissions, allow } = allowOf(settings)
  const kept = allow.filter((rule) => rule !== CELLO_PERMISSION)
  if (kept.length === allow.length) return unchanged
  const next = withKey(permissions, "allow", kept.length === 0 ? undefined : kept)
  return { settings: withKey(settings as Json, "permissions", Object.keys(next).length === 0 ? undefined : next), changed: true }
}

/** A settings change that says what it changed: Cello's hooks, its plugin, its permission; `off` as in PluginMerged. */
export interface CelloMerged extends Merged {
  readonly hooks: boolean
  readonly plugin: boolean
  readonly permission: boolean
  readonly off: boolean
}

/** What `cello install claude` puts in one settings file: the hooks it wants, the plugin entries and (`permission`) Bash(cello:*). */
export const installCello = (
  settings: unknown,
  wanted: { readonly hooks: ReadonlyArray<CelloHook>; readonly plugin: PluginWanted; readonly permission: boolean },
): CelloMerged => {
  const hooks = wanted.hooks.length === 0 ? { settings: settings as Json, changed: false } : addCelloHooks(settings, wanted.hooks)
  const plugin = addCelloPlugin(hooks.settings, wanted.plugin)
  const permission = wanted.permission ? addCelloPermission(plugin.settings) : { settings: plugin.settings, changed: false }
  return {
    settings: permission.settings,
    changed: hooks.changed || plugin.changed || permission.changed,
    hooks: hooks.changed,
    plugin: plugin.changed,
    permission: permission.changed,
    off: plugin.off,
  }
}

/** What `cello uninstall claude` takes out of one settings file: Cello's hooks, its plugin entries (`folder`: pluginFolder) and its permission. */
export const uninstallCello = (settings: unknown, folder: string | null): CelloMerged => {
  const hooks = removeCelloHooks(settings)
  const plugin = removeCelloPlugin(hooks.settings, folder)
  const permission = removeCelloPermission(plugin.settings)
  return {
    settings: permission.settings,
    changed: hooks.changed || plugin.changed || permission.changed,
    hooks: hooks.changed,
    plugin: plugin.changed,
    permission: permission.changed,
    off: false,
  }
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
 * keeping its mode. The old bytes are kept in `<file>.bak` (unless `backup: false`); with
 * `backup: "new"` an existing .bak is left alone and the copy goes to the first free `.bak.1`, `.bak.2`…
 * Returns the file written (a symlink's target) and the backup, if one was kept. `io` is for tests
 * that fail the write.
 */
export const writeFileAtomically = (
  file: string,
  text: string,
  options: { readonly io?: { readonly writeSync: (fd: number, data: string) => unknown }; readonly backup?: boolean | "new" } = {},
): { readonly target: string; readonly backup: string | null } => {
  const { io = fs, backup = true } = options
  const target = fs.existsSync(file) ? fs.realpathSync(file) : file
  const folder = path.dirname(target)
  fs.mkdirSync(folder, { recursive: true })
  const old = fs.existsSync(target) ? { bytes: fs.readFileSync(target), mode: fs.statSync(target).mode & 0o7777 } : null
  const temp = path.join(folder, `${path.basename(target)}.cello-${process.pid}.tmp`)
  const backupFile = old === null || backup === false ? null : backup === "new" ? freeBackup(target) : `${target}.bak`
  try {
    const fd = fs.openSync(temp, "w", old?.mode ?? 0o644)
    try {
      io.writeSync(fd, text)
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    if (old) fs.chmodSync(temp, old.mode)
    if (old && backupFile) fs.writeFileSync(backupFile, old.bytes, { mode: old.mode })
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
  return { target, backup: backupFile }
}

/** `<target>.bak`, or the first of `.bak.1`, `.bak.2`… that doesn't exist yet. */
const freeBackup = (target: string): string => {
  const taken = (file: string) => fs.lstatSync(file, { throwIfNoEntry: false }) !== undefined
  if (!taken(`${target}.bak`)) return `${target}.bak`
  let n = 1
  while (taken(`${target}.bak.${n}`)) n++
  return `${target}.bak.${n}`
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
