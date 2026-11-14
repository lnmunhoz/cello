// Where `cello start` finds the web app when run from source: CELLO_WEB_DIR, else apps/web/dist.
// The compiled binary embeds the build instead (see scripts/build.ts).
import * as fs from "node:fs"
import * as path from "node:path"
import * as WebFiles from "@cello/server/web/WebFiles"
import type { Env } from "./identity.ts"

export const webFromDirectory = (env: Env): WebFiles.WebFiles | undefined => {
  const dir = env.CELLO_WEB_DIR || path.join(import.meta.dir, "../../web/dist")
  return fs.existsSync(path.join(dir, "index.html")) ? WebFiles.fromDirectory(dir) : undefined
}
