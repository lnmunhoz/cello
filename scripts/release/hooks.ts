// The steps release-it runs as hooks (.release-it.json), each a call into the tested modules beside this, plus
// the one GitHub Actions runs:
//
//   bun scripts/release/hooks.ts bump <version>        after:bump: the version everywhere (then the plugin's
//                                                      embedded copy regenerated), and CHANGELOG.md
//   bun scripts/release/hooks.ts build <version>       after:release (after the commit and tag, before the push):
//                                                      this Mac's own cello into release/stage, for the deploy;
//                                                      with --local-artifacts, the downloads too
//   bun scripts/release/hooks.ts publish <version>     after:release (after the push): with --local-artifacts, the
//                                                      GitHub release from this Mac; otherwise nothing, since the
//                                                      pushed tag starts GitHub Actions, which publishes it
//   bun scripts/release/hooks.ts artifacts <version>   the release workflow, on each runner: the downloads for its
//                                                      machine (the cello zip, Cello.app's DMG and zip)
//
// bun run release passes CELLO_RELEASE_LOCAL_ARTIFACTS=1 for --local-artifacts and CELLO_RELEASE_SKIP_DESKTOP=1
// for --skip-desktop; the workflow passes CELLO_RELEASE_SIGN=1 when its signing secrets exist.
import { spawnSync } from "node:child_process"
import * as path from "node:path"
import { buildArtifacts, RELEASE_DIR } from "./artifacts.ts"
import { writeChangelog } from "./changelog.ts"
import { publishRelease, releaseFilesIn } from "./publish.ts"
import { syncVersion } from "./version.ts"

const root = path.join(import.meta.dirname, "../..")
const [command, version] = process.argv.slice(2)
const localArtifacts = process.env.CELLO_RELEASE_LOCAL_ARTIFACTS === "1"

const build = (deploy: boolean, downloads: boolean) => {
  const files = buildArtifacts({
    root,
    version: version!,
    platform: process.platform,
    arch: process.arch,
    deploy,
    downloads,
    desktop: process.env.CELLO_RELEASE_SKIP_DESKTOP !== "1",
    sign: process.env.CELLO_RELEASE_SIGN === "1",
  })
  console.log(downloads ? `Built ${files.map((file) => path.relative(root, file)).join(", ")}` : "Built release/stage/cello for the deploy")
}

try {
  if (!version) throw new Error("Usage: bun scripts/release/hooks.ts bump|build|publish|artifacts <version>")
  if (command === "bump") {
    const files = syncVersion(root, version)
    console.log(`Version ${version} written to ${files.join(", ")}`)
    // The plugin's plugin.json changed, so the copy the cello binary embeds (apps/cli/src/claudePluginFiles.ts)
    // must be regenerated, or the release commit fails apps/cli/src/claudePlugin.test.ts.
    const docs = spawnSync("bun", ["apps/cli/scripts/docs.ts"], { cwd: root, stdio: "inherit" })
    if (docs.status !== 0) throw new Error(`bun run docs:cli failed (exit ${docs.status}): the embedded plugin is stale.`)
    writeChangelog(root, version)
    console.log(`CHANGELOG.md: added the ${version} section`)
  } else if (command === "build") {
    build(true, localArtifacts)
  } else if (command === "artifacts") {
    // GitHub Actions: the downloads only, the release flavor; nothing to deploy there.
    build(false, true)
  } else if (command === "publish") {
    if (localArtifacts) publishRelease({ root, version, files: releaseFilesIn(path.join(root, RELEASE_DIR)) })
    else console.log(`v${version} is pushed: GitHub Actions builds its downloads and publishes the GitHub release.`)
  } else {
    throw new Error(`Unknown hook "${command}": use bump, build, publish or artifacts.`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
