// `cello start`: the server on 127.0.0.1:${CELLO_PORT:-4747} with data in ${CELLO_DATA_DIR:-~/.cello},
// serving the built web app on the same port. Runs until stopped.
import * as os from "node:os"
import * as path from "node:path"
import { gitUserName } from "@cello/server/humanName"
import * as Server from "@cello/server/server"
import * as Console from "effect/Console"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as HttpServer from "effect/http/HttpServer"
import { CliEnv, portOf } from "./env.ts"
import { CliFailure } from "./errors.ts"

export const start = Effect.gen(function* () {
  const { env, web } = yield* CliEnv
  const port = portOf(env)
  const dataDir = path.resolve(env.CELLO_DATA_DIR || path.join(env.HOME || os.homedir(), ".cello"))
  const files = web()
  yield* Effect.scoped(Effect.gen(function* () {
    const context = yield* Layer.build(Server.layer({ dataDir, port, humanName: gitUserName(), web: files }))
    const address = Context.get(context, HttpServer.HttpServer).address
    const bound = "port" in address ? address.port : port
    yield* Console.log(`Cello is running at http://127.0.0.1:${bound} (data in ${dataDir}${files ? "" : "; no web app found"})`)
    return yield* Effect.never
  }))
}).pipe(
  Effect.catchTag("ServerAlreadyRunning", (error) => Effect.fail(new CliFailure({ message: error.message }))),
  Effect.catchTag("ServeError", () =>
    Effect.fail(new CliFailure({ message: "Couldn't listen on that port; another program is using it. Set CELLO_PORT to another port." }))),
)
