// Live events. Writers publish after commit; a subscriber joins the live channel first, then replays
// the table, then skips live events it already replayed (by seq), so nothing is lost or doubled.
import type { Scope } from "@cello/contract/entities"
import { SnapshotRequired } from "@cello/contract/errors"
import type { CelloEvent } from "@cello/contract/events"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as Stream from "effect/Stream"
import * as EventStore from "./EventStore.ts"
import { inScope } from "./scope.ts"

/** A client further behind than this takes a fresh snapshot instead of a replay. */
export const MAX_REPLAY = 5_000

export class EventLog extends Context.Service<EventLog, {
  /** Hands committed events, in seq order, to live subscribers. */
  readonly publish: (events: ReadonlyArray<CelloEvent>) => Effect.Effect<void>
  /** Events in scope after `afterSeq`: the stored ones, then live ones as they commit. */
  readonly subscribe: (scope: Scope, afterSeq: number) => Stream.Stream<CelloEvent, SnapshotRequired>
}>()("cello/EventLog") {}

const make = Effect.gen(function* () {
  const store = yield* EventStore.EventStore
  const live = yield* PubSub.unbounded<CelloEvent>()

  const publish = Effect.fn("EventLog.publish")(function* (events: ReadonlyArray<CelloEvent>) {
    if (events.length > 0) yield* PubSub.publishAll(live, events)
  })

  const subscribe = (scope: Scope, afterSeq: number): Stream.Stream<CelloEvent, SnapshotRequired> =>
    Stream.unwrap(Effect.gen(function* () {
      const resolved = yield* store.resolveScope(scope)
      // Join first: anything committed from here on reaches us live.
      const subscription = yield* PubSub.subscribe(live)
      const latestSeq = yield* store.latestSeq
      if (afterSeq > latestSeq || (yield* store.countAfter(resolved, afterSeq)) > MAX_REPLAY) {
        return yield* new SnapshotRequired({ latestSeq })
      }
      const replay = yield* store.readAfter(resolved, afterSeq)
      const replayedTo = replay.at(-1)?.seq ?? afterSeq
      return Stream.concat(
        Stream.fromIterable(replay),
        Stream.fromSubscription(subscription).pipe(
          Stream.filter((event) => event.seq > replayedTo && inScope(event, resolved)),
        ),
      )
    }).pipe(Effect.withSpan("EventLog.subscribe")))

  return EventLog.of({ publish, subscribe })
})

export const layer = Layer.effect(EventLog, make)
