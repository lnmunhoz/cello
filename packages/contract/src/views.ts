// Read models for the CLI (and later MCP): one RPC returns everything a command prints.
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { Actor, AgentSession, Ask, Comment, DocumentSummary, InboxItem, Label, Project, Review, SessionAgent, Status, Task } from "./entities.ts"
import { CelloEvent } from "./events.ts"

/**
 * Who the server sees: the actor, its agent session (null for the human), the session's subagent making
 * the call when it said so (CEL-55), and the project if one resolved.
 */
export const Whoami = Schema.Struct({
  actor: Actor,
  session: Schema.NullOr(AgentSession),
  agent: Schema.NullOr(SessionAgent).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  project: Schema.NullOr(Project),
})
export type Whoami = typeof Whoami.Type

/** A project with the names a command needs to print ids: statuses, labels, actors, sessions and their subagents. */
const projectFields = {
  project: Project,
  statuses: Schema.Array(Status),
  labels: Schema.Array(Label),
  actors: Schema.Array(Actor),
  sessions: Schema.Array(AgentSession),
  /** The subagents the tasks, comments and events name (CEL-55); their sessions are in `sessions`. */
  agents: Schema.Array(SessionAgent),
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
  /**
   * New comments waiting in this session's inbox, from every project, oldest first (empty for the
   * human). Showing them doesn't mark them read: subagents share their parent's session.
   */
  inbox: Schema.Array(InboxItem),
})
export type ProjectContext = typeof ProjectContext.Type

/** What `inbox.take` hands an agent session (`cello inbox`, the hook): the human's comments on tasks it claimed. */
export const Inbox = Schema.Struct({
  /** The caller's session; null for the human, who has no inbox. */
  session: Schema.NullOr(AgentSession),
  /** The new items this call handed over, now marked read, oldest first. Another call never gets them. */
  items: Schema.Array(InboxItem),
  /** The latest items read before, oldest first; empty when only new ones were asked for. */
  earlier: Schema.Array(InboxItem),
  /**
   * The keys of the tasks the session holds a claim on now (CEL-74): comments on them come to it, so
   * the Stop hook asks it to wait for them when it goes idle. Empty for the human. Optional, like
   * `human`, so a newer CLI still reads an older server's inbox: read it as `claimed ?? []`.
   */
  claimed: Schema.optionalKey(Schema.Array(Schema.String)),
  /** The human's name, for what the hook and `cello inbox --wait` tell the agent (CEL-74). */
  human: Schema.optionalKey(Schema.String),
})
export type Inbox = typeof Inbox.Type

export const TaskList = Schema.Struct({ ...projectFields, tasks: Schema.Array(Task) })
export type TaskList = typeof TaskList.Type

export const TaskDetail = Schema.Struct({
  ...projectFields,
  task: Task,
  comments: Schema.Array(Comment),
  /** Every review packet, oldest first. */
  reviews: Schema.Array(Review),
  /** Every ask (questions for Lucas, CEL-47) with its answers, oldest first. */
  asks: Schema.Array(Ask),
  /** Documents linked to the task that aren't archived, newest first. */
  documents: Schema.Array(DocumentSummary),
  /** Every event about the task, oldest first. */
  history: Schema.Array(CelloEvent),
})
export type TaskDetail = typeof TaskDetail.Type

/**
 * A project's labels, archived ones included, for `cello label list`: each with how many of the
 * project's tasks that aren't archived carry it.
 */
export const LabelList = Schema.Struct({
  project: Project,
  labels: Schema.Array(Schema.Struct({ label: Label, tasks: Schema.Number })),
})
export type LabelList = typeof LabelList.Type

/** A project's documents, for `cello doc list`. */
export const DocumentList = Schema.Struct({ project: Project, documents: Schema.Array(DocumentSummary) })
export type DocumentList = typeof DocumentList.Type
