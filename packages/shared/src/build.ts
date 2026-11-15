// Which build of Cello is running (CEL-37): the stamp a web build carries, what an open tab does when
// the server it reconnects to serves a different one, and the one line the sidebar shows.
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
