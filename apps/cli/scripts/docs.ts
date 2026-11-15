// `bun run docs:cli`: rewrites what's generated from the CLI and its sources: docs/cli.md's command
// reference from the CLI's --help, apps/cli/src/guide.ts (what `cello guide` prints) from docs/cli.md,
// and apps/cli/src/claudePluginFiles.ts (the Claude Code plugin the binary carries) from
// apps/cli/claude-plugin/. `--check` only reports drift.
import * as fs from "node:fs"
import * as Effect from "effect/Effect"
import { PLUGIN_FILES_MODULE, PLUGIN_SOURCE_DIR, pluginFilesModule, readPluginSource } from "../src/claudePluginSource.ts"

const check = process.argv.includes("--check")
const current = (file: string, text: string) => fs.existsSync(file) && fs.readFileSync(file, "utf8") === text

// The plugin's module first: the CLI imports it, so it has to exist before the reference is read.
const plugin = pluginFilesModule(readPluginSource(PLUGIN_SOURCE_DIR))
const pluginStale = !current(PLUGIN_FILES_MODULE, plugin)
if (!check && pluginStale) fs.writeFileSync(PLUGIN_FILES_MODULE, plugin)

const { DOC_PATH, GUIDE_PATH, guideModule, referenceFromCli, withReference } = await import("../src/reference.ts")
const reference = await Effect.runPromise(referenceFromCli)
const before = fs.readFileSync(DOC_PATH, "utf8")
const doc = withReference(before, reference)
const guide = guideModule(doc)
const stale = [
  ...(doc === before ? [] : ["docs/cli.md"]),
  ...(current(GUIDE_PATH, guide) ? [] : ["apps/cli/src/guide.ts"]),
  ...(pluginStale ? ["apps/cli/src/claudePluginFiles.ts"] : []),
]

if (check) {
  if (stale.length > 0) {
    console.error(`Out of date: ${stale.join(", ")}. Run \`bun run docs:cli\`.`)
    process.exit(1)
  }
  console.log("docs/cli.md, cello guide and the Claude Code plugin match their sources.")
} else {
  fs.writeFileSync(DOC_PATH, doc)
  fs.writeFileSync(GUIDE_PATH, guide)
  console.log(stale.length > 0 ? `Updated ${stale.join(", ")}.` : "Already up to date.")
}
