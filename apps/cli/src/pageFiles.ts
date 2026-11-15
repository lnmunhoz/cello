// The files `cello doc publish` uploads: every --asset (from the working folder), plus every file the
// markdown links (as an image or a plain link) that the server stores and that exists on disk, by a
// path relative to the markdown file or an absolute one. Paths become absolute: the server copies
// them from this machine and points the links at the copies. Linked files it can't send are named,
// so the CLI can warn: a link left as it is shows as a missing file in the reader.
import * as fs from "node:fs"
import * as path from "node:path"
import { classify } from "@cello/shared/attachment"
import { linkTargets, localFileTarget } from "@cello/shared/document"

const isFile = (file: string) => {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

/** A linked local file that stays behind: not on disk, or a type the server doesn't store. */
export interface SkippedFile {
  /** As the markdown links it, without a query or anchor. */
  readonly target: string
  /** Where it was looked for. */
  readonly file: string
  readonly reason: "missing" | "unsupported"
}

export const pageFiles = (
  markdown: string,
  baseDir: string,
  assets: ReadonlyArray<string>,
  cwd: string,
): { files: string[]; skipped: SkippedFile[] } => {
  const files = assets.map((asset) => path.resolve(cwd, asset))
  const skipped: SkippedFile[] = []
  for (const { target } of linkTargets(markdown)) {
    const local = localFileTarget(target)
    if (local === null || skipped.some((s) => s.target === local)) continue
    const file = path.resolve(baseDir, local)
    if (!isFile(file)) skipped.push({ target: local, file, reason: "missing" })
    else if (classify(file) === null) skipped.push({ target: local, file, reason: "unsupported" })
    else files.push(file)
  }
  return { files: [...new Set(files)], skipped }
}
