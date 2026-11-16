// A woken run's log over HTTP (CEL-92): GET /runs/<run id>/log sends `<dataDir>/runs/<session>/<time>.jsonl`
// as plain text, for the card's Log link. Only files inside the runs folder are ever sent; the global
// origin check guards it like every other route.
import * as fs from "node:fs"
import * as path from "node:path"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import { SessionHost } from "../wake/SessionHost.ts"
import { WakeConfig } from "../wake/WakeConfig.ts"

/** Whether `file` is inside `dir` (both resolved, symlinks too). */
const inside = (dir: string, file: string) => {
  try {
    const relative = path.relative(fs.realpathSync(dir), fs.realpathSync(file))
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  } catch {
    return false
  }
}

export const layer = Layer.unwrap(Effect.gen(function* () {
  const host = yield* SessionHost
  const config = yield* WakeConfig
  return HttpRouter.add("GET", "/runs/:id/log", Effect.gen(function* () {
    const { id } = yield* HttpRouter.params
    const file = yield* host.logOf(id ?? "")
    if (file === null || !inside(config.runsDir, file)) return HttpServerResponse.text("Not found", { status: 404 })
    return HttpServerResponse.raw(Bun.file(file), {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
    })
  }))
}))
