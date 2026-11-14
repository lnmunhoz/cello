// Test 10: `cello start` refuses a second server for the same data folder and prints the running
// one. And a real `cello start` serves the board and /rpc on its port.
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

const MAIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/bin.ts")

/** Runs `cello start` as its own process; it's stopped (by its pid) when the scope closes. */
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
      if (proc.exitCode === null) proc.kill()
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
})
