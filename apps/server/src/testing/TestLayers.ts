// Test layers: a real in-memory SQLite, migrated and seeded, with every service on top. Review files
// go to a temp folder that's removed when the test ends.
import * as path from "node:path"
import { Caller } from "@cello/contract/rpcs"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Migrations from "../persistence/Migrations.ts"
import * as Seed from "../persistence/Seed.ts"
import * as Sqlite from "../persistence/Sqlite.ts"
import * as AssetStore from "../review/AssetStore.ts"
import type * as RepoPaths from "../project/repoPath.ts"
import * as Services from "../services.ts"
import * as ModelService from "../session/ModelService.ts"
import * as SessionService from "../session/SessionService.ts"
import { tempDataDir } from "./tempDir.ts"

export const TEST_HUMAN = "Lucas"

/** A fresh in-memory database, migrated and seeded. */
export const database = () =>
  Seed.layer(TEST_HUMAN).pipe(Layer.provideMerge(Migrations.layer), Layer.provideMerge(Sqlite.layer(":memory:")))

/** An asset store in a fresh temp folder. `ffmpeg: null` turns posters off. */
export const tempAssets = (options: { readonly ffmpeg?: string | null } = {}) =>
  Layer.effect(
    AssetStore.AssetStore,
    Effect.map(tempDataDir, (dir) => AssetStore.make({ dir: path.join(dir, "assets"), ...options })),
  )

/** Every service over a fresh database and a temp asset folder; `repoPaths` replaces the folder normalizer. */
export const services = (
  options: { readonly ffmpeg?: string | null; readonly repoPaths?: Layer.Layer<RepoPaths.RepoPaths> } = {},
) =>
  (options.repoPaths ? Services.layerWith(options.repoPaths) : Services.layer).pipe(
    Layer.provideMerge(database()),
    Layer.provideMerge(tempAssets(options)),
  )

/** Runs `effect` as the seeded human, the way a browser request would. */
export const asHuman = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const human = yield* Seed.HumanActor
    return yield* Effect.provideService(effect, Caller, { actorId: human.id, sessionId: null })
  })

/**
 * Runs `effect` as the agent session an identity resolves to, the way a CLI request would; with a
 * ModelService provided, stamped with the model its transcript names, as CallerMiddleware does (CEL-119).
 */
export const asAgent = (identity: SessionService.Identity) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const resolved = yield* (yield* SessionService.SessionService).resolve(identity)
      const models = yield* Effect.serviceOption(ModelService.ModelService)
      const caller = models._tag === "Some" ? yield* models.value.stamp(resolved) : resolved
      return yield* Effect.provideService(effect, Caller, caller)
    })
