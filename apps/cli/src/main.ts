// Runs `cello` with the process's arguments and environment. `bin.ts` calls it with apps/web/dist and
// the checkout's commit; the compiled binary with the web app and the commit embedded (scripts/build.ts).
import * as BunRuntime from "@effect/platform-bun/BunRuntime"
import * as BunServices from "@effect/platform-bun/BunServices"
import type * as WebFiles from "@cello/server/web/WebFiles"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import { CliEnv, run } from "./cli.ts"
import type { CliBuild } from "./env.ts"
import { systemOpener } from "./open.ts"
import { selfCommand } from "./service.ts"

export const main = (web: () => WebFiles.WebFiles | undefined, build: CliBuild) =>
  run(process.argv.slice(2)).pipe(
    Effect.provideService(CliEnv, {
      env: process.env,
      cwd: process.cwd(),
      now: () => Date.now(),
      readStdin: () => Bun.stdin.text(),
      web,
      open: systemOpener(process.platform),
      build,
      self: selfCommand({ execPath: process.execPath, main: Bun.main }),
      exit: (code) => process.exit(code),
    }),
    // CliFailure carries the sentence to print; parse errors were already shown with the help text.
    Effect.catch((error) =>
      Effect.andThen(
        error._tag === "CliFailure" ? Console.error(error.message) : Effect.void,
        Effect.sync(() => process.exit(1)),
      )),
    Effect.provide(BunServices.layer),
    BunRuntime.runMain({ disableErrorReporting: true }),
  )
