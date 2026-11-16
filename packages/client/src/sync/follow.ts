// Keeps client state current: snapshot, then the event stream from its seq.
// Reconnects from the last seq it saw; on SnapshotRequired it takes a fresh snapshot. An event this
// build can't read (a newer server's, CEL-131) is skipped and counted, never a reason to drop the stream.
import type { Scope, Snapshot } from "@cello/contract/entities"
import { type CelloEvent, isReadable, type StreamedEvent, type UnreadableEvent } from "@cello/contract/events"
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
  readonly subscribe: (scope: Scope, afterSeq: number) => Stream.Stream<StreamedEvent, unknown>
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
  /**
   * How many events this follow skipped because this build can't read them (CEL-131), kept across
   * fresh snapshots. Above 0, the server runs a newer build than this client.
   */
  readonly unreadable: number
}

const SEEN_LIMIT = 500

/** The events in `events` after `synced`'s seq that this build can't read. */
const unreadableIn = (synced: Synced, events: ReadonlyArray<StreamedEvent>): ReadonlyArray<UnreadableEvent> =>
  events.filter((e): e is UnreadableEvent => !isReadable(e) && e.seq > synced.state.seq)

/**
 * Apply a batch of events; remembers their command ids. An event this build can't read applies
 * nothing, but its seq still moves the state past it, so a reconnect resumes after it. Returns `synced`
 * itself when nothing is new.
 */
export const advance = (synced: Synced, events: ReadonlyArray<StreamedEvent>): Synced => {
  const fresh = events.filter((e) => e.seq > synced.state.seq)
  if (fresh.length === 0) return synced
  const readable = fresh.filter(isReadable)
  const applied = applyEvents(synced.state, readable)
  const lastSeq = Math.max(...fresh.map((e) => e.seq))
  const state = applied.seq >= lastSeq ? applied : { ...applied, seq: lastSeq }
  const seen = new Map(synced.seen)
  for (const e of readable) seen.set(e.commandId, e.seq)
  for (const key of seen.keys()) {
    if (seen.size <= SEEN_LIMIT) break
    seen.delete(key)
  }
  return { ...synced, state, seen, batch: readable, unreadable: synced.unreadable + fresh.length - readable.length }
}

/** Whether `synced` follows the workspace asked for; `null` asks for the server's default. */
export const followsWorkspace = (synced: Synced, wanted: string | null): boolean =>
  wanted === null || ("workspaceId" in synced.scope && synced.scope.workspaceId === wanted)

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
    const box: { synced: Synced | null; epoch: number; unreadable: number } = { synced: null, epoch: 0, unreadable: 0 }
    const emit = (next: Synced) => {
      box.synced = next
      box.unreadable = next.unreadable
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
          unreadable: box.unreadable,
        })
      } else if (box.synced.connection !== "live") {
        emit({ ...box.synced, connection: "live", batch: [] })
      }
      const current = box.synced!
      yield* source.subscribe(current.scope, current.state.seq).pipe(
        Stream.runForEachArray((events) =>
          Effect.suspend(() => {
            const skipped = unreadableIn(box.synced!, events)
            const next = advance(box.synced!, events)
            if (next !== box.synced) emit(next)
            return skipped.length === 0
              ? Effect.void
              : Effect.logWarning(
                "Skipped events this build of Cello can't read: the server runs a newer build",
                skipped.map((e) => `${e.sentType} (seq ${e.seq})`),
              )
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
