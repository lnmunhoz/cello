// Every RPC. Writes carry a client-made commandId and return { result, seq }.
import * as Context from "effect/Context"
import * as Schema from "effect/Schema"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import * as RpcMiddleware from "effect/rpc/RpcMiddleware"
import { Comment, DueDate, Id, Label, Priority, Project, ProjectRef, Scope, Snapshot, Status, Task, Workspace } from "./entities.ts"
import { Invalid, KeyTaken, NotFound, SnapshotRequired, TaskClaimed, VersionConflict } from "./errors.ts"
import { CelloEvent } from "./events.ts"
import { ProjectContext, TaskDetail, TaskList, Whoami } from "./views.ts"

/** Who is calling, resolved by the server from per-request RPC headers. */
export class Caller extends Context.Service<Caller, {
  readonly actorId: string
  readonly sessionId: string | null
}>()("cello/Caller") {}

export class CallerMiddleware extends RpcMiddleware.Service<CallerMiddleware, {
  provides: Caller
}>()("cello/CallerMiddleware", { requiredForClient: true }) {}

/** Sent by the CLI on every request. A session of "me", or none, is the human. */
export const IDENTITY_HEADERS = {
  session: "x-cello-session",
  client: "x-cello-client",
  cwd: "x-cello-cwd",
  pid: "x-cello-pid",
  entrypoint: "x-cello-entrypoint",
} as const

/** The `x-cello-session` value that records the human, whatever agent variables are set. */
export const HUMAN_SESSION = "me"

const commandId = Schema.String
const write = <S extends Schema.Top>(result: S) => Schema.Struct({ result, seq: Schema.NullOr(Schema.Number) })
const neighbors = { before: Schema.optionalKey(Schema.NullOr(Id)), after: Schema.optionalKey(Schema.NullOr(Id)) }

export const CelloRpcs = RpcGroup.make(
  // No scope: the first non-archived workspace by position. Every snapshot lists all non-archived workspaces.
  Rpc.make("snapshot.get", { payload: { scope: Schema.optionalKey(Scope) }, success: Snapshot, error: NotFound }),
  Rpc.make("events.subscribe", {
    payload: { scope: Scope, afterSeq: Schema.Number },
    success: CelloEvent,
    error: SnapshotRequired,
    stream: true,
  }),

  Rpc.make("workspace.create", { payload: { commandId, name: Schema.String }, success: write(Workspace), error: Invalid }),
  Rpc.make("workspace.update", {
    payload: { commandId, id: Id, name: Schema.optionalKey(Schema.String) },
    success: write(Workspace),
    error: Schema.Union([NotFound, Invalid]),
  }),

  Rpc.make("project.create", {
    payload: {
      commandId,
      workspaceId: Id,
      name: Schema.String,
      key: Schema.String,
      color: Schema.optionalKey(Schema.String),
      repoPath: Schema.optionalKey(Schema.String),
    },
    success: write(Project),
    error: Schema.Union([NotFound, Invalid, KeyTaken]),
  }),
  Rpc.make("project.update", {
    payload: {
      commandId,
      id: Id,
      name: Schema.optionalKey(Schema.String),
      color: Schema.optionalKey(Schema.String),
      description: Schema.optionalKey(Schema.String),
    },
    success: write(Project),
    error: Schema.Union([NotFound, Invalid]),
  }),
  Rpc.make("project.archive", { payload: { commandId, id: Id }, success: write(Project), error: NotFound }),

  Rpc.make("status.update", {
    payload: {
      commandId,
      id: Id,
      name: Schema.optionalKey(Schema.String),
      color: Schema.optionalKey(Schema.String),
      hidden: Schema.optionalKey(Schema.Boolean),
      ...neighbors,
    },
    success: write(Status),
    error: Schema.Union([NotFound, Invalid]),
  }),

  Rpc.make("label.create", {
    payload: { commandId, workspaceId: Id, name: Schema.String, color: Schema.String },
    success: write(Label),
    error: Schema.Union([NotFound, Invalid]),
  }),
  Rpc.make("label.update", {
    payload: { commandId, id: Id, name: Schema.optionalKey(Schema.String), color: Schema.optionalKey(Schema.String) },
    success: write(Label),
    error: Schema.Union([NotFound, Invalid]),
  }),
  Rpc.make("label.archive", { payload: { commandId, id: Id }, success: write(Label), error: NotFound }),

  Rpc.make("task.create", {
    payload: {
      commandId,
      projectId: Id,
      title: Schema.String,
      description: Schema.optionalKey(Schema.String),
      statusId: Schema.optionalKey(Id),
      priority: Schema.optionalKey(Priority),
      labelIds: Schema.optionalKey(Schema.Array(Id)),
      dueDate: Schema.optionalKey(Schema.NullOr(DueDate)),
      parentId: Schema.optionalKey(Schema.NullOr(Id)),
      ...neighbors,
    },
    success: write(Task),
    error: Schema.Union([NotFound, Invalid]),
  }),
  Rpc.make("task.update", {
    payload: {
      commandId,
      id: Id,
      expectedVersion: Schema.Number,
      title: Schema.optionalKey(Schema.String),
      description: Schema.optionalKey(Schema.String),
      priority: Schema.optionalKey(Priority),
      dueDate: Schema.optionalKey(Schema.NullOr(DueDate)),
      parentId: Schema.optionalKey(Schema.NullOr(Id)),
    },
    success: write(Task),
    error: Schema.Union([NotFound, Invalid, VersionConflict]),
  }),
  Rpc.make("task.move", {
    payload: { commandId, id: Id, expectedVersion: Schema.optionalKey(Schema.Number), statusId: Id, ...neighbors },
    success: write(Task),
    error: Schema.Union([NotFound, Invalid, VersionConflict]),
  }),
  Rpc.make("task.setLabels", {
    payload: { commandId, id: Id, add: Schema.Array(Id), remove: Schema.Array(Id) },
    success: write(Task),
    error: Schema.Union([NotFound, Invalid]),
  }),
  Rpc.make("task.archive", { payload: { commandId, id: Id }, success: write(Task), error: NotFound }),
  Rpc.make("task.unarchive", { payload: { commandId, id: Id }, success: write(Task), error: NotFound }),
  Rpc.make("task.history", { payload: { id: Id }, success: Schema.Array(CelloEvent), error: NotFound }),

  // For the CLI. Tasks are named by key ("CEL-3"); projects by key or repository folder.
  Rpc.make("whoami", { payload: { project: ProjectRef }, success: Whoami }),
  Rpc.make("context", { payload: { project: ProjectRef }, success: ProjectContext, error: Schema.Union([NotFound, Invalid]) }),
  Rpc.make("task.list", {
    payload: {
      project: ProjectRef,
      status: Schema.optionalKey(Schema.String),
      label: Schema.optionalKey(Schema.String),
      mine: Schema.optionalKey(Schema.Boolean),
    },
    success: TaskList,
    error: Schema.Union([NotFound, Invalid]),
  }),
  Rpc.make("task.get", { payload: { key: Schema.String }, success: TaskDetail, error: NotFound }),
  Rpc.make("task.claim", {
    payload: { commandId, key: Schema.String },
    success: write(Task),
    error: Schema.Union([NotFound, TaskClaimed]),
  }),
  Rpc.make("task.release", {
    payload: { commandId, key: Schema.String },
    success: write(Task),
    error: Schema.Union([NotFound, Invalid]),
  }),

  Rpc.make("comment.list", { payload: { taskId: Id }, success: Schema.Array(Comment), error: NotFound }),
  Rpc.make("comment.add", {
    payload: { commandId, taskId: Id, body: Schema.String },
    success: write(Comment),
    error: Schema.Union([NotFound, Invalid]),
  }),
  Rpc.make("comment.edit", {
    payload: { commandId, id: Id, body: Schema.String },
    success: write(Comment),
    error: Schema.Union([NotFound, Invalid]),
  }),
  Rpc.make("comment.delete", { payload: { commandId, id: Id }, success: write(Comment), error: NotFound }),
).middleware(CallerMiddleware)

export type CelloRpcs = typeof CelloRpcs
