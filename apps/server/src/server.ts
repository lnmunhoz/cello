// The whole server as one layer: lock → database → migrations → seed → services → RPC over a
// WebSocket at /rpc on 127.0.0.1, review evidence at /attachments/<id> (files in <dataDir>/assets),
// plus the built web app when given, and the daily backup into <dataDir>/backups. It knows its build
// (version, commit, start time, the web app's stamp) for open tabs to compare with theirs (CEL-37), and
// records it in the build history before it serves (CEL-50). main.ts and
// `cello start` launch it; integration tests build it on port 0.
import * as os from "node:os"
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
import * as AgentLogService from "./agentLog/AgentLogService.ts"
import { claudeProjectsDir } from "./agentLog/transcriptPath.ts"
import * as BackupSchedule from "./backup/BackupSchedule.ts"
import * as BackupService from "./backup/BackupService.ts"
import * as BuildHistory from "./build/BuildHistory.ts"
import * as BuildInfo from "./build/BuildInfo.ts"
import { commitsBetween } from "./build/git.ts"
import * as CallerMiddleware from "./caller/CallerMiddleware.ts"
import * as Migrations from "./persistence/Migrations.ts"
import * as Seed from "./persistence/Seed.ts"
import * as Sqlite from "./persistence/Sqlite.ts"
import * as AllowedOrigins from "./rpc/AllowedOrigins.ts"
import * as AssetStore from "./review/AssetStore.ts"
import * as Handlers from "./rpc/Handlers.ts"
import * as ServerLock from "./server/ServerLock.ts"
import * as Services from "./services.ts"
import * as PresenceWatch from "./session/PresenceWatch.ts"
import * as AgentDriver from "./wake/agents/AgentDriver.ts"
import { claudeCode } from "./wake/agents/claudeCode.ts"
import * as SessionHost from "./wake/SessionHost.ts"
import * as WakeConfig from "./wake/WakeConfig.ts"
import * as WakeService from "./wake/WakeService.ts"
import * as Attachments from "./web/Attachments.ts"
import * as RunLogs from "./web/RunLogs.ts"
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
  /** The git commit this server was built from (build/git.ts), for `server.build`; null or left out when unknown. */
  readonly commit?: string | null | undefined
  /**
   * A git checkout with this build's history, where the build history reads the commits merged since the
   * previous build (CEL-50); without one (or when git can't tell) it takes the web build's own list.
   */
  readonly checkout?: string | null | undefined
  /** Take the daily backup (on unless false). Integration tests turn it off; the schedule has its own tests. */
  readonly autoBackup?: boolean | undefined
  /**
   * Waking sessions (CEL-92). `env` is added to the environment woken runs get (tests put a stub
   * `claude` on PATH and point CLAUDE_CONFIG_DIR at a temp folder); `batch` and `quiet` replace the
   * 30 s and 2 min waits.
   */
  readonly wake?: {
    readonly env?: Readonly<Record<string, string>> | undefined
    readonly batch?: Duration.Input | undefined
    readonly quiet?: Duration.Input | undefined
  } | undefined
  /**
   * Claude Code's projects folder, the only place agents' transcripts are read from (CEL-106). Default:
   * `$CLAUDE_CONFIG_DIR/projects`, else `~/.claude/projects`. Tests point it at a temp folder.
   */
  readonly claudeProjectsDir?: string | undefined
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

/**
 * Waking sessions (CEL-92): WakeService decides, the session host runs, through the agent drivers (only
 * Claude Code for now). Woken runs get the server's environment plus CELLO_PORT, so their `cello`
 * commands reach this server, whatever port it bound.
 */
const wake = (options: ServerOptions) => {
  const config = Layer.effect(WakeConfig.WakeConfig, Effect.gen(function* () {
    const server = yield* HttpServer.HttpServer
    const port = "port" in server.address ? server.address.port : options.port
    return WakeConfig.make({
      runsDir: path.join(options.dataDir, WakeConfig.RUNS_DIR),
      env: Effect.sync(() => ({ ...process.env, ...options.wake?.env, CELLO_PORT: String(port) })),
      batch: options.wake?.batch,
      quiet: options.wake?.quiet,
    })
  }))
  // An agent's live log (CEL-106) reads woken runs' logs too, so it sits on the same config.
  const logs = AgentLogService.layer({ projectsDir: options.claudeProjectsDir ?? claudeProjectsDir(process.env, os.homedir()) })
  return Layer.merge(WakeService.layer, logs).pipe(
    Layer.provideMerge(SessionHost.layer),
    Layer.provideMerge(AgentDriver.layer([claudeCode()])),
    Layer.provideMerge(config),
  )
}

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
  const build = BuildInfo.layer({ commit: options.commit ?? null, web: options.web })
  const checkout = options.checkout
  const history = BuildHistory.layer({ changesBetween: checkout ? (from, to) => commitsBetween(checkout, from, to) : undefined })
  const app = history.pipe(
    Layer.provideMerge(Layer.mergeAll(wake(options).pipe(Layer.provideMerge(Services.layer)), backups, build)),
    Layer.provideMerge(storage),
    Layer.provideMerge(assets),
  )
  // The build is recorded before anything is served, so the first `builds.list` already names it running.
  const started = BuildHistory.recordOnStart.pipe(Layer.provideMerge(app))
  const rpc = RpcServer.layer(CelloRpcs).pipe(
    Layer.provide(Handlers.layer),
    Layer.provide(CallerMiddleware.layer),
    Layer.provideMerge(RpcServer.layerProtocolWebsocket({ path: "/rpc" })),
    Layer.provide(RpcSerialization.layerJson),
  )
  const api = Layer.mergeAll(rpc, Attachments.layer, Uploads.layer, RunLogs.layer, AllowedOrigins.layer)
  const routes = options.web === undefined ? api : Layer.mergeAll(api, WebFiles.layer(options.web))
  const dailyBackup = options.autoBackup === false ? Layer.empty : BackupSchedule.layer
  return Layer.mergeAll(HttpRouter.serve(routes, { disableLogger: true }), recordPort, dailyBackup, PresenceWatch.layer, WakeService.watchLayer).pipe(
    Layer.provide(started),
    Layer.provideMerge(BunHttpServer.layer({ hostname: "127.0.0.1", port: options.port, gracefulShutdownTimeout: SHUTDOWN_GRACE })),
    Layer.provideMerge(ServerLock.layer({ dataDir: options.dataDir, port: options.port })),
  )
}
