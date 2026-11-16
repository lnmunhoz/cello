// What a hook saw the caller do besides checking in (`activity.report`): the session itself, or with
// `x-cello-agent` one of its subagents (CEL-55). The rules are ./activity.ts; this keeps them on the
// caller's row.
//
// - `background` (CEL-133): a tool call started background work (a shell run with run_in_background, a
//   Monitor). It's remembered, so a later stop can tell a subagent waiting on its own work from one that
//   finished (AgentService.report).
import type { ActivityReport } from "@cello/contract/rpcs"
import { Caller } from "@cello/contract/rpcs"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import { type BackgroundWork, parseBackground, stored, withBackground } from "./activity.ts"
import { cleanAgentText, cleanStep } from "./SessionService.ts"

export class ActivityService extends Context.Service<ActivityService, {
  /** What a hook saw the caller do. The human, or a call without a session, changes nothing. */
  readonly report: (report: ActivityReport) => Effect.Effect<void, never, Caller>
}>()("cello/ActivityService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  /** The caller's stored background work, changed by `change`, in one transaction. */
  const changeBackground = (caller: Caller["Service"], change: (list: ReadonlyArray<BackgroundWork>) => ReadonlyArray<BackgroundWork>) =>
    sql.withTransaction(Effect.gen(function* () {
      if (caller.sessionId === null) return
      if (caller.agentId) {
        const [row] = yield* sql<{ background_json: string | null }>`
          SELECT background_json FROM session_agents WHERE session_id = ${caller.sessionId} AND agent_id = ${caller.agentId}`
        if (!row) return
        yield* sql`UPDATE session_agents SET background_json = ${stored(change(parseBackground(row.background_json)))}
          WHERE session_id = ${caller.sessionId} AND agent_id = ${caller.agentId}`
      } else {
        const [row] = yield* sql<{ background_json: string | null }>`SELECT background_json FROM agent_sessions WHERE id = ${caller.sessionId}`
        if (!row) return
        yield* sql`UPDATE agent_sessions SET background_json = ${stored(change(parseBackground(row.background_json)))} WHERE id = ${caller.sessionId}`
      }
    }))

  const report = Effect.fn("ActivityService.report")(function* (input: ActivityReport) {
    const caller = yield* Caller
    if (caller.sessionId === null) return
    switch (input.kind) {
      case "background": {
        const id = cleanAgentText(input.id)
        if (id === null) return
        const work: BackgroundWork = { id, label: cleanStep(input.label) ?? "Background work", toolUseId: cleanAgentText(input.toolUseId) }
        yield* changeBackground(caller, (list) => withBackground(list, work))
        return
      }
    }
  }, Effect.orDie)

  return ActivityService.of({ report })
})

export const layer = Layer.effect(ActivityService, make)
