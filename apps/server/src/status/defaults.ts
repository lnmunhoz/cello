// The statuses every new workspace starts with (first start and workspace.create).
import type { KnownStatusCategory } from "@cello/contract/entities"
import { positionsAfter } from "@cello/domain/position"
import * as Effect from "effect/Effect"
import type * as SqlClient from "effect/sql/SqlClient"
import { newId } from "../persistence/ids.ts"

export const DEFAULT_STATUSES: ReadonlyArray<{
  readonly name: string
  readonly category: KnownStatusCategory
  readonly color: string
  readonly hidden: boolean
}> = [
  { name: "Backlog", category: "backlog", color: "#9CA3AF", hidden: true },
  { name: "Todo", category: "unstarted", color: "#6B7280", hidden: false },
  { name: "In Progress", category: "started", color: "#F59E0B", hidden: false },
  { name: "Needs input", category: "waiting", color: "#EC4899", hidden: false },
  { name: "In Review", category: "started", color: "#8B5CF6", hidden: false },
  { name: "Done", category: "completed", color: "#10B981", hidden: false },
  { name: "Canceled", category: "canceled", color: "#EF4444", hidden: true },
]

/** Inserts the default statuses into a workspace. Runs inside the caller's transaction. */
export const insertDefaultStatuses = (sql: SqlClient.SqlClient, workspaceId: string, now: number) => {
  const positions = positionsAfter(null, DEFAULT_STATUSES.length)
  return Effect.forEach(DEFAULT_STATUSES, (s, i) =>
    sql`INSERT INTO statuses (id, workspace_id, name, category, position, color, hidden, created_at, updated_at)
      VALUES (${newId(now)}, ${workspaceId}, ${s.name}, ${s.category}, ${positions[i]!}, ${s.color}, ${s.hidden ? 1 : 0},
              ${now}, ${now})`, { discard: true })
}
