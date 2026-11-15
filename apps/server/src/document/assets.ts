// Which uploaded file a link in a published document means. The CLI sends the files' absolute paths;
// the markdown links them relative to its own file, by the end of their path, or by bare name.
import * as path from "node:path"
import { type LinkTarget, localFileTarget } from "@cello/shared/document"

/** A file the document carries: where it came from on this machine, and where it's served now. */
export interface StoredAsset {
  readonly path: string
  readonly url: string
}

/**
 * Maps a link target to a stored file's URL, or null to keep it. In order: the path relative to the
 * markdown file (`sourceDir`), a file whose path ends with the target, a file with the same name.
 * An absolute target matches only exactly; URLs, anchors and paths without a file extension
 * (`localFileTarget`) are never touched. Images and plain links resolve the same way.
 */
export const assetResolver = (sourceDir: string | null, assets: ReadonlyArray<StoredAsset>) =>
  ({ target }: LinkTarget): string | null => {
    const clean = localFileTarget(target)
    if (clean === null) return null
    if (path.isAbsolute(clean)) return assets.find((a) => a.path === path.normalize(clean))?.url ?? null
    if (sourceDir !== null) {
      const relative = path.resolve(sourceDir, clean)
      const exact = assets.find((a) => a.path === relative)
      if (exact) return exact.url
    }
    const tail = path.normalize(clean).replace(/^(\.\.[/\\])+/, "")
    const name = path.basename(clean)
    return (assets.find((a) => a.path.endsWith(path.sep + tail)) ?? assets.find((a) => path.basename(a.path) === name))?.url ?? null
  }
