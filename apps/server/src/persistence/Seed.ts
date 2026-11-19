// First start: the human actor, a "Personal" workspace and its statuses. Idempotent.
import { positionBetween } from "@cello/domain/position"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import { insertDefaultStatuses } from "../status/defaults.ts"
import { newId } from "./ids.ts"

/** The one human actor, seeded on first start. Browser and headerless requests act as this actor. */
export class HumanActor extends Context.Service<HumanActor, {
  readonly id: string
  readonly name: string
}>()("cello/HumanActor") {}

export const HUMAN_COLOR = "#3B82F6"
export const FIRST_WORKSPACE = { name: "Personal", slug: "personal" } as const

/**
 * Seeds what's missing and returns the human actor. The actor is created only if there is none;
 * the workspace only if there are no workspaces at all, so a renamed or archived one isn't re-added.
 */
export const seed = Effect.fn("Seed.seed")(function* (humanName: string) {
  const sql = yield* SqlClient.SqlClient
  return yield* sql.withTransaction(Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const humans = yield* sql<{ id: string; name: string }>`SELECT id, name FROM actors WHERE kind = 'human' ORDER BY created_at LIMIT 1`
    let human = humans[0]
    if (!human) {
      human = { id: newId(now), name: humanName }
      yield* sql`INSERT INTO actors (id, kind, name, client, color, created_at)
        VALUES (${human.id}, 'human', ${human.name}, NULL, ${HUMAN_COLOR}, ${now})`
    }
    const [{ count }] = (yield* sql<{ count: number }>`SELECT COUNT(*) AS count FROM workspaces`) as [{ count: number }]
    if (count === 0) {
      const id = newId(now)
      yield* sql`INSERT INTO workspaces (id, name, slug, position, created_at, updated_at)
        VALUES (${id}, ${FIRST_WORKSPACE.name}, ${FIRST_WORKSPACE.slug}, ${positionBetween(null, null)}, ${now}, ${now})`
      yield* insertDefaultStatuses(sql, id, now)
    }
    return human
  }))
}, Effect.orDie)

/** Seeds on construction and provides the human actor. */
export const layer = (humanName: string) => Layer.effect(HumanActor, seed(humanName))
