// Cello's one version: the root package.json holds it, and a release writes it everywhere else it lives.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { nextVersion, readVersions, syncVersion } from "./version.ts"

const repoRoot = path.join(import.meta.dirname, "../..")
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cello-release-version-")))
afterAll(() => fs.rmSync(base, { recursive: true, force: true }))

const write = (root: string, file: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  fs.writeFileSync(path.join(root, file), content)
}
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

// A small copy of the repo's layout: the root, a versioned app (desktop), an unversioned app and package,
// and the shared version.ts.
const fixture = (name: string, version = "0.2.0") => {
  const root = path.join(base, name)
  write(root, "package.json", json({ name: "cello", version, private: true, workspaces: ["packages/*", "apps/*"] }))
  write(root, "apps/desktop/package.json", json({ name: "@cello/desktop", private: true, version: "0.1.0", main: "x.cjs" }))
  write(root, "apps/cli/package.json", json({ name: "@cello/cli", private: true }))
  write(root, "packages/shared/package.json", json({ name: "@cello/shared", private: true }))
  // bun.lock records each workspace's version: a release that left it stale would dirty the tree at the
  // next bun install.
  write(
    root,
    "bun.lock",
    [
      "{",
      '  "lockfileVersion": 2,',
      '  "workspaces": {',
      '    "": {',
      '      "name": "cello",',
      "    },",
      '    "apps/cli": {',
      '      "name": "@cello/cli",',
      "    },",
      '    "apps/desktop": {',
      '      "name": "@cello/desktop",',
      '      "version": "0.1.0",',
      '      "devDependencies": {',
      '        "electron": "44.10.1",',
      "      },",
      "    },",
      "  },",
      '  "packages": {',
      '    "left-alone": ["left-alone@1.0.0", "", { "version": "9.9.9" }],',
      "  }",
      "}",
      "",
    ].join("\n"),
  )
  write(
    root,
    "packages/shared/src/version.ts",
    `// Cello's version.\nexport const APP_VERSION = "${version}"\n`,
  )
  return root
}

describe("nextVersion", () => {
  it("bumps the patch by default, and minor or major when asked", () => {
    expect(nextVersion("0.3.0", "patch")).toBe("0.3.1")
    expect(nextVersion("0.3.4", "minor")).toBe("0.4.0")
    expect(nextVersion("0.3.4", "major")).toBe("1.0.0")
  })

  it("takes an exact version that is newer", () => {
    expect(nextVersion("0.2.0", "0.3.0")).toBe("0.3.0")
    expect(nextVersion("0.2.0", "v1.0.0")).toBe("1.0.0")
  })

  it("refuses a version that isn't newer, or isn't a version", () => {
    expect(() => nextVersion("0.3.0", "0.3.0")).toThrow(/not newer than 0.3.0/)
    expect(() => nextVersion("0.3.0", "0.2.9")).toThrow(/not newer than 0.3.0/)
    expect(() => nextVersion("0.3.0", "huge")).toThrow(/patch, minor, major or a version like 1.2.3/)
    expect(() => nextVersion("banana", "patch")).toThrow(/isn't a version/)
  })
})

describe("readVersions", () => {
  it("lists every place the version lives: root, shared version.ts, and each package.json that has one", () => {
    const root = fixture("read")
    expect(readVersions(root)).toEqual([
      { file: "package.json", version: "0.2.0" },
      { file: "packages/shared/src/version.ts", version: "0.2.0" },
      { file: "apps/desktop/package.json", version: "0.1.0" },
      { file: "bun.lock (apps/desktop)", version: "0.1.0" },
    ])
  })
})

describe("syncVersion", () => {
  it("writes the new version everywhere it lives and leaves the rest of each file alone", () => {
    const root = fixture("sync")
    const written = syncVersion(root, "0.3.0")
    expect(written).toEqual(["package.json", "packages/shared/src/version.ts", "apps/desktop/package.json", "bun.lock"])
    expect(readVersions(root).map((v) => v.version)).toEqual(["0.3.0", "0.3.0", "0.3.0", "0.3.0"])
    const lock = fs.readFileSync(path.join(root, "bun.lock"), "utf8")
    expect(lock).toContain('"@cello/desktop",\n      "version": "0.3.0",')
    expect(lock).toContain('{ "version": "9.9.9" }')
    expect(JSON.parse(fs.readFileSync(path.join(root, "apps/desktop/package.json"), "utf8"))).toEqual({
      name: "@cello/desktop",
      private: true,
      version: "0.3.0",
      main: "x.cjs",
    })
    expect(fs.readFileSync(path.join(root, "packages/shared/src/version.ts"), "utf8")).toBe(
      `// Cello's version.\nexport const APP_VERSION = "0.3.0"\n`,
    )
    // Unversioned packages stay unversioned.
    expect(JSON.parse(fs.readFileSync(path.join(root, "apps/cli/package.json"), "utf8"))).not.toHaveProperty("version")
  })

  it("dry run: says what it would write and writes nothing", () => {
    const root = fixture("dry")
    expect(syncVersion(root, "0.3.0", { dryRun: true })).toEqual([
      "package.json",
      "packages/shared/src/version.ts",
      "apps/desktop/package.json",
      "bun.lock",
    ])
    expect(readVersions(root).map((v) => v.version)).toEqual(["0.2.0", "0.2.0", "0.1.0", "0.1.0"])
  })

  it("refuses a bun.lock without the versioned workspace's entry, before writing anything", () => {
    const root = fixture("nolock")
    write(root, "bun.lock", '{\n  "workspaces": {\n    "": {\n      "name": "cello",\n    },\n  },\n}\n')
    expect(() => syncVersion(root, "0.3.0")).toThrow(/bun\.lock has no version for apps\/desktop/)
    expect(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version).toBe("0.2.0")
  })

  it("refuses a version.ts it can't find APP_VERSION in, before writing anything", () => {
    const root = fixture("broken")
    write(root, "packages/shared/src/version.ts", "export const VERSION = 1\n")
    expect(() => syncVersion(root, "0.3.0")).toThrow(/APP_VERSION/)
    expect(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version).toBe("0.2.0")
  })
})

describe("this repository", () => {
  it("has one version everywhere: root package.json, APP_VERSION, every versioned package.json and bun.lock agree", () => {
    const versions = readVersions(repoRoot)
    expect(versions.map((v) => v.file)).toContain("packages/shared/src/version.ts")
    expect(versions.map((v) => v.file)).toContain("apps/desktop/package.json")
    expect(versions.map((v) => v.file)).toContain("bun.lock (apps/desktop)")
    const root = versions[0]!
    expect(root.file).toBe("package.json")
    for (const v of versions) expect(v, `${v.file} disagrees with package.json`).toEqual({ file: v.file, version: root.version })
  })
})
