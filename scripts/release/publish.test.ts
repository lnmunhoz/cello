// Publishing a version's GitHub release: created the first time, updated after (the release workflow's
// publish job, or --local-artifacts on the Mac, may each get there first), always with every file attached.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { publishCommands, publishRelease, releaseFilesIn } from "./publish.ts"

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cello-release-publish-")))
afterAll(() => fs.rmSync(base, { recursive: true, force: true }))

describe("publishCommands", () => {
  const files = ["dist/cello-v0.5.0-darwin-arm64.zip", "dist/Cello-v0.5.0-mac-arm64.dmg"]

  it("creates the release on the pushed tag, titled Cello vX.Y.Z, with the notes and every file", () => {
    expect(publishCommands({ version: "0.5.0", files, notesFile: "/tmp/notes.md", exists: false })).toEqual([
      ["gh", "release", "create", "v0.5.0", ...files, "--title", "Cello v0.5.0", "--notes-file", "/tmp/notes.md", "--verify-tag"],
    ])
  })

  it("updates a release that's there: replaces same-named files, then the title and notes", () => {
    expect(publishCommands({ version: "0.5.0", files, notesFile: "/tmp/notes.md", exists: true })).toEqual([
      ["gh", "release", "upload", "v0.5.0", ...files, "--clobber"],
      ["gh", "release", "edit", "v0.5.0", "--title", "Cello v0.5.0", "--notes-file", "/tmp/notes.md"],
    ])
  })
})

describe("releaseFilesIn", () => {
  it("lists the zips and DMGs at the top of a folder, never the staged build or anything else", () => {
    const dir = path.join(base, "release")
    fs.mkdirSync(path.join(dir, "stage"), { recursive: true })
    for (const name of ["Cello-v0.5.0-mac-arm64.zip", "cello-v0.5.0-darwin-arm64.zip", "Cello-v0.5.0-mac-arm64.dmg", "packaging-failed", "stage/cello"]) {
      fs.writeFileSync(path.join(dir, name), "x")
    }
    expect(releaseFilesIn(dir).map((file) => path.basename(file))).toEqual([
      "Cello-v0.5.0-mac-arm64.dmg",
      "Cello-v0.5.0-mac-arm64.zip",
      "cello-v0.5.0-darwin-arm64.zip",
    ])
    expect(releaseFilesIn(path.join(base, "missing"))).toEqual([])
  })
})

describe("publishRelease", () => {
  const repo = (name: string) => {
    const dir = path.join(base, name)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, "CHANGELOG.md"),
      "# Changelog\n\n## [0.5.0](https://x/compare/v0.4.0...v0.5.0) (2026-11-17)\n\n### Features\n\n- builds on GitHub (CEL-139)\n\n## [0.4.0](https://x) (2026-11-16)\n\n- older\n",
    )
    return dir
  }

  it("takes the notes from the version's CHANGELOG.md section and runs the commands for a new release", () => {
    const dir = repo("new")
    const ran: string[][] = []
    let notes = ""
    publishRelease({ root: dir, version: "0.5.0", files: ["a.zip"] }, {
      exists: () => false,
      run: (cmd) => {
        ran.push([...cmd])
        notes = fs.readFileSync(cmd[cmd.indexOf("--notes-file") + 1]!, "utf8")
        return 0
      },
    })
    expect(ran.map((cmd) => cmd.slice(0, 5))).toEqual([["gh", "release", "create", "v0.5.0", "a.zip"]])
    expect(notes).toBe("### Features\n\n- builds on GitHub (CEL-139)\n")
  })

  it("updates a release that's already there", () => {
    const dir = repo("update")
    const ran: string[] = []
    publishRelease({ root: dir, version: "0.5.0", files: ["a.zip"] }, { exists: () => true, run: (cmd) => (ran.push(cmd[2]!), 0) })
    expect(ran).toEqual(["upload", "edit"])
  })

  it("refuses with nothing to attach, a version CHANGELOG.md lacks, or a failing gh", () => {
    const dir = repo("fail")
    const gh = { exists: () => false, run: () => 0 }
    expect(() => publishRelease({ root: dir, version: "0.5.0", files: [] }, gh)).toThrow("No files to attach to v0.5.0.")
    expect(() => publishRelease({ root: dir, version: "0.6.0", files: ["a.zip"] }, gh)).toThrow("CHANGELOG.md has no 0.6.0 section.")
    expect(() => publishRelease({ root: dir, version: "0.5.0", files: ["a.zip"] }, { exists: () => false, run: () => 1 })).toThrow(
      /gh release create v0\.5\.0 a\.zip .* exited 1/,
    )
  })
})
