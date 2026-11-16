// Which Cello server the app uses, decided from what a launch finds. Pure, so it's tested without
// processes; sidecar.ts gathers the facts and carries the plan out.
//
// The rule (SPEC "Desktop app"): one server per data folder. The server writes `server.lock` with
// its pid and port before opening the database (apps/server/src/server/ServerLock.ts), so the app
// never starts a second one against a folder a live server holds; it joins that server instead.
import * as path from "node:path"
import { parsePlist } from "@cello/shared/launchAgent"

export const DEFAULT_PORT = 4747
/** The lock file `cello start` keeps in its data folder (apps/server/src/server/ServerLock.ts). */
export const LOCK_FILE = "server.lock"

export interface LockInfo {
  readonly pid: number
  readonly port: number
}

/** What a launch finds: does CELLO_PORT answer, and who holds the data folder's server lock. */
export interface ServerSurvey {
  readonly port: number
  readonly portAnswers: boolean
  /** `alive`: the pid still runs. `answers`: something answers on the lock's port. */
  readonly lock: (LockInfo & { readonly alive: boolean; readonly answers: boolean }) | null
  /** A background service is installed for this data folder (CEL-81, `cello service install`). */
  readonly service: boolean
}

export type ServerPlan =
  | { readonly kind: "join"; readonly url: string }
  | { readonly kind: "wait"; readonly url: string; readonly pid: number }
  | { readonly kind: "service"; readonly url: string }
  | { readonly kind: "start" }

export const serverUrl = (port: number): string => `http://127.0.0.1:${port}`

export const planServer = (survey: ServerSurvey): ServerPlan => {
  const holder = survey.lock?.alive ? survey.lock : null
  if (holder && holder.port > 0 && holder.answers) return { kind: "join", url: serverUrl(holder.port) }
  if (survey.portAnswers) return { kind: "join", url: serverUrl(survey.port) }
  if (holder) return { kind: "wait", url: serverUrl(holder.port > 0 ? holder.port : survey.port), pid: holder.pid }
  // With the service installed, a server of the app's own would hold the folder and keep the service out.
  if (survey.service) return { kind: "service", url: serverUrl(survey.port) }
  return { kind: "start" }
}

/** Same reading as the server's own: a lock without a numeric pid is no lock. */
export const parseLock = (text: string): LockInfo | null => {
  try {
    const info = JSON.parse(text) as Partial<LockInfo>
    return typeof info.pid === "number" ? { pid: info.pid, port: typeof info.port === "number" ? info.port : 0 } : null
  } catch {
    return null
  }
}

/** `cello start` prints "Cello is running at http://127.0.0.1:<port> (data in …)" once it listens. */
export const parseBanner = (output: string): string | null =>
  /Cello is running at (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] ?? null

/** `cello start` refuses a data folder another live server holds (ServerAlreadyRunning). */
export const isAlreadyRunning = (stderr: string): boolean => stderr.includes("Cello is already running for")

type Env = Readonly<Record<string, string | undefined>>

/** The port and data folder `cello start` would use: CELLO_PORT or 4747, CELLO_DATA_DIR or ~/.cello. */
export const serverConfig = (env: Env): { port: number; dataDir: string } => ({
  port: Number(env.CELLO_PORT || DEFAULT_PORT),
  dataDir: path.resolve(env.CELLO_DATA_DIR || path.join(env.HOME ?? "", ".cello")),
})

/** The `cello` binary to start: CELLO_BIN, else the one bundled in the app, else the repo's build. */
export const celloCommand = (options: {
  readonly env: Env
  readonly isPackaged: boolean
  readonly resourcesPath: string
  readonly repoRoot: string
  readonly exists: (file: string) => boolean
}): string | null => {
  if (options.env.CELLO_BIN) return options.env.CELLO_BIN
  if (options.isPackaged) return path.join(options.resourcesPath, "cello")
  const built = path.join(options.repoRoot, "apps/cli/dist/cello")
  return options.exists(built) ? built : null
}

/** Whether an installed plist (its text, null when there's none) is the background service for `dataDir`. */
export const serviceFor = (plist: string | null, dataDir: string): boolean => {
  const installed = plist === null ? null : parsePlist(plist)
  return installed?.dataDir != null && path.resolve(installed.dataDir) === path.resolve(dataDir)
}

/**
 * The `cello` that installs the background service from the quit question: the one Lucas runs (CELLO_BIN,
 * else `cello` in CELLO_BIN_DIR or ~/.local/bin, which links to the repo build), else the app's own. The
 * service runs whichever binary installs it.
 */
export const serviceInstaller = (options: {
  readonly env: Env
  readonly exists: (file: string) => boolean
  readonly fallback: string | null
}): string | null => {
  if (options.env.CELLO_BIN) return options.env.CELLO_BIN
  const linked = path.join(options.env.CELLO_BIN_DIR || path.join(options.env.HOME ?? "", ".local/bin"), "cello")
  return options.exists(linked) ? linked : options.fallback
}
