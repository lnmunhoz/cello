// Entities as they travel on the wire and live in client state. Schemas only.
import * as Schema from "effect/Schema"

export const Id = Schema.String
export const Millis = Schema.Number
export const DueDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))

export const StatusCategory = Schema.Literals(["backlog", "unstarted", "started", "completed", "canceled"])
export type StatusCategory = typeof StatusCategory.Type

/** 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
export const Priority = Schema.Literals([0, 1, 2, 3, 4])
export type Priority = typeof Priority.Type

export const Actor = Schema.Struct({
  id: Id,
  kind: Schema.Literals(["human", "agent"]),
  name: Schema.String,
  client: Schema.NullOr(Schema.String),
  color: Schema.String,
  createdAt: Millis,
})
export type Actor = typeof Actor.Type

/** One agent conversation, keyed by its host's session id (`externalId`, e.g. CLAUDE_CODE_SESSION_ID). */
export const AgentSession = Schema.Struct({
  id: Id,
  actorId: Id,
  externalId: Schema.NullOr(Schema.String),
  clientName: Schema.String,
  entrypoint: Schema.NullOr(Schema.String),
  cwd: Schema.NullOr(Schema.String),
  pid: Schema.NullOr(Schema.Number),
  startedAt: Millis,
  lastSeenAt: Millis,
  endedAt: Schema.NullOr(Millis),
})
export type AgentSession = typeof AgentSession.Type

export const Workspace = Schema.Struct({
  id: Id,
  name: Schema.String,
  slug: Schema.String,
  position: Schema.String,
  createdAt: Millis,
  updatedAt: Millis,
  archivedAt: Schema.NullOr(Millis),
})
export type Workspace = typeof Workspace.Type

export const Project = Schema.Struct({
  id: Id,
  workspaceId: Id,
  name: Schema.String,
  key: Schema.String,
  color: Schema.String,
  description: Schema.String,
  repoPath: Schema.NullOr(Schema.String),
  createdAt: Millis,
  updatedAt: Millis,
  archivedAt: Schema.NullOr(Millis),
})
export type Project = typeof Project.Type

export const Status = Schema.Struct({
  id: Id,
  workspaceId: Id,
  name: Schema.String,
  category: StatusCategory,
  position: Schema.String,
  color: Schema.String,
  hidden: Schema.Boolean,
  createdAt: Millis,
  updatedAt: Millis,
})
export type Status = typeof Status.Type

export const Label = Schema.Struct({
  id: Id,
  workspaceId: Id,
  name: Schema.String,
  color: Schema.String,
  createdAt: Millis,
  updatedAt: Millis,
  archivedAt: Schema.NullOr(Millis),
})
export type Label = typeof Label.Type

export const Task = Schema.Struct({
  id: Id,
  projectId: Id,
  number: Schema.Number,
  key: Schema.String,
  title: Schema.String,
  description: Schema.String,
  statusId: Id,
  priority: Priority,
  position: Schema.String,
  dueDate: Schema.NullOr(DueDate),
  parentId: Schema.NullOr(Id),
  labelIds: Schema.Array(Id),
  assigneeActorId: Schema.NullOr(Id),
  assigneeSessionId: Schema.NullOr(Id),
  createdByActorId: Id,
  createdBySessionId: Schema.NullOr(Id),
  version: Schema.Number,
  createdAt: Millis,
  updatedAt: Millis,
  archivedAt: Schema.NullOr(Millis),
})
export type Task = typeof Task.Type

export const Comment = Schema.Struct({
  id: Id,
  taskId: Id,
  body: Schema.String,
  actorId: Id,
  sessionId: Schema.NullOr(Id),
  createdAt: Millis,
  updatedAt: Millis,
  deletedAt: Schema.NullOr(Millis),
})
export type Comment = typeof Comment.Type

/** Which project a CLI call is about: by key (`--project CEL`), or by the repository folder it runs in. */
export const ProjectRef = Schema.Struct({
  key: Schema.optionalKey(Schema.String),
  /** The main checkout's folder: the parent of `git rev-parse --git-common-dir`. */
  repoPath: Schema.optionalKey(Schema.String),
})
export type ProjectRef = typeof ProjectRef.Type

/** What a subscription or snapshot covers. */
export const Scope = Schema.Union([
  Schema.Struct({ workspaceId: Id }),
  Schema.Struct({ projectId: Id }),
])
export type Scope = typeof Scope.Type

export const Snapshot = Schema.Struct({
  seq: Schema.Number,
  actors: Schema.Array(Actor),
  workspaces: Schema.Array(Workspace),
  projects: Schema.Array(Project),
  statuses: Schema.Array(Status),
  labels: Schema.Array(Label),
  tasks: Schema.Array(Task),
})
export type Snapshot = typeof Snapshot.Type
