// Spike (d): the shared contract. Schemas only, no runtime logic.
import * as Context from "effect/Context"
import * as Schema from "effect/Schema"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import * as RpcMiddleware from "effect/rpc/RpcMiddleware"

export const Task = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  title: Schema.String,
  actor: Schema.String,
  sessionId: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
})
export type Task = typeof Task.Type

export const TaskCreated = Schema.Struct({
  type: Schema.Literal("task.created"),
  seq: Schema.Number,
  commandId: Schema.String,
  task: Task,
})

export const CelloEvent = Schema.Union([TaskCreated])
export type CelloEvent = typeof CelloEvent.Type

export class EmptyTitle extends Schema.TaggedError<EmptyTitle>()("EmptyTitle", {}) {}

/** Who is calling, resolved by the server from per-request RPC headers. */
export class Caller extends Context.Service<Caller, {
  readonly actor: string
  readonly sessionId: string | null
}>()("cello/Caller") {}

export class CallerMiddleware extends RpcMiddleware.Service<CallerMiddleware, {
  provides: Caller
}>()("cello/CallerMiddleware", { requiredForClient: true }) {}

export const TaskCreate = Rpc.make("task.create", {
  payload: { title: Schema.String, commandId: Schema.String },
  success: Schema.Struct({ task: Task, seq: Schema.Number }),
  error: EmptyTitle,
})

export const SnapshotGet = Rpc.make("snapshot.get", {
  success: Schema.Struct({ seq: Schema.Number, tasks: Schema.Array(Task) }),
})

export const EventsSubscribe = Rpc.make("events.subscribe", {
  payload: { afterSeq: Schema.Number },
  success: CelloEvent,
  stream: true,
})

export const CelloRpcs = RpcGroup.make(TaskCreate, SnapshotGet, EventsSubscribe).middleware(CallerMiddleware)

export const IDENTITY_HEADERS = {
  session: "x-cello-session",
  client: "x-cello-client",
  pid: "x-cello-pid",
} as const
