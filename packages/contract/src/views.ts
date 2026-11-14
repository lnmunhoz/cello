// Read models for the CLI (and later MCP): one RPC returns everything a command prints.
import * as Schema from "effect/Schema"
import { Actor, AgentSession, Comment, Label, Project, Status, Task } from "./entities.ts"
import { CelloEvent } from "./events.ts"

/** Who the server sees: the actor, its agent session (null for the human), and the project if one resolved. */
export const Whoami = Schema.Struct({
  actor: Actor,
  session: Schema.NullOr(AgentSession),
  project: Schema.NullOr(Project),
})
export type Whoami = typeof Whoami.Type

/** A project with the names a command needs to print ids: statuses, labels, actors and sessions. */
const projectFields = {
  project: Project,
  statuses: Schema.Array(Status),
  labels: Schema.Array(Label),
  actors: Schema.Array(Actor),
  sessions: Schema.Array(AgentSession),
}

/** An event with the key of the task it's about (null for non-task events). */
export const Activity = Schema.Struct({ event: CelloEvent, taskKey: Schema.NullOr(Schema.String) })
export type Activity = typeof Activity.Type

export const ProjectContext = Schema.Struct({
  ...projectFields,
  actor: Actor,
  session: Schema.NullOr(AgentSession),
  /** Tasks this caller holds: assigned to its session (or, for the human, to the human with no session). */
  claimed: Schema.Array(Task),
  /** The project's latest events, newest first. */
  recent: Schema.Array(Activity),
  /** Claims this session lost, newest first: taken over by another session, or ended by a human change. */
  lostClaims: Schema.Array(Activity),
})
export type ProjectContext = typeof ProjectContext.Type

export const TaskList = Schema.Struct({ ...projectFields, tasks: Schema.Array(Task) })
export type TaskList = typeof TaskList.Type

export const TaskDetail = Schema.Struct({
  ...projectFields,
  task: Task,
  comments: Schema.Array(Comment),
  /** Every event about the task, oldest first. */
  history: Schema.Array(CelloEvent),
})
export type TaskDetail = typeof TaskDetail.Type
