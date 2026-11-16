// Cello's one version (CEL-36). The root package.json is the source of truth; a release writes the new
// version to every other place it lives: APP_VERSION in packages/shared/src/version.ts (what `cello
// --version`, the server's build and backup manifests report) and each workspace package.json that carries
// a "version" (apps/desktop's, which electron-builder stamps into Cello.app). version.test.ts checks they agree.
import * as fs from "node:fs"
import * as path from "node:path"

export type Increment = "patch" | "minor" | "major"

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/
const parse = (version: string) => {
  const match = SEMVER.exec(version)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

/** The version after `current`: `patch` (the default for a release), `minor`, `major`, or an exact newer version. */
export const nextVersion = (current: string, increment: string): string => {
  const now = parse(current)
  if (!now) throw new Error(`The current version "${current}" isn't a version like 1.2.3.`)
  const [major, minor, patch] = now as [number, number, number]
  if (increment === "patch") return `${major}.${minor}.${patch + 1}`
  if (increment === "minor") return `${major}.${minor + 1}.0`
  if (increment === "major") return `${major + 1}.0.0`
  const exact = parse(increment)
  if (!exact) throw new Error(`"${increment}" isn't an increment: use patch, minor, major or a version like 1.2.3.`)
  const isNewer = exact[0]! - major || exact[1]! - minor || exact[2]! - patch
  if (isNewer <= 0) throw new Error(`${increment} is not newer than ${current}.`)
  return exact.join(".")
}

const SHARED_VERSION = "packages/shared/src/version.ts"
const APP_VERSION = /(export const APP_VERSION = ")([^"]*)(")/

const PACKAGE_VERSION = /^(\s*"version":\s*")([^"]*)(")/m

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>

// The workspace package.json files, from the root's "workspaces" globs (each is `<dir>/*`).
const workspacePackages = (root: string): string[] => {
  const globs = (readJson(path.join(root, "package.json")).workspaces as string[] | undefined) ?? []
  return globs.flatMap((glob) => {
    const dir = glob.replace(/\/\*$/, "")
    const full = path.join(root, dir)
    if (!fs.existsSync(full)) return []
    return fs
      .readdirSync(full, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(full, entry.name, "package.json")))
      .map((entry) => `${dir}/${entry.name}/package.json`)
      .sort()
  })
}

const versionedPackages = (root: string) =>
  workspacePackages(root).filter((file) => typeof readJson(path.join(root, file)).version === "string")

const sharedVersion = (root: string): string => {
  const match = APP_VERSION.exec(fs.readFileSync(path.join(root, SHARED_VERSION), "utf8"))
  if (!match) throw new Error(`No APP_VERSION = "…" in ${SHARED_VERSION}.`)
  return match[2]!
}

/** Every place the version lives, the root package.json first. */
export const readVersions = (root: string): Array<{ file: string; version: string }> => [
  { file: "package.json", version: String(readJson(path.join(root, "package.json")).version) },
  { file: SHARED_VERSION, version: sharedVersion(root) },
  ...versionedPackages(root).map((file) => ({ file, version: String(readJson(path.join(root, file)).version) })),
]

/** The version the root package.json holds: the current release. */
export const currentVersion = (root: string): string => readVersions(root)[0]!.version

/** Writes `version` everywhere it lives; returns the files (written, or that a dry run would write). */
export const syncVersion = (root: string, version: string, options: { dryRun?: boolean } = {}): string[] => {
  if (!parse(version)) throw new Error(`"${version}" isn't a version like 1.2.3.`)
  sharedVersion(root) // refuses before anything is written
  const packages = ["package.json", ...versionedPackages(root)]
  const files = ["package.json", SHARED_VERSION, ...packages.slice(1)]
  if (options.dryRun) return files
  // Replaced in place, so each file keeps its own formatting; parsed back to be sure it was the top-level one.
  for (const file of packages) {
    const full = path.join(root, file)
    const text = fs.readFileSync(full, "utf8")
    if (!PACKAGE_VERSION.test(text)) throw new Error(`No "version" in ${file}.`)
    const updated = text.replace(PACKAGE_VERSION, `$1${version}$3`)
    if ((JSON.parse(updated) as { version?: unknown }).version !== version) throw new Error(`Couldn't set the version in ${file}.`)
    fs.writeFileSync(full, updated)
  }
  const shared = path.join(root, SHARED_VERSION)
  fs.writeFileSync(shared, fs.readFileSync(shared, "utf8").replace(APP_VERSION, `$1${version}$3`))
  return files
}
