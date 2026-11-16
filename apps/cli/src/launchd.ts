// `cello service` (CEL-81): installs, checks, restarts and removes the launchd user agent that keeps
// `cello start` running. service.ts has the plans and the words; this file reads and writes the plist
// in $HOME/Library/LaunchAgents, runs `launchctl` (found on CliEnv's PATH, so tests put a fake there),
// and reads the data folder's server lock. It never touches the data itself.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { isAlive } from "@cello/server/process/isAlive"
import { LOCK_FILE, readLock } from "@cello/server/server/ServerLock"
import { type InstalledService, parsePlist, plistPath, renderPlist, serviceLogPath, servicePathVariable } from "@cello/shared/launchAgent"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { CliEnv, dataDirOf, portOf } from "./env.ts"
import { CliFailure } from "./errors.ts"
import type { Env } from "./identity.ts"
import {
  type Holder,
  type Installed,
  installSteps,
  type JobState,
  parsePrint,
  printArgs,
  refusalText,
  restartSteps,
  type ServiceStatus,
  type Step,
  tailLines,
  uninstallSteps,
} from "./service.ts"

/** How long a stopped server gets to exit (and release the data folder) before install gives up. */
const EXIT_WAIT = Duration.seconds(20)
const EXIT_STEP = Duration.millis(100)
const LOG_LINES = 10

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

const runSteps = (bin: string, env: Env, steps: ReadonlyArray<Step>) =>
  Effect.forEach(steps, (step) =>
    Effect.flatMap(call(bin, env, step.args), (result) =>
      result.code === 0 || step.optional
        ? Effect.void
        : fail(`launchctl couldn't do it (${step.what}): ${(result.stderr || result.stdout).trim() || `exit code ${result.code}`}`)), { discard: true })

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

/** The live server holding the data folder's lock; null when none does. */
const holderOf = (dataDir: string): Holder | null => {
  const lock = readLock(path.join(dataDir, LOCK_FILE))
  return lock && isAlive(lock.pid) ? lock : null
}

/** Waits (up to EXIT_WAIT) for `pid` to exit; true once it has. */
const exited = (pid: number) =>
  Effect.gen(function* () {
    const deadline = Date.now() + Duration.toMillis(EXIT_WAIT)
    while (isAlive(pid)) {
      if (Date.now() > deadline) return false
      yield* Effect.sleep(EXIT_STEP)
    }
    return true
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

/** The plist this command would write: this `cello`, for CELLO_DATA_DIR and CELLO_PORT. */
const desired = Effect.gen(function* () {
  const { env, self } = yield* CliEnv
  if (!self || self.length === 0) return yield* fail("Can't tell which cello binary this is, so there's nothing to put in the service.")
  const resolved = self.map((file) => (fs.existsSync(file) ? fs.realpathSync(file) : file))
  if (!programExists(resolved)) return yield* fail(`${resolved.join(" ")} doesn't exist, so the service couldn't run it.`)
  const home = homeOf(env)
  const dataDir = dataDirOf(env)
  return {
    env,
    plist: plistPath(home),
    spec: {
      program: [...resolved, "start"],
      home,
      path: servicePathVariable(resolved[0]!, env.PATH ?? ""),
      dataDir,
      port: portOf(env),
      logPath: serviceLogPath(dataDir),
    },
  }
})

export const installService = (options: { readonly replace: boolean }) =>
  Effect.gen(function* () {
    const { env, plist, spec } = yield* desired
    const bin = yield* launchctl(env)
    const previous = readInstalled(plist)
    const job = previous ? yield* jobState(bin, env) : null
    // The installed service's own server isn't "another server": installing again replaces it.
    const holder = holderOf(spec.dataDir)
    const other = holder && holder.pid !== job?.pid ? holder : null
    let replaced: number | null = null
    if (other) {
      if (!options.replace) return yield* fail(refusalText(spec.dataDir, other))
      if (other.pid === process.pid) return yield* fail(`The server holding ${spec.dataDir} is this very process (pid ${other.pid}); stop it another way.`)
      process.kill(other.pid, "SIGTERM")
      if (!(yield* exited(other.pid))) {
        return yield* fail(`Sent pid ${other.pid} a stop signal, but it's still running after 20 s. Stop it yourself, then install again.`)
      }
      replaced = other.pid
    }
    fs.mkdirSync(path.dirname(spec.logPath), { recursive: true })
    writeAtomically(plist, renderPlist(spec))
    const steps = installSteps(uid(), plist, { loaded: job !== null })
    // Unload the old job and let its server go before the new one starts, or the new one finds the lock held.
    const [unload, load] = job ? [steps.slice(0, 1), steps.slice(1)] : [[], steps]
    yield* runSteps(bin, env, unload)
    if (job?.pid) yield* exited(job.pid)
    yield* runSteps(bin, env, load)
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

/**
 * What `cello service status` shows. `serverBuild` asks the server on a port which build it is (null
 * when nothing answers); cli.ts passes its RPC client.
 */
export const serviceStatus = <R>(
  serverBuild: (port: number) => Effect.Effect<{ readonly version: string; readonly commit: string | null } | null, never, R>,
) =>
  Effect.gen(function* () {
    const { env } = yield* CliEnv
    const plist = plistPath(homeOf(env))
    const installed = readInstalled(plist)
    const dataDir = installed?.dataDir ?? dataDirOf(env)
    const port = installed?.port ?? portOf(env)
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

export const restartService = Effect.gen(function* () {
  const { env } = yield* CliEnv
  const installed = readInstalled(plistPath(homeOf(env)))
  if (!installed) return yield* fail(NOT_INSTALLED)
  if (!programExists(installed.program)) {
    return yield* fail(
      `The service's program ${installed.program.slice(0, -1).join(" ")} doesn't exist any more (the repo moved, or the build was deleted). ` +
        "Build it again, or run `cello service install` with the cello you want the service to run.",
    )
  }
  const bin = yield* launchctl(env)
  const job = yield* jobState(bin, env)
  if (!job) return yield* fail("The background service is installed but not loaded in launchd. Run `cello service install` to load it again.")
  yield* runSteps(bin, env, restartSteps(uid()))
  return { program: installed.program }
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
