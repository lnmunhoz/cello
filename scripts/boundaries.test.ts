import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { checkBoundaries, importsOf, ownerOf } from "./boundaries.ts"

const repoRoot = path.resolve(import.meta.dirname, "..")

/** A throwaway tree: `files` maps a path to its content. */
const tree = (files: Record<string, string>): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cello-boundaries-"))
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), content)
  }
  return root
}
const pkg = (deps: ReadonlyArray<string>): string => JSON.stringify({ dependencies: Object.fromEntries(deps.map((name) => [name, "workspace:*"])) })

const rulesOf = (files: Record<string, string>): ReadonlyArray<string> => checkBoundaries(tree(files)).map((violation) => `${violation.file} ${violation.rule}`)

describe("importsOf", () => {
  it("reads from, side-effect, type-only, dynamic and require imports, and skips comments and strings", () => {
    const source = [
      `import { a } from "@cello/domain/ask"`,
      `import type { B } from "./b.ts"`,
      `import "./side.css"`,
      `const c = await import("node:fs")`,
      `const d = require("effect")`,
      `export { e } from "../e.ts"`,
      `export type { F } from "../f.ts"`,
      `// import { x } from "@cello/shared/commented"`,
      `/**`,
      ` * import { y } from "@cello/shared/doc"`,
      ` */`,
      "const fixture = `import { _electron } from \"@playwright/test\"`",
      `const other = 'from "@cello/shared/quoted"'`,
    ].join("\n")
    expect([...importsOf(source)].sort()).toEqual(["../e.ts", "../f.ts", "./b.ts", "./side.css", "@cello/domain/ask", "effect", "node:fs"])
  })

  it("finds imports the line-by-line reading missed", () => {
    const source = [
      `const next = await import(`,
      `  "next-line"`,
      `)`,
      "const template = await import(`template-specifier`)",
      `const text = "it's"; const afterApostrophe = await import("after-apostrophe")`,
      `/* a comment */ const afterComment = await import("after-comment")`,
      `import type {`,
      `  Many,`,
      `  Names,`,
      `} from "multi-line-type"`,
      `import {`,
      `  Value`,
      `} from`,
      `  "from-on-next-line"`,
    ].join("\n")
    expect([...importsOf(source)].sort()).toEqual(["after-apostrophe", "after-comment", "from-on-next-line", "multi-line-type", "next-line", "template-specifier"])
  })

  it("doesn't count text that only looks like an import", () => {
    const source = [
      "const a = `import { x } from \"in-template\"`",
      `const b = "import('in-string')"`,
      `const c = 'require("in-quotes")'`,
      `/* import { y } from "in-block-comment" */`,
      `export const d = "not-a-specifier"`,
    ].join("\n")
    expect(importsOf(source)).toEqual([])
  })

  it("reads JSX files", () => {
    expect(importsOf(`import { A } from "a"\nexport const x = <A prop="b">don't</A>\n`, "x.tsx")).toEqual(["a"])
  })
})

describe("ownerOf", () => {
  it("names the package or app, and nothing for e2e and scripts", () => {
    expect(ownerOf("packages/domain/src/ask.ts")).toBe("packages/domain")
    expect(ownerOf("apps/web/src/main.tsx")).toBe("apps/web")
    expect(ownerOf("e2e/board.spec.ts")).toBeNull()
  })
})

describe("the boundary rules, on small trees", () => {
  it("1: the web app and the client may not import @cello/host or node:", () => {
    expect(
      rulesOf({
        "apps/web/package.json": pkg(["@cello/host"]),
        "apps/web/src/a.ts": `import { lock } from "@cello/host/serverLock"\nimport * as fs from "node:fs"\n`,
        "packages/client/package.json": pkg([]),
        "packages/client/src/b.ts": `import * as path from "node:path"\n`,
      }),
    ).toEqual(["apps/web/src/a.ts browser-no-host", "apps/web/src/a.ts browser-no-node", "packages/client/src/b.ts browser-no-node"])
  })

  // A violation hides in any way of importing, not only `import x from "y"`.
  const FORMS: ReadonlyArray<readonly [string, (specifier: string) => string]> = [
    ["a dynamic import()", (x) => `const m = await import("${x}")\n`],
    ["a dynamic import() on the next line", (x) => `const m = await import(\n  "${x}"\n)\n`],
    ["require()", (x) => `const m = require("${x}")\n`],
    ["export ... from", (x) => `export { m } from "${x}"\n`],
    ["a side-effect import", (x) => `import "${x}"\n`],
    ["a type-only import", (x) => `import type { M } from "${x}"\n`],
    ["an import after a string with an apostrophe", (x) => `const s = "it's"; const m = await import("${x}")\n`],
  ]

  it.each(FORMS)("1: the web app can't import @cello/host or node: with %s", (_, form) => {
    expect(rulesOf({ "apps/web/package.json": pkg(["@cello/host"]), "apps/web/src/a.ts": form("@cello/host/serverLock") })).toEqual(["apps/web/src/a.ts browser-no-host"])
    expect(rulesOf({ "apps/web/package.json": pkg([]), "apps/web/src/a.ts": form("node:fs") })).toEqual(["apps/web/src/a.ts browser-no-node"])
  })

  it.each(FORMS)("2: domain can't import a @cello package, node: or another library with %s", (_, form) => {
    expect(rulesOf({ "packages/domain/package.json": pkg(["@cello/text"]), "packages/domain/src/a.ts": form("@cello/text/words") })).toEqual(["packages/domain/src/a.ts pure-imports"])
    expect(rulesOf({ "packages/domain/package.json": pkg([]), "packages/domain/src/a.ts": form("node:fs") })).toEqual(["packages/domain/src/a.ts pure-no-node"])
    expect(rulesOf({ "packages/domain/package.json": pkg([]), "packages/domain/src/a.ts": form("react") })).toEqual(["packages/domain/src/a.ts pure-imports"])
  })

  it("1: a web test may read files with node:", () => {
    expect(rulesOf({ "apps/web/package.json": pkg([]), "apps/web/src/a.test.ts": `import * as fs from "node:fs"\n` })).toEqual([])
  })

  it("2: domain imports only effect and fractional-indexing, and no @cello package", () => {
    expect(
      rulesOf({
        "packages/domain/package.json": pkg(["@cello/text"]),
        "packages/domain/src/a.ts": `import * as Schema from "effect/Schema"\nimport { generateKeyBetween } from "fractional-indexing"\nimport { b } from "./b.ts"\n`,
        "packages/domain/src/b.ts": `import { words } from "@cello/text/words"\nimport React from "react"\nimport * as fs from "node:fs"\n`,
        "packages/domain/src/b.test.ts": `import { describe } from "vitest"\nimport { it } from "@effect/vitest"\n`,
      }),
    ).toEqual(["packages/domain/src/b.ts pure-imports", "packages/domain/src/b.ts pure-imports", "packages/domain/src/b.ts pure-no-node"])
  })

  it("3: text imports no @cello package except domain", () => {
    expect(
      rulesOf({
        "packages/text/package.json": pkg(["@cello/domain", "@cello/release"]),
        "packages/text/src/a.ts": `import { taskKey } from "@cello/domain/taskKey"\nimport { flavor } from "@cello/release/flavor"\n`,
      }),
    ).toEqual(["packages/text/src/a.ts pure-imports"])
  })

  it("4: a package imports only the @cello packages its package.json lists", () => {
    expect(
      rulesOf({
        "packages/client/package.json": pkg(["@cello/contract"]),
        "packages/client/src/a.ts": `import type { Task } from "@cello/contract/entities"\nimport { ask } from "@cello/domain/ask"\nimport { self } from "@cello/client/other"\n`,
      }),
    ).toEqual(["packages/client/src/a.ts undeclared"])
  })

  it("5: nothing imports @cello/shared", () => {
    expect(
      rulesOf({
        "apps/cli/package.json": pkg(["@cello/shared"]),
        "apps/cli/src/a.ts": `import { x } from "@cello/shared/ask"\n`,
        "scripts/b.ts": `import { y } from "@cello/shared/version"\n`,
        "e2e/c.spec.ts": `import { z } from "@cello/shared/diff.fixture"\n`,
      }),
    ).toEqual(["apps/cli/src/a.ts no-shared", "e2e/c.spec.ts no-shared", "scripts/b.ts no-shared"])
  })

  it("lets a host file use node: and every package import its own subpaths", () => {
    expect(rulesOf({ "packages/host/package.json": pkg([]), "packages/host/src/lock.ts": `import * as fs from "node:fs"\nimport { x } from "@cello/host/other"\n` })).toEqual([])
  })
})

describe("the repo", () => {
  it("keeps every boundary", () => {
    const violations = checkBoundaries(repoRoot).map((violation) => `${violation.file}: ${violation.message} (${violation.rule})`)
    expect(violations).toEqual([])
  })
})
