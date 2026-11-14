// Server entry: lock, migrations, seed, HTTP + /rpc. Config comes from the environment:
//   CELLO_DATA_DIR  required; dev uses <repo>/.cello, production ~/.cello
//   CELLO_PORT      default 4747
import * as BunRuntime from "@effect/platform-bun/BunRuntime"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { gitUserName } from "./humanName.ts"
import * as Server from "./server.ts"

const dataDir = process.env.CELLO_DATA_DIR
if (!dataDir) {
  console.error("Set CELLO_DATA_DIR to the folder for the database (dev: <repo>/.cello).")
  process.exit(1)
}
const port = Number(process.env.CELLO_PORT ?? 4747)

Layer.launch(Server.layer({ dataDir, port, humanName: gitUserName() })).pipe(
  Effect.catchTag("ServerAlreadyRunning", (error) =>
    Console.error(error.message).pipe(Effect.andThen(Effect.sync(() => process.exit(1))))),
  BunRuntime.runMain,
)
