// `cello service` (CEL-81), the pure part: the launchctl steps for install, restart and uninstall,
// reading `launchctl print`, and the words each command prints. launchd.ts carries the steps out.
// The plist itself is packages/shared/src/launchAgent.ts, which the desktop app reads too.
import { SERVICE_LABEL } from "@cello/shared/launchAgent"
import { shortCommit } from "@cello/shared/build"
import { columns } from "./format.ts"

/** One `launchctl` call. An optional step's failure is ignored (unloading what isn't loaded, say). */
export interface Step {
  readonly what: string
  readonly args: ReadonlyArray<string>
  readonly optional: boolean
}

/** The service in the user's GUI session: gui/<uid>/dev.cello.server. */
export const serviceTarget = (uid: number): string => `gui/${uid}/${SERVICE_LABEL}`

export const installSteps = (uid: number, plist: string, options: { readonly loaded: boolean }): ReadonlyArray<Step> => [
  // launchd reads a plist when it's loaded, so a loaded one goes first.
  ...(options.loaded ? [{ what: "unloading the old service", args: ["bootout", serviceTarget(uid)], optional: true }] : []),
  // A `launchctl disable` left from before makes bootstrap refuse.
  { what: "clearing a disabled flag", args: ["enable", serviceTarget(uid)], optional: true },
  // Loading a RunAtLoad job starts it.
  { what: "loading the service", args: ["bootstrap", `gui/${uid}`, plist], optional: false },
]

/** -k kills the running server first, so launchd starts the binary afresh (a rebuilt one). */
export const restartSteps = (uid: number): ReadonlyArray<Step> => [
  { what: "restarting the service", args: ["kickstart", "-k", serviceTarget(uid)], optional: false },
]

export const uninstallSteps = (uid: number): ReadonlyArray<Step> => [
  { what: "unloading the service", args: ["bootout", serviceTarget(uid)], optional: true },
]

export const printArgs = (uid: number): ReadonlyArray<string> => ["print", serviceTarget(uid)]

/** What `launchctl print gui/<uid>/<label>` says about a loaded job. */
export interface JobState {
  readonly running: boolean
  readonly pid: number | null
  /** "(never exited)", "0", "78: EX_CONFIG"…; null when it doesn't say. */
  readonly lastExit: string | null
}

export const parsePrint = (text: string): JobState => {
  const field = (name: string) => new RegExp(`^\\s*${name} = (.+)$`, "m").exec(text)?.[1]?.trim() ?? null
  const pid = field("pid")
  return { running: field("state") === "running", pid: pid !== null && /^\d+$/.test(pid) ? Number(pid) : null, lastExit: field("last exit code") }
}

/**
 * The command that runs this `cello`, for the plist: the binary itself when compiled (Bun reports its
 * real path), else bun and the script.
 */
export const selfCommand = (process: { readonly execPath: string; readonly main: string }): ReadonlyArray<string> =>
  process.main.startsWith("/$bunfs/") ? [process.execPath] : [process.execPath, process.main]

/** The last `count` lines of a log. */
export const tailLines = (text: string, count: number): ReadonlyArray<string> => {
  const lines = text.split("\n")
  if (lines.at(-1) === "") lines.pop()
  return lines.slice(-count)
}

export interface Holder {
  readonly pid: number
  readonly port: number
}

/** What `cello service status` finds. */
export interface ServiceStatus {
  readonly installed: boolean
  readonly plist: string
  /** The command the plist runs; empty when it isn't installed. */
  readonly program: ReadonlyArray<string>
  /** Whether the program's executable (and script, from source) still exists. */
  readonly programExists: boolean
  readonly dataDir: string
  readonly port: number
  readonly logPath: string
  /** launchd knows the job (`launchctl print` found it). */
  readonly loaded: boolean
  readonly running: boolean
  readonly pid: number | null
  readonly lastExit: string | null
  /** What the server on `port` says it is; null when nothing answers. */
  readonly server: { readonly version: string; readonly commit: string | null } | null
  readonly logTail: ReadonlyArray<string>
  /** The live server holding the data folder's lock, whoever started it. */
  readonly holder: Holder | null
}

const serverUrl = (port: number) => `http://127.0.0.1:${port}`

const staleProgram = (program: ReadonlyArray<string>) =>
  `The service's program ${program.slice(0, -1).join(" ")} doesn't exist any more (the repo moved, or the build was deleted). ` +
  "Build it again, or run `cello service install` with the cello you want the service to run."

export const statusText = (status: ServiceStatus): string => {
  if (!status.installed) {
    return [
      "The background service isn't installed: nothing starts Cello at login, or again when it stops.",
      ...(status.holder
        ? [
          `A server is running for ${status.dataDir} (pid ${status.holder.pid}, ${serverUrl(status.holder.port)}), started by hand or by the desktop app.`,
        ]
        : []),
      "Install the service with `cello service install`.",
    ].join("\n")
  }
  const state = !status.loaded
    ? "installed, but not loaded in launchd (run `cello service install` again to load it)"
    : status.running
    ? `installed, running${status.pid !== null ? ` (pid ${status.pid})` : ""}`
    : `installed, not running${status.lastExit !== null ? ` (last exit code ${status.lastExit})` : ""}`
  const server = status.server
    ? `${serverUrl(status.port)} answers: Cello ${status.server.version} (build ${shortCommit(status.server.commit)})`
    : `${serverUrl(status.port)} doesn't answer`
  return [
    `Background service ${SERVICE_LABEL}: ${state}`,
    ...columns([
      ["program", status.program.join(" ")],
      ["data", status.dataDir],
      ["server", server],
      ["plist", status.plist],
      ["log", `${status.logPath}${status.logTail.length === 0 ? " (empty)" : ""}`],
    ]).map((line) => `  ${line}`),
    ...(status.programExists ? [] : [staleProgram(status.program)]),
    ...(status.logTail.length ? ["Last lines of the log:", ...status.logTail.map((line) => `  ${line}`)] : []),
  ].join("\n")
}

/** Why install won't take a data folder another server holds. */
export const refusalText = (dataDir: string, holder: Holder): string =>
  `Cello is already running for ${dataDir} (pid ${holder.pid}, ${serverUrl(holder.port)}), outside the service. ` +
  "Stop it first (Ctrl-C in its terminal, or quit the desktop app and pick Stop), or run `cello service install --replace` " +
  `to stop pid ${holder.pid} and install the service in its place.`

export interface Installed {
  readonly plist: string
  readonly program: ReadonlyArray<string>
  readonly dataDir: string
  readonly port: number
  readonly logPath: string
  /** The pid --replace stopped; null when it stopped none. */
  readonly replaced: number | null
  /** The service this install replaced; null when there was none. */
  readonly previous: { readonly program: ReadonlyArray<string>; readonly dataDir: string | null } | null
}

export const installText = (done: Installed): string => [
  ...(done.replaced !== null ? [`Stopped the server that held ${done.dataDir} (pid ${done.replaced}).`] : []),
  `Installed the background service ${SERVICE_LABEL}: it runs \`${done.program.join(" ")}\` now, at every login, and again whenever it stops.`,
  ...(done.previous
    ? [`It replaces the service that ran \`${done.previous.program.join(" ")}\`${done.previous.dataDir ? ` for ${done.previous.dataDir}` : ""}.`]
    : []),
  ...columns([
    ["data", done.dataDir],
    ["server", serverUrl(done.port)],
    ["plist", done.plist],
    ["log", done.logPath],
  ]).map((line) => `  ${line}`),
  "Check it with `cello service status`. After rebuilding cello, `cello service restart` runs the new build.",
].join("\n")
