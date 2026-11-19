// One server per data folder. Before the database is opened, the server creates `server.lock`
// exclusively and writes its pid and port into it. A second server finds the file, sees the pid is
// alive, and stops with ServerAlreadyRunning naming the running one. A lock left by a dead process
// is taken over.
import * as fs from "node:fs"
import * as path from "node:path"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { DB_FILE, lockPath, readLock } from "@cello/host/serverLock"
import { isAlive } from "../process/isAlive.ts"

export class ServerAlreadyRunning extends Schema.TaggedError<ServerAlreadyRunning>()("ServerAlreadyRunning", {
  dataDir: Schema.String,
  pid: Schema.Number,
  port: Schema.Number,
}) {
  override get message(): string {
    return `Cello is already running for ${this.dataDir} (pid ${this.pid}, http://127.0.0.1:${this.port}).`
  }
}

export class ServerLock extends Context.Service<ServerLock, {
  readonly dataDir: string
  /** The database file inside the data folder; only open it while holding the lock. */
  readonly dbPath: string
  /** Rewrites the lock with the port actually bound (it may have been 0). */
  readonly recordPort: (port: number) => Effect.Effect<void>
}>()("cello/ServerLock") {}

/** Creates the lock file exclusively, taking over a stale one; fails if a live server holds it. */
const tryAcquire = (dataDir: string, file: string, port: number): Effect.Effect<void, ServerAlreadyRunning> =>
  Effect.suspend(() => {
    fs.mkdirSync(dataDir, { recursive: true })
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = fs.openSync(file, "wx")
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, port }))
        fs.closeSync(fd)
        return Effect.void
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        const holder = readLock(file)
        if (holder && isAlive(holder.pid)) {
          return Effect.fail(new ServerAlreadyRunning({ dataDir, pid: holder.pid, port: holder.port }))
        }
        fs.rmSync(file, { force: true })
      }
    }
    throw new Error(`Couldn't take ${file}`)
  })

/** Holds the lock for the layer's lifetime and removes it on release. */
export const layer = (options: { readonly dataDir: string; readonly port: number }) =>
  Layer.effect(ServerLock, Effect.gen(function* () {
    const dataDir = path.resolve(options.dataDir)
    const file = lockPath(dataDir)
    yield* Effect.acquireRelease(
      tryAcquire(dataDir, file, options.port),
      () => Effect.sync(() => {
        if (readLock(file)?.pid === process.pid) fs.rmSync(file, { force: true })
      }),
    )
    return ServerLock.of({
      dataDir,
      dbPath: path.join(dataDir, DB_FILE),
      recordPort: (port) => Effect.sync(() => fs.writeFileSync(file, JSON.stringify({ pid: process.pid, port }))),
    })
  }).pipe(Effect.withSpan("ServerLock.acquire")))
