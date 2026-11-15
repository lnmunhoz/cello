// The Claude Code plugin's source (CEL-64): apps/cli/claude-plugin/, and claudePluginFiles.ts, the
// module `bun run docs:cli` generates from it so the compiled binary carries the files. Kept apart from
// claudePlugin.ts, which imports that module, so the generator runs even when the module is missing.
import * as fs from "node:fs"
import * as path from "node:path"

export interface PluginFile {
  /** Relative to the marketplace's root, with `/` separators. */
  readonly path: string
  readonly text: string
}

/** The plugin's source in the repo, and the module `bun run docs:cli` generates from it. */
export const PLUGIN_SOURCE_DIR = path.join(import.meta.dirname, "../claude-plugin")
export const PLUGIN_FILES_MODULE = path.join(import.meta.dirname, "claudePluginFiles.ts")

/** Every file under `dir`, sorted by path. */
export const readPluginSource = (dir: string): ReadonlyArray<PluginFile> => {
  const files: PluginFile[] = []
  const walk = (folder: string) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) files.push({ path: path.relative(dir, full).split(path.sep).join("/"), text: fs.readFileSync(full, "utf8") })
    }
  }
  walk(dir)
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** claudePluginFiles.ts for these files. */
export const pluginFilesModule = (files: ReadonlyArray<PluginFile>): string =>
  [
    "// Generated from apps/cli/claude-plugin/ by `bun run docs:cli`; edit those files, not this one.",
    "// `cello install claude` writes them out as Claude Code's cello plugin (claudePlugin.ts).",
    "export const CLAUDE_PLUGIN_FILES: ReadonlyArray<{ readonly path: string; readonly text: string }> = [",
    ...[...files]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((file) => `  { path: ${JSON.stringify(file.path)}, text: ${JSON.stringify(file.text)} },`),
    "]",
    "",
  ].join("\n")

