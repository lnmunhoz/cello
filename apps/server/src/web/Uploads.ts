// Screenshots Lucas pastes or drops into his answers (CEL-47): POST /asks/<askId>/uploads?name=<file>
// with the image as the body. Over HTTP rather than the RPC socket because a 20 MB image, base64'd,
// is larger than a WebSocket message may be. Only the human uploads: a request carrying an agent
// session's identity header is refused, like `ask.answer`. Answers JSON: the stored attachment (201),
// or { error, reason } with 400 (Invalid), 403 (an agent) or 404 (no such ask).
import { Caller, HUMAN_SESSION, IDENTITY_HEADERS } from "@cello/contract/rpcs"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServerRequest from "effect/http/HttpServerRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import { AskService } from "../ask/AskService.ts"
import * as Seed from "../persistence/Seed.ts"

const json = (body: unknown, status: number) =>
  HttpServerResponse.text(JSON.stringify(body), { status, contentType: "application/json" })

export const layer = Layer.unwrap(Effect.gen(function* () {
  const asks = yield* AskService
  const human = yield* Seed.HumanActor
  return HttpRouter.add("POST", "/asks/:id/uploads", Effect.gen(function* () {
    const { id } = yield* HttpRouter.params
    const request = yield* HttpServerRequest.HttpServerRequest
    const session = request.headers[IDENTITY_HEADERS.session]?.trim()
    // An agent's request is refused before its body is read; the service checks the caller too.
    const caller = session && session !== HUMAN_SESSION ? { actorId: "", sessionId: session } : { actorId: human.id, sessionId: null }
    const name = new URL(request.url, "http://localhost").searchParams.get("name") ?? "image.png"
    const bytes = caller.sessionId === null ? new Uint8Array(yield* Effect.orDie(request.arrayBuffer)) : new Uint8Array()
    return yield* asks.upload({ askId: id ?? "", name, bytes }).pipe(
      Effect.provideService(Caller, caller),
      Effect.map((attachment) => json(attachment, 201)),
      Effect.catchTags({
        Invalid: (e) => Effect.succeed(json({ error: "Invalid", reason: e.reason }, 400)),
        NotFound: (e) => Effect.succeed(json({ error: "NotFound", reason: `no ${e.entity} ${e.id}` }, 404)),
        HumanOnly: (e) => Effect.succeed(json({ error: "HumanOnly", reason: `only ${e.human} can ${e.action}` }, 403)),
      }),
    )
  }))
}))
