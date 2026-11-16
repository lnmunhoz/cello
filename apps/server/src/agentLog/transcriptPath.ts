// Which transcript files Cello reads (CEL-106). A path reaches the server only from a hook (as the
// session or subagent it belongs to), never from the web; and even then it's read only when it's a
// `.jsonl` inside Claude Code's `projects/` folder, symlinks resolved, so a hook input or a CELLO_TRANSCRIPT
// someone set by hand can't make the server read anything else.
import * as fs from "node:fs"
import * as path from "node:path"

/** Claude Code's projects folder: `$CLAUDE_CONFIG_DIR/projects`, else `~/.claude/projects`. */
export const claudeProjectsDir = (env: Readonly<Record<string, string | undefined>>, home: string): string =>
  path.join(env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"), "projects")

export type Guarded =
  | { readonly _tag: "ok"; readonly file: string }
  /** Inside projects/, but not on disk: cleaned up, or not written yet. */
  | { readonly _tag: "missing" }
  /** Not a transcript Cello reads. */
  | { readonly _tag: "refused" }

/** `file` with symlinks resolved as far as it exists, the rest appended. */
const resolved = (file: string): string => {
  try {
    return fs.realpathSync(file)
  } catch {
    const parent = path.dirname(file)
    return parent === file ? file : path.join(resolved(parent), path.basename(file))
  }
}

const inside = (root: string, file: string) => {
  const relative = path.relative(root, file)
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

/**
 * Whether Cello reads `reported` as a log, and the real file when it does: a `.jsonl` inside `root`
 * (Claude Code's projects folder for transcripts; `<dataDir>/runs` for a woken run's log), symlinks resolved.
 */
export const guardLogFile = (reported: string, root: string): Guarded => {
  if (!path.isAbsolute(reported) || path.extname(reported) !== ".jsonl") return { _tag: "refused" }
  let realRoot: string
  try {
    realRoot = fs.realpathSync(root)
  } catch {
    // No such folder here: nothing of it is on disk.
    return { _tag: "missing" }
  }
  const file = resolved(path.resolve(reported))
  if (!inside(realRoot, file) || path.extname(file) !== ".jsonl") return { _tag: "refused" }
  try {
    return fs.statSync(file).isFile() ? { _tag: "ok", file } : { _tag: "refused" }
  } catch {
    return { _tag: "missing" }
  }
}
