// The files `cello doc publish` uploads: every --asset (from the working folder), plus the images the
// markdown links that exist on disk, by a path relative to the markdown file or an absolute one. Paths
// become absolute: the server copies them from this machine and points the links at the copies.
import * as fs from "node:fs"
import * as path from "node:path"
import { classify } from "@cello/shared/attachment"
import { linkTargets } from "@cello/shared/document"

const isFile = (file: string) => {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

export const pageFiles = (markdown: string, baseDir: string, assets: ReadonlyArray<string>, cwd: string): string[] => {
  const files = assets.map((asset) => path.resolve(cwd, asset))
  for (const { target, image } of linkTargets(markdown)) {
    const clean = target.replace(/[?#].*$/, "")
    if (!image || clean === "" || /^[a-z][a-z0-9+.-]*:/i.test(clean) || clean.startsWith("//")) continue
    const file = path.resolve(baseDir, clean)
    if (classify(file)?.kind === "image" && isFile(file)) files.push(file)
  }
  return [...new Set(files)]
}
