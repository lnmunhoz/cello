// Real servers on ephemeral ports with temp data folders, for integration tests here and in the CLI.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as HttpServer from "effect/http/HttpServer"
import * as Server from "../server.ts"

export { tempDataDir } from "./tempDir.ts"

export const HUMAN = "Lucas"

/** Starts a server on a free port, without the daily backup; it stops when the scope closes. Returns its port. */
export const startServer = (dataDir: string, options: Pick<Server.ServerOptions, "web" | "autoBackup" | "commit"> = {}) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(Server.layer({ dataDir, port: 0, humanName: HUMAN, autoBackup: false, ...options }))
    const address = Context.get(context, HttpServer.HttpServer).address
    return { port: "port" in address ? address.port : 0 }
  })
