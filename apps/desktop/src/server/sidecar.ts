// Finds the Cello server for the app, starting the bundled `cello start` only when none is running
// for the data folder. Electron's Node can't run the Bun server, so the server is a child process
// (the compiled `cello` binary); the app stops it on quit only if it started it.
import { spawn, type ChildProcess } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { isAlive } from "@cello/server/process/isAlive"
import { isAlreadyRunning, LOCK_FILE, parseBanner, parseLock, planServer, serverUrl, type ServerSurvey } from "./plan.ts"

export interface Server {
  readonly url: string
  /** True when the app started this server; only then does `stop` stop it. */
  readonly startedByUs: boolean
  readonly stop: () => Promise<void>
}

export interface ConnectOptions {
  readonly port: number
  readonly dataDir: string
  /** The `cello` binary (and any arguments before `start`); null when there's none to start. */
  readonly command: ReadonlyArray<string> | null
  /** The environment for `cello start`; CELLO_PORT and CELLO_DATA_DIR are set from the options. */
  readonly env: Readonly<Record<string, string | undefined>>
  /** Where the started server's output goes. */
  readonly log?: (text: string) => void
  /**
   * The background service is installed for this data folder (CEL-81): the app never starts a server of
   * its own then, it asks launchd to start the service (`startService`) and waits for it.
   */
  readonly service?: { readonly installed: boolean; readonly start: () => Promise<void> }
}

const PROBE_TIMEOUT_MS = 1_000
const WAIT_STEP_MS = 200
const WAIT_LIMIT_MS = 15_000
const STOP_GRACE_MS = 5_000

/** Does anything answer HTTP at `url`? */
export const probe = async (url: string): Promise<boolean> => {
  try {
    await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    return true
  } catch {
    return false
  }
}

/** Looks at CELLO_PORT and the data folder's server lock. */
export const survey = async (port: number, dataDir: string, service = false): Promise<ServerSurvey> => {
  const lockPath = path.join(dataDir, LOCK_FILE)
  const lock = fs.existsSync(lockPath) ? parseLock(fs.readFileSync(lockPath, "utf8")) : null
  const [portAnswers, lockAnswers] = await Promise.all([
    port > 0 ? probe(serverUrl(port)) : false,
    lock && lock.port > 0 && lock.port !== port ? probe(serverUrl(lock.port)) : undefined,
  ])
  return {
    port,
    portAnswers,
    lock: lock && { ...lock, alive: isAlive(lock.pid), answers: lockAnswers ?? (lock.port === port && portAnswers) },
    service,
  }
}

/** The pid in the data folder's server lock, when that process is alive. */
export const lockHolder = (dataDir: string): number | null => {
  const lockPath = path.join(dataDir, LOCK_FILE)
  const lock = fs.existsSync(lockPath) ? parseLock(fs.readFileSync(lockPath, "utf8")) : null
  return lock && isAlive(lock.pid) ? lock.pid : null
}

const joined = (url: string): Server => ({ url, startedByUs: false, stop: async () => {} })

export class ServerStartError extends Error {}

export const connectServer = async (options: ConnectOptions): Promise<Server> => {
  // A second pass covers a race: another `cello start` took the folder between the survey and ours.
  for (let pass = 0; pass < 2; pass++) {
    const plan = planServer(await survey(options.port, options.dataDir, options.service?.installed ?? false))
    if (plan.kind === "join") return joined(plan.url)
    if (plan.kind === "service") {
      await options.service!.start().catch(() => {})
      if (await waitUntilAnswers(plan.url)) return joined(plan.url)
      throw new ServerStartError(
        `Cello's background service is installed for ${options.dataDir} but didn't start at ${plan.url}. Run \`cello service status\` in a terminal to see why.`,
      )
    }
    if (plan.kind === "wait") {
      if (await waitUntilAnswers(plan.url)) return joined(plan.url)
      throw new ServerStartError(
        `Cello is running for ${options.dataDir} (pid ${plan.pid}) but doesn't answer at ${plan.url}. Stop it, or wait for it to finish starting.`,
      )
    }
    if (!options.command || options.command.length === 0) {
      throw new ServerStartError(
        `No Cello server is running on port ${options.port} and there's no cello binary to start one. Run \`cello start\`, or build the CLI (bun run build in apps/cli).`,
      )
    }
    const started = await startServer(options, options.command)
    if (started.kind === "started") return started.server
    if (started.kind === "failed") throw new ServerStartError(started.message)
  }
  throw new ServerStartError(`Couldn't start or join the Cello server for ${options.dataDir}.`)
}

const waitUntilAnswers = async (url: string): Promise<boolean> => {
  for (let waited = 0; waited < WAIT_LIMIT_MS; waited += WAIT_STEP_MS) {
    if (await probe(url)) return true
    await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS))
  }
  return false
}

type StartResult =
  | { readonly kind: "started"; readonly server: Server }
  | { readonly kind: "already-running" }
  | { readonly kind: "failed"; readonly message: string }

/** Spawns `cello start` and resolves once its banner says it's listening, or it exits. */
const startServer = (options: ConnectOptions, command: ReadonlyArray<string>): Promise<StartResult> =>
  new Promise((resolve) => {
    const [file, ...args] = command as [string, ...string[]]
    const child = spawn(file, [...args, "start"], {
      env: { ...options.env, CELLO_PORT: String(options.port), CELLO_DATA_DIR: options.dataDir },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const log = options.log ?? (() => {})
    let stdout = ""
    let stderr = ""
    let settled = false
    const settle = (result: StartResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    // Keep draining both pipes for the server's whole life, or it blocks once a pipe fills.
    child.stdout!.setEncoding("utf8").on("data", (chunk: string) => {
      log(chunk)
      if (settled) return
      stdout += chunk
      const url = parseBanner(stdout)
      if (url) settle({ kind: "started", server: { url, startedByUs: true, stop: () => stopChild(child) } })
    })
    child.stderr!.setEncoding("utf8").on("data", (chunk: string) => {
      log(chunk)
      if (!settled) stderr += chunk
    })
    child.on("error", (error) => settle({ kind: "failed", message: `Couldn't run ${file}: ${error.message}` }))
    child.on("exit", (code) =>
      settle(
        isAlreadyRunning(stderr)
          ? { kind: "already-running" }
          : { kind: "failed", message: stderr.trim() || `cello start exited with code ${code}.` },
      ))
  })

/**
 * Keep Running (CEL-81): starts `cello start` on its own, outliving the app, with its output appended
 * to `logPath` (a pipe to the app would break when the app quits). Resolves to its pid once it answers
 * at `url`, or null if it doesn't.
 */
export const startDetached = async (options: {
  readonly command: ReadonlyArray<string>
  readonly url: string
  readonly dataDir: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly logPath: string
}): Promise<number | null> => {
  const [file, ...args] = options.command as [string, ...string[]]
  fs.mkdirSync(path.dirname(options.logPath), { recursive: true })
  const out = fs.openSync(options.logPath, "a")
  try {
    const child = spawn(file, [...args, "start"], {
      env: { ...options.env, CELLO_PORT: new URL(options.url).port, CELLO_DATA_DIR: options.dataDir },
      detached: true,
      stdio: ["ignore", out, out],
    })
    child.unref()
    const failed = new Promise<false>((resolve) => {
      child.once("error", () => resolve(false))
      child.once("exit", () => resolve(false))
    })
    return (await Promise.race([waitUntilAnswers(options.url), failed])) ? child.pid ?? null : null
  } finally {
    fs.closeSync(out)
  }
}

/** Install Background Service (CEL-81): runs `cello service install` and returns what it printed. */
export const installService = (options: {
  readonly command: string
  readonly port: number
  readonly dataDir: string
  readonly env: Readonly<Record<string, string | undefined>>
}): Promise<{ readonly ok: boolean; readonly output: string }> =>
  new Promise((resolve) => {
    const child = spawn(options.command, ["service", "install"], {
      env: { ...options.env, CELLO_PORT: String(options.port), CELLO_DATA_DIR: options.dataDir },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    child.stdout!.setEncoding("utf8").on("data", (chunk: string) => (output += chunk))
    child.stderr!.setEncoding("utf8").on("data", (chunk: string) => (output += chunk))
    child.on("error", (error) => resolve({ ok: false, output: `Couldn't run ${options.command}: ${error.message}` }))
    child.on("close", (code) => resolve({ ok: code === 0, output: output.trim() }))
  })

/** Stops a server the app started: SIGTERM lets it release its lock; SIGKILL if it hangs. */
const stopChild = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
  child.kill("SIGTERM")
  const timer = setTimeout(() => child.kill("SIGKILL"), STOP_GRACE_MS)
  await exited
  clearTimeout(timer)
}
