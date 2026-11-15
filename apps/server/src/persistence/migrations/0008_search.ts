// Search (CEL-11, CEL-43): one index over tasks, comments, review packets and documents, kept current
// by triggers, so a change, its event and its index row commit or roll back together and no write path
// can forget it. Additive only: new tables and triggers, existing rows untouched.
//
// - `search_entries` holds one row per searchable thing: its kind and id, the project it's in, the
//   task it is or is on, and the text: `task_key` ("CEL-15"), `title` and `body`.
//     - a task: its title and description; archived tasks are left out
//     - a comment: its body; deleted comments are left out
//     - a packet: its summary, steps and Lucas's note; superseded packets are left out
//     - a document: its title, and its summary and body (without the frontmatter); archived documents are left out
//   A comment or packet on an archived task stays in, and the search leaves it out (it joins the task).
// - Two FTS5 indexes read their text from it (external content): `search_words` (plain words, for
//   as-you-type prefixes: "eviden" finds "evidence") and `search_stems` (porter stemming: "videos"
//   finds "video"). A query asks both and keeps each row's better match.
// - Triggers on tasks, comments, reviews and documents replace a thing's entry when its text or its
//   archived/deleted state changes; triggers on `search_entries` keep both indexes in step with it.
// - The existing rows are indexed once, here.
// - A later migration that rebuilds tasks, comments, reviews or documents (drop and recreate) drops
//   their search_* triggers with them: it must recreate those triggers, or the index stops following.
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"

const COLUMNS = "kind, ref_id, project_id, task_id, task_key, title, body"

/** A packet's searchable text: its summary, each step on a line (when `steps` is valid JSON), and the decision note. */
const packetBody = (r: string) =>
  `${r}.summary || coalesce((SELECT char(10) || group_concat(value, char(10)) FROM json_each(CASE WHEN json_valid(${r}.steps) THEN ${r}.steps ELSE '[]' END)), '') || coalesce(char(10) || ${r}.decision_note, '')`

/**
 * The entries to index for each kind, read from `n`: a trigger's `new` row, or with `from` the table
 * itself under that alias (the backfill).
 */
const TASK = (n: string, from = "") =>
  `SELECT 'task', ${n}.id, ${n}.project_id, ${n}.id, p.key || '-' || ${n}.number, ${n}.title, ${n}.description
   FROM ${from}projects p WHERE p.id = ${n}.project_id AND ${n}.archived_at IS NULL`
const COMMENT = (n: string, from = "") =>
  `SELECT 'comment', ${n}.id, t.project_id, t.id, p.key || '-' || t.number, '', ${n}.body
   FROM ${from}tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ${n}.task_id AND ${n}.deleted_at IS NULL`
const PACKET = (n: string, from = "") =>
  `SELECT 'packet', ${n}.id, t.project_id, t.id, p.key || '-' || t.number, '', ${packetBody(n)}
   FROM ${from}tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ${n}.task_id AND ${n}.decision IS NOT 'superseded'`
/**
 * A document's markdown without its frontmatter (`---` … `---` at the top): the title and summary
 * are indexed from their own columns, so snippets never show "summary: …".
 */
const withoutFrontmatter = (body: string) => {
  const rest = `substr(${body}, 5)`
  const end = `instr(${rest}, char(10) || '---')`
  return `CASE WHEN substr(${body}, 1, 4) = '---' || char(10) AND ${end} > 0 THEN ltrim(substr(${rest}, ${end} + 4), char(10) || char(13)) ELSE ${body} END`
}
const DOCUMENT = (n: string, from = "") =>
  `SELECT 'document', ${n}.id, ${n}.project_id, NULL, '', ${n}.title, ${n}.summary || char(10) || ${withoutFrontmatter(`${n}.body`)}
   ${from ? `FROM ${from.slice(0, -2)}` : ""} WHERE ${n}.archived_at IS NULL`

/** Each table whose rows are indexed: the entries' kind, the columns whose change re-indexes a row, and its entries. */
const SOURCES = [
  { table: "tasks", kind: "task", columns: ["title", "description", "archived_at"], select: TASK },
  { table: "comments", kind: "comment", columns: ["body", "deleted_at"], select: COMMENT },
  { table: "reviews", kind: "packet", columns: ["summary", "steps", "decision", "decision_note"], select: PACKET },
  { table: "documents", kind: "document", columns: ["title", "summary", "body", "archived_at"], select: DOCUMENT },
] as const

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`CREATE TABLE search_entries (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('task', 'comment', 'packet', 'document')),
    ref_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    task_id TEXT,
    task_key TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    UNIQUE (kind, ref_id)
  )`
  yield* sql`CREATE INDEX search_entries_task ON search_entries (task_id)`

  for (const [name, tokenize] of [["search_words", "unicode61 remove_diacritics 2"], ["search_stems", "porter unicode61 remove_diacritics 2"]]) {
    yield* sql.unsafe(`CREATE VIRTUAL TABLE ${name} USING fts5(
      task_key, title, body,
      content = 'search_entries', content_rowid = 'id',
      tokenize = '${tokenize}', prefix = '2 3'
    )`)
  }

  // The existing rows, then both indexes built from them in one pass.
  for (const source of SOURCES) {
    yield* sql.unsafe(`INSERT INTO search_entries (${COLUMNS}) ${source.select("x", `${source.table} x, `)} ORDER BY x.created_at, x.id`)
  }
  yield* sql`INSERT INTO search_words (search_words) VALUES ('rebuild')`
  yield* sql`INSERT INTO search_stems (search_stems) VALUES ('rebuild')`

  // The indexes follow their entries.
  const indexRow = (prefix: string, r: string) =>
    ["search_words", "search_stems"]
      .map((t) => `INSERT INTO ${t} (${prefix ? `${t}, ` : ""}rowid, task_key, title, body) VALUES (${prefix ? `'${prefix}', ` : ""}${r}.id, ${r}.task_key, ${r}.title, ${r}.body);`)
      .join("\n")
  yield* sql.unsafe(`CREATE TRIGGER search_entries_insert AFTER INSERT ON search_entries BEGIN
    ${indexRow("", "new")}
  END`)
  yield* sql.unsafe(`CREATE TRIGGER search_entries_delete AFTER DELETE ON search_entries BEGIN
    ${indexRow("delete", "old")}
  END`)
  yield* sql.unsafe(`CREATE TRIGGER search_entries_update AFTER UPDATE ON search_entries BEGIN
    ${indexRow("delete", "old")}
    ${indexRow("", "new")}
  END`)

  // Each source replaces its entry when what's indexed changes.
  for (const { table, kind, columns, select } of SOURCES) {
    const changed = columns.map((c) => `old.${c} IS NOT new.${c}`).join(" OR ")
    yield* sql.unsafe(`CREATE TRIGGER search_${table}_insert AFTER INSERT ON ${table} BEGIN
      INSERT INTO search_entries (${COLUMNS}) ${select("new")};
    END`)
    yield* sql.unsafe(`CREATE TRIGGER search_${table}_update AFTER UPDATE OF ${columns.join(", ")} ON ${table} WHEN ${changed} BEGIN
      DELETE FROM search_entries WHERE kind = '${kind}' AND ref_id = old.id;
      INSERT INTO search_entries (${COLUMNS}) ${select("new")};
    END`)
    yield* sql.unsafe(`CREATE TRIGGER search_${table}_delete AFTER DELETE ON ${table} BEGIN
      DELETE FROM search_entries WHERE kind = '${kind}' AND ref_id = old.id;
    END`)
  }
})
