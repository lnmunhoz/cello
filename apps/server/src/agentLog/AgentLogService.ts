// An agent's live log (CEL-106): which file belongs to the agent asked for, and following it. Sessions
// and subagents have the transcript their hooks last reported (SessionService, AgentService); a woken
// run (CEL-92) has its log under the runs folder. The web names only ids, never a path, and each read
// goes through the guard: transcripts inside Claude Code's projects/ folder, run logs inside the runs one.
import type { LogUpdate } from "@cello/contract/agentLog"
import { NotFound } from "@cello/contract/errors"
import { Caller } from "@cello/contract/rpcs"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as SqlClient from "effect/sql/SqlClient"
import { WakeConfig } from "../wake/WakeConfig.ts"
import { followLog, type Watch, watchFile } from "./followLog.ts"
import { guardLogFile } from "./transcriptPath.ts"

/** Whose log: a session, one of its subagents, or one of its woken runs. */
export interface LogSource {
  readonly sessionId: string
  readonly agentId?: string | undefined
  readonly runId?: string | undefined
  /** Keys and tokens as they are; honoured for the human only. */
  readonly reveal?: boolean | undefined
}

export interface AgentLogOptions {
  /** Claude Code's projects folder (transcriptPath.ts claudeProjectsDir): the only place transcripts are read from. */
  readonly projectsDir: string
  /** Tests may pass their own; the server watches the file's folder. */
  readonly watch?: Watch | undefined
}

export class AgentLogService extends Context.Service<AgentLogService, {
  readonly log: (source: LogSource) => Stream.Stream<LogUpdate, NotFound, Caller>
}>()("cello/AgentLogService") {}

export const layer = (options: AgentLogOptions) =>
  Layer.effect(AgentLogService, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const wake = yield* WakeConfig
    const watch = options.watch ?? watchFile

    /** The file and the folder it must be inside, or null when nothing was reported yet. */
    const fileOf = (source: LogSource) =>
      Effect.gen(function* () {
        if (source.runId !== undefined) {
          const [run] = yield* sql<{ log_path: string }>`SELECT log_path FROM session_runs WHERE id = ${source.runId} AND session_id = ${source.sessionId}`
          if (!run) return yield* new NotFound({ entity: "run", id: source.runId })
          return { file: run.log_path, root: wake.runsDir }
        }
        if (source.agentId !== undefined) {
          const [agent] = yield* sql<{ transcript_path: string | null }>`
            SELECT transcript_path FROM session_agents WHERE session_id = ${source.sessionId} AND agent_id = ${source.agentId}`
          if (!agent) return yield* new NotFound({ entity: "agent", id: source.agentId })
          return agent.transcript_path === null ? null : { file: agent.transcript_path, root: options.projectsDir }
        }
        const [session] = yield* sql<{ transcript_path: string | null }>`SELECT transcript_path FROM agent_sessions WHERE id = ${source.sessionId}`
        if (!session) return yield* new NotFound({ entity: "session", id: source.sessionId })
        return session.transcript_path === null ? null : { file: session.transcript_path, root: options.projectsDir }
      }).pipe(Effect.catchTag("SqlError", Effect.die))

    const log = (source: LogSource) =>
      Stream.unwrap(Effect.gen(function* () {
        const caller = yield* Caller
        const found = yield* fileOf(source)
        if (found === null) return Stream.succeed<LogUpdate>({ _tag: "unavailable", reason: "none" })
        return followLog({
          file: found.file,
          check: () => guardLogFile(found.file, found.root),
          reveal: source.reveal === true && caller.sessionId === null,
          watch,
        })
      }))

    return AgentLogService.of({ log })
  }))
