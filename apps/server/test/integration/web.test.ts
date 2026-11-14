// Test 9: the server serves the built web app on its own port (static files, plus index.html for
// client routes), /rpc keeps working, and the origin check allows the server's own port.
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as WebFiles from "../../src/web/WebFiles.ts"
import { connect, startServer, tempDataDir } from "./harness.ts"

const INDEX = "<!doctype html><title>Cello</title><script src=\"/assets/app-abc123.js\"></script>"

/** A fake `vite build` output. */
const writeWebBuild = (dir: string) => {
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true })
  fs.mkdirSync(path.join(dir, "icons"), { recursive: true })
  fs.writeFileSync(path.join(dir, "index.html"), INDEX)
  fs.writeFileSync(path.join(dir, "assets", "app-abc123.js"), "console.log('board')")
  fs.writeFileSync(path.join(dir, "icons", "icon.svg"), "<svg/>")
  return dir
}

describe("the server serves the web app", () => {
  it.live("static files, index.html for client routes, 404 for missing files, and /rpc alongside", () =>
    Effect.gen(function* () {
      const dataDir = yield* tempDataDir
      const web = WebFiles.fromDirectory(writeWebBuild(path.join(dataDir, "web")))
      const { port } = yield* startServer(dataDir, { web })
      const get = (pathname: string, headers: Record<string, string> = {}) =>
        Effect.promise(async () => {
          const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { headers: { accept: "text/html", ...headers } })
          return {
            status: response.status,
            type: response.headers.get("content-type"),
            cache: response.headers.get("cache-control"),
            body: await response.text(),
          }
        })

      expect(yield* get("/")).toMatchObject({ status: 200, body: INDEX, cache: "no-cache" })
      expect((yield* get("/")).type).toContain("text/html")
      for (const route of ["/CEL/issues", "/CEL/3", "/settings"]) {
        expect(yield* get(route)).toMatchObject({ status: 200, body: INDEX })
      }
      const script = yield* get("/assets/app-abc123.js")
      expect(script).toMatchObject({ status: 200, body: "console.log('board')", cache: "public, max-age=31536000, immutable" })
      expect(script.type).toContain("javascript")
      expect((yield* get("/icons/icon.svg")).type).toContain("image/svg+xml")
      expect((yield* get("/assets/missing.js")).status).toBe(404)
      expect((yield* get("/../server.lock")).status).not.toBe(200)

      // The page's own origin may open the socket; other origins may not.
      expect((yield* get("/rpc", { origin: `http://127.0.0.1:${port}`, upgrade: "websocket" })).status).not.toBe(403)
      expect((yield* get("/", { origin: "http://evil.example" })).status).toBe(403)
      const client = yield* connect(port)
      expect((yield* client["snapshot.get"]({})).workspaces).toHaveLength(1)
    }).pipe(Effect.scoped))

  it.live("without a web build, the server still answers /rpc and client routes are 404", () =>
    Effect.gen(function* () {
      const { port } = yield* startServer(yield* tempDataDir)
      const status = yield* Effect.promise(() => fetch(`http://127.0.0.1:${port}/CEL/issues`).then((r) => r.status))
      expect(status).toBe(404)
      const client = yield* connect(port)
      expect((yield* client["snapshot.get"]({})).workspaces).toHaveLength(1)
    }).pipe(Effect.scoped))
})
