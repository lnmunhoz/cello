// What each label says about a task (CEL-52): a kind of work, an area of the product, a milestone, or
// none. Additive only: one column with a default, so every label made before (and any made without a
// group) is `none`. Then CEL-56's labels go in their groups by name, in any case. The group list lives
// in @cello/contract/entities and the label service checks it, so a new group needs no migration.
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"

/** CEL-56's labels by group: the five kinds, the 15 areas and the milestones. */
const BY_NAME = {
  kind: ["feature", "bug", "polish", "chore", "docs"],
  milestone: ["m2", "m3"],
  area: ["board", "list", "task-panel", "review", "pages", "sidebar", "search", "viewer", "agents", "cli", "server", "data", "desktop", "tests", "release"],
} as const

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`ALTER TABLE labels ADD COLUMN label_group TEXT NOT NULL DEFAULT 'none'`
  for (const [group, names] of Object.entries(BY_NAME)) {
    yield* sql`UPDATE labels SET label_group = ${group} WHERE lower(name) IN ${sql.in(names)}`
  }
})
