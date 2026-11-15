// `bun run docs:cli`: rewrites docs/cli.md's command reference from the CLI's --help, and
// apps/cli/src/guide.ts (what `cello guide` prints) from docs/cli.md. `--check` only reports drift.
import * as fs from "node:fs"
import * as Effect from "effect/Effect"
import { DOC_PATH, GUIDE_PATH, guideModule, referenceFromCli, withReference } from "../src/reference.ts"

const check = process.argv.includes("--check")
const reference = await Effect.runPromise(referenceFromCli)
const before = fs.readFileSync(DOC_PATH, "utf8")
const doc = withReference(before, reference)
const guide = guideModule(doc)
const stale = [
  ...(doc === before ? [] : ["docs/cli.md"]),
  ...(fs.existsSync(GUIDE_PATH) && fs.readFileSync(GUIDE_PATH, "utf8") === guide ? [] : ["apps/cli/src/guide.ts"]),
]

if (check) {
  if (stale.length > 0) {
    console.error(`Out of date: ${stale.join(", ")}. Run \`bun run docs:cli\`.`)
    process.exit(1)
  }
  console.log("docs/cli.md and cello guide match the CLI.")
} else {
  fs.writeFileSync(DOC_PATH, doc)
  fs.writeFileSync(GUIDE_PATH, guide)
  console.log(stale.length > 0 ? `Updated ${stale.join(", ")}.` : "Already up to date.")
}
