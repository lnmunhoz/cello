// Publishes a version's GitHub release (CEL-139): "Cello vX.Y.Z" on the pushed tag vX.Y.Z, its notes the
// version's CHANGELOG.md section, every file attached. Creates it the first time and updates it after (same-named
// files replaced), so the release workflow and `bun run release -- --local-artifacts` can each get there first.
// It uses gh, logged in (gh auth login) or given GH_TOKEN, as the workflow's publish job does.
//
//   bun scripts/release/publish.ts <version> [files...]   the files, or every .zip and .dmg in release/
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { isPrerelease } from "../../packages/release/src/updates.ts"
import { RELEASE_DIR } from "./artifacts.ts"
import { notesOf } from "./changelog.ts"

export type Publish = { readonly version: string; readonly files: ReadonlyArray<string>; readonly notesFile: string; readonly exists: boolean }

export const publishCommands = ({ version, files, notesFile, exists }: Publish): string[][] => {
  const tag = `v${version}`
  const title = `Cello ${tag}`
  // A preview (v0.6.0-beta.1) is a GitHub prerelease: only the app's Preview channel offers it (CEL-140),
  // and GitHub never marks it the latest release.
  const preview = isPrerelease(version) ? ["--prerelease"] : []
  if (exists) {
    return [
      ["gh", "release", "upload", tag, ...files, "--clobber"],
      ["gh", "release", "edit", tag, "--title", title, "--notes-file", notesFile, ...preview],
    ]
  }
  // --verify-tag: never let gh make the tag; the release commit's tag must already be on GitHub.
  return [["gh", "release", "create", tag, ...files, "--title", title, "--notes-file", notesFile, "--verify-tag", ...preview]]
}

/** The .zip and .dmg files at the top of `dir` (never release/stage's binary), sorted. */
export const releaseFilesIn = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(zip|dmg)$/.test(entry.name))
    .map((entry) => path.join(dir, entry.name))
    .sort()
}

export type Gh = { readonly exists: (tag: string) => boolean; readonly run: (cmd: ReadonlyArray<string>) => number }

const realGh: Gh = {
  exists: (tag) => spawnSync("gh", ["release", "view", tag, "--json", "tagName"], { stdio: "ignore" }).status === 0,
  run: (cmd) => spawnSync(cmd[0]!, cmd.slice(1), { stdio: "inherit" }).status ?? 1,
}

export const publishRelease = (options: { root: string; version: string; files: ReadonlyArray<string> }, gh: Gh = realGh): void => {
  const { root, version, files } = options
  if (files.length === 0) throw new Error(`No files to attach to v${version}.`)
  const notes = notesOf(fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8"), version)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-release-notes-"))
  try {
    const notesFile = path.join(dir, "notes.md")
    fs.writeFileSync(notesFile, notes)
    for (const cmd of publishCommands({ version, files, notesFile, exists: gh.exists(`v${version}`) })) {
      const code = gh.run(cmd)
      if (code !== 0) throw new Error(`${cmd.join(" ")} exited ${code}.`)
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  const root = path.join(import.meta.dirname, "../..")
  const [version, ...given] = process.argv.slice(2)
  try {
    if (!version) throw new Error("Usage: bun scripts/release/publish.ts <version> [files...]")
    const files = given.length > 0 ? given : releaseFilesIn(path.join(root, RELEASE_DIR))
    publishRelease({ root, version, files })
    console.log(`Published Cello v${version} with ${files.map((file) => path.basename(file)).join(", ")}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
