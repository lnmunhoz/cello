import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import { DEFAULT_STATUSES } from "../status/defaults.ts"
import * as Migrations from "./Migrations.ts"
import * as Seed from "./Seed.ts"
import * as Sqlite from "./Sqlite.ts"

const db = Migrations.layer.pipe(Layer.provideMerge(Sqlite.layer(":memory:")))

const counts = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const one = (table: string) =>
    sql<{ n: number }>`SELECT COUNT(*) AS n FROM ${sql(table)}`.pipe(Effect.map((rows) => rows[0]!.n))
  return {
    actors: yield* one("actors"),
    workspaces: yield* one("workspaces"),
    statuses: yield* one("statuses"),
    events: yield* one("events"),
  }
}).pipe(Effect.orDie)

describe("Seed", () => {
  it.effect("creates the human actor, Personal and the default statuses", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const human = yield* Seed.seed("Lucas")
      expect(human.name).toBe("Lucas")
      expect(yield* counts).toEqual({ actors: 1, workspaces: 1, statuses: DEFAULT_STATUSES.length, events: 0 })
      const statuses = yield* sql<{ name: string; category: string; hidden: number }>`
        SELECT name, category, hidden FROM statuses ORDER BY position`.pipe(Effect.orDie)
      expect(statuses).toEqual(DEFAULT_STATUSES.map((s) => ({ name: s.name, category: s.category, hidden: s.hidden ? 1 : 0 })))
    }).pipe(Effect.provide(db)))

  it.effect("is idempotent: a second run changes nothing and keeps the first name", () =>
    Effect.gen(function* () {
      const first = yield* Seed.seed("Lucas")
      const before = yield* counts
      const second = yield* Seed.seed("Someone Else")
      expect(second).toEqual(first)
      expect(yield* counts).toEqual(before)
    }).pipe(Effect.provide(db)))

  it.effect("doesn't bring Personal back once workspaces exist under other names", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* Seed.seed("Lucas")
      yield* sql`UPDATE workspaces SET name = 'Home', slug = 'home'`.pipe(Effect.orDie)
      yield* Seed.seed("Lucas")
      expect((yield* counts).workspaces).toBe(1)
    }).pipe(Effect.provide(db)))
})

describe("Migrations", () => {
  it.effect("are tracked in the migrations table and run once", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* Migrations.run
      const rows = yield* sql<{ migration_id: number; name: string }>`SELECT migration_id, name FROM migrations`.pipe(Effect.orDie)
      expect(rows).toEqual([
        { migration_id: 1, name: "init" },
        { migration_id: 2, name: "reviews" },
        { migration_id: 3, name: "documents" },
        { migration_id: 4, name: "inbox" },
        { migration_id: 5, name: "builds" },
        { migration_id: 6, name: "asks" },
      ])
    }).pipe(Effect.provide(db)))
})
