// A database file as a board made before Needs input (CEL-47) left it: migrated up to 0005, with the
// default statuses of the time, a project CEL and a task in each of In Progress, In Review and Done.
// For tests of the upgrade a real server runs at start.
import * as SqliteMigrator from "@effect/sql-sqlite-bun/SqliteMigrator"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import init from "../persistence/migrations/0001_init.ts"
import reviews from "../persistence/migrations/0002_reviews.ts"
import documents from "../persistence/migrations/0003_documents.ts"
import inbox from "../persistence/migrations/0004_inbox.ts"
import builds from "../persistence/migrations/0005_builds.ts"
import * as Sqlite from "../persistence/Sqlite.ts"

export const writeBoardBeforeAsks = (file: string) =>
  Effect.gen(function* () {
    yield* SqliteMigrator.run({
      loader: SqliteMigrator.fromRecord({ "0001_init": init, "0002_reviews": reviews, "0003_documents": documents, "0004_inbox": inbox, "0005_builds": builds }),
      table: "migrations",
    })
    const sql = yield* SqlClient.SqlClient
    yield* sql`INSERT INTO actors (id, kind, name, color, created_at) VALUES ('human', 'human', 'Lucas', '#3B82F6', 1)`
    yield* sql`INSERT INTO workspaces (id, name, slug, position, created_at, updated_at) VALUES ('w', 'Personal', 'personal', 'a0', 1, 1)`
    const statuses = [
      ["backlog", "Backlog", "backlog", "a0", 1],
      ["todo", "Todo", "unstarted", "a1", 0],
      ["doing", "In Progress", "started", "a2", 0],
      ["review", "In Review", "started", "a3", 0],
      ["done", "Done", "completed", "a4", 0],
      ["canceled", "Canceled", "canceled", "a5", 1],
    ] as const
    for (const [id, name, category, position, hidden] of statuses) {
      yield* sql`INSERT INTO statuses (id, workspace_id, name, category, position, color, hidden, created_at, updated_at)
        VALUES (${id}, 'w', ${name}, ${category}, ${position}, '#999999', ${hidden}, 1, 1)`
    }
    yield* sql`INSERT INTO projects (id, workspace_id, name, key, color, next_task_number, created_at, updated_at)
      VALUES ('p', 'w', 'Cello', 'CEL', '#5E6AD2', 4, 1, 1)`
    for (const [n, status] of [[1, "doing"], [2, "review"], [3, "done"]] as const) {
      yield* sql`INSERT INTO tasks (id, project_id, number, title, status_id, position, created_by_actor_id, created_at, updated_at)
        VALUES (${`t${n}`}, 'p', ${n}, ${`Task ${n}`}, ${status}, 'a0', 'human', 1, 1)`
    }
  }).pipe(Effect.provide(Sqlite.layer(file)), Effect.orDie)
