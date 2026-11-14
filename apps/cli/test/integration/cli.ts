// Runs `cello` commands in this process against a real server, capturing what they print.
import * as fs from "node:fs"
import * as path from "node:path"
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
}

export const cello = (options: { readonly port: number; readonly env?: Env; readonly cwd: string; readonly stdin?: string }) =>
  (...args: string[]): Effect.Effect<Output> =>
    Effect.gen(function* () {
      const lines: string[] = []
      const errors: string[] = []
      const console: Console.Console = Object.assign(Object.create(globalThis.console), {
        log: (...parts: ReadonlyArray<unknown>) => lines.push(parts.join(" ")),
        error: (...parts: ReadonlyArray<unknown>) => errors.push(parts.join(" ")),
      })
      const exit = yield* run(args).pipe(
        Effect.provideService(CliEnv, {
          env: { CELLO_PORT: String(options.port), ...options.env },
          cwd: options.cwd,
          now: () => Date.now(),
          readStdin: () => Promise.resolve(options.stdin ?? ""),
          web: () => undefined,
        }),
        Effect.provideService(Console.Console, console),
        Effect.provide(BunServices.layer),
        Effect.exit,
      )
      const failure = Exit.isFailure(exit)
        ? (exit.cause.reasons.map((r) => ("error" in r ? (r.error as { message?: string }).message : String(r))).join("\n") ?? "")
        : null
      return { out: lines.join("\n"), failure }
    })

/** A git repository at `dir/name`, for project-from-folder tests. */
export const gitRepo = (dir: string, name: string) => {
  const repo = path.join(dir, name)
  fs.mkdirSync(path.join(repo, "src"), { recursive: true })
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: repo })
  return fs.realpathSync(repo)
}
