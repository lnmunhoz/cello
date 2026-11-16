// `cello service` (CEL-81), the pure part: the launchctl steps for install, restart and uninstall,
// reading `launchctl print`, and the words each command prints. launchd.ts carries the steps out.
// The plist itself is packages/shared/src/launchAgent.ts, which the desktop app reads too.
import { SERVICE_LABEL, serviceTarget } from "@cello/shared/launchAgent"
import { shortCommit } from "@cello/shared/build"
import { columns } from "./format.ts"

/** One `launchctl` call. An optional step's failure is ignored (unloading what isn't loaded, say). */
export interface Step {
  readonly what: string
  readonly args: ReadonlyArray<string>
  readonly optional: boolean
}

export const installSteps = (uid: number, plist: string, options: { readonly loaded: boolean }): ReadonlyArray<Step> => [
  // launchd reads a plist when it's loaded, so a loaded one goes first.
  ...(options.loaded ? [{ what: "unloading the old service", args: ["bootout", serviceTarget(uid)], optional: true }] : []),
  // A `launchctl disable` left from before makes bootstrap refuse.
  { what: "clearing a disabled flag", args: ["enable", serviceTarget(uid)], optional: true },
  // Loading a RunAtLoad job starts it.
  { what: "loading the service", args: ["bootstrap", `gui/${uid}`, plist], optional: false },
]

/** -k kills the running server first, so launchd starts the binary afresh (a rebuilt one). */
/**
 * A restart: SIGTERM to the running server through launchd (the server only shuts down cleanly on
 * SIGTERM; `kickstart -k` may SIGKILL it), and KeepAlive starts the program again. A job that isn't
 * running is started instead.
 */
export const restartSteps = (uid: number, options: { readonly running: boolean }): ReadonlyArray<Step> =>
  options.running
    ? [{ what: "stopping the service's server", args: ["kill", "SIGTERM", serviceTarget(uid)], optional: false }]
    : [{ what: "starting the service", args: ["kickstart", serviceTarget(uid)], optional: false }]

export const uninstallSteps = (uid: number): ReadonlyArray<Step> => [
  { what: "unloading the service", args: ["bootout", serviceTarget(uid)], optional: true },
]

export const printArgs = (uid: number): ReadonlyArray<string> => ["print", serviceTarget(uid)]

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

export const staleProgram = (program: ReadonlyArray<string>) =>
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

const lockFile = (dataDir: string) => `${dataDir}/server.lock`

/** A lock naming a pid that can't be another server (0, 1, negative, or the installer itself). */
export const invalidLockText = (dataDir: string, pid: number): string =>
  `${lockFile(dataDir)} names pid ${pid}, which can't be another Cello server, so nothing was stopped. ` +
  `If no Cello server runs for ${dataDir}, delete that file, then install again.`

/** A lock whose pid runs but isn't a Cello server answering on the lock's port: never signalled. */
export const staleLockText = (dataDir: string, holder: Holder): string =>
  `${lockFile(dataDir)} names pid ${holder.pid}, which is running but isn't a Cello server answering on ${serverUrl(holder.port)}: ` +
  "probably a lock left by a server that died, its pid since taken by another program. Nothing was stopped. " +
  `If no Cello server runs for ${dataDir}, delete that file, then install again.`

export interface ServiceConfig {
  readonly program: ReadonlyArray<string>
  readonly dataDir: string | null
  readonly port: number | null
}

/** Whether installing `next` would change what the installed service runs. */
export const sameService = (installed: ServiceConfig, next: ServiceConfig): boolean =>
  installed.dataDir === next.dataDir && installed.port === next.port && installed.program.join("\u0000") === next.program.join("\u0000")

/** Install refuses to replace a service that runs something else, unless --replace. */
export const otherServiceText = (installed: ServiceConfig, next: ServiceConfig): string =>
  `The background service already runs \`${installed.program.join(" ")}\` for ${installed.dataDir ?? "an unknown data folder"} on port ` +
  `${installed.port ?? "unknown"}. Installing would replace it with \`${next.program.join(" ")}\` for ${next.dataDir} on port ${next.port}. ` +
  "Run `cello service install --replace` to replace it."

/** A cello in a temp folder or a git worktree: the service would lose its program when it goes. */
export const isTemporaryPath = (file: string, tempDirs: ReadonlyArray<string>): boolean =>
  file.includes("/.claude/worktrees/") || tempDirs.some((dir) => file === dir || file.startsWith(dir.endsWith("/") ? dir : `${dir}/`))

export const temporaryText = (program: string): string =>
  `${program} is in a temp folder or a git worktree (.claude/worktrees/), which can disappear and leave the service with nothing to run. ` +
  "Install with the cello you keep (~/.local/bin/cello, the repo's apps/cli/dist/cello), or pass --temporary to install this one anyway."

/** Why an install failed, what state it left, and how to get Cello running again. */
export const failedInstallText = (failure: {
  readonly reason: string
  readonly dataDir: string
  /** A server for the data folder was stopped on the way (the old service's, or one --replace stopped). */
  readonly stopped: boolean
  /** The old plist was put back: and launchd loaded it again, or didn't. null when there was none. */
  readonly restored: "loaded" | "not loaded" | null
}): string => [
  `launchctl couldn't load the service: ${failure.reason}`,
  ...(failure.restored === "loaded" ? ["The old service's plist is back in place and running again."] : []),
  ...(failure.restored === "not loaded" ? ["The old service's plist is back in place, but launchd didn't load it either."] : []),
  ...(failure.restored !== "loaded" && failure.stopped
    ? [`The server for ${failure.dataDir} was stopped. Run \`cello start\` to use Cello now; \`cello service status\` and the log say why the service didn't load.`]
    : []),
  ...(failure.restored === null && !failure.stopped ? ["Nothing was changed; `cello service status` shows the state."] : []),
].join(" ")

export const restartedText = (program: ReadonlyArray<string>, pid: number, port: number): string =>
  `Restarted the background service: launchd started \`${program.join(" ")}\` again (pid ${pid}), and it answers on ${serverUrl(port)}.`

export const restartTimeoutText = (port: number, seconds: number): string =>
  `The service's server was stopped, but no new one answered on ${serverUrl(port)} within ${seconds} s. ` +
  "`cello service status` shows whether launchd is starting it and the log's last lines; `cello start` runs Cello in the meantime."

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
