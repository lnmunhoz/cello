// The desktop app's server sidecar against real servers with temp data folders (never ~/.cello):
// it starts `cello start` when nothing answers and stops only what it started; it joins a server
// that already holds the data folder and leaves it running.
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { LOCK_FILE, parseLock } from "@cello/host/serverLock"
import { connectServer, probe } from "../../src/server/sidecar.ts"

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../cli/src/bin.ts")
/** `cello start` from source: the same command as the compiled binary. */
const command = [process.execPath, CLI]
const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" }

const readLock = (dataDir: string) =>
  fs.existsSync(path.join(dataDir, LOCK_FILE)) ? parseLock(fs.readFileSync(path.join(dataDir, LOCK_FILE), "utf8")) : null

describe("connectServer", () => {
  it.live("starts `cello start` when nothing answers, and stops it (releasing the lock) when asked", () =>
    Effect.gen(function* () {
      const dataDir = yield* tempDataDir
      // Port 0: nothing answers there, and the started server picks a free port and reports it.
      const server = yield* Effect.promise(() => connectServer({ port: 0, dataDir, command, env, defaultBoard: false }))
      expect(server.startedByUs).toBe(true)
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
      expect(yield* Effect.promise(() => probe(server.url))).toBe(true)
      const lock = readLock(dataDir)
      expect(lock && `http://127.0.0.1:${lock.port}`).toBe(server.url)

      yield* Effect.promise(() => server.stop())
      expect(readLock(dataDir)).toBeNull()
      expect(yield* Effect.promise(() => probe(server.url))).toBe(false)
    }).pipe(Effect.scoped))

  it.live("joins the server already running for the data folder, and leaves it running", () =>
    Effect.gen(function* () {
      const dataDir = yield* tempDataDir
      const { port } = yield* startServer(dataDir)
      const server = yield* Effect.promise(() => connectServer({ port: 0, dataDir, command, env, defaultBoard: false }))
      expect(server).toMatchObject({ url: `http://127.0.0.1:${port}`, startedByUs: false })

      yield* Effect.promise(() => server.stop())
      expect(yield* Effect.promise(() => probe(server.url))).toBe(true)
    }).pipe(Effect.scoped))

  it.live("CEL-149: a new board's folder on a port another board's server answers is refused, not joined, and the folder stays untouched", () =>
    Effect.gen(function* () {
      const other = yield* tempDataDir
      const { port } = yield* startServer(other)
      const fresh = yield* tempDataDir
      const error = yield* Effect.promise(() =>
        connectServer({ port, dataDir: fresh, command, env, defaultBoard: false }).then(
          () => null,
          (e: Error) => e,
        ))
      expect(error?.message).toBe(`Port ${port} is already used by another Cello board or another program; pick another port for this board.`)
      expect(fs.readdirSync(fresh)).toEqual([])
      expect(yield* Effect.promise(() => probe(`http://127.0.0.1:${port}`))).toBe(true)
    }).pipe(Effect.scoped))

  it.live("the default board joins what answers on its port, as before", () =>
    Effect.gen(function* () {
      const other = yield* tempDataDir
      const { port } = yield* startServer(other)
      const fresh = yield* tempDataDir
      const server = yield* Effect.promise(() => connectServer({ port, dataDir: fresh, command, env, defaultBoard: true }))
      expect(server).toMatchObject({ url: `http://127.0.0.1:${port}`, startedByUs: false })
    }).pipe(Effect.scoped))

  it.live("says why when there's no cello binary to start", () =>
    Effect.gen(function* () {
      const dataDir = yield* tempDataDir
      const error = yield* Effect.promise(() => connectServer({ port: 0, dataDir, command: null, env, defaultBoard: false }).catch((e: Error) => e))
      expect(String(error)).toContain("No Cello server is running")
    }).pipe(Effect.scoped))
})
