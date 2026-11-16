// Screenshots Lucas pastes or drops while he writes, uploaded at once with the image as the body:
// - POST /asks/<askId>/uploads?name=<file>: into his answers to an ask (CEL-47)
// - POST /tasks/<taskId>/uploads?name=<file>: into a task's comment box, in the task panel or on the Review page (CEL-73)
// Over HTTP rather than the RPC socket because a 20 MB image, base64'd, is larger than a WebSocket
// message may be. Only the human uploads: a request carrying an agent session's identity header is
// refused before its body is read (the services check the caller too). Answers JSON: the stored draft
// attachment (201), or { error, reason } with 400 (Invalid), 403 (an agent) or 404 (no such ask or task).
import type { Attachment } from "@cello/contract/entities"
import type { HumanOnly, Invalid, NotFound } from "@cello/contract/errors"
import { Caller, HUMAN_SESSION, IDENTITY_HEADERS } from "@cello/contract/rpcs"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServerRequest from "effect/http/HttpServerRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import { AskService } from "../ask/AskService.ts"
import { CommentService } from "../comment/CommentService.ts"
import * as Seed from "../persistence/Seed.ts"

const json = (body: unknown, status: number) =>
  HttpServerResponse.text(JSON.stringify(body), { status, contentType: "application/json" })

type Store = (id: string, name: string, bytes: Uint8Array) => Effect.Effect<Attachment, Invalid | NotFound | HumanOnly, Caller>

/** One upload route: decodes the request, calls `store` once as the caller, and maps its errors. */
const route = (pattern: `/${string}/:id/uploads`, humanId: string, store: Store) =>
  HttpRouter.add("POST", pattern, Effect.gen(function* () {
    const { id } = yield* HttpRouter.params
    const request = yield* HttpServerRequest.HttpServerRequest
    const session = request.headers[IDENTITY_HEADERS.session]?.trim()
    const caller = session && session !== HUMAN_SESSION ? { actorId: "", sessionId: session } : { actorId: humanId, sessionId: null }
    const name = new URL(request.url, "http://localhost").searchParams.get("name") ?? "image.png"
    const bytes = caller.sessionId === null ? new Uint8Array(yield* Effect.orDie(request.arrayBuffer)) : new Uint8Array()
    return yield* store(id ?? "", name, bytes).pipe(
      Effect.provideService(Caller, caller),
      Effect.map((attachment) => json(attachment, 201)),
      Effect.catchTags({
        Invalid: (e) => Effect.succeed(json({ error: "Invalid", reason: e.reason }, 400)),
        NotFound: (e) => Effect.succeed(json({ error: "NotFound", reason: `no ${e.entity} ${e.id}` }, 404)),
        HumanOnly: (e) => Effect.succeed(json({ error: "HumanOnly", reason: `only ${e.human} can ${e.action}` }, 403)),
      }),
    )
  }))

export const layer = Layer.unwrap(Effect.gen(function* () {
  const asks = yield* AskService
  const comments = yield* CommentService
  const human = yield* Seed.HumanActor
  return Layer.mergeAll(
    route("/asks/:id/uploads", human.id, (askId, name, bytes) => asks.upload({ askId, name, bytes })),
    route("/tasks/:id/uploads", human.id, (taskId, name, bytes) => comments.upload({ taskId, name, bytes })),
  )
}))
