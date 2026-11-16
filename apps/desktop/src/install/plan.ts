// What `bun run package -- --install` does after copying Cello.app to /Applications (CEL-75). Pure, so
// it's tested without touching LaunchServices or processes; scripts/package.ts gathers the facts and
// runs the plan.
//
// Every Cello.app on disk claims `cello://` (its Info.plist), and LaunchServices may hand a link to any
// copy it has registered. A build folder's copy (`apps/desktop/dist/mac-arm64/Cello.app`, in the repo or
// an agent's worktree) is registered as soon as Finder or a launch sees it, and once one of those runs an
// old build, `cello://open` links land in whatever that build did. So after installing, the build-folder
// copies are unregistered (never deleted) and /Applications' copy is registered again; and a Cello still
// running from a build folder, or started before the install, gets a line telling Lucas to reopen it.
import * as path from "node:path"

export const LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
export const INSTALLED_APP = "/Applications/Cello.app"
const APP_NAME = "Cello.app"
/** How deep under `apps/desktop/dist*` a packaged Cello.app sits (electron-builder: `dist/mac-arm64/Cello.app`). */
const MAX_DEPTH = 3

export interface DirEntry {
  readonly name: string
  readonly isDirectory: boolean
}

/** Lists a folder's entries; [] for a folder that isn't there. */
export type ReadDir = (dir: string) => readonly DirEntry[]

/** Each app bundle path in `lsregister -dump`, once (`path:   /Applications/Cello.app (0x186ec)`). */
export const parseRegisteredApps = (dump: string): string[] => {
  const apps = new Set<string>()
  for (const line of dump.split("\n")) {
    const match = /^path:\s+(.+?\.app)(?: \(0x[0-9a-f]+\))?\s*$/.exec(line)
    if (match?.[1]) apps.add(match[1])
  }
  return [...apps]
}

/** The checkouts `git worktree list --porcelain` names, the main one first. */
export const parseWorktreeList = (porcelain: string): string[] =>
  porcelain
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))

const worktreesDir = (mainRoot: string) => path.join(mainRoot, ".claude/worktrees")

/**
 * Where a build of the desktop app may sit: the repo, its git worktrees, and every folder in
 * `.claude/worktrees` (an agent's worktree git no longer lists still holds the build it packaged).
 */
export const checkoutRoots = (options: { readonly mainRoot: string; readonly worktrees: readonly string[]; readonly readDir: ReadDir }): string[] => {
  const folders = options
    .readDir(worktreesDir(options.mainRoot))
    .filter((entry) => entry.isDirectory)
    .map((entry) => path.join(worktreesDir(options.mainRoot), entry.name))
  return [...new Set([options.mainRoot, ...options.worktrees, ...folders])]
}

const desktopDir = (root: string) => path.join(root, "apps/desktop")

/** Each Cello.app on disk in a checkout's `apps/desktop/dist*` folders. It doesn't look inside app bundles. */
export const findBuildCopies = (roots: readonly string[], readDir: ReadDir): string[] => {
  const found: string[] = []
  const walk = (dir: string, depth: number) => {
    for (const entry of readDir(dir)) {
      if (!entry.isDirectory) continue
      const child = path.join(dir, entry.name)
      if (entry.name === APP_NAME) found.push(child)
      else if (!entry.name.endsWith(".app") && depth < MAX_DEPTH) walk(child, depth + 1)
    }
  }
  for (const root of roots) {
    for (const entry of readDir(desktopDir(root))) {
      if (entry.isDirectory && entry.name.startsWith("dist")) walk(path.join(desktopDir(root), entry.name), 1)
    }
  }
  return found
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// <checkout>/apps/desktop/dist*/…/Cello.app, for a known checkout or any folder in .claude/worktrees.
const buildCopyPattern = (mainRoot: string, roots: readonly string[]): RegExp => {
  const checkouts = [...roots.map(escape), `${escape(worktreesDir(mainRoot))}/[^/]+`]
  return new RegExp(`^(?:${checkouts.join("|")})/apps/desktop/dist[^/]*/(?:[^/]+/){0,${MAX_DEPTH - 1}}Cello\\.app$`)
}

/**
 * The copies to unregister: every build-folder Cello.app LaunchServices knows (`registered`, including
 * ones deleted since, which it keeps until told) or that is on disk, sorted, never the installed one.
 * Copies anywhere else (Downloads, another repo) are left alone.
 */
export const strayCopies = (options: {
  readonly mainRoot: string
  readonly roots: readonly string[]
  readonly registered: readonly string[]
  readonly onDisk: readonly string[]
  readonly installed: string
}): string[] => {
  const pattern = buildCopyPattern(options.mainRoot, options.roots)
  const strays = [...options.registered, ...options.onDisk].filter((app) => app !== options.installed && pattern.test(app))
  return [...new Set(strays)].sort()
}

/** `lsregister -u` for each stray copy, then `lsregister -f` for the installed app. */
export const lsregisterCommands = (strays: readonly string[], installed: string): string[][] => [
  ...strays.map((app) => [LSREGISTER, "-u", app]),
  [LSREGISTER, "-f", installed],
]

/** A running Cello main process (not one of its helpers). */
export interface CelloProcess {
  readonly pid: number
  /** The bundle it runs from, e.g. `/Applications/Cello.app`. */
  readonly app: string
  readonly startedAt: Date
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/**
 * Cello's main processes in `LC_ALL=C ps -axo pid=,lstart=,comm=` (comm: the executable's full path, without arguments), whose start time reads
 * `Sun Nov 15 17:54:22 2026` in local time. Helpers run `…/Cello Helper.app/…` and don't match.
 */
export const parseCelloProcesses = (ps: string): CelloProcess[] => {
  const processes: CelloProcess[] = []
  for (const line of ps.split("\n")) {
    const match = /^\s*(\d+)\s+\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})\s+(\/.*\/Cello\.app)\/Contents\/MacOS\/Cello\s*$/.exec(line)
    if (!match) continue
    const [, pid, month, day, hours, minutes, seconds, year, app] = match
    const monthIndex = MONTHS.indexOf(month!)
    if (monthIndex < 0) continue
    processes.push({
      pid: Number(pid),
      app: app!,
      startedAt: new Date(Number(year), monthIndex, Number(day), Number(hours), Number(minutes), Number(seconds)),
    })
  }
  return processes
}

const two = (n: number) => String(n).padStart(2, "0")
const localTime = (date: Date) =>
  `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`

/**
 * A line for each running Cello that won't run the build just installed: one from another copy, or
 * /Applications' copy started before the install began. The script prints them; it never quits Cello.
 */
export const outdatedWarnings = (options: { readonly processes: readonly CelloProcess[]; readonly installed: string; readonly installedAt: Date }): string[] =>
  options.processes.flatMap((process) => {
    if (process.app !== options.installed) {
      return [
        `Cello (pid ${process.pid}) is running from ${process.app}, not ${options.installed}. Quit it (⌘Q) and open ${options.installed}, so cello:// links reach the new build.`,
      ]
    }
    if (process.startedAt.getTime() < options.installedAt.getTime()) {
      return [
        `Cello (pid ${process.pid}) started at ${localTime(process.startedAt)}, before this install, so it still runs the old build. Quit it (⌘Q) and reopen ${options.installed}.`,
      ]
    }
    return []
  })
