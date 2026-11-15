// Which web app `cello start` serves: CELLO_WEB_DIR when it holds a build (tests serve two builds this
// way, CEL-37), else the built-in one: the files embedded in the compiled binary (scripts/build.ts),
// or apps/web/dist when run from source.
import * as fs from "node:fs"
import * as path from "node:path"
import * as WebFiles from "@cello/server/web/WebFiles"
import type { Env } from "./identity.ts"

const fromDirectory = (dir: string): WebFiles.WebFiles | undefined =>
  fs.existsSync(path.join(dir, "index.html")) ? WebFiles.fromDirectory(dir) : undefined

/** CELLO_WEB_DIR's build when it has an index.html, else `builtIn`'s, after `warn`ing that it was skipped. */
export const webFor = (
  env: Env,
  builtIn: () => WebFiles.WebFiles | undefined,
  warn: (message: string) => void,
): WebFiles.WebFiles | undefined => {
  if (env.CELLO_WEB_DIR) {
    const files = fromDirectory(env.CELLO_WEB_DIR)
    if (files) return files
    warn(`CELLO_WEB_DIR has no index.html (${path.resolve(env.CELLO_WEB_DIR)}); serving the built-in web app instead.`)
  }
  return builtIn()
}

/** The built-in web app when run from source: apps/web/dist. */
export const webFromSource = (): WebFiles.WebFiles | undefined => fromDirectory(path.join(import.meta.dir, "../../web/dist"))
