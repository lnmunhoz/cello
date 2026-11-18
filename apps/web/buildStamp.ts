// Stamps each web build (CEL-37): the bundle gets `__CELLO_BUILD__` (version, commit, build time), and
// the same stamp, plus the commits merged since the build that was in the output folder before, goes
// into build.json beside index.html. The server reads build.json and reports it; an open tab compares
// it with its own `__CELLO_BUILD__` each time it connects (packages/release/src/build.ts).
import * as fs from "node:fs"
import * as path from "node:path"
import type { Plugin } from "vite"
import type { WebBuild } from "../../packages/contract/src/build.ts"
import { webBuildStamp } from "../server/src/build/git.ts"

const readPrevious = (file: string): WebBuild | null => {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<WebBuild>
    return typeof parsed.builtAt === "number" && Array.isArray(parsed.changes) ? (parsed as WebBuild) : null
  } catch {
    return null
  }
}

export const buildStamp = (): Plugin => {
  const builtAt = Date.now()
  let stamp: WebBuild | null = null
  return {
    name: "cello-build-stamp",
    config(config) {
      const { version, commit } = webBuildStamp({ dir: config.root ?? process.cwd(), env: process.env, previous: null, now: builtAt })
      return { define: { __CELLO_BUILD__: JSON.stringify({ version, commit, builtAt }) } }
    },
    // The output folder is known only once the config is resolved (`--outDir` included); vite empties it
    // later, when it writes the bundle.
    configResolved(config) {
      const previous = readPrevious(path.resolve(config.root, config.build.outDir, "build.json"))
      stamp = webBuildStamp({ dir: config.root, env: process.env, previous, now: builtAt })
    },
    generateBundle() {
      if (stamp) this.emitFile({ type: "asset", fileName: "build.json", source: `${JSON.stringify(stamp, null, 2)}\n` })
    },
  }
}
