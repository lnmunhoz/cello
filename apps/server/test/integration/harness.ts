// Real servers on ephemeral ports with temp data folders, and real clients over WebSockets.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as BunSocket from "@effect/platform-bun/BunSocket"
import { CelloClient, makeClientLayer } from "@cello/client/client"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as HttpServer from "effect/http/HttpServer"
import type * as Scope from "effect/Scope"
import * as Server from "../../src/server.ts"

export const HUMAN = "Lucas"

/** A temp data folder, removed when the scope closes. */
export const tempDataDir = Effect.acquireRelease(
  Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "cello-test-"))),
  (dir) => Effect.sync(() => fs.rmSync(dir, { recursive: true, force: true })),
)

/** Starts a server on a free port; it stops when the scope closes. Returns its port. */
export const startServer = (dataDir: string) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(Server.layer({ dataDir, port: 0, humanName: HUMAN }))
    const address = Context.get(context, HttpServer.HttpServer).address
    return { port: "port" in address ? address.port : 0 }
  })

/** A client connected to `port`; it disconnects when the scope closes. */
export const connect = (port: number): Effect.Effect<CelloClient["Service"], never, Scope.Scope> =>
  Layer.build(makeClientLayer(BunSocket.layerWebSocket(`ws://127.0.0.1:${port}/rpc`))).pipe(
    Effect.map((context) => Context.get(context, CelloClient)),
  )

/** Runs `use` with a client in its own scope, so closing it is a real disconnect. */
export const withClient = <A, E, R>(port: number, use: (client: CelloClient["Service"]) => Effect.Effect<A, E, R>) =>
  Effect.scoped(Effect.flatMap(connect(port), use))
