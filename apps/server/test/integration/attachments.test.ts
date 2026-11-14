// Review evidence over HTTP: a real server serves a submitted file at /attachments/<id> with its mime
// type and Range support (so videos seek), the poster at /attachments/<id>/poster, and the origin
// check guards it like every other route.
import * as fs from "node:fs"
import { newCommandId } from "@cello/client/client"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { writeMp4 } from "../../src/testing/media.ts"
import { AGENT_IDENTITY, connect, startServer, tempDataDir } from "./harness.ts"

describe("GET /attachments/<id>", () => {
  it.live("serves the file with its type, whole or by range, plus the poster; refuses other origins", () =>
    Effect.gen(function* () {
      const dataDir = yield* tempDataDir
      const { port } = yield* startServer(dataDir)
      const human = yield* connect(port)
      const agent = yield* connect(port, AGENT_IDENTITY)
      const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
      const { result: project } = yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "Cello", key: "CEL" })
      const { result: task } = yield* agent["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Evidence" })
      const video = writeMp4(dataDir, "flow.mp4", { codec: "h264" })
      const { result } = yield* agent["review.submit"]({
        commandId: newCommandId(),
        key: task.key,
        summary: "A video",
        steps: ["Watch it"],
        files: [{ path: video }],
        links: [{ url: "https://example.com/pr/1" }],
      })
      const [attachment, link] = result.review.attachments
      const original = fs.readFileSync(video)
      const size = original.byteLength

      const get = (pathname: string, headers: Record<string, string> = {}) =>
        Effect.promise(async () => {
          const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { headers })
          return { status: response.status, headers: response.headers, body: Buffer.from(await response.arrayBuffer()) }
        })

      const whole = yield* get(`/attachments/${attachment!.id}`)
      expect(whole.status).toBe(200)
      expect(whole.headers.get("content-type")).toBe("video/mp4")
      expect(whole.headers.get("accept-ranges")).toBe("bytes")
      expect(whole.headers.get("content-length")).toBe(String(size))
      expect(whole.body.equals(original)).toBe(true)

      const head = yield* get(`/attachments/${attachment!.id}`, { range: "bytes=0-99" })
      expect(head.status).toBe(206)
      expect(head.headers.get("content-range")).toBe(`bytes 0-99/${size}`)
      expect(head.body.equals(original.subarray(0, 100))).toBe(true)

      const tail = yield* get(`/attachments/${attachment!.id}`, { range: `bytes=${size - 10}-` })
      expect(tail.status).toBe(206)
      expect(tail.headers.get("content-range")).toBe(`bytes ${size - 10}-${size - 1}/${size}`)
      expect(tail.body.equals(original.subarray(size - 10))).toBe(true)

      const past = yield* get(`/attachments/${attachment!.id}`, { range: `bytes=${size}-` })
      expect(past.status).toBe(416)
      expect(past.headers.get("content-range")).toBe(`bytes */${size}`)

      const poster = yield* get(`/attachments/${attachment!.id}/poster`)
      expect(poster.status).toBe(200)
      expect(poster.headers.get("content-type")).toBe("image/jpeg")
      expect(poster.body.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true)

      expect((yield* get(`/attachments/${link!.id}`)).status).toBe(404)
      expect((yield* get("/attachments/01NOTANATTACHMENT")).status).toBe(404)
      expect((yield* get(`/attachments/${attachment!.id}`, { origin: "http://evil.example" })).status).toBe(403)
      expect((yield* get(`/attachments/${attachment!.id}`, { origin: `http://127.0.0.1:${port}` })).status).toBe(200)
    }).pipe(Effect.scoped))
})
