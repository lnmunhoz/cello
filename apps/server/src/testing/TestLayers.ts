// Test layers: a real in-memory SQLite, migrated and seeded, with every service on top.
import { Caller } from "@cello/contract/rpcs"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Migrations from "../persistence/Migrations.ts"
import * as Seed from "../persistence/Seed.ts"
import * as Sqlite from "../persistence/Sqlite.ts"
import * as Services from "../services.ts"
import * as SessionService from "../session/SessionService.ts"

export const TEST_HUMAN = "Lucas"

/** A fresh in-memory database, migrated and seeded. */
export const database = () =>
  Seed.layer(TEST_HUMAN).pipe(Layer.provideMerge(Migrations.layer), Layer.provideMerge(Sqlite.layer(":memory:")))

/** Every service over a fresh database. */
export const services = () => Services.layer.pipe(Layer.provideMerge(database()))

/** Runs `effect` as the seeded human, the way a browser request would. */
export const asHuman = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const human = yield* Seed.HumanActor
    return yield* Effect.provideService(effect, Caller, { actorId: human.id, sessionId: null })
  })

/** Runs `effect` as the agent session an identity resolves to, the way a CLI request would. */
export const asAgent = (identity: SessionService.Identity) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const caller = yield* (yield* SessionService.SessionService).resolve(identity)
      return yield* Effect.provideService(effect, Caller, caller)
    })
