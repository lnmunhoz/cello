// The whole server as one layer: lock → database → migrations → seed → services → RPC over a
// WebSocket at /rpc on 127.0.0.1. main.ts launches it; integration tests build it on port 0.
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServer from "effect/http/HttpServer"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as RpcServer from "effect/rpc/RpcServer"
import { CelloRpcs } from "@cello/contract/rpcs"
import * as CallerMiddleware from "./caller/CallerMiddleware.ts"
import * as Migrations from "./persistence/Migrations.ts"
import * as Seed from "./persistence/Seed.ts"
import * as Sqlite from "./persistence/Sqlite.ts"
import * as AllowedOrigins from "./rpc/AllowedOrigins.ts"
import * as Handlers from "./rpc/Handlers.ts"
import * as ServerLock from "./server/ServerLock.ts"
import * as Services from "./services.ts"

export interface ServerOptions {
  /** Folder for the lock and the database. Never `~/.cello` in dev or tests. */
  readonly dataDir: string
  /** 0 picks a free port. */
  readonly port: number
  /** Name for the human actor on first start. */
  readonly humanName: string
}

/** The database is opened only after the lock is held: the layer needs `ServerLock`. */
const database = Layer.unwrap(Effect.map(Effect.service(ServerLock.ServerLock), (lock) => Sqlite.layer(lock.dbPath)))

const recordPort = Layer.effectDiscard(Effect.gen(function* () {
  const server = yield* HttpServer.HttpServer
  const lock = yield* ServerLock.ServerLock
  if ("port" in server.address) yield* lock.recordPort(server.address.port)
}))

export const layer = (options: ServerOptions) => {
  const storage = Seed.layer(options.humanName).pipe(
    Layer.provideMerge(Migrations.layer),
    Layer.provideMerge(database),
  )
  const app = Services.layer.pipe(Layer.provideMerge(storage))
  const rpc = RpcServer.layer(CelloRpcs).pipe(
    Layer.provide(Handlers.layer),
    Layer.provide(CallerMiddleware.layer),
    Layer.provideMerge(RpcServer.layerProtocolWebsocket({ path: "/rpc" })),
    Layer.provide(RpcSerialization.layerJson),
  )
  return Layer.mergeAll(HttpRouter.serve(Layer.mergeAll(rpc, AllowedOrigins.layer), { disableLogger: true }), recordPort).pipe(
    Layer.provide(app),
    Layer.provideMerge(BunHttpServer.layer({ hostname: "127.0.0.1", port: options.port })),
    Layer.provideMerge(ServerLock.layer({ dataDir: options.dataDir, port: options.port })),
  )
}
