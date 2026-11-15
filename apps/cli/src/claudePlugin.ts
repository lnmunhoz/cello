// The Claude Code plugin `cello install claude` installs (CEL-64): /cello:orchestrate, /cello:work, the
// cello skill and the builder and reviewer agents. Its source is apps/cli/claude-plugin/, a local
// marketplace holding one plugin. `bun run docs:cli` copies those files into claudePluginFiles.ts, so
// the compiled binary carries them and running from source reads the same list; a test fails when the
// two differ.
//
// Install writes them to a folder of Cello's own outside the repo and outside the data folder
// ($XDG_DATA_HOME/cello/claude-plugin, else ~/.local/share/cello/claude-plugin), rewritten on every
// install so a new Cello updates the plugin. Claude Code reads the plugin in place from there. Cello
// records the files it wrote in `.cello-files.json` and only ever removes files on that list.
import * as fs from "node:fs"
import * as path from "node:path"
import { CLAUDE_PLUGIN_FILES } from "./claudePluginFiles.ts"
import type { PluginFile } from "./claudePluginSource.ts"
import type { Env } from "./identity.ts"

export { CLAUDE_PLUGIN_FILES }

/** The list of files Cello wrote into the plugin folder, kept in that folder. */
export const OWN_FILES = ".cello-files.json"

/** Where install writes the plugin: $XDG_DATA_HOME/cello/claude-plugin (when absolute), else ~/.local/share/…; null without either. */
export const pluginFolder = (env: Env): string | null => {
  const data = env.XDG_DATA_HOME && path.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : env.HOME ? path.join(env.HOME, ".local", "share") : null
  return data === null ? null : path.join(data, "cello", "claude-plugin")
}

/** `relative` inside `folder`, or null when it would leave it (`..`, an absolute path). */
const inside = (folder: string, relative: string): string | null => {
  if (path.isAbsolute(relative)) return null
  const full = path.resolve(folder, relative)
  return full.startsWith(folder + path.sep) ? full : null
}

/**
 * The first folder between `root` (not included: it may be a symlink, dotfiles-style) and `full` that
 * is a symlink, or null. Writing or deleting through one would reach outside the plugin folder.
 */
const symlinkedFolder = (root: string, full: string): string | null => {
  const parts = path.relative(root, path.dirname(full)).split(path.sep).filter((p) => p !== "")
  let dir = root
  for (const part of parts) {
    dir = path.join(dir, part)
    const stat = fs.lstatSync(dir, { throwIfNoEntry: false })
    if (stat === undefined) return null
    if (stat.isSymbolicLink()) return dir
  }
  return null
}

/**
 * Replaces `file` with `text` through a temp file and a rename, which replaces a symlink there rather
 * than what it points at. Not writeFileAtomically: that follows a symlink to its target and keeps a
 * .bak, and neither is wanted for files Cello owns.
 */
const replaceFile = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.cello-${process.pid}.tmp`
  try {
    fs.writeFileSync(temp, text)
    fs.renameSync(temp, file)
  } catch (error) {
    fs.rmSync(temp, { force: true })
    throw error
  }
}

const sameFile = (file: string, text: string) => {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false })
  return stat !== undefined && stat.isFile() && fs.readFileSync(file, "utf8") === text
}

/** The files Cello wrote here last time, as listed in OWN_FILES; anything unreadable is an empty list. */
const ownFiles = (folder: string): ReadonlyArray<string> => {
  try {
    const list: unknown = JSON.parse(fs.readFileSync(path.join(folder, OWN_FILES), "utf8"))
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : []
  } catch {
    return []
  }
}

/**
 * Makes `folder` hold exactly `files`: writes the ones that are missing or different, removes the files
 * an earlier install wrote that aren't in `files` any more (never anything else), and keeps the list in
 * OWN_FILES. Refuses, before writing anything, when a folder inside it is a symlink. Says whether it
 * changed anything on disk.
 */
export const writePluginFolder = (folder: string, files: ReadonlyArray<PluginFile>): { readonly changed: boolean } => {
  const root = path.resolve(folder)
  const targets = files.map((file) => {
    const full = inside(root, file.path)
    if (full === null) throw new Error(`${file.path} is outside ${root}`)
    const link = symlinkedFolder(root, full)
    if (link !== null) throw new Error(`${link} is a symlink; Cello only writes real folders inside ${root}`)
    return { full, text: file.text }
  })
  let changed = false
  for (const { full, text } of targets) {
    if (sameFile(full, text)) continue
    replaceFile(full, text)
    changed = true
  }
  const wanted = new Set(files.map((f) => f.path))
  for (const old of ownFiles(root)) {
    const full = wanted.has(old) ? null : inside(root, old)
    if (full === null || symlinkedFolder(root, full) !== null) continue
    // Only files (or a link in a file's place): a folder named in the list is left alone.
    const stat = fs.lstatSync(full, { throwIfNoEntry: false })
    if (stat === undefined || !(stat.isFile() || stat.isSymbolicLink())) continue
    fs.rmSync(full, { force: true })
    changed = true
    // Folders it leaves empty go too, up to the plugin folder itself.
    for (let dir = path.dirname(full); dir !== root && dir.startsWith(root + path.sep); dir = path.dirname(dir)) {
      if (fs.readdirSync(dir).length > 0) break
      fs.rmdirSync(dir)
    }
  }
  const list = `${JSON.stringify([...wanted].sort(), null, 2)}\n`
  if (!sameFile(path.join(root, OWN_FILES), list)) {
    replaceFile(path.join(root, OWN_FILES), list)
    changed = true
  }
  return { changed }
}

