// What `cello init` reads for detection (CEL-89): the repo's marker files, package.json files (the
// root's and its workspace members') and a few config files, and what this machine has (ffmpeg, Docker,
// Playwright's browsers). The judging happens in @cello/shared/detect, over these facts.
import * as fs from "node:fs"
import * as path from "node:path"
import { CONFIG_FILES, type MachineFacts, MARKER_FILES, type PackageJson, type RepoFacts } from "@cello/shared/detect"
import type { Env } from "./identity.ts"

const readJson = (file: string): PackageJson | null => {
  try {
    const json = JSON.parse(fs.readFileSync(file, "utf8"))
    return typeof json === "object" && json !== null ? json : null
  } catch {
    return null
  }
}

/** The workspace patterns package.json (or pnpm-workspace.yaml) lists: "apps/*", "packages/shared". */
const workspacePatterns = (root: string, json: PackageJson | null): string[] => {
  const declared = json?.workspaces
  const list = Array.isArray(declared)
    ? declared
    : typeof declared === "object" && declared !== null && Array.isArray((declared as { packages?: unknown }).packages)
    ? (declared as { packages: unknown[] }).packages
    : []
  const pnpm = path.join(root, "pnpm-workspace.yaml")
  const fromPnpm = fs.existsSync(pnpm)
    ? [...fs.readFileSync(pnpm, "utf8").matchAll(/^\s*-\s*["']?([^"'\n#]+?)["']?\s*$/gm)].map((m) => m[1]!)
    : []
  return [...list, ...fromPnpm].filter((p): p is string => typeof p === "string" && !p.startsWith("!"))
}

/** Member folders for patterns of the form "dir/*" or "dir/name", relative to the root. */
const memberDirs = (root: string, patterns: ReadonlyArray<string>): string[] =>
  patterns.flatMap((pattern) => {
    const clean = pattern.replace(/\/+$/, "")
    if (!clean.endsWith("/*")) return [clean]
    const parent = clean.slice(0, -2)
    try {
      return fs.readdirSync(path.join(root, parent), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `${parent}/${d.name}`).sort()
    } catch {
      return []
    }
  })

export const readRepoFacts = (root: string): RepoFacts => {
  const rootJson = readJson(path.join(root, "package.json"))
  const members = memberDirs(root, workspacePatterns(root, rootJson)).filter((dir) => fs.existsSync(path.join(root, dir, "package.json")))
  const paths: string[] = []
  const texts: Record<string, string> = {}
  const packages: Array<{ path: string; json: PackageJson }> = []
  for (const dir of ["", ...members]) {
    const rel = (name: string) => (dir ? `${dir}/${name}` : name)
    for (const name of new Set([...MARKER_FILES, ...CONFIG_FILES])) {
      const file = path.join(root, rel(name))
      if (!fs.existsSync(file)) continue
      paths.push(rel(name))
      if (CONFIG_FILES.includes(name) && fs.statSync(file).isFile()) texts[rel(name)] = fs.readFileSync(file, "utf8")
    }
    const json = readJson(path.join(root, rel("package.json")))
    if (json) packages.push({ path: rel("package.json"), json })
  }
  return { paths, packages, texts }
}

const hasEntries = (dir: string) => {
  try {
    return fs.readdirSync(dir).some((name) => !name.startsWith("."))
  } catch {
    return false
  }
}

/** Tools on PATH, and Playwright's browser cache (PLAYWRIGHT_BROWSERS_PATH, else the platform's default folder). */
export const machineFacts = (env: Env, platform: NodeJS.Platform = process.platform): MachineFacts => {
  const on = (tool: string) => Bun.which(tool, { PATH: env.PATH ?? "" }) !== null
  const cache = env.PLAYWRIGHT_BROWSERS_PATH
    ?? (env.HOME ? path.join(env.HOME, ...(platform === "darwin" ? ["Library", "Caches"] : [".cache"]), "ms-playwright") : null)
  return { ffmpeg: on("ffmpeg"), docker: on("docker"), playwrightBrowsers: cache !== null && hasEntries(cache) }
}
