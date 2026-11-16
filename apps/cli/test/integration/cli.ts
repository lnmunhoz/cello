// Runs `cello` commands in this process against a real server, capturing what they print.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { tempDataDir } from "@cello/server/testing/servers"
import * as BunServices from "@effect/platform-bun/BunServices"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { CliEnv, run } from "../../src/cli.ts"
import type { Env } from "../../src/identity.ts"

export interface Output {
  /** Everything printed to stdout, lines joined with "\n". */
  readonly out: string
  /** The failure's message, or null when the command succeeded. */
  readonly failure: string | null
  /** Warnings printed to stderr, lines joined with "\n"; left out when there were none. */
  readonly err?: string
}

/**
 * HOME for every command a test runs, unless the test sets its own: a temp path that's never created.
 * The default data folder (~/.cello) then resolves inside it, so a test that forgets CELLO_DATA_DIR
 * finds nothing there instead of reaching Lucas's real board.
 */
export const TEST_HOME = path.join(os.tmpdir(), `cello-test-home-${process.pid}-never-created`)

export const cello = (options: {
  readonly port: number
  readonly env?: Env
  readonly cwd: string
  readonly stdin?: string
  /** The CLI's own build, as bin.ts or the compiled binary passes it. */
  readonly build?: { readonly commit: string | null }
  /** Hears each line the command prints to stderr as it prints it (a waiter saying it's waiting). */
  readonly onErr?: (line: string) => void
  /** Hears each line the command prints to stdout as it prints it (`cello agents log --follow`'s new steps). */
  readonly onOut?: (line: string) => void
  /**
   * Stands in for the system's opener (`cello open`). Without it, opening fails: a test never opens
   * anything on the machine it runs on.
   */
  readonly open?: (link: string) => Promise<void>
  /** The command this `cello` runs as (`cello service install` writes it into the plist). */
  readonly self?: ReadonlyArray<string>
}) =>
  (...args: string[]): Effect.Effect<Output> =>
    Effect.gen(function* () {
      const lines: string[] = []
      const errors: string[] = []
      const console: Console.Console = Object.assign(Object.create(globalThis.console), {
        log: (...parts: ReadonlyArray<unknown>) => {
          lines.push(parts.join(" "))
          options.onOut?.(parts.join(" "))
        },
        error: (...parts: ReadonlyArray<unknown>) => {
          errors.push(parts.join(" "))
          options.onErr?.(parts.join(" "))
        },
      })
      const exit = yield* run(args).pipe(
        Effect.provideService(CliEnv, {
          env: { CELLO_PORT: String(options.port), HOME: TEST_HOME, CELLO_DATA_DIR: path.join(TEST_HOME, ".cello"), ...options.env },
          cwd: options.cwd,
          now: () => Date.now(),
          readStdin: () => Promise.resolve(options.stdin ?? ""),
          web: () => undefined,
          open: options.open ?? (() => Promise.reject(new Error("tests don't open links"))),
          ...(options.build ? { build: options.build } : {}),
          ...(options.self ? { self: options.self } : {}),
        }),
        Effect.provideService(Console.Console, console),
        Effect.provide(BunServices.layer),
        Effect.exit,
      )
      const failure = Exit.isFailure(exit)
        ? (exit.cause.reasons.map((r) => ("error" in r ? (r.error as { message?: string }).message : String(r))).join("\n") ?? "")
        : null
      return { out: lines.join("\n"), failure, ...(errors.length ? { err: errors.join("\n") } : {}) }
    })

/**
 * Vitest's options for a test whose time goes to real processes: the `git` a CLI call runs, a whole
 * `cello` process, a server started again. That time grows with the machine's load, not with the test.
 * Measured for CEL-121: the slowest such tests take 0.3–1 s idle, 4–5.5 s at load average ~110 and up
 * to 15 s at ~290 (other agents' test runs and Docker), past Vitest's default 5 s. Cut the processes
 * first (`hookInProcess`); use this where they're what the test is about.
 */
export const UNDER_LOAD = { timeout: 30_000 }

/** A git repository at `dir/name`, for project-from-folder tests. */
export const gitRepo = (dir: string, name: string) => {
  const repo = path.join(dir, name)
  fs.mkdirSync(path.join(repo, "src"), { recursive: true })
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: repo })
  return fs.realpathSync(repo)
}

const BIN = path.resolve(import.meta.dirname, "../../src/bin.ts")

/** `cello hook claude <event>` as a real process, as Claude Code runs it: its exit code, stdout and stderr. `stdin: null` leaves stdin open. */
export const hookProcess = (event: string, env: Record<string, string>, stdin: string | null) =>
  Effect.promise(async () => {
    const proc = Bun.spawn(["bun", BIN, "hook", "claude", event], {
      env: { PATH: process.env.PATH, ...env },
      stdin: stdin === null ? "pipe" : new Blob([stdin]),
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    return { exitCode, stdout, stderr }
  })

/**
 * `cello hook claude <event>` in this process, answering in `hookProcess`'s shape. For tests of what the
 * hook decides: a process loads the whole CLI each time (about 0.2 s of CPU idle, over a second on a
 * loaded machine), so a test that runs the hook a few times as processes outlasts Vitest's 5 s (CEL-121).
 * Keep `hookProcess` for what only a process shows: stdin, the exit code, the environment it's given.
 */
export const hookInProcess = (event: string, options: { readonly port: number; readonly env: Env; readonly cwd: string }, stdin: string) =>
  Effect.map(cello({ ...options, stdin })("hook", "claude", event), (output) => ({
    exitCode: output.failure === null ? 0 : 1,
    stdout: output.out === "" ? "" : `${output.out}\n`,
    stderr: [output.err, output.failure].filter((text) => text != null).join("\n"),
  }))

/** For `cello install claude` tests: a temp HOME, a fake `cello` on PATH, and a git repo "app" inside a temp `dir`. */
export const installSetup = Effect.gen(function* () {
  const dir = yield* tempDataDir
  const repo = gitRepo(dir, "app")
  const home = path.join(dir, "home")
  const bin = path.join(dir, "bin")
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, "cello"), "#!/bin/sh\n", { mode: 0o755 })
  const run = (cwd: string, PATH = bin, env: Env = {}) => cello({ port: 1, env: { HOME: home, PATH, ...env }, cwd })
  return { dir, repo, home, run }
})

// ── `cello start` as its own process ───────────────────────────────────────────────────────────


/** Runs `cello start` as its own process; it's killed (by its pid) when the scope closes. */
export const spawnStart = (env: Record<string, string>) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      Bun.spawn([process.execPath, BIN, "start"], {
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
        stdout: "pipe",
        stderr: "pipe",
      })
    ),
    (proc) => Effect.promise(async () => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL")
      await proc.exited
    }),
  )

/** Reads a stream until `pattern` matches what has arrived so far. */
export const readUntil = (stream: ReadableStream<Uint8Array>, pattern: RegExp) =>
  Effect.promise(async () => {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let text = ""
    while (!pattern.test(text)) {
      const { value, done } = await reader.read()
      if (done) break
      text += decoder.decode(value)
    }
    reader.releaseLock()
    return text
  })

export const RUNNING = /Cello is running at http:\/\/127\.0\.0\.1:(\d+) .*\n/

/** Starts `cello start` (daily backup on, as in production) and waits for its banner. */
export const startProcess = (dataDir: string, env: Record<string, string> = {}) =>
  Effect.gen(function* () {
    const proc = yield* spawnStart({ CELLO_DATA_DIR: dataDir, CELLO_PORT: "0", ...env })
    const banner = yield* readUntil(proc.stdout, RUNNING)
    return { proc, port: Number(RUNNING.exec(banner)![1]) }
  })
