// Splits packages/shared into @cello/domain, @cello/text, @cello/release and @cello/host, and moves agentMark
// into the web app (CEL-18). Run it from anywhere:
//
//   bun scripts/split-shared.ts
//
// It is safe to run again. On a tree that is already split it changes nothing; on a branch that still adds
// `@cello/shared/<x>` imports (or a new file in packages/shared/src) it moves and rewrites just those. Then run
// `bun install` so Bun links the new packages and rewrites bun.lock.
//
// What it does, in order:
//   1. `git mv`s every module in packages/shared/src, with its test and fixtures, to the package the MAP names.
//   2. Rewrites `./x` imports between moved files that now live in different packages to `@cello/<package>/x`.
//   3. Rewrites `@cello/shared/<x>` and `packages/shared/(src/)<x>` everywhere (source, tests, e2e, scripts, docs).
//   4. Writes each new package's package.json with the dependencies its files import (and adds missing ones later).
//   5. Swaps `@cello/shared` for the new packages a package or app imports in its package.json.
//   6. Deletes packages/shared once it holds no module, and lists any mention it could not rewrite.
// A module the MAP doesn't name stops the script before it changes anything: add it to the MAP.
//
// The map is the one place that says which package a module belongs to. scripts/boundaries.test.ts keeps it honest.

import * as fs from "node:fs"
import * as path from "node:path"
import { spawnSync } from "node:child_process"
import { celloPackageOf, importsOf, ownerOf, sourceFiles } from "./boundaries.ts"

/** Where each module goes. `web` means apps/web/src/lib: its only user is the web app. */
export const MAP = {
  // The board's rules: pure, effect and fractional-indexing only.
  domain: [
    "ask", "review", "claim", "status", "milestone", "position", "taskKey", "reaction", "presence", "testRun",
    "testingProfile", "comment", "session", "model", "origin", "color",
    // words: milestone's text, and the CLI's and web's history lines; no module in `text` needs it.
    "words",
    // desktopBoard: the board's Settings state and its switch command. Pure types and parsers the web app and the
    // desktop app share, so it can't live in `host`.
    "desktopBoard",
  ],
  // Markdown, diffs, links, search text, redaction.
  text: ["document", "diff", "diff.fixture", "linkify", "search", "attachment", "bytes", "redact", "toolSummary", "embed"],
  // Which build is running and which release a channel offers. celloLink is here, not in `text`, because the scheme
  // it builds links with depends on the build's flavor.
  release: ["build", "updates", "version", "flavor", "celloLink"],
  // Node and macOS only.
  host: ["detect", "launchAgent", "logRotation"],
  web: ["agentMark"],
} as const satisfies Record<string, ReadonlyArray<string>>

type Group = keyof typeof MAP
const PACKAGES = ["domain", "text", "release", "host"] as const
type PackageName = (typeof PACKAGES)[number]

/** The versions a new package's dependencies are written with (what packages/shared pinned). */
const EXTERNAL_VERSIONS: Readonly<Record<string, string>> = { effect: "4.1.4", "fractional-indexing": "4.0.0" }
/** Imports a package doesn't list: the test runner (the repo's root devDependency) and Bun's own modules. */
const UNLISTED = new Set(["vitest", "@effect/vitest", "bun", "bun:test", "bun:sqlite"])

const WEB_DIR = "apps/web/src/lib"
interface Target {
  readonly group: Group
  /** Repo-relative folder the module's files live in. */
  readonly dir: string
}
const TARGETS = new Map<string, Target>()
for (const group of Object.keys(MAP) as Group[]) {
  for (const name of MAP[group]) TARGETS.set(name, { group, dir: group === "web" ? WEB_DIR : `packages/${group}/src` })
}

const importPath = (name: string, group: Group): string => (group === "web" ? `${WEB_DIR}/${name}` : `@cello/${group}/${name}`)

/** Files whose text talks about the old paths on purpose, or is history. */
const NOT_REWRITTEN = new Set(["scripts/split-shared.ts", "scripts/split-shared.test.ts", "scripts/boundaries.test.ts", "scripts/boundaries.ts", "CHANGELOG.md", "bun.lock"])
const TEXT_FILE = /\.(?:ts|tsx|mts|cts|js|mjs|cjs|json|md|css|html|yml|yaml|sh|txt)$/

// Longest names first, so `diff.fixture` wins over `diff` and `testingProfile` over `testRun`'s prefix.
const NAMES = [...TARGETS.keys()].sort((a, b) => b.length - a.length).map((name) => name.replace(/\./g, "\\."))
const NAME = `(${NAMES.join("|")})(?![A-Za-z0-9])`
const QUOTED_AGENT_MARK = /(["'])@cello\/shared\/agentMark\1/g
const PACKAGE_SPECIFIER = new RegExp(`@cello/shared/${NAME}`, "g")
const PATH_MENTION = new RegExp(`packages/shared/(?:src/)?${NAME}`, "g")
/** `../../../art/icon/…` from packages/shared/src is one folder deeper from apps/web/src/lib. */
const ART_URL = /(`)\.\.\/\.\.\/\.\.\/art\/icon\//g

/** The new text of `text`, a file at repo-relative `file`, with every old path and import rewritten. */
export const rewriteText = (text: string, file: string): string => {
  let out = text.replace(QUOTED_AGENT_MARK, (_, quote: string) => {
    const relative = path.posix.relative(path.posix.dirname(file), `${WEB_DIR}/agentMark.ts`)
    return `${quote}${relative.startsWith(".") ? relative : `./${relative}`}${quote}`
  })
  out = out.replace(PACKAGE_SPECIFIER, (_, name: string) => importPath(name, TARGETS.get(name)!.group))
  out = out.replace(PATH_MENTION, (_, name: string) => `${TARGETS.get(name)!.dir}/${name}`)
  if (file === `${WEB_DIR}/agentMark.test.ts`) out = out.replace(ART_URL, "$1../../../../art/icon/")
  return out
}

const RELATIVE_IMPORT = /(from\s*|import\s*\(?\s*)(["'])\.\/([A-Za-z.]+?)(?:\.ts)?\2/g

/** A moved file's `./x` imports of modules that now live in another package become `@cello/<package>/x`. */
export const rewriteRelativeImports = (text: string, file: string): string => {
  const own = ownerOf(file)
  return text.replace(RELATIVE_IMPORT, (whole, lead: string, quote: string, name: string) => {
    const target = TARGETS.get(name)
    if (target === undefined || own === null || target.group === "web" || own === `packages/${target.group}`) return whole
    return `${lead}${quote}@cello/${target.group}/${name}${quote}`
  })
}

// ---------------------------------------------------------------------------------------------------------------------

export interface Report {
  moved: string[]
  rewritten: string[]
  packageJson: string[]
  removed: string[]
  leftovers: string[]
}

const git = (root: string, args: ReadonlyArray<string>): string => {
  const run = spawnSync("git", args, { cwd: root, encoding: "utf8" })
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr}`)
  return run.stdout
}

const trackedAndNewFiles = (root: string): ReadonlyArray<string> =>
  git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    .split("\0")
    .filter((file) => file !== "" && fs.existsSync(path.join(root, file)))

const writeIfChanged = (root: string, file: string, content: string): boolean => {
  const full = path.join(root, file)
  if (fs.existsSync(full) && fs.readFileSync(full, "utf8") === content) return false
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
  return true
}

/** Which module a file in packages/shared/src is: `ask.test.ts` and `ask.ts` are both `ask`; `diff.fixture.ts` is `diff.fixture`. */
const moduleOfFile = (file: string): string => file.replace(/\.test\.ts$/, "").replace(/\.ts$/, "")

const moveModules = (root: string, report: Report): void => {
  const sourceDir = path.join(root, "packages/shared/src")
  if (!fs.existsSync(sourceDir)) return
  const files = fs.readdirSync(sourceDir).filter((file) => fs.statSync(path.join(sourceDir, file)).isFile())
  const unmapped = files.filter((file) => !TARGETS.has(moduleOfFile(file)))
  if (unmapped.length > 0) throw new Error(`packages/shared/src has files the MAP in scripts/split-shared.ts doesn't name: ${unmapped.join(", ")}. Add each module to the package it belongs to.`)
  const clashes = files.filter((file) => fs.existsSync(path.join(root, TARGETS.get(moduleOfFile(file))!.dir, file)))
  if (clashes.length > 0) throw new Error(`These files exist both in packages/shared/src and where the MAP sends them: ${clashes.join(", ")}. Resolve by hand.`)
  for (const file of files) {
    const to = `${TARGETS.get(moduleOfFile(file))!.dir}/${file}`
    fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true })
    git(root, ["mv", `packages/shared/src/${file}`, to])
    report.moved.push(`${file} -> ${to}`)
  }
}

const rewriteEverything = (root: string, report: Report): void => {
  for (const file of trackedAndNewFiles(root)) {
    if (NOT_REWRITTEN.has(file) || !TEXT_FILE.test(file) || file.endsWith("/package.json") || file === "package.json") continue
    const before = fs.readFileSync(path.join(root, file), "utf8")
    let after = rewriteText(before, file)
    if (/^packages\/(?:domain|text|release|host)\/src\//.test(file)) after = rewriteRelativeImports(after, file)
    if (after !== before) {
      fs.writeFileSync(path.join(root, file), after)
      report.rewritten.push(file)
    }
  }
}

// --- package.json -----------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>
const readJson = (root: string, file: string): Json | null => {
  const full = path.join(root, file)
  return fs.existsSync(full) ? (JSON.parse(fs.readFileSync(full, "utf8")) as Json) : null
}
const sortedObject = (value: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
const stringify = (json: Json): string => `${JSON.stringify(json, null, 2)}\n`

const externalName = (specifier: string): string => (specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]!)

/** What each package or app imports, by owner (`packages/text`): the @cello packages and the outside ones. */
const importsByOwner = (root: string): Map<string, { cello: Set<string>; external: Set<string> }> => {
  const byOwner = new Map<string, { cello: Set<string>; external: Set<string> }>()
  for (const file of sourceFiles(root)) {
    const owner = ownerOf(file)
    if (owner === null) continue
    const entry = byOwner.get(owner) ?? { cello: new Set<string>(), external: new Set<string>() }
    byOwner.set(owner, entry)
    for (const specifier of importsOf(fs.readFileSync(path.join(root, file), "utf8"))) {
      const cello = celloPackageOf(specifier)
      if (cello !== null) entry.cello.add(cello)
      else if (!specifier.startsWith(".") && !specifier.startsWith("node:")) entry.external.add(externalName(specifier))
    }
  }
  return byOwner
}

const newPackageJson = (name: PackageName): Json => ({
  name: `@cello/${name}`,
  private: true,
  type: "module",
  exports: { "./*": "./src/*.ts" },
})

const writePackageJsons = (root: string, report: Report): void => {
  const imports = importsByOwner(root)
  const newPackages = new Set(PACKAGES.map((name) => `@cello/${name}`))
  for (const owner of imports.keys()) {
    const used = imports.get(owner)!
    const file = `${owner}/package.json`
    const isNew = PACKAGES.some((name) => owner === `packages/${name}`)
    let json = readJson(root, file)
    if (json === null) {
      if (!isNew) continue
      json = newPackageJson(owner.split("/")[1] as PackageName)
    }
    const dependencies = { ...((json["dependencies"] as Record<string, string> | undefined) ?? {}) }
    const devDependencies = { ...((json["devDependencies"] as Record<string, string> | undefined) ?? {}) }
    const listed = (name: string) => name in dependencies || name in devDependencies
    const own = `@cello/${owner.split("/")[1]}`

    // Where the old @cello/shared entry was, the new @cello packages go.
    const shared = "@cello/shared"
    const intoDev = shared in devDependencies || (!(shared in dependencies) && Object.keys(dependencies).every((name) => !name.startsWith("@cello/")) && Object.keys(devDependencies).some((name) => name.startsWith("@cello/")))
    delete dependencies[shared]
    delete devDependencies[shared]

    for (const name of [...used.cello].sort()) {
      if (!newPackages.has(name) || name === own || listed(name)) continue
      ;(intoDev ? devDependencies : dependencies)[name] = "workspace:*"
    }
    if (isNew) {
      for (const name of [...used.external].sort()) {
        if (UNLISTED.has(name) || listed(name)) continue
        const version = EXTERNAL_VERSIONS[name]
        if (version === undefined) throw new Error(`${owner} imports ${name}, which has no version in EXTERNAL_VERSIONS in scripts/split-shared.ts.`)
        dependencies[name] = version
      }
    }
    const next: Json = { ...json }
    if (Object.keys(dependencies).length > 0) next["dependencies"] = sortedObject(dependencies)
    else delete next["dependencies"]
    if (Object.keys(devDependencies).length > 0) next["devDependencies"] = sortedObject(devDependencies)
    else delete next["devDependencies"]
    if (writeIfChanged(root, file, stringify(next))) report.packageJson.push(file)
  }
}

// --- the end ----------------------------------------------------------------------------------------------------------

const removeShared = (root: string, report: Report): void => {
  const dir = path.join(root, "packages/shared")
  if (!fs.existsSync(dir)) return
  const src = path.join(dir, "src")
  if (fs.existsSync(src) && fs.readdirSync(src).length > 0) return
  if (fs.existsSync(path.join(dir, "package.json"))) git(root, ["rm", "-q", "-f", "packages/shared/package.json"])
  fs.rmSync(dir, { recursive: true, force: true })
  report.removed.push("packages/shared")
}

const findLeftovers = (root: string, report: Report): void => {
  for (const file of trackedAndNewFiles(root)) {
    if (NOT_REWRITTEN.has(file) || !TEXT_FILE.test(file)) continue
    fs.readFileSync(path.join(root, file), "utf8").split("\n").forEach((line, index) => {
      if (/@cello\/shared|packages\/shared/.test(line)) report.leftovers.push(`${file}:${index + 1}: ${line.trim().slice(0, 140)}`)
    })
  }
}

export const splitShared = (root: string): Report => {
  const report: Report = { moved: [], rewritten: [], packageJson: [], removed: [], leftovers: [] }
  moveModules(root, report)
  rewriteEverything(root, report)
  writePackageJsons(root, report)
  removeShared(root, report)
  findLeftovers(root, report)
  return report
}

if (import.meta.main) {
  const root = path.resolve(import.meta.dirname, "..")
  const report = splitShared(root)
  const line = (label: string, items: ReadonlyArray<string>) => console.log(`${label}: ${items.length}`)
  line("moved", report.moved)
  line("rewritten", report.rewritten)
  line("package.json written", report.packageJson)
  for (const item of report.packageJson) console.log(`  ${item}`)
  line("removed", report.removed)
  if (report.leftovers.length > 0) {
    console.log(`\nStill mentions packages/shared or @cello/shared (change by hand):`)
    for (const item of report.leftovers) console.log(`  ${item}`)
  }
  const changed = report.moved.length + report.rewritten.length + report.packageJson.length + report.removed.length
  console.log(changed === 0 ? "\nNothing to change." : "\nNow run `bun install`.")
}
