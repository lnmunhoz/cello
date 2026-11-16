// The steps release-it runs as hooks (.release-it.json), each a call into the tested modules beside this:
//
//   bun scripts/release/hooks.ts bump <version>        after:bump: the version everywhere, and CHANGELOG.md
//   bun scripts/release/hooks.ts artifacts <version>   before:github:release (after the commit and tag):
//                                                      the cello binary and Cello.app, zipped into release/
//
// CELLO_RELEASE_SKIP_DESKTOP=1 (bun run release -- --skip-desktop) leaves Cello.app out.
import * as path from "node:path"
import { buildArtifacts } from "./artifacts.ts"
import { writeChangelog } from "./changelog.ts"
import { syncVersion } from "./version.ts"

const root = path.join(import.meta.dirname, "../..")
const [command, version] = process.argv.slice(2)

try {
  if (!version) throw new Error("Usage: bun scripts/release/hooks.ts bump|artifacts <version>")
  if (command === "bump") {
    const files = syncVersion(root, version)
    console.log(`Version ${version} written to ${files.join(", ")}`)
    writeChangelog(root, version)
    console.log(`CHANGELOG.md: added the ${version} section`)
  } else if (command === "artifacts") {
    const zips = buildArtifacts({
      root,
      version,
      platform: process.platform,
      arch: process.arch,
      desktop: process.env.CELLO_RELEASE_SKIP_DESKTOP !== "1",
    })
    console.log(`Built ${zips.map((zip) => path.relative(root, zip)).join(", ")}`)
  } else {
    throw new Error(`Unknown hook "${command}": use bump or artifacts.`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
