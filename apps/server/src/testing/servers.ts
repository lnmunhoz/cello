// Real servers on ephemeral ports with temp data folders, for integration tests here and in the CLI.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as HttpServer from "effect/http/HttpServer"
import * as Server from "../server.ts"

export const HUMAN = "Lucas"

/** A temp data folder, removed when the scope closes. */
export const tempDataDir = Effect.acquireRelease(
  Effect.sync(() => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cello-test-")))),
  (dir) => Effect.sync(() => fs.rmSync(dir, { recursive: true, force: true })),
)

/** Starts a server on a free port; it stops when the scope closes. Returns its port. */
export const startServer = (dataDir: string, options: Pick<Server.ServerOptions, "web"> = {}) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(Server.layer({ dataDir, port: 0, humanName: HUMAN, ...options }))
    const address = Context.get(context, HttpServer.HttpServer).address
    return { port: "port" in address ? address.port : 0 }
  })
