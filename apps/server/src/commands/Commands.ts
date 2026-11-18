// Every write goes through `write`: one transaction that checks the command receipt, runs the change,
// appends its events and stores the receipt; then, after commit, publishes the events.
import { Caller } from "@cello/contract/rpcs"
import type { CelloEvent, EventBody } from "@cello/contract/events"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Semaphore from "effect/Semaphore"
import * as SqlClient from "effect/sql/SqlClient"
import type { SqlError } from "effect/sql/SqlError"
import * as EventLog from "../events/EventLog.ts"
import * as EventStore from "../events/EventStore.ts"

/** What every write RPC returns: the result and the highest event it committed (null: no change). */
export interface Written<A> {
  readonly result: A
  readonly seq: number | null
}

export interface WriteContext {
  /** The command's time: every row it touches and every event it appends use it. */
  readonly now: number
  readonly caller: Caller["Service"]
  /** Appends an event in this command's transaction. */
  readonly emit: (
    body: EventBody,
    /**
     * `agentId` (CEL-181) credits the event to that subagent of the caller's session instead of the caller's
     * own agent: a test runner reports as its session, for a run that was a subagent's. Left out, the caller's.
     */
    where: { readonly workspaceId: string; readonly projectId: string | null; readonly agentId?: string | null },
  ) => Effect.Effect<CelloEvent, SqlError>
}

/**
 * `receipt: false` is for the server's own bookkeeping (a session checking in, CEL-35): no client
 * retries it, so there's no receipt to look up or keep.
 */
export interface Command {
  readonly commandId: string
  readonly rpc: string
  readonly receipt?: boolean
}

export class Commands extends Context.Service<Commands, {
  readonly write: <A, E>(
    command: Command,
    change: (context: WriteContext) => Effect.Effect<A, E | SqlError>,
  ) => Effect.Effect<Written<A>, Exclude<E, SqlError>, Caller>
}>()("cello/Commands") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const store = yield* EventStore.EventStore
  const log = yield* EventLog.EventLog
  // Commit and publish happen under one permit, so live subscribers see events in seq order.
  const writing = yield* Semaphore.make(1)

  const write = <A, E>(
    command: Command,
    change: (context: WriteContext) => Effect.Effect<A, E | SqlError>,
  ): Effect.Effect<Written<A>, Exclude<E, SqlError>, Caller> =>
    Effect.gen(function* () {
      const caller = yield* Caller
      // Once a write holds the permit it runs to the end: a closing connection or a stopping server
      // interrupts its request, but the change still commits and is published (CEL-17).
      const outcome = yield* Effect.uninterruptible(sql.withTransaction(Effect.gen(function* () {
        const keep = command.receipt !== false
        const receipts = keep
          ? yield* sql<{ result: string; last_seq: number | null }>`
          SELECT result, last_seq FROM command_receipts WHERE command_id = ${command.commandId}`
          : []
        const receipt = receipts[0]
        if (receipt) {
          // A retry: hand back what the first run returned, write nothing.
          const written: Written<A> = { result: JSON.parse(receipt.result) as A, seq: receipt.last_seq }
          return { written, events: [] as CelloEvent[] }
        }
        const now = yield* Clock.currentTimeMillis
        const events: CelloEvent[] = []
        const emit: WriteContext["emit"] = (body, where) =>
          store.append(body, {
            ts: now,
            commandId: command.commandId,
            actorId: caller.actorId,
            sessionId: caller.sessionId,
            agentId: where.agentId === undefined ? caller.agentId ?? null : where.agentId,
            model: caller.model ?? null,
            effort: caller.effort ?? null,
            workspaceId: where.workspaceId,
            projectId: where.projectId,
          }).pipe(Effect.tap((event) => Effect.sync(() => events.push(event))))
        const result = yield* change({ now, caller, emit })
        const seq = events.at(-1)?.seq ?? null
        if (keep) {
          yield* sql`INSERT INTO command_receipts (command_id, rpc, result, last_seq, created_at)
            VALUES (${command.commandId}, ${command.rpc}, ${JSON.stringify(result)}, ${seq}, ${now})`
        }
        return { written: { result, seq } as Written<A>, events }
      })).pipe(Effect.tap((outcome) => log.publish(outcome.events))))
      return outcome.written
    }).pipe(
      writing.withPermits(1),
      // Storage failures are defects; only the change's own tagged errors reach the caller.
      Effect.catchTag("SqlError", (error) => Effect.die(error)),
      Effect.withSpan("Commands.write", { attributes: { rpc: command.rpc } }),
    ) as Effect.Effect<Written<A>, Exclude<E, SqlError>, Caller>

  return Commands.of({ write })
})

export const layer = Layer.effect(Commands, make)
