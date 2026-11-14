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
export const survey = async (port: number, dataDir: string): Promise<ServerSurvey> => {
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
  }
}

const joined = (url: string): Server => ({ url, startedByUs: false, stop: async () => {} })

export class ServerStartError extends Error {}

export const connectServer = async (options: ConnectOptions): Promise<Server> => {
  // A second pass covers a race: another `cello start` took the folder between the survey and ours.
  for (let pass = 0; pass < 2; pass++) {
    const plan = planServer(await survey(options.port, options.dataDir))
    if (plan.kind === "join") return joined(plan.url)
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

/** Stops a server the app started: SIGTERM lets it release its lock; SIGKILL if it hangs. */
const stopChild = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
  child.kill("SIGTERM")
  const timer = setTimeout(() => child.kill("SIGKILL"), STOP_GRACE_MS)
  await exited
  clearTimeout(timer)
}
