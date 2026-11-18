// Server entry: lock, migrations, seed, HTTP + /rpc. Config comes from the environment:
//   CELLO_DATA_DIR  required; dev uses <repo>/.cello, production ~/.cello
//   CELLO_PORT      default 4747
//   CELLO_BUILD_COMMIT  the commit `server.build` reports; default: this checkout's HEAD
//   CELLO_WAKE_BATCH_MS, CELLO_WAKE_QUIET_MS  test-only, honoured only with CELLO_E2E=1: waking's 30 s and
//                   2 min waits (CEL-92; wake/WakeConfig.ts testWaitsFromEnv)
import { DEFAULT_PORT } from "@cello/host/serverLock"
import * as BunRuntime from "@effect/platform-bun/BunRuntime"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { buildCommit } from "./build/git.ts"
import { gitUserName } from "./humanName.ts"
import * as Server from "./server.ts"
import { testWaitsFromEnv } from "./wake/WakeConfig.ts"

const dataDir = process.env.CELLO_DATA_DIR
if (!dataDir) {
  console.error("Set CELLO_DATA_DIR to the folder for the database (dev: <repo>/.cello).")
  process.exit(1)
}
const port = Number(process.env.CELLO_PORT ?? DEFAULT_PORT)
const wake = testWaitsFromEnv(process.env)

Layer.launch(Server.layer({ dataDir, port, humanName: gitUserName(), commit: buildCommit(process.env, import.meta.dir), checkout: import.meta.dir, wake })).pipe(
  Effect.catchTag(["ServerAlreadyRunning", "BoardTooNew"], (error) =>
    Console.error(error.message).pipe(Effect.andThen(Effect.sync(() => process.exit(1))))),
  BunRuntime.runMain,
)
