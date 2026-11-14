// Documents (CEL-13): docs, specs and pages in one table, every saved version, and links to tasks.
// A page's images reuse the attachments storage: `attachments` is rebuilt so a file belongs to a task
// or a document (SQLite can't drop NOT NULL in place), and gains a content hash so republishing an
// unchanged image stores nothing new.
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    kind TEXT NOT NULL CHECK (kind IN ('doc', 'spec', 'page')),
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    source_path TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
    created_by_session_id TEXT REFERENCES agent_sessions(id),
    updated_by_actor_id TEXT NOT NULL REFERENCES actors(id),
    updated_by_session_id TEXT REFERENCES agent_sessions(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived_at INTEGER,
    UNIQUE (project_id, slug)
  )`
  yield* sql`CREATE INDEX documents_source ON documents (project_id, source_path) WHERE source_path IS NOT NULL`

  yield* sql`CREATE TABLE document_versions (
    document_id TEXT NOT NULL REFERENCES documents(id),
    version INTEGER NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    body TEXT NOT NULL,
    actor_id TEXT NOT NULL REFERENCES actors(id),
    session_id TEXT REFERENCES agent_sessions(id),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (document_id, version)
  )`

  yield* sql`CREATE TABLE document_tasks (
    document_id TEXT NOT NULL REFERENCES documents(id),
    task_id TEXT NOT NULL REFERENCES tasks(id),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (document_id, task_id)
  )`
  yield* sql`CREATE INDEX document_tasks_task ON document_tasks (task_id)`

  yield* sql`CREATE TABLE attachments_next (
    id TEXT PRIMARY KEY,
    task_id TEXT REFERENCES tasks(id),
    document_id TEXT REFERENCES documents(id),
    review_id TEXT REFERENCES reviews(id),
    kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'file', 'link')),
    name TEXT NOT NULL,
    path TEXT,
    url TEXT,
    caption TEXT NOT NULL DEFAULT '',
    mime TEXT,
    bytes INTEGER,
    poster_path TEXT,
    sha256 TEXT,
    actor_id TEXT NOT NULL REFERENCES actors(id),
    session_id TEXT REFERENCES agent_sessions(id),
    created_at INTEGER NOT NULL,
    deleted_at INTEGER,
    CHECK (task_id IS NOT NULL OR document_id IS NOT NULL)
  )`
  yield* sql`INSERT INTO attachments_next (id, task_id, review_id, kind, name, path, url, caption, mime, bytes, poster_path,
                                           actor_id, session_id, created_at, deleted_at)
    SELECT id, task_id, review_id, kind, name, path, url, caption, mime, bytes, poster_path, actor_id, session_id, created_at, deleted_at
    FROM attachments`
  yield* sql`DROP TABLE attachments`
  yield* sql`ALTER TABLE attachments_next RENAME TO attachments`
  yield* sql`CREATE INDEX attachments_task ON attachments (task_id, created_at)`
  yield* sql`CREATE INDEX attachments_review ON attachments (review_id)`
  yield* sql`CREATE INDEX attachments_document ON attachments (document_id, sha256)`
})
