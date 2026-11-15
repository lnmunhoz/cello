// The whole server as one layer: lock → database → migrations → seed → services → RPC over a
// WebSocket at /rpc on 127.0.0.1, review evidence at /attachments/<id> (files in <dataDir>/assets),
// plus the built web app when given, and the daily backup into <dataDir>/backups. main.ts and
// `cello start` launch it; integration tests build it on port 0.
import * as path from "node:path"
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServer from "effect/http/HttpServer"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as RpcServer from "effect/rpc/RpcServer"
import { CelloRpcs } from "@cello/contract/rpcs"
import * as BackupSchedule from "./backup/BackupSchedule.ts"
import * as BackupService from "./backup/BackupService.ts"
import * as CallerMiddleware from "./caller/CallerMiddleware.ts"
import * as Migrations from "./persistence/Migrations.ts"
import * as Seed from "./persistence/Seed.ts"
import * as Sqlite from "./persistence/Sqlite.ts"
import * as AllowedOrigins from "./rpc/AllowedOrigins.ts"
import * as AssetStore from "./review/AssetStore.ts"
import * as Handlers from "./rpc/Handlers.ts"
import * as ServerLock from "./server/ServerLock.ts"
import * as Services from "./services.ts"
import * as Attachments from "./web/Attachments.ts"
import * as Uploads from "./web/Uploads.ts"
import * as WebFiles from "./web/WebFiles.ts"

export interface ServerOptions {
  /** Folder for the lock and the database. Never `~/.cello` in dev or tests. */
  readonly dataDir: string
  /** 0 picks a free port. */
  readonly port: number
  /** Name for the human actor on first start. */
  readonly humanName: string
  /** The built web app to serve on the same port. Dev leaves it out: Vite serves the app. */
  readonly web?: WebFiles.WebFiles | undefined
  /** Take the daily backup (on unless false). Integration tests turn it off; the schedule has its own tests. */
  readonly autoBackup?: boolean | undefined
}

/**
 * How long a stopping server waits for open connections to close on their own before it closes them
 * (CEL-17). Board tabs hold a WebSocket open until the server closes it, so without this a stop waits
 * Bun's default 20 s. Clients reconnect by themselves; writes already running finish first
 * (Commands.write), then the database closes and the lock is released.
 */
const SHUTDOWN_GRACE = Duration.seconds(1)

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
  const assets = AssetStore.layer({ dir: path.join(options.dataDir, AssetStore.ASSETS_DIR) })
  const backups = BackupService.layer({ dir: path.join(options.dataDir, BackupService.BACKUPS_DIR) })
  const app = Layer.merge(Services.layer, backups).pipe(Layer.provideMerge(storage), Layer.provideMerge(assets))
  const rpc = RpcServer.layer(CelloRpcs).pipe(
    Layer.provide(Handlers.layer),
    Layer.provide(CallerMiddleware.layer),
    Layer.provideMerge(RpcServer.layerProtocolWebsocket({ path: "/rpc" })),
    Layer.provide(RpcSerialization.layerJson),
  )
  const api = Layer.mergeAll(rpc, Attachments.layer, Uploads.layer, AllowedOrigins.layer)
  const routes = options.web === undefined ? api : Layer.mergeAll(api, WebFiles.layer(options.web))
  const dailyBackup = options.autoBackup === false ? Layer.empty : BackupSchedule.layer
  return Layer.mergeAll(HttpRouter.serve(routes, { disableLogger: true }), recordPort, dailyBackup).pipe(
    Layer.provide(app),
    Layer.provideMerge(BunHttpServer.layer({ hostname: "127.0.0.1", port: options.port, gracefulShutdownTimeout: SHUTDOWN_GRACE })),
    Layer.provideMerge(ServerLock.layer({ dataDir: options.dataDir, port: options.port })),
  )
}
