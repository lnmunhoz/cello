// Test 10: `cello start` refuses a second server for the same data folder and prints the running
// one. And a real `cello start` serves the board and /rpc on its port, and stops promptly on
// SIGTERM or SIGINT even with board tabs connected (CEL-17).
import { Database } from "bun:sqlite"
import * as fs from "node:fs"
import * as net from "node:net"
import * as path from "node:path"
import * as BunSocket from "@effect/platform-bun/BunSocket"
import { CelloClient, makeClientLayer, newCommandId } from "@cello/client/client"
import { isAlive } from "@cello/server/process/isAlive"
import { LOCK_FILE } from "@cello/host/serverLock"
import { writeHungFfmpeg } from "@cello/server/testing/media"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import { APP_VERSION } from "@cello/release/version"
import { connect } from "../../../server/test/integration/harness.ts"
import { readUntil, spawnStart, startProcess } from "./cli.ts"

/** A board tab: an RPC client with a live event subscription that has delivered an event. */
const connectSubscriber = (port: number) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(makeClientLayer(BunSocket.layerWebSocket(`ws://127.0.0.1:${port}/rpc`)))
    const client = Context.get(context, CelloClient)
    const snapshot = yield* client["snapshot.get"]({})
    const workspace = snapshot.workspaces[0]!
    const first = yield* Effect.forkScoped(
      client["events.subscribe"]({ scope: { workspaceId: workspace.id }, afterSeq: snapshot.seq }).pipe(
        Stream.take(1),
        Stream.runCollect,
      ),
    )
    const { result: project } = yield* client["project.create"]({ commandId: newCommandId(), workspaceId: workspace.id, name: "Cello", key: "CEL" })
    expect(yield* Fiber.join(first)).toHaveLength(1)
    const { result: task } = yield* client["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Shutdown" })
    // Stays subscribed: the server keeps a stream open for this client until it stops.
    yield* Effect.forkScoped(
      Stream.runDrain(client["events.subscribe"]({ scope: { workspaceId: workspace.id }, afterSeq: snapshot.seq })),
    )
    return { client, task }
  })

/** One masked WebSocket text frame, as a client sends it. */
const clientFrame = (text: string): Buffer => {
  const payload = Buffer.from(text)
  const mask = Buffer.from([1, 2, 3, 4])
  const header = payload.length < 126
    ? Buffer.from([0x81, 0x80 | payload.length])
    : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff])
  return Buffer.concat([header, mask, payload.map((byte, i) => byte ^ mask[i % 4]!)])
}

/**
 * A client that never reads: it upgrades /rpc by hand, subscribes, then stops reading its socket,
 * so it never answers the server's close frame.
 */
const connectNonReader = (port: number, workspaceId: string) =>
  Effect.acquireRelease(
    Effect.callback<net.Socket>((resume) => {
      const socket = net.connect(port, "127.0.0.1", () => {
        socket.write([
          "GET /rpc HTTP/1.1",
          `Host: 127.0.0.1:${port}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n"))
      })
      socket.once("data", (chunk) => {
        expect(chunk.toString()).toMatch(/^HTTP\/1\.1 101/)
        socket.pause()
        socket.write(clientFrame(JSON.stringify({
          _tag: "Request",
          id: "1",
          tag: "events.subscribe",
          payload: { scope: { workspaceId }, afterSeq: 0 },
          headers: [],
        })))
        resume(Effect.succeed(socket))
      })
    }),
    (socket) => Effect.sync(() => socket.destroy()),
  )

/**
 * How long a stop may take with clients connected (CEL-17). It takes about 1 s; 10 s leaves room on
 * a busy machine and still proves it isn't Bun's 20 s wait for connections to close.
 */
const STOP_DEADLINE = Duration.seconds(10)
const TEST_TIMEOUT = 30_000

/** Sends `signal` and expects the process to exit within the deadline, with its lock released. */
const expectStops = (proc: Bun.Subprocess<"ignore", "pipe", "pipe">, dataDir: string, signal: NodeJS.Signals) =>
  Effect.gen(function* () {
    const stopped = Date.now()
    proc.kill(signal)
    const exited = yield* Effect.promise(() => proc.exited).pipe(Effect.timeoutOption(STOP_DEADLINE))
    const took = Date.now() - stopped
    expect(Option.isSome(exited), `still running ${took} ms after ${signal}`).toBe(true)
    expect(fs.existsSync(path.join(dataDir, LOCK_FILE))).toBe(false)
    expect(yield* Effect.promise(() => new Response(proc.stderr).text())).toBe("")
  })

describe("cello start", () => {
  it.live("refuses to start a second server for the same data folder and prints the running one", () =>
    Effect.gen(function* () {
      const dataDir = yield* tempDataDir
      const { port } = yield* startServer(dataDir)
      const proc = yield* spawnStart({ CELLO_DATA_DIR: dataDir, CELLO_PORT: "0" })
      const code = yield* Effect.promise(() => proc.exited)
      const stderr = yield* Effect.promise(() => new Response(proc.stderr).text())
      expect(code).toBe(1)
      expect(stderr.trim()).toBe(`Cello is already running for ${dataDir} (pid ${process.pid}, http://127.0.0.1:${port}).`)
    }).pipe(Effect.scoped))

  it.live("CEL-149: refuses a board a newer Cello migrated, saying so in one line, and changes nothing", () =>
    Effect.gen(function* () {
      const dataDir = yield* tempDataDir
      yield* Effect.scoped(startServer(dataDir))
      const db = new Database(path.join(dataDir, "cello.db"))
      const { newest } = db.query("SELECT MAX(migration_id) AS newest FROM migrations").get() as { newest: number }
      db.run("INSERT INTO migrations (migration_id, name) VALUES (?, 'from_a_newer_cello')", [newest + 1])
      db.close()
      const files = () => fs.readdirSync(dataDir).sort()
      const before = files()
      const proc = yield* spawnStart({ CELLO_DATA_DIR: dataDir, CELLO_PORT: "0" })
      const code = yield* Effect.promise(() => proc.exited)
      const stderr = yield* Effect.promise(() => new Response(proc.stderr).text())
      expect(code).toBe(1)
      expect(stderr.trim()).toBe(
        `This board (${dataDir}) was opened by a newer Cello (migration ${String(newest + 1).padStart(4, "0")}_from_a_newer_cello); ` +
          `this cello is v${APP_VERSION}. Update Cello, or use another board. Nothing was changed.`,
      )
      // The database was closed before the process exited: no -wal or -shm left, no lock, nothing new.
      expect(files()).toEqual(before)
      expect(fs.existsSync(path.join(dataDir, LOCK_FILE))).toBe(false)
    }).pipe(Effect.scoped))

  it.live("runs the server with the web app, on CELLO_PORT with data in CELLO_DATA_DIR", () =>
    Effect.gen(function* () {
      const dataDir = yield* tempDataDir
      const webDir = path.join(dataDir, "web")
      fs.mkdirSync(webDir)
      fs.writeFileSync(path.join(webDir, "index.html"), "<title>Cello board</title>")
      const proc = yield* spawnStart({ CELLO_DATA_DIR: path.join(dataDir, "data"), CELLO_PORT: "0", CELLO_WEB_DIR: webDir })
      const running = /Cello is running at http:\/\/127\.0\.0\.1:(\d+) .*\n/
      const banner = yield* readUntil(proc.stdout, running)
      const port = Number(running.exec(banner)![1])
      expect(banner).toContain(`data in ${path.join(dataDir, "data")}`)
      const board = yield* Effect.promise(() =>
        fetch(`http://127.0.0.1:${port}/CEL/issues`, { headers: { accept: "text/html" } }).then((r) => r.text())
      )
      expect(board).toBe("<title>Cello board</title>")
      expect(fs.existsSync(path.join(dataDir, "data", "cello.db"))).toBe(true)
    }).pipe(Effect.scoped))

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    it.live(`${signal} stops it within ${Duration.format(STOP_DEADLINE)} with clients connected, and releases the lock`, () =>
      Effect.gen(function* () {
        const dataDir = yield* tempDataDir
        const { proc, port } = yield* startProcess(dataDir)
        const { client } = yield* connectSubscriber(port)
        const { workspaces } = yield* client["snapshot.get"]({})
        yield* connectNonReader(port, workspaces[0]!.id)
        yield* expectStops(proc, dataDir, signal)
      }).pipe(Effect.scoped), TEST_TIMEOUT)
  }

  it.live("SIGTERM stops it while a review submit waits on an ffmpeg that never finishes", () =>
    Effect.gen(function* () {
      const dataDir = yield* tempDataDir
      const bin = path.join(dataDir, "bin")
      fs.mkdirSync(bin)
      const ffmpeg = writeHungFfmpeg(bin)
      const { proc, port } = yield* startProcess(path.join(dataDir, "data"), { PATH: `${bin}:${process.env.PATH ?? ""}` })
      const { client, task } = yield* connectSubscriber(port)
      const video = path.join(dataDir, "flow.mp4")
      fs.writeFileSync(video, "not really a video")
      yield* Effect.forkScoped(Effect.exit(client["review.submit"]({
        commandId: newCommandId(),
        key: task.key,
        summary: "Stops cleanly",
        steps: ["Send SIGTERM"],
        files: [{ path: video }],
        links: [],
      })))
      const pid = yield* Effect.promise(ffmpeg.started)
      yield* expectStops(proc, path.join(dataDir, "data"), "SIGTERM")
      expect(isAlive(pid)).toBe(false)
    }).pipe(Effect.scoped), TEST_TIMEOUT)
  it.live("CEL-37: from source it reports CELLO_BUILD_COMMIT as its commit, and the stamp of the web app it serves", () =>
    Effect.gen(function* () {
      const dataDir = yield* tempDataDir
      const webDir = path.join(dataDir, "web")
      fs.mkdirSync(webDir)
      fs.writeFileSync(path.join(webDir, "index.html"), "<title>Cello board</title>")
      const stamp = { version: APP_VERSION, commit: "bbbbbbb", builtAt: 1_763_230_000_000, changes: ["merge: the reload bar (CEL-37)"] }
      fs.writeFileSync(path.join(webDir, "build.json"), JSON.stringify(stamp))
      const proc = yield* spawnStart({ CELLO_DATA_DIR: path.join(dataDir, "data"), CELLO_PORT: "0", CELLO_WEB_DIR: webDir, CELLO_BUILD_COMMIT: "bbbbbbb" })
      const running = /Cello is running at http:\/\/127\.0\.0\.1:(\d+) .*\n/
      const port = Number(running.exec(yield* readUntil(proc.stdout, running))![1])
      const build = yield* (yield* connect(port))["server.build"]({})
      expect(build).toMatchObject({ version: APP_VERSION, commit: "bbbbbbb", web: stamp })
    }).pipe(Effect.scoped))
})
