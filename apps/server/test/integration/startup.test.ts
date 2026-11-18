// Tests 15–16: first start seeds once; one server per data folder. CEL-149: a board a newer Cello migrated
// is refused before anything is written.
import { Database } from "bun:sqlite"
import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { APP_VERSION } from "@cello/release/version"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import { DEFAULT_STATUSES } from "../../src/status/defaults.ts"
import { DB_FILE, LOCK_FILE } from "@cello/host/serverLock"
import { HUMAN, startServer, tempDataDir, withClient } from "./harness.ts"

/** Starts a server, takes a snapshot, stops the server. */
const snapshotOfFreshStart = (dataDir: string) =>
  Effect.scoped(Effect.gen(function* () {
    const { port } = yield* startServer(dataDir)
    return yield* withClient(port, (client) => client["snapshot.get"]({}))
  }))

describe("startup", () => {
  it.live("first start seeds once; a restart against the same database adds nothing", () =>
    Effect.gen(function* () {
      const dataDir = yield* tempDataDir
      const first = yield* snapshotOfFreshStart(dataDir)
      expect(first.actors.map((a) => [a.kind, a.name])).toEqual([["human", HUMAN]])
      expect(first.workspaces.map((w) => w.name)).toEqual(["Personal"])
      expect(first.statuses.map((s) => [s.name, s.category, s.hidden])).toEqual(
        DEFAULT_STATUSES.map((s) => [s.name, s.category, s.hidden]),
      )
      expect(first.seq).toBe(0)

      const second = yield* snapshotOfFreshStart(dataDir)
      expect(second).toEqual(first)
    }).pipe(Effect.scoped))

  it.live("a second server on the same data folder doesn't open the database and reports the running one", () =>
    Effect.gen(function* () {
      const dataDir = yield* tempDataDir
      const { port } = yield* startServer(dataDir)
      expect(JSON.parse(fs.readFileSync(path.join(dataDir, LOCK_FILE), "utf8"))).toEqual({ pid: process.pid, port })

      const error = yield* Effect.flip(Effect.scoped(startServer(dataDir)))
      expect(error).toMatchObject({ _tag: "ServerAlreadyRunning", pid: process.pid, port })
      expect(error.message).toContain(`http://127.0.0.1:${port}`)

      // The first server is unaffected.
      const snapshot = yield* withClient(port, (client) => client["snapshot.get"]({}))
      expect(snapshot.workspaces).toHaveLength(1)
    }).pipe(Effect.scoped))

  it.live("the lock is checked before the database is opened", () =>
    Effect.gen(function* () {
      const dataDir = yield* tempDataDir
      // A live server (this process) holds the lock, but no database exists yet.
      fs.writeFileSync(path.join(dataDir, LOCK_FILE), JSON.stringify({ pid: process.pid, port: 4748 }))
      const error = yield* Effect.flip(Effect.scoped(startServer(dataDir)))
      expect(error).toMatchObject({ _tag: "ServerAlreadyRunning", pid: process.pid, port: 4748 })
      expect(fs.existsSync(path.join(dataDir, DB_FILE))).toBe(false)
    }).pipe(Effect.scoped))

  it.live("a lock left by a dead process is taken over, and released on shutdown", () =>
    Effect.gen(function* () {
      const dataDir = yield* tempDataDir
      const lockFile = path.join(dataDir, LOCK_FILE)
      const dead = Bun.spawnSync(["true"]).pid // exited already
      fs.writeFileSync(lockFile, JSON.stringify({ pid: dead, port: 1 }))

      const scope = yield* Scope.make()
      const { port } = yield* startServer(dataDir).pipe(Scope.provide(scope))
      expect(JSON.parse(fs.readFileSync(lockFile, "utf8"))).toEqual({ pid: process.pid, port })
      yield* Scope.close(scope, Exit.void)
      expect(fs.existsSync(lockFile)).toBe(false)
    }).pipe(Effect.scoped))

  it.live("CEL-149: a board a newer Cello migrated is refused before anything is written, and the lock is released", () =>
    Effect.gen(function* () {
      const dataDir = yield* tempDataDir
      // A real board, made and stopped by this build, then migrated further by a "newer" one.
      yield* snapshotOfFreshStart(dataDir)
      const dbPath = path.join(dataDir, DB_FILE)
      const db = new Database(dbPath)
      const { newest } = db.query("SELECT MAX(migration_id) AS newest FROM migrations").get() as { newest: number }
      db.run("INSERT INTO migrations (migration_id, name) VALUES (?, 'from_a_newer_cello')", [newest + 1])
      const builds = (db.query("SELECT COUNT(*) AS n FROM builds").get() as { n: number }).n
      db.close()
      const files = () => fs.readdirSync(dataDir).sort()
      const hash = () => crypto.createHash("sha256").update(fs.readFileSync(dbPath)).digest("hex")
      const [filesBefore, hashBefore] = [files(), hash()]

      const error = yield* Effect.flip(Effect.scoped(startServer(dataDir)))
      const migration = `${String(newest + 1).padStart(4, "0")}_from_a_newer_cello`
      expect(error).toMatchObject({ _tag: "BoardTooNew", newest: migration, version: APP_VERSION, dataDir })
      expect(error.message).toBe(
        `This board (${dataDir}) was opened by a newer Cello (migration ${migration}); this cello is v${APP_VERSION}. ` +
          "Update Cello, or use another board. Nothing was changed.",
      )
      // Nothing written: the same database bytes, no new build recorded, no seed, and no lock left behind.
      expect(hash()).toBe(hashBefore)
      expect(files()).toEqual(filesBefore)
      expect(fs.existsSync(path.join(dataDir, LOCK_FILE))).toBe(false)
      const after = new Database(dbPath, { readonly: true })
      expect((after.query("SELECT COUNT(*) AS n FROM builds").get() as { n: number }).n).toBe(builds)
      after.close()

      // The server's own entry (src/main.ts) prints the sentence, exits 1, and leaves no -wal, -shm or lock behind.
      const entry = Bun.spawn([process.execPath, path.join(import.meta.dirname, "../../src/main.ts")], {
        env: { PATH: process.env.PATH ?? "", HOME: yield* tempDataDir, CELLO_DATA_DIR: dataDir, CELLO_PORT: "0" },
        stdout: "ignore",
        stderr: "pipe",
      })
      const [code, stderr] = yield* Effect.promise(() => Promise.all([entry.exited, new Response(entry.stderr).text()]))
      expect(code).toBe(1)
      expect(stderr.trim()).toBe(error.message)
      expect(files()).toEqual(filesBefore)
      expect(hash()).toBe(hashBefore)
    }).pipe(Effect.scoped))
})
