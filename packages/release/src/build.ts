// Which build of Cello is running (CEL-37): the stamp a web build carries, what an open tab does when
// the server it reconnects to serves a different one, and the one line the sidebar shows. And the words
// of the build history (CEL-50), which the Builds page and `cello builds` share.
//
// A web build is stamped at `vite build` (apps/web/buildStamp.ts): the bundle knows its own stamp, and
// the same stamp goes into build.json next to index.html, which the server reads and reports. A tab
// compares the two each time it connects.

/** A web build: the app version, the git commit it was built from (null outside a checkout), and when. */
export interface BuildStamp {
  readonly version: string
  readonly commit: string | null
  readonly builtAt: number
}

export const sameBuild = (a: BuildStamp, b: BuildStamp): boolean =>
  a.version === b.version && a.commit === b.commit && a.builtAt === b.builtAt

/** "0.2.0+c602f25.1763230740000": names one build, to remember that a tab already reloaded for it. */
export const buildKey = (build: BuildStamp): string => `${build.version}+${build.commit ?? "dev"}.${build.builtAt}`

/**
 * - `none`: nothing to do
 * - `reload`: reload by itself, after a short notice
 * - `offer`: show "Cello was updated · Reload" and wait for a click
 */
export type ReloadAction = "none" | "offer" | "reload"

export interface ReloadInput {
  /** The build this tab was loaded with; null when it has no stamp. */
  readonly loaded: BuildStamp | null
  /** The web build the server serves now; null when it serves none (dev, where Vite serves the app). */
  readonly served: BuildStamp | null
  /** A text field has focus, or a draft holds text that a reload would lose. */
  readonly editing: boolean
  /** The `buildKey` this tab last reloaded by itself for, if any. */
  readonly reloadedFor: string | null
}

/**
 * What a tab does once it hears which build the server serves. A different build reloads by itself
 * unless something is being edited. If a reload for that build already happened and the tab still
 * runs another one (a cache in the way), it only offers, so it can never reload in a loop.
 */
export const reloadAction = ({ loaded, served, editing, reloadedFor }: ReloadInput): ReloadAction => {
  if (loaded === null || served === null || sameBuild(loaded, served)) return "none"
  if (editing || reloadedFor === buildKey(served)) return "offer"
  return "reload"
}

/** A build as the update notice lists it: what a recorded build (BuildRecord) has, or a web build stands in for one. */
export interface ListedBuild {
  /** Its number in the build history; null for a web build that isn't recorded. */
  readonly number: number | null
  readonly commit: string | null
  readonly webBuiltAt: number
  /** Commit subjects merged since the build before it, newest first. */
  readonly changes: ReadonlyArray<string>
}

/**
 * What reloading brings into a tab that runs `loaded` (CEL-148): every recorded build after it up to
 * the one the server serves, newest first. Builds are found by when their web app was built, since a
 * record's commit can be the server's own. `missed` when the loaded build isn't in `history` (never
 * recorded, or older than the page): then only the served build is listed. Without a record of the
 * served build (the history not loaded yet, or a server that couldn't record it), its web build's own
 * list of changes stands in.
 */
export const buildsSinceLoaded = <B extends ListedBuild>(input: {
  readonly loaded: BuildStamp
  readonly served: BuildStamp & { readonly changes: ReadonlyArray<string> }
  /** `builds.list`, newest first; null while it loads. */
  readonly history: ReadonlyArray<B> | null
}): { readonly builds: ReadonlyArray<B | ListedBuild>; readonly missed: boolean } => {
  const { loaded, served } = input
  const history = input.history ?? []
  const top = history.findIndex((b) => b.webBuiltAt === served.builtAt)
  if (top === -1) {
    return { builds: [{ number: null, commit: served.commit, webBuiltAt: served.builtAt, changes: served.changes }], missed: false }
  }
  const bottom = history.findIndex((b, i) => i > top && b.webBuiltAt === loaded.builtAt)
  return bottom === -1 ? { builds: [history[top]!], missed: true } : { builds: history.slice(top, bottom), missed: false }
}

/** The first 7 characters of a commit, or "dev" for a build made outside a git checkout. */
export const shortCommit = (commit: string | null): string => (commit ? commit.slice(0, 7) : "dev")

const pad = (n: number) => String(n).padStart(2, "0")

/** "18:19" in local time, or "Nov 14, 18:19" when that was another day than `now`. */
export const liveSince = (startedAt: number, now: number): string => {
  const at = new Date(startedAt)
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  return at.toDateString() === new Date(now).toDateString()
    ? time
    : `${at.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${time}`
}

export interface RunningBuild {
  readonly version: string
  readonly commit: string | null
  readonly startedAt: number
}

/** The line's two halves, for a narrow place that shows them on two lines: "Cello 0.2.0 · build c602f25", "live since 18:19". */
export const buildParts = (build: RunningBuild, now: number): { readonly name: string; readonly since: string } => ({
  name: `Cello ${build.version} · build ${shortCommit(build.commit)}`,
  since: `live since ${liveSince(build.startedAt, now)}`,
})

/** "Cello 0.2.0 · build c602f25 · live since 18:19" */
export const buildLine = (build: RunningBuild, now: number): string => {
  const { name, since } = buildParts(build, now)
  return `${name} · ${since}`
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** How long a build was live, in its two largest units: "under a minute", "45 min", "3 h 20 min", "2 d 4 h". */
export const liveFor = (ms: number): string => {
  if (ms < MINUTE) return "under a minute"
  const days = Math.floor(ms / DAY)
  const hours = Math.floor((ms % DAY) / HOUR)
  const minutes = Math.floor((ms % HOUR) / MINUTE)
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`
  return `${minutes} min`
}

const startOfDay = (ms: number): number => {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** The day a build went live, in local time: "Today", "Yesterday", "Tuesday, Nov 3", or "Wednesday, Dec 31, 2025" in another year. */
export const buildDay = (startedAt: number, now: number): string => {
  const day = startOfDay(startedAt)
  const today = startOfDay(now)
  if (day === today) return "Today"
  if (day === startOfDay(today - 1)) return "Yesterday"
  const at = new Date(startedAt)
  return at.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    ...(at.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }),
  })
}

/** Builds, newest first, in groups by the day each went live; the order within a day is kept. */
export const byDay = <B extends { readonly startedAt: number }>(
  builds: ReadonlyArray<B>,
  now: number,
): ReadonlyArray<{ readonly day: string; readonly builds: ReadonlyArray<B> }> => {
  const groups: Array<{ day: string; builds: B[] }> = []
  for (const build of builds) {
    const day = buildDay(build.startedAt, now)
    const last = groups.at(-1)
    if (last?.day === day) last.builds.push(build)
    else groups.push({ day, builds: [build] })
  }
  return groups
}
