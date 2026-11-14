// Keeps client state current: snapshot, then the event stream from its seq.
// Reconnects from the last seq it saw; on SnapshotRequired it takes a fresh snapshot.
import type { Scope, Snapshot } from "@cello/contract/entities"
import type { CelloEvent } from "@cello/contract/events"
import * as Cause from "effect/Cause"
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import type { CelloClient } from "../client.ts"
import { applyEvents, fromSnapshot, type BoardState } from "./applyEvents.ts"

/** The two reads sync needs. `sourceFromClient` adapts the RPC client; tests pass a fake. */
export interface SyncSource {
  readonly snapshot: (scope: Scope | undefined) => Effect.Effect<Snapshot, unknown>
  readonly subscribe: (scope: Scope, afterSeq: number) => Stream.Stream<CelloEvent, unknown>
}

export const sourceFromClient = (client: CelloClient["Service"]): SyncSource => ({
  snapshot: (scope) => client["snapshot.get"](scope === undefined ? {} : { scope }),
  subscribe: (scope, afterSeq) => client["events.subscribe"]({ scope, afterSeq }),
})

export interface Synced {
  readonly state: BoardState
  /** The scope the stream follows: the one asked for, or the snapshot's default workspace. */
  readonly scope: Scope
  /** Goes up by one each time a fresh snapshot replaces the state. */
  readonly epoch: number
  /** Recent command ids seen in events, with the seq that carried them. */
  readonly seen: ReadonlyMap<string, number>
  readonly connection: "live" | "reconnecting"
  /** The events applied by the change that produced this value; empty after a snapshot. */
  readonly batch: ReadonlyArray<CelloEvent>
}

const SEEN_LIMIT = 500

/** Apply a batch of events; remembers their command ids. Returns `synced` itself when nothing applies. */
export const advance = (synced: Synced, events: ReadonlyArray<CelloEvent>): Synced => {
  const state = applyEvents(synced.state, events)
  if (state === synced.state) return synced
  const seen = new Map(synced.seen)
  for (const e of events) if (e.seq > synced.state.seq) seen.set(e.commandId, e.seq)
  for (const key of seen.keys()) {
    if (seen.size <= SEEN_LIMIT) break
    seen.delete(key)
  }
  return { ...synced, state, seen, batch: events.filter((e) => e.seq > synced.state.seq) }
}

/** The workspace a scopeless snapshot covers: the first non-archived one by position. */
export const defaultWorkspaceId = (snapshot: Snapshot): string => {
  const open = snapshot.workspaces.filter((w) => w.archivedAt === null)
  const first = [...open].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))[0]
  if (!first) throw new Error("The snapshot has no workspace")
  return first.id
}

const isSnapshotRequired = (cause: Cause.Cause<unknown>) => {
  const error = Cause.findErrorOption(cause)
  return Option.isSome(error) && (error.value as { _tag?: unknown } | null)?._tag === "SnapshotRequired"
}

export interface FollowOptions {
  readonly scope?: Scope
  /** Wait before resubscribing after the stream drops. */
  readonly retryDelay?: Duration.Input
}

/** Every state change as a stream: the snapshot first, then each applied batch and connection change. */
export const follow = (source: SyncSource, options: FollowOptions = {}): Stream.Stream<Synced> =>
  Stream.callback<Synced>((queue) => {
    const box: { synced: Synced | null; epoch: number } = { synced: null, epoch: 0 }
    const emit = (next: Synced) => {
      box.synced = next
      Queue.offerUnsafe(queue, next)
    }

    const connectOnce = Effect.gen(function* () {
      if (box.synced === null) {
        const snapshot = yield* source.snapshot(options.scope)
        emit({
          state: fromSnapshot(snapshot),
          scope: options.scope ?? { workspaceId: defaultWorkspaceId(snapshot) },
          epoch: ++box.epoch,
          seen: new Map(),
          connection: "live",
          batch: [],
        })
      } else if (box.synced.connection !== "live") {
        emit({ ...box.synced, connection: "live", batch: [] })
      }
      const current = box.synced!
      yield* source.subscribe(current.scope, current.state.seq).pipe(
        Stream.runForEachArray((events) =>
          Effect.sync(() => {
            const next = advance(box.synced!, events)
            if (next !== box.synced) emit(next)
          })),
      )
    })

    const loop: Effect.Effect<never> = Effect.gen(function* () {
      while (true) {
        const exit = yield* Effect.exit(connectOnce)
        if (Exit.isFailure(exit)) {
          if (Cause.hasInterruptsOnly(exit.cause)) return yield* Effect.failCause(exit.cause)
          if (isSnapshotRequired(exit.cause)) {
            box.synced = null
            continue
          }
        }
        if (box.synced !== null && box.synced.connection === "live") emit({ ...box.synced, connection: "reconnecting", batch: [] })
        yield* Effect.sleep(options.retryDelay ?? "1 second")
      }
    }) as Effect.Effect<never>

    return Effect.forkScoped(loop)
  })
