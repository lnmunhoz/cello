// Checking a database file that isn't open: a backup's copy right after it's made, and a backup's
// database before restore puts it in place.
import { Database } from "bun:sqlite"
import * as Effect from "effect/Effect"
import * as Migrations from "../persistence/Migrations.ts"

export interface DatabaseCheck {
  /** `PRAGMA integrity_check` said "ok". */
  readonly ok: boolean
  /** What integrity_check reported instead, or why the file couldn't be read. */
  readonly problems: ReadonlyArray<string>
  /** The newest migration it had; 0 for a database without migrations. */
  readonly schemaLevel: number
}

/** Opens `file` read-only and runs SQLite's integrity check; a file that isn't a database fails it. */
export const checkDatabase = (file: string): DatabaseCheck => {
  let db: Database | undefined
  try {
    db = new Database(file, { readonly: true })
    const problems = (db.query("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>)
      .map((row) => row.integrity_check)
      .filter((result) => result !== "ok")
    const migrated = db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'migrations'").get() !== null
    const level = migrated ? (db.query("SELECT MAX(migration_id) AS level FROM migrations").get() as { level: number | null }).level : 0
    return { ok: problems.length === 0, problems, schemaLevel: level ?? 0 }
  } catch (error) {
    return { ok: false, problems: [error instanceof Error ? error.message : String(error)], schemaLevel: 0 }
  } finally {
    db?.close()
  }
}

/** The newest migration this build knows: a backup with a higher level was made by a newer Cello. */
export const latestSchemaLevel: Effect.Effect<number> = Migrations.migrations.pipe(
  Effect.map((migrations) => Math.max(0, ...migrations.map(([id]) => id))),
  Effect.orDie,
)
