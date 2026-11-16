// Which model a caller is on (CEL-119). As each request from an agent comes in (CallerMiddleware), the
// end of its own Claude Code transcript says which model wrote its last reply and at what effort: the
// session's transcript for the session, the subagent's for a subagent (both reported by the hooks,
// CEL-106). The caller carries them, so its comments and events are written with them (Commands,
// CommentService), and the session or subagent keeps them as its current model (the Agents page, presence).
//
// Unknown stays unknown: no transcript yet, a file that's gone or refused, no reply in it yet, or an agent
// that isn't Claude Code leave the caller's model null, and never a guess. A gone file doesn't clear the
// current model kept on the row: it's the last one known. Reading never fails or blocks a call: any
// failure is logged and the caller goes on without a model.
import { Caller } from "@cello/contract/rpcs"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import { modelReader, type ModelReaderOptions } from "../agentLog/transcriptModel.ts"

export class ModelService extends Context.Service<ModelService, {
  /** The caller with the model and effort of its transcript's last reply (null when unknown); the human as it is. */
  readonly stamp: (caller: Caller["Service"]) => Effect.Effect<Caller["Service"]>
}>()("cello/ModelService") {}

interface Kept {
  transcript_path: string | null
  model: string | null
  effort: string | null
}

export const layer = (options: ModelReaderOptions) =>
  Layer.effect(ModelService, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const read = modelReader(options)

    const keptOf = (sessionId: string, agentId: string | null) =>
      agentId === null
        ? sql<Kept>`SELECT transcript_path, model, effort FROM agent_sessions WHERE id = ${sessionId}`
        : sql<Kept>`SELECT transcript_path, model, effort FROM session_agents WHERE session_id = ${sessionId} AND agent_id = ${agentId}`

    const keep = (sessionId: string, agentId: string | null, model: string, effort: string | null) =>
      agentId === null
        ? sql`UPDATE agent_sessions SET model = ${model}, effort = ${effort} WHERE id = ${sessionId}`
        : sql`UPDATE session_agents SET model = ${model}, effort = ${effort} WHERE session_id = ${sessionId} AND agent_id = ${agentId}`

    const stamp = (caller: Caller["Service"]): Effect.Effect<Caller["Service"]> => {
      if (caller.sessionId === null) return Effect.succeed(caller)
      const sessionId = caller.sessionId
      const agentId = caller.agentId ?? null
      return Effect.gen(function* () {
        const [kept] = yield* keptOf(sessionId, agentId)
        const found = kept?.transcript_path ? read(kept.transcript_path) : null
        // Written only when it changed: most requests find the model they found last time.
        if (kept && found && (found.model !== kept.model || found.effort !== kept.effort)) {
          yield* keep(sessionId, agentId, found.model, found.effort)
        }
        return { ...caller, model: found?.model ?? null, effort: found?.effort ?? null }
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.as(Effect.logWarning(`Couldn't read which model the caller is on; it goes on without one.\n${Cause.pretty(cause)}`), caller)
        ),
        Effect.withSpan("ModelService.stamp"),
      )
    }

    return ModelService.of({ stamp })
  }))
