import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { MAP, rewriteRelativeImports, rewriteText, splitShared } from "./split-shared.ts"

describe("rewriteText", () => {
  it("points @cello/shared imports at the package the map names", () => {
    expect(rewriteText(`import { a } from "@cello/shared/taskKey"\nimport { b } from "@cello/shared/linkify"\n`, "apps/web/src/a.ts")).toBe(
      `import { a } from "@cello/domain/taskKey"\nimport { b } from "@cello/text/linkify"\n`,
    )
  })

  it("keeps diff.fixture whole, not diff plus .fixture", () => {
    expect(rewriteText(`import { F } from "@cello/shared/diff.fixture"`, "apps/web/src/a.test.ts")).toBe(`import { F } from "@cello/text/diff.fixture"`)
  })

  it("turns the agentMark import into a path from the importing file", () => {
    expect(rewriteText(`import { m } from "@cello/shared/agentMark"`, "apps/web/src/components/ui/AgentMark.tsx")).toBe(`import { m } from "../../lib/agentMark.ts"`)
    expect(rewriteText(`import { m } from "@cello/shared/agentMark"`, "apps/web/src/lib/agentMark.test.ts")).toBe(`import { m } from "./agentMark.ts"`)
  })

  it("rewrites relative paths into packages/shared, keeping the prefix", () => {
    expect(rewriteText(`import { isPrerelease } from "../../packages/shared/src/updates.ts"`, "scripts/release/x.ts")).toBe(`import { isPrerelease } from "../../packages/release/src/updates.ts"`)
    expect(rewriteText(`import { m } from "../packages/shared/src/agentMark.ts"`, "e2e/fixtures.ts")).toBe(`import { m } from "../apps/web/src/lib/agentMark.ts"`)
    expect(rewriteText("see packages/shared/position.ts and @cello/shared/milestone's findMilestone", "docs/x.md")).toBe("see packages/domain/src/position.ts and @cello/domain/milestone's findMilestone")
  })

  it("leaves a mention of a module the map doesn't name, so the script can list it", () => {
    expect(rewriteText("packages/shared and @cello/shared/nothing", "docs/x.md")).toBe("packages/shared and @cello/shared/nothing")
  })

  it("gives every module exactly one package", () => {
    const all = Object.values(MAP).flat()
    expect(new Set(all).size).toBe(all.length)
  })
})

describe("rewriteRelativeImports", () => {
  it("turns a ./x import of a module now in another package into a package import", () => {
    const text = `import { taskKey } from "./taskKey.ts"\nimport { doc } from "./document.ts"\nimport { own } from "./helper.ts"\n`
    expect(rewriteRelativeImports(text, "packages/text/src/linkify.ts")).toBe(`import { taskKey } from "@cello/domain/taskKey"\nimport { doc } from "./document.ts"\nimport { own } from "./helper.ts"\n`)
  })

  it("leaves the web app's own ./embed.ts alone", () => {
    expect(rewriteRelativeImports(`import { e } from "./embed.ts"`, "apps/web/src/lib/x.ts")).toBe(`import { e } from "./embed.ts"`)
  })
})

describe("splitShared on a small repo", () => {
  const git = (root: string, ...args: string[]) => {
    const run = spawnSync("git", args, { cwd: root, encoding: "utf8" })
    if (run.status !== 0) throw new Error(run.stderr)
    return run.stdout
  }
  const write = (root: string, file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), content)
  }
  const read = (root: string, file: string) => fs.readFileSync(path.join(root, file), "utf8")

  const repo = (): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cello-split-"))
    git(root, "init", "-q")
    write(root, "packages/shared/package.json", JSON.stringify({ name: "@cello/shared", dependencies: { "fractional-indexing": "4.0.0" } }))
    write(root, "packages/shared/src/taskKey.ts", "export const key = 1\n")
    write(root, "packages/shared/src/taskKey.test.ts", `import { key } from "./taskKey.ts"\n`)
    write(root, "packages/shared/src/linkify.ts", `import { key } from "./taskKey.ts"\nexport const link = key\n`)
    write(root, "packages/shared/src/agentMark.ts", "export const mark = 1\n")
    write(root, "apps/web/package.json", JSON.stringify({ name: "@cello/web", dependencies: { "@cello/shared": "workspace:*", react: "1" } }))
    write(root, "apps/web/src/a.ts", `import { link } from "@cello/shared/linkify"\nimport { mark } from "@cello/shared/agentMark"\n`)
    write(root, "apps/desktop/package.json", JSON.stringify({ name: "@cello/desktop", devDependencies: { "@cello/server": "workspace:*", "@cello/shared": "workspace:*" } }))
    write(root, "apps/desktop/src/b.ts", `import { key } from "@cello/shared/taskKey"\n`)
    git(root, "add", "-A")
    commit(root)
    return root
  }
  const commit = (root: string) => {
    git(root, "add", "-A")
    git(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "x")
  }

  it("moves, rewrites, writes the package.json files, and changes nothing the second time", () => {
    const root = repo()
    const first = splitShared(root)
    expect(first.moved).toHaveLength(4)
    expect(fs.existsSync(path.join(root, "packages/shared"))).toBe(false)
    expect(read(root, "packages/text/src/linkify.ts")).toBe(`import { key } from "@cello/domain/taskKey"\nexport const link = key\n`)
    expect(read(root, "apps/web/src/a.ts")).toBe(`import { link } from "@cello/text/linkify"\nimport { mark } from "./lib/agentMark.ts"\n`)
    expect(fs.existsSync(path.join(root, "apps/web/src/lib/agentMark.ts"))).toBe(true)
    expect(JSON.parse(read(root, "packages/text/package.json")).dependencies).toEqual({ "@cello/domain": "workspace:*" })
    expect(JSON.parse(read(root, "packages/domain/package.json"))).toMatchObject({ name: "@cello/domain", exports: { "./*": "./src/*.ts" } })
    expect(JSON.parse(read(root, "apps/web/package.json")).dependencies).toEqual({ "@cello/text": "workspace:*", react: "1" })
    expect(JSON.parse(read(root, "apps/desktop/package.json")).devDependencies).toEqual({ "@cello/domain": "workspace:*", "@cello/server": "workspace:*" })

    commit(root)
    const second = splitShared(root)
    expect([second.moved, second.rewritten, second.packageJson, second.removed]).toEqual([[], [], [], []])
    expect(git(root, "status", "--short")).toBe("")
  })

  it("refuses a working tree with uncommitted changes, unless told otherwise", () => {
    const root = repo()
    write(root, "apps/web/src/a.ts", `import { link } from "@cello/shared/linkify"\nconst edited = 1\n`)
    expect(() => splitShared(root)).toThrow("uncommitted changes")
    expect(fs.existsSync(path.join(root, "packages/shared/src/taskKey.ts"))).toBe(true)
    expect(splitShared(root, { allowDirty: true }).moved).toHaveLength(4)
  })

  it("stops before moving anything when a new package would import a dependency with no version", () => {
    const root = repo()
    write(root, "packages/shared/src/search.ts", `import { x } from "some-new-library"\n`)
    commit(root)
    expect(() => splitShared(root)).toThrow("some-new-library")
    expect(fs.existsSync(path.join(root, "packages/shared/src/taskKey.ts"))).toBe(true)
    expect(fs.existsSync(path.join(root, "packages/text"))).toBe(false)
    expect(git(root, "status", "--short")).toBe("")
  })

  it("deletes only packages/shared's package.json and its empty folders, and lists what else a branch put there", () => {
    const root = repo()
    write(root, "packages/shared/test/helper.ts", "export const h = 1\n")
    write(root, "packages/shared/README.md", "kept\n")
    commit(root)
    const report = splitShared(root)
    expect(fs.existsSync(path.join(root, "packages/shared/package.json"))).toBe(false)
    expect(fs.existsSync(path.join(root, "packages/shared/src"))).toBe(false)
    expect(read(root, "packages/shared/test/helper.ts")).toBe("export const h = 1\n")
    expect(read(root, "packages/shared/README.md")).toBe("kept\n")
    expect(report.removed).toEqual(["packages/shared/package.json"])
    expect(report.leftovers.join("\n")).toContain("packages/shared/README.md")
    expect(report.leftovers.join("\n")).toContain("packages/shared/test/helper.ts")
  })

  it("rewrites only the new imports when a branch adds them after the split", () => {
    const root = repo()
    splitShared(root)
    write(root, "apps/cli/package.json", JSON.stringify({ name: "@cello/cli", dependencies: { "@cello/client": "workspace:*" } }))
    write(root, "apps/cli/src/c.ts", `import { key } from "@cello/shared/taskKey"\nimport { link } from "@cello/text/linkify"\n`)
    write(root, "packages/shared/src/detect.ts", "export const detect = 1\n")
    const again = splitShared(root, { allowDirty: true })
    expect(again.moved).toEqual(["detect.ts -> packages/host/src/detect.ts"])
    expect(read(root, "apps/cli/src/c.ts")).toBe(`import { key } from "@cello/domain/taskKey"\nimport { link } from "@cello/text/linkify"\n`)
    expect(JSON.parse(read(root, "apps/cli/package.json")).dependencies).toEqual({ "@cello/client": "workspace:*", "@cello/domain": "workspace:*", "@cello/text": "workspace:*" })
    expect(fs.existsSync(path.join(root, "packages/shared"))).toBe(false)
  })

  it("stops before changing anything when a module isn't in the map", () => {
    const root = repo()
    write(root, "packages/shared/src/brandNew.ts", "export const x = 1\n")
    expect(() => splitShared(root, { allowDirty: true })).toThrow("brandNew.ts")
    expect(fs.existsSync(path.join(root, "packages/shared/src/taskKey.ts"))).toBe(true)
  })
})
