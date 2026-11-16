// A woken run's log over HTTP (CEL-92): GET /runs/<run id>/log sends `<dataDir>/runs/<session>/<time>.jsonl`
// as plain text, for the card's Log link. Only files inside the runs folder are ever sent (the same guard
// the Agents page's log uses, CEL-106); the global origin check guards it like every other route.
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import { guardLogFile } from "../agentLog/transcriptPath.ts"
import { SessionHost } from "../wake/SessionHost.ts"
import { WakeConfig } from "../wake/WakeConfig.ts"

export const layer = Layer.unwrap(Effect.gen(function* () {
  const host = yield* SessionHost
  const config = yield* WakeConfig
  return HttpRouter.add("GET", "/runs/:id/log", Effect.gen(function* () {
    const { id } = yield* HttpRouter.params
    const file = yield* host.logOf(id ?? "")
    const guarded = file === null ? null : guardLogFile(file, config.runsDir)
    if (guarded?._tag !== "ok") return HttpServerResponse.text("Not found", { status: 404 })
    return HttpServerResponse.raw(Bun.file(guarded.file), {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
    })
  }))
}))
