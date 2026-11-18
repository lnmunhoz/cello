// `cello service` (CEL-81): installs, checks, restarts and removes the launchd user agent that keeps
// `cello start` running. service.ts has the plans and the words; this file reads and writes the plist
// in $HOME/Library/LaunchAgents, runs `launchctl` (found on CliEnv's PATH, so tests put a fake there),
// and reads the data folder's server lock. It never touches the data itself.
//
// It only ever signals a process it has checked is a Cello server for this data folder: the lock's pid
// is alive, its command is a `… start`, and the lock's port answers `server.build`. A lock whose pid was
// reused by another program, or that names 0, 1 or this process, is reported, never acted on.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { isAlive } from "@cello/server/process/isAlive"
import { DEFAULT_PORT, type LockInfo, lockPath, readLock } from "@cello/host/serverLock"
import {
  type InstalledService,
  type JobState,
  parsePlist,
  parsePrint,
  plistPath,
  renderPlist,
  serviceLogPath,
  servicePathVariable,
} from "@cello/host/launchAgent"
import { rotateLog } from "@cello/host/logRotation"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { CliEnv, dataDirOf } from "./env.ts"
import { CliFailure } from "./errors.ts"
import type { Env } from "./identity.ts"
import {
  failedInstallText,
  type Holder,
  type Installed,
  installSteps,
  invalidLockText,
  isTemporaryPath,
  otherServiceText,
  printArgs,
  refusalText,
  restartSteps,
  restartTimeoutText,
  sameService,
  type ServiceStatus,
  staleLockText,
  staleProgram,
  type Step,
  tailLines,
  temporaryText,
  uninstallSteps,
} from "./service.ts"

/** How long a stopped server gets to exit (and release the data folder) before giving up. */
const EXIT_WAIT = Duration.seconds(20)
const STEP = Duration.millis(100)
/** How long `restart` waits for the new server to answer; tests shorten it with CELLO_TEST_SERVICE_WAIT_MS. */
const RESTART_WAIT_MS = 30_000
const LOG_LINES = 10

/** Which build answers on a port; null when nothing does. cli.ts passes its RPC client. */
export type ServerBuild<R> = (port: number) => Effect.Effect<{ readonly version: string; readonly commit: string | null } | null, never, R>

const uid = () => process.getuid?.() ?? 0
const homeOf = (env: Env) => env.HOME || os.homedir()

const fail = (message: string) => Effect.fail(new CliFailure({ message }))

/** launchctl from the PATH this command runs with; a plain failure where there's none (not macOS). */
const launchctl = (env: Env) =>
  Effect.suspend(() => {
    const found = Bun.which("launchctl", { PATH: env.PATH ?? "" })
    return found
      ? Effect.succeed(found)
      : fail("`cello service` runs Cello as a macOS launchd service, and launchctl isn't on the PATH. On other systems, run `cello start` yourself.")
  })

const call = (bin: string, env: Env, args: ReadonlyArray<string>) =>
  Effect.promise(async () => {
    const proc = Bun.spawn([bin, ...args], { env: { PATH: env.PATH ?? "", HOME: homeOf(env) }, stdout: "pipe", stderr: "pipe" })
    const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    return { code, stdout, stderr }
  })

/** Runs the steps in order; the first required step that fails stops it, with launchctl's words. */
const runSteps = (bin: string, env: Env, steps: ReadonlyArray<Step>): Effect.Effect<{ readonly step: Step; readonly reason: string } | null> =>
  Effect.gen(function* () {
    for (const step of steps) {
      const result = yield* call(bin, env, step.args)
      if (result.code !== 0 && !step.optional) return { step, reason: (result.stderr || result.stdout).trim() || `exit code ${result.code}` }
    }
    return null
  })

const runOrFail = (bin: string, env: Env, steps: ReadonlyArray<Step>) =>
  Effect.flatMap(runSteps(bin, env, steps), (failed) => (failed ? fail(`launchctl couldn't do it (${failed.step.what}): ${failed.reason}`) : Effect.void))

/** The loaded job's state, or null when launchd doesn't know it. */
const jobState = (bin: string, env: Env): Effect.Effect<JobState | null> =>
  Effect.map(call(bin, env, printArgs(uid())), (result) => (result.code === 0 ? parsePrint(result.stdout) : null))

const readInstalled = (plist: string): InstalledService | null => {
  try {
    return parsePlist(fs.readFileSync(plist, "utf8"))
  } catch {
    return null
  }
}

const lockOf = (dataDir: string): LockInfo | null => readLock(lockPath(dataDir))

/** A pid that can't be another Cello server: 0, 1 and negative ones signal groups of processes. */
const impossiblePid = (pid: number) => pid <= 1 || pid === process.pid

/** The live server holding the data folder's lock, for status; null when none does. */
const holderOf = (dataDir: string): Holder | null => {
  const lock = lockOf(dataDir)
  return lock && !impossiblePid(lock.pid) && isAlive(lock.pid) ? lock : null
}

/** The process's command line (`ps`), or null when it can't be read. */
const commandOf = (pid: number): string | null => {
  try {
    const result = Bun.spawnSync(["/bin/ps", "-o", "args=", "-p", String(pid)], { stdout: "pipe", stderr: "ignore" })
    return result.exitCode === 0 ? result.stdout.toString().trim() : null
  } catch {
    return null
  }
}

/** Where lsof lives on macOS and Linux; looked up by path, since a command's PATH may not have it. */
export const LSOF_PATHS = ["/usr/sbin/lsof", "/usr/bin/lsof", "/sbin/lsof", "/bin/lsof"]

/** The pids listening on a TCP port (lsof), or null when lsof isn't there to say. */
const listenersOf = (port: number): ReadonlyArray<number> | null => {
  const lsof = LSOF_PATHS.find((file) => fs.existsSync(file))
  if (!lsof) return null
  try {
    const result = Bun.spawnSync([lsof, "-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { stdout: "pipe", stderr: "ignore" })
    // 1 is lsof's "nothing matched".
    if (result.exitCode !== 0 && result.exitCode !== 1) return null
    return result.stdout.toString().split("\n").filter((line) => /^\d+$/.test(line.trim())).map(Number)
  } catch {
    return null
  }
}

/**
 * The lock's pid is a Cello server: a `… start` command, listening on the lock's port itself (when
 * lsof can tell; a reused pid with another Cello on that port isn't it), and that port answers as Cello.
 */
const isCelloServer = <R>(lock: LockInfo, serverBuild: ServerBuild<R>) =>
  Effect.gen(function* () {
    const command = commandOf(lock.pid)
    if (command !== null && !/(^|\s)start$/.test(command)) return false
    if (lock.port <= 0) return false
    const listeners = listenersOf(lock.port)
    if (listeners !== null && !listeners.includes(lock.pid)) return false
    return (yield* serverBuild(lock.port)) !== null
  })

/** Waits (up to EXIT_WAIT) for `pid` to exit; true once it has. */
const exited = (pid: number) =>
  Effect.gen(function* () {
    const deadline = Date.now() + Duration.toMillis(EXIT_WAIT)
    while (isAlive(pid)) {
      if (Date.now() > deadline) return false
      yield* Effect.sleep(STEP)
    }
    return true
  })

/** Sends SIGTERM to a checked Cello server and waits for it to go. */
const stopServer = (pid: number) =>
  Effect.gen(function* () {
    try {
      process.kill(pid, "SIGTERM")
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      return yield* fail(
        code === "EPERM"
          ? `Not allowed to stop pid ${pid} (it belongs to another user). Stop it yourself, then install again.`
          : `Couldn't stop pid ${pid} (${code ?? String(error)}). Stop it yourself, then install again.`,
      )
    }
    if (!(yield* exited(pid))) {
      return yield* fail(`Sent pid ${pid} a stop signal, but it's still running after 20 s. Stop it yourself, then install again.`)
    }
  })

/** Every file of the command (the binary, and the script from source) is still there. */
const programExists = (program: ReadonlyArray<string>) => {
  const files = program.at(-1) === "start" ? program.slice(0, -1) : program
  return files.length > 0 && files.every((file) => fs.existsSync(file))
}

const writeAtomically = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, text, { mode: 0o644 })
  fs.renameSync(temp, file)
}

/** Folders whose files can vanish: the OS temp folder (as given and resolved) and /tmp. */
const tempDirs = () => {
  const tmp = os.tmpdir()
  return [...new Set([tmp, fs.existsSync(tmp) ? fs.realpathSync(tmp) : tmp, "/tmp", "/private/tmp", "/var/folders", "/private/var/folders"])]
}

/** The plist this command would write: this `cello`, for CELLO_DATA_DIR and CELLO_PORT. */
const desired = Effect.gen(function* () {
  const { env, self } = yield* CliEnv
  if (!self || self.length === 0) return yield* fail("Can't tell which cello binary this is, so there's nothing to put in the service.")
  const resolved = self.map((file) => (fs.existsSync(file) ? fs.realpathSync(file) : file))
  if (!programExists(resolved)) return yield* fail(`${resolved.join(" ")} doesn't exist, so the service couldn't run it.`)
  const home = homeOf(env)
  if (!path.isAbsolute(home)) {
    return yield* fail(`HOME is "${home}", which isn't an absolute path, so there's no LaunchAgents folder to put the service in.`)
  }
  const rawPort = env.CELLO_PORT || String(DEFAULT_PORT)
  const port = Number(rawPort)
  if (!/^\d+$/.test(rawPort) || port < 1 || port > 65535) {
    return yield* fail(`CELLO_PORT is "${rawPort}", which isn't a port (1 to 65535), so the service couldn't listen on it.`)
  }
  const dataDir = dataDirOf(env)
  return {
    env,
    plist: plistPath(home),
    spec: { program: [...resolved, "start"], home, path: servicePathVariable(resolved[0]!, env.PATH ?? ""), dataDir, port, logPath: serviceLogPath(dataDir) },
  }
})

export const installService = <R>(options: { readonly replace: boolean; readonly temporary: boolean }, serverBuild: ServerBuild<R>) =>
  Effect.gen(function* () {
    const { env, plist, spec } = yield* desired
    const cello = spec.program.at(-2)!
    if (!options.temporary && isTemporaryPath(cello, tempDirs())) return yield* fail(temporaryText(cello))
    const bin = yield* launchctl(env)
    const previous = readInstalled(plist)
    // Replacing a service that runs something else (another data folder, port or binary) takes --replace.
    if (previous && !options.replace && !sameService(previous, spec)) return yield* fail(otherServiceText(previous, spec))
    const job = previous ? yield* jobState(bin, env) : null

    // The data folder's lock: the installed service's own server isn't "another server".
    let replaced: number | null = null
    const lock = lockOf(spec.dataDir)
    if (lock && lock.pid !== job?.pid) {
      if (impossiblePid(lock.pid)) return yield* fail(invalidLockText(spec.dataDir, lock.pid))
      if (isAlive(lock.pid)) {
        if (!(yield* isCelloServer(lock, serverBuild))) return yield* fail(staleLockText(spec.dataDir, lock))
        if (!options.replace) return yield* fail(refusalText(spec.dataDir, lock))
        yield* stopServer(lock.pid)
        replaced = lock.pid
      }
    }

    rotateLog(spec.logPath)
    fs.mkdirSync(path.dirname(spec.logPath), { recursive: true })
    // The old plist stays as .bak until launchd loads the new one, and comes back if it doesn't.
    const backup = `${plist}.bak`
    if (previous) fs.copyFileSync(plist, backup)
    writeAtomically(plist, renderPlist(spec))
    const steps = installSteps(uid(), plist, { loaded: job !== null })
    // Unload the old job and let its server go before the new one starts, or the new one finds the lock held.
    const [unload, load] = job ? [steps.slice(0, 1), steps.slice(1)] : [[], steps]
    yield* runSteps(bin, env, unload)
    if (job?.pid) yield* exited(job.pid)
    const failed = yield* runSteps(bin, env, load)
    if (failed) {
      let restored: "loaded" | "not loaded" | null = null
      if (previous) {
        fs.renameSync(backup, plist)
        restored = (yield* runSteps(bin, env, load)) === null ? "loaded" : "not loaded"
      } else {
        fs.rmSync(plist, { force: true })
      }
      // The old service's server served its own folder, which may not be the new one's.
      const stopped = [...(job?.pid ? [previous?.dataDir ?? spec.dataDir] : []), ...(replaced !== null ? [spec.dataDir] : [])]
      return yield* fail(failedInstallText({ reason: failed.reason, stopped, restored }))
    }
    fs.rmSync(backup, { force: true })
    return {
      plist,
      program: spec.program,
      dataDir: spec.dataDir,
      port: spec.port,
      logPath: spec.logPath,
      replaced,
      previous: previous && { program: previous.program, dataDir: previous.dataDir },
    } satisfies Installed
  })

/** What `cello service status` shows. */
export const serviceStatus = <R>(serverBuild: ServerBuild<R>) =>
  Effect.gen(function* () {
    const { env } = yield* CliEnv
    const plist = plistPath(homeOf(env))
    const installed = readInstalled(plist)
    const dataDir = installed?.dataDir ?? dataDirOf(env)
    const port = installed?.port ?? Number(env.CELLO_PORT || DEFAULT_PORT)
    const logPath = installed?.logPath ?? serviceLogPath(dataDir)
    const base = { plist, dataDir, port, logPath, holder: holderOf(dataDir) }
    if (!installed) {
      return {
        ...base,
        installed: false,
        program: [],
        programExists: false,
        loaded: false,
        running: false,
        pid: null,
        lastExit: null,
        server: null,
        logTail: [],
      } satisfies ServiceStatus
    }
    const job = yield* jobState(yield* launchctl(env), env)
    const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : ""
    return {
      ...base,
      installed: true,
      program: installed.program,
      programExists: programExists(installed.program),
      loaded: job !== null,
      running: job?.running ?? false,
      pid: job?.pid ?? null,
      lastExit: job?.lastExit ?? null,
      server: yield* serverBuild(port),
      logTail: tailLines(log, LOG_LINES),
    } satisfies ServiceStatus
  })

const NOT_INSTALLED = "The background service isn't installed. Install it with `cello service install`."

/**
 * Restarts the service's server cleanly: SIGTERM through launchd, then waits for the new server
 * KeepAlive starts (another pid) to answer. Returns its pid.
 */
export const restartService = <R>(serverBuild: ServerBuild<R>) =>
  Effect.gen(function* () {
    const { env } = yield* CliEnv
    const installed = readInstalled(plistPath(homeOf(env)))
    if (!installed) return yield* fail(NOT_INSTALLED)
    if (!programExists(installed.program)) return yield* fail(staleProgram(installed.program))
    const bin = yield* launchctl(env)
    const job = yield* jobState(bin, env)
    if (!job) return yield* fail("The background service is installed but not loaded in launchd. Run `cello service install` to load it again.")
    const port = installed.port ?? Number(env.CELLO_PORT || DEFAULT_PORT)
    if (installed.logPath) rotateLog(installed.logPath)
    yield* runOrFail(bin, env, restartSteps(uid(), { running: job.pid !== null }))
    if (job.pid !== null) yield* exited(job.pid)
    const waitMs = Number(env.CELLO_TEST_SERVICE_WAIT_MS) || RESTART_WAIT_MS
    const deadline = Date.now() + waitMs
    for (;;) {
      const now = yield* jobState(bin, env)
      if (now?.pid != null && now.pid !== job.pid && (yield* serverBuild(port)) !== null) return { program: installed.program, pid: now.pid, port }
      if (Date.now() > deadline) return yield* fail(restartTimeoutText(port, waitMs / 1000))
      yield* Effect.sleep(STEP)
    }
  })

export const uninstallService = Effect.gen(function* () {
  const { env } = yield* CliEnv
  const plist = plistPath(homeOf(env))
  const installed = readInstalled(plist)
  if (!installed && !fs.existsSync(plist)) return null
  const bin = yield* launchctl(env)
  const job = yield* jobState(bin, env)
  yield* runSteps(bin, env, uninstallSteps(uid()))
  if (job?.pid) yield* exited(job.pid)
  fs.rmSync(plist, { force: true })
  const dataDir = installed?.dataDir ?? dataDirOf(env)
  return { dataDir, logPath: installed?.logPath ?? serviceLogPath(dataDir) }
})
