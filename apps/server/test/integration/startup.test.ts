// Tests 15–16: first start seeds once; one server per data folder.
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import { DEFAULT_STATUSES } from "../../src/status/defaults.ts"
import { DB_FILE, LOCK_FILE } from "../../src/server/ServerLock.ts"
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
})
