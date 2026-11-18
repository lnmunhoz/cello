// Who may import what in the repo (CEL-18). The rules are read from the code itself, so a boundary that only
// exists in a diagram can't drift: scripts/boundaries.test.ts runs them over the whole tree, and
// scripts/split-shared.ts reads imports the same way to write each package's dependencies.
//
// Packages (packages/<name>, imported as @cello/<name>):
//   domain   the board's rules. Pure: effect and fractional-indexing, no node:, no other @cello package.
//   text     markdown, diffs, links, redaction. Pure; may import domain.
//   release  builds, versions, update channels. Pure; may import domain.
//   host     Node and macOS only (server lock, launchd, log rotation). The web app never imports it.

import * as fs from "node:fs"
import * as path from "node:path"

export interface Violation {
  readonly file: string
  readonly rule: string
  readonly message: string
}

/** Directories no code of ours lives in. */
const SKIPPED_DIRS = new Set(["node_modules", "dist", "dist-electron", "test-results", "playwright-report", ".cello", ".git", ".claude", "evidence"])
/** Where code lives: every package and app, plus the repo's e2e specs and scripts. */
const ROOTS = ["packages", "apps", "e2e", "scripts"]
const SOURCE = /\.(?:ts|tsx|mts|cts)$/
const TEST = /\.test\.tsx?$/

/** Files that write imports as text (the rules' own fixtures, the split script's map), not as code. */
const TALKS_ABOUT_IMPORTS = new Set(["scripts/boundaries.test.ts", "scripts/split-shared.ts", "scripts/split-shared.test.ts"])

const walk = (dir: string, into: string[]): void => {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) walk(path.join(dir, entry.name), into)
    } else if (SOURCE.test(entry.name)) into.push(path.join(dir, entry.name))
  }
}

/** Every source file under packages, apps, e2e and scripts, as paths relative to `root` with `/`. */
export const sourceFiles = (root: string): ReadonlyArray<string> => {
  const found: string[] = []
  for (const top of ROOTS) walk(path.join(root, top), found)
  return found
    .map((file) => path.relative(root, file).split(path.sep).join("/"))
    .filter((file) => !TALKS_ABOUT_IMPORTS.has(file))
    .sort()
}

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(["'])([^"'\n]+)\1/g

/** The module names a file imports (`from "x"`, `import "x"`, `import("x")`, `require("x")`), comments left out. */
export const importsOf = (source: string): ReadonlyArray<string> => {
  const found: string[] = []
  for (const line of source.split("\n")) {
    const trimmed = line.trimStart()
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue
    for (const match of line.matchAll(SPECIFIER)) {
      if (!insideString(line.slice(0, match.index))) found.push(match[2]!)
    }
  }
  return found
}

/** An import written inside a string (a test's fixture) has an open quote before it; a real one doesn't. */
const insideString = (before: string): boolean => ["\"", "'", "`"].some((quote) => before.split(`\\${quote}`).join("").split(quote).length % 2 === 0)

/** The package or app a file belongs to: `packages/domain/src/x.ts` is "packages/domain". Null for e2e and scripts. */
export const ownerOf = (file: string): string | null => {
  const match = /^(packages|apps)\/([^/]+)\//.exec(file)
  return match ? `${match[1]}/${match[2]}` : null
}

/** `@cello/domain/taskKey` is "@cello/domain"; anything else is null. */
export const celloPackageOf = (specifier: string): string | null => {
  const match = /^(@cello\/[^/]+)/.exec(specifier)
  return match ? match[1]! : null
}

/** `effect/Effect` is "effect", `@effect/vitest` stays whole. */
const externalName = (specifier: string): string => (specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]!)

/** What a file may import from outside the repo, by the package it sits in. Null means no rule. */
const PURE_ALLOWED: Readonly<Record<string, { readonly external: ReadonlyArray<string>; readonly cello: ReadonlyArray<string> }>> = {
  "packages/domain": { external: ["effect", "fractional-indexing"], cello: [] },
  "packages/text": { external: ["effect"], cello: ["@cello/domain"] },
  "packages/release": { external: ["effect"], cello: ["@cello/domain"] },
}
/** Only tests may use these, as the test runner. */
const TEST_ONLY = new Set(["vitest", "@effect/vitest"])

const isNode = (specifier: string): boolean => specifier.startsWith("node:")

const dependenciesOf = (root: string, owner: string): ReadonlySet<string> => {
  const file = path.join(root, owner, "package.json")
  if (!fs.existsSync(file)) return new Set()
  const json = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, Record<string, string> | undefined>
  return new Set([...Object.keys(json["dependencies"] ?? {}), ...Object.keys(json["devDependencies"] ?? {}), ...Object.keys(json["peerDependencies"] ?? {})])
}

/** Every import in the tree that breaks a rule, in file order. Empty means the boundaries hold. */
export const checkBoundaries = (root: string): ReadonlyArray<Violation> => {
  const violations: Violation[] = []
  const declared = new Map<string, ReadonlySet<string>>()
  for (const file of sourceFiles(root)) {
    const owner = ownerOf(file)
    const isTest = TEST.test(file)
    const add = (rule: string, message: string) => violations.push({ file, rule, message })
    for (const specifier of importsOf(fs.readFileSync(path.join(root, file), "utf8"))) {
      const cello = celloPackageOf(specifier)

      // 5. @cello/shared is gone, with no shim.
      if (cello === "@cello/shared") add("no-shared", `imports ${specifier}: @cello/shared no longer exists`)

      // 1. The web app and the client run in a browser: no @cello/host, no node:.
      if ((owner === "apps/web" || owner === "packages/client") && !isTest && file.includes("/src/")) {
        if (cello === "@cello/host") add("browser-no-host", `imports ${specifier}: ${owner} runs in a browser, @cello/host is Node and macOS only`)
        if (isNode(specifier)) add("browser-no-node", `imports ${specifier}: ${owner} runs in a browser`)
      }

      // 2, 3 and 6. The pure packages: domain imports nothing of ours, text and release only domain, and none touch node:.
      const pure = owner === null ? undefined : PURE_ALLOWED[owner]
      if (owner !== null && pure !== undefined && !specifier.startsWith(".")) {
        if (isNode(specifier)) add("pure-no-node", `imports ${specifier}: ${owner} stays free of Node so the browser can import it`)
        else if (cello !== null) {
          if (!pure.cello.includes(cello)) add("pure-imports", `imports ${cello}: ${owner} may import ${pure.cello.length === 0 ? "no @cello package" : pure.cello.join(", ")}`)
        } else if (!(isTest && TEST_ONLY.has(externalName(specifier))) && !pure.external.includes(externalName(specifier))) {
          add("pure-imports", `imports ${specifier}: ${owner} may import only ${pure.external.join(" and ")}`)
        }
      }

      // 4. A package imports only the @cello packages its package.json lists.
      if (owner !== null && cello !== null && cello !== "@cello/shared" && cello !== `@cello/${owner.split("/")[1]}`) {
        if (!declared.has(owner)) declared.set(owner, dependenciesOf(root, owner))
        if (!declared.get(owner)!.has(cello)) add("undeclared", `imports ${cello} but ${owner}/package.json doesn't list it`)
      }
    }
  }
  return violations
}
