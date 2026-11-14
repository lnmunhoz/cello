// Every M1 table. Times are epoch milliseconds, booleans 0/1, ids ULID text.
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`CREATE TABLE actors (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('human', 'agent')),
    name TEXT NOT NULL,
    client TEXT,
    color TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`

  yield* sql`CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    position TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived_at INTEGER
  )`

  yield* sql`CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    name TEXT NOT NULL,
    key TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    next_task_number INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived_at INTEGER
  )`

  yield* sql`CREATE TABLE agent_sessions (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL REFERENCES actors(id),
    external_id TEXT UNIQUE,
    client_name TEXT NOT NULL,
    entrypoint TEXT,
    cwd TEXT,
    project_id TEXT REFERENCES projects(id),
    pid INTEGER,
    identity_json TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    ended_at INTEGER,
    created_at INTEGER NOT NULL
  )`

  yield* sql`CREATE TABLE project_repos (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    path TEXT NOT NULL UNIQUE,
    git_remote TEXT,
    is_main INTEGER NOT NULL DEFAULT 0 CHECK (is_main IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`
  yield* sql`CREATE UNIQUE INDEX project_repos_one_main ON project_repos (project_id) WHERE is_main = 1`

  yield* sql`CREATE TABLE statuses (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('backlog', 'unstarted', 'started', 'completed', 'canceled')),
    position TEXT NOT NULL,
    color TEXT NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (workspace_id, name)
  )`

  yield* sql`CREATE TABLE labels (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived_at INTEGER,
    UNIQUE (workspace_id, name)
  )`

  yield* sql`CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    number INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status_id TEXT NOT NULL REFERENCES statuses(id),
    priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 4),
    position TEXT NOT NULL,
    due_date TEXT,
    parent_id TEXT REFERENCES tasks(id),
    assignee_actor_id TEXT REFERENCES actors(id),
    assignee_session_id TEXT REFERENCES agent_sessions(id),
    created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
    created_by_session_id TEXT REFERENCES agent_sessions(id),
    version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived_at INTEGER,
    UNIQUE (project_id, number)
  )`
  yield* sql`CREATE INDEX tasks_column ON tasks (project_id, status_id, position)`

  yield* sql`CREATE TABLE task_labels (
    task_id TEXT NOT NULL REFERENCES tasks(id),
    label_id TEXT NOT NULL REFERENCES labels(id),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (task_id, label_id)
  )`

  yield* sql`CREATE TABLE comments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    body TEXT NOT NULL,
    actor_id TEXT NOT NULL REFERENCES actors(id),
    session_id TEXT REFERENCES agent_sessions(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  )`
  yield* sql`CREATE INDEX comments_task ON comments (task_id, created_at)`

  yield* sql`CREATE TABLE events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    project_id TEXT,
    command_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    session_id TEXT,
    schema_version INTEGER NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`
  yield* sql`CREATE INDEX events_entity ON events (entity_id, seq)`
  yield* sql`CREATE INDEX events_project ON events (project_id, seq)`
  yield* sql`CREATE INDEX events_workspace ON events (workspace_id, seq)`
  yield* sql`CREATE INDEX events_command ON events (command_id)`

  yield* sql`CREATE TABLE command_receipts (
    command_id TEXT PRIMARY KEY,
    rpc TEXT NOT NULL,
    result TEXT NOT NULL,
    last_seq INTEGER,
    created_at INTEGER NOT NULL
  )`
})
