// Spike (d): server. Services hold the logic; RPC handlers stay thin.
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer"
import * as BunRuntime from "@effect/platform-bun/BunRuntime"
import * as SqliteClient from "@effect/sql-sqlite-bun/SqliteClient"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as HttpRouter from "effect/http/HttpRouter"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as RpcServer from "effect/rpc/RpcServer"
import * as SqlClient from "effect/sql/SqlClient"
import {
  Caller,
  CallerMiddleware,
  CelloEvent,
  CelloRpcs,
  EmptyTitle,
  IDENTITY_HEADERS,
  type Task,
} from "./contract.ts"

const DB_PATH = process.env.CELLO_DB ?? `${import.meta.dir}/../.cello/spike.db`
const PORT = Number(process.env.CELLO_PORT ?? 4747)

const decodeEvent = Schema.decodeUnknownSync(Schema.fromJsonString(CelloEvent))

// --- Event log: the events table plus a live channel ------------------------

export class EventLog extends Context.Service<EventLog, {
  readonly publish: (event: CelloEvent) => Effect.Effect<void>
  readonly subscribe: (afterSeq: number) => Stream.Stream<CelloEvent>
}>()("cello/EventLog") {}

const EventLogLayer = Layer.effect(EventLog, Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const live = yield* PubSub.unbounded<CelloEvent>()
  return EventLog.of({
    publish: (event) => PubSub.publish(live, event).pipe(Effect.asVoid),
    // Join the live channel first, then replay stored events, then skip duplicates by seq.
    subscribe: (afterSeq) =>
      Stream.unwrap(Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(live)
        const rows = yield* sql<{ payload: string }>`
          SELECT payload FROM events WHERE seq > ${afterSeq} ORDER BY seq`
        const replay = rows.map((row) => decodeEvent(row.payload))
        const replayedTo = replay.at(-1)?.seq ?? afterSeq
        return Stream.concat(
          Stream.fromIterable(replay),
          Stream.fromSubscription(subscription).pipe(Stream.filter((event) => event.seq > replayedTo)),
        )
      }).pipe(Effect.orDie)),
  })
}))

// --- TaskService: all task logic ---------------------------------------------

export class TaskService extends Context.Service<TaskService, {
  readonly create: (title: string, commandId: string) => Effect.Effect<{ task: Task; seq: number }, EmptyTitle, Caller>
  readonly snapshot: Effect.Effect<{ seq: number; tasks: ReadonlyArray<Task> }>
}>()("cello/TaskService") {}

const TaskServiceLayer = Layer.effect(TaskService, Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const log = yield* EventLog

  const create = Effect.fn("TaskService.create")(function* (title: string, commandId: string) {
    const trimmed = title.trim()
    if (trimmed.length === 0) return yield* new EmptyTitle()
    const caller = yield* Caller

    const result = yield* sql.withTransaction(Effect.gen(function* () {
      // A retried command returns its stored result instead of running again.
      const receipt = yield* sql<{ result: string }>`SELECT result FROM command_receipts WHERE command_id = ${commandId}`
      if (receipt[0]) return { ...(JSON.parse(receipt[0].result) as { task: Task; seq: number }), replayed: true }

      const [{ next }] = yield* sql<{ next: number }>`SELECT COALESCE(MAX(number), 0) + 1 AS next FROM tasks`
      const task: Task = {
        id: crypto.randomUUID(),
        key: `CEL-${next}`,
        title: trimmed,
        actor: caller.actor,
        sessionId: caller.sessionId,
        createdAt: Date.now(),
      }
      yield* sql`INSERT INTO tasks (id, number, key, title, actor, session_id, created_at)
        VALUES (${task.id}, ${next}, ${task.key}, ${task.title}, ${task.actor}, ${task.sessionId}, ${task.createdAt})`
      const [{ seq }] = yield* sql<{ seq: number }>`
        INSERT INTO events (type, entity_id, command_id, actor, session_id, payload)
        VALUES ('task.created', ${task.id}, ${commandId}, ${task.actor}, ${task.sessionId}, '')
        RETURNING seq`
      const event: CelloEvent = { type: "task.created", seq, commandId, task }
      yield* sql`UPDATE events SET payload = ${JSON.stringify(event)} WHERE seq = ${seq}`
      yield* sql`INSERT INTO command_receipts (command_id, result) VALUES (${commandId}, ${JSON.stringify({ task, seq })})`
      return { task, seq, event, replayed: false }
    })).pipe(Effect.orDie) // storage failures are defects, not API errors

    // Publish only after the transaction committed.
    if (!result.replayed && "event" in result && result.event) yield* log.publish(result.event)
    return { task: result.task, seq: result.seq }
  })

  const snapshot = Effect.gen(function* () {
    const tasks = yield* sql<{ id: string; key: string; title: string; actor: string; session_id: string | null; created_at: number }>`
      SELECT id, key, title, actor, session_id, created_at FROM tasks ORDER BY number`
    const [{ seq }] = yield* sql<{ seq: number }>`SELECT COALESCE(MAX(seq), 0) AS seq FROM events`
    return {
      seq,
      tasks: tasks.map((t) => ({ id: t.id, key: t.key, title: t.title, actor: t.actor, sessionId: t.session_id, createdAt: t.created_at })),
    }
  }).pipe(Effect.orDie)

  return TaskService.of({ create, snapshot })
}))

// --- Persistence ---------------------------------------------------------------

const Migrate = Layer.effectDiscard(Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, key TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
    actor TEXT NOT NULL, session_id TEXT, created_at INTEGER NOT NULL)`
  yield* sql`CREATE TABLE IF NOT EXISTS events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, entity_id TEXT NOT NULL, command_id TEXT NOT NULL,
    actor TEXT NOT NULL, session_id TEXT, payload TEXT NOT NULL, schema_version INTEGER NOT NULL DEFAULT 1)`
  yield* sql`CREATE TABLE IF NOT EXISTS command_receipts (
    command_id TEXT PRIMARY KEY, result TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()))`
}))

const Sqlite = SqliteClient.layer({ filename: DB_PATH })

// --- RPC: thin handlers + caller middleware -------------------------------------

const Handlers = CelloRpcs.toLayer(Effect.gen(function* () {
  const tasks = yield* TaskService
  const log = yield* EventLog
  return CelloRpcs.of({
    "task.create": ({ title, commandId }) => tasks.create(title, commandId),
    "snapshot.get": () => tasks.snapshot,
    "events.subscribe": ({ afterSeq }) => log.subscribe(afterSeq),
  })
}))

const CallerLayer = Layer.succeed(CallerMiddleware)(
  CallerMiddleware.of((effect, { headers }) => {
    const session = headers[IDENTITY_HEADERS.session]
    const client = headers[IDENTITY_HEADERS.client]
    return Effect.provideService(effect, Caller, session
      ? { actor: client ?? "agent", sessionId: session }
      : { actor: "Lucas", sessionId: null })
  }),
)

const Services = Layer.mergeAll(TaskServiceLayer, EventLogLayer).pipe(
  Layer.provideMerge(EventLogLayer),
  Layer.provideMerge(Migrate),
  Layer.provideMerge(Sqlite),
)

const RpcLive = RpcServer.layer(CelloRpcs).pipe(
  Layer.provide(Handlers),
  Layer.provide(CallerLayer),
  Layer.provide(Services),
  Layer.provideMerge(RpcServer.layerProtocolWebsocket({ path: "/rpc" })),
  Layer.provide(RpcSerialization.layerJson),
)

const ServerLive = HttpRouter.serve(RpcLive).pipe(
  Layer.provide(BunHttpServer.layer({ port: PORT, hostname: "127.0.0.1" })),
)

Layer.launch(ServerLive).pipe(BunRuntime.runMain)
