// Orchestrate mode (CEL-124): a session running work through builder and reviewer agents, which nobody
// watches. /cello:orchestrate puts its session in it (`cello sessions orchestrate on`) and `/cello:orchestrate
// off` takes it out. While it's on, the Claude Code hook turns the session's AskUserQuestion away (its
// dialog would block the run until someone answered), so its questions go on the card; a session chatting
// with Lucas isn't in it and keeps the dialog. It's a flag on the session, kept across a resumed
// conversation; each change is one `session.orchestrating` event, in the board of the project the command
// ran in, written in the same command.
import type { AgentSession, ProjectRef } from "@cello/contract/entities"
import { Invalid, NotFound } from "@cello/contract/errors"
import type { Caller } from "@cello/contract/rpcs"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import * as Commands from "../commands/Commands.ts"
import * as ProjectService from "../project/ProjectService.ts"
import { SessionService } from "./SessionService.ts"

export interface SetOrchestrating {
  readonly commandId: string
  readonly project: ProjectRef
  readonly on: boolean
}

export class OrchestrateService extends Context.Service<OrchestrateService, {
  /** Puts the calling session in orchestrate mode (`on`) or takes it out; the same again changes nothing. */
  readonly set: (input: SetOrchestrating) => Effect.Effect<Commands.Written<AgentSession>, NotFound | Invalid, Caller>
}>()("cello/OrchestrateService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const commands = yield* Commands.Commands
  const projects = yield* ProjectService.ProjectService
  const sessions = yield* SessionService

  const set = Effect.fn("OrchestrateService.set")(function* (input: SetOrchestrating) {
    const project = yield* projects.resolve(input.project)
    return yield* commands.write({ commandId: input.commandId, rpc: "session.orchestrate" }, ({ caller, emit }) =>
      Effect.gen(function* () {
        const id = caller.sessionId
        if (id === null) {
          return yield* new Invalid({
            field: "session",
            reason: "orchestrate mode is for an agent session: run it from the agent's own session (/cello:orchestrate does)",
          })
        }
        // A subagent's calls carry its parent's session: a builder turning it off would leave the
        // orchestrator open to a dialog nobody watches.
        if (caller.agentId) {
          return yield* new Invalid({ field: "session", reason: "orchestrate mode is for the main conversation, not a subagent" })
        }
        const changed = yield* sql<{ id: string }>`
          UPDATE agent_sessions SET orchestrating = ${input.on ? 1 : 0}
          WHERE id = ${id} AND orchestrating <> ${input.on ? 1 : 0} RETURNING id`
        if (changed.length > 0) {
          yield* emit({ type: "session.orchestrating", session: id, orchestrating: input.on }, { workspaceId: project.workspaceId, projectId: project.id })
        }
        const [session] = yield* sessions.byIds([id])
        return session!
      }))
  })

  return OrchestrateService.of({ set })
})

export const layer = Layer.effect(OrchestrateService, make)
