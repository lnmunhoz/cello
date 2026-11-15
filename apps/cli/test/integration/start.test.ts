// Test 10: `cello start` refuses a second server for the same data folder and prints the running
// one. And a real `cello start` serves the board and /rpc on its port, and stops promptly on
// SIGTERM or SIGINT even with board tabs connected (CEL-17).
import * as fs from "node:fs"
import * as net from "node:net"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import * as BunSocket from "@effect/platform-bun/BunSocket"
import { CelloClient, makeClientLayer, newCommandId } from "@cello/client/client"
import { LOCK_FILE } from "@cello/server/server/ServerLock"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"

const MAIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/bin.ts")

/** Runs `cello start` as its own process; it's killed (by its pid) when the scope closes. */
const spawnStart = (env: Record<string, string>) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      Bun.spawn([process.execPath, MAIN, "start"], {
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
        stdout: "pipe",
        stderr: "pipe",
      })
    ),
    (proc) => Effect.promise(async () => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL")
      await proc.exited
    }),
  )

/** Reads a stream until `pattern` matches what has arrived so far. */
const readUntil = (stream: ReadableStream<Uint8Array>, pattern: RegExp) =>
  Effect.promise(async () => {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let text = ""
    while (!pattern.test(text)) {
      const { value, done } = await reader.read()
      if (done) break
      text += decoder.decode(value)
    }
    reader.releaseLock()
    return text
  })

const RUNNING = /Cello is running at http:\/\/127\.0\.0\.1:(\d+) .*\n/

/** Starts `cello start` (daily backup on, as in production) and waits for its banner. */
const startProcess = (dataDir: string) =>
  Effect.gen(function* () {
    const proc = yield* spawnStart({ CELLO_DATA_DIR: dataDir, CELLO_PORT: "0" })
    const banner = yield* readUntil(proc.stdout, RUNNING)
    return { proc, port: Number(RUNNING.exec(banner)![1]) }
  })

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
    yield* client["project.create"]({ commandId: newCommandId(), workspaceId: workspace.id, name: "Cello", key: "CEL" })
    expect(yield* Fiber.join(first)).toHaveLength(1)
    // Stays subscribed: the server keeps a stream open for this client until it stops.
    yield* Effect.forkScoped(
      Stream.runDrain(client["events.subscribe"]({ scope: { workspaceId: workspace.id }, afterSeq: snapshot.seq })),
    )
    return client
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

/** How long a stop may take with clients connected (CEL-17). */
const STOP_DEADLINE = Duration.seconds(2)

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
        const subscriber = yield* connectSubscriber(port)
        const { workspaces } = yield* subscriber["snapshot.get"]({})
        yield* connectNonReader(port, workspaces[0]!.id)

        const stopped = Date.now()
        proc.kill(signal)
        const exited = yield* Effect.promise(() => proc.exited).pipe(Effect.timeoutOption(STOP_DEADLINE))
        const took = Date.now() - stopped

        expect(Option.isSome(exited), `still running ${took} ms after ${signal}`).toBe(true)
        expect(fs.existsSync(path.join(dataDir, LOCK_FILE))).toBe(false)
        expect(yield* Effect.promise(() => new Response(proc.stderr).text())).toBe("")
      }).pipe(Effect.scoped))
  }
})
