// Review evidence over HTTP: GET /attachments/<id> sends the stored file, GET /attachments/<id>/poster
// a video's poster frame. Range requests work, so videos seek. The global origin check guards these
// like every other route. (Not /assets/: that's where Vite puts the web app's bundles.)
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServerRequest from "effect/http/HttpServerRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import { ReviewService, type StoredFile } from "../review/ReviewService.ts"
import { parseRange } from "./range.ts"

/** Evidence never changes once stored: it can be cached for as long as the browser likes. */
const CACHE = "private, max-age=31536000, immutable"

export const respond = (stored: StoredFile, rangeHeader: string | undefined) => {
  const headers = {
    "content-type": stored.mime,
    "accept-ranges": "bytes",
    "cache-control": CACHE,
    "x-content-type-options": "nosniff",
  }
  const range = parseRange(rangeHeader, stored.bytes)
  switch (range._tag) {
    case "Whole":
      return HttpServerResponse.raw(Bun.file(stored.path), { headers: { ...headers, "content-length": String(stored.bytes) } })
    case "Partial":
      return HttpServerResponse.raw(Bun.file(stored.path).slice(range.start, range.end + 1), {
        status: 206,
        headers: {
          ...headers,
          "content-range": `bytes ${range.start}-${range.end}/${stored.bytes}`,
          "content-length": String(range.end - range.start + 1),
        },
      })
    case "Unsatisfiable":
      return HttpServerResponse.empty({ status: 416, headers: { ...headers, "content-range": `bytes */${stored.bytes}` } })
  }
}

export const layer = Layer.unwrap(Effect.gen(function* () {
  const reviews = yield* ReviewService
  const serve = (variant: "original" | "poster") =>
    Effect.gen(function* () {
      const { id } = yield* HttpRouter.params
      const request = yield* HttpServerRequest.HttpServerRequest
      return yield* reviews.file(id ?? "", variant).pipe(
        Effect.map((stored) => respond(stored, request.headers["range"])),
        Effect.catchTag("NotFound", () => Effect.succeed(HttpServerResponse.text("Not found", { status: 404 }))),
      )
    })
  return Layer.mergeAll(
    HttpRouter.add("GET", "/attachments/:id", serve("original")),
    HttpRouter.add("GET", "/attachments/:id/poster", serve("poster")),
  )
}))
