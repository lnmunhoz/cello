// Reading rows into contract entities. Every service and the snapshot read through these, so a
// column maps to a field in exactly one place. Each reader takes a WHERE fragment over its aliases.
import type {
  Actor,
  Ask,
  AskQuestion,
  AskState,
  Attachment,
  AttachmentKind,
  Comment,
  DocumentKind,
  DocumentSummary,
  InboxItem,
  InboxKind,
  Label,
  Priority,
  Project,
  Review,
  ReviewDecision,
  Status,
  StatusCategory,
  Task,
  Workspace,
} from "@cello/contract/entities"
import { formatTaskKey } from "@cello/shared/taskKey"
import * as Effect from "effect/Effect"
import type * as SqlClient from "effect/sql/SqlClient"
import type * as Statement from "effect/sql/Statement"

type Sql = SqlClient.SqlClient
type Where = Statement.Fragment

interface ActorRow {
  id: string
  kind: "human" | "agent"
  name: string
  client: string | null
  color: string
  created_at: number
}

export const selectActors = (sql: Sql) =>
  sql<ActorRow>`SELECT id, kind, name, client, color, created_at FROM actors ORDER BY created_at, id`.pipe(
    Effect.map((rows) =>
      rows.map((r): Actor => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        client: r.client,
        color: r.color,
        createdAt: r.created_at,
      }))),
  )

interface WorkspaceRow {
  id: string
  name: string
  slug: string
  position: string
  created_at: number
  updated_at: number
  archived_at: number | null
}

/** Alias: `w`. */
export const selectWorkspaces = (sql: Sql, where: Where) =>
  sql<WorkspaceRow>`SELECT w.* FROM workspaces w WHERE ${where} ORDER BY w.position, w.id`.pipe(
    Effect.map((rows) =>
      rows.map((r): Workspace => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        position: r.position,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        archivedAt: r.archived_at,
      }))),
  )

interface ProjectRow {
  id: string
  workspace_id: string
  name: string
  key: string
  color: string
  description: string
  repo_path: string | null
  created_at: number
  updated_at: number
  archived_at: number | null
}

/** Alias: `p`. */
export const selectProjects = (sql: Sql, where: Where) =>
  sql<ProjectRow>`
    SELECT p.id, p.workspace_id, p.name, p.key, p.color, p.description, r.path AS repo_path,
           p.created_at, p.updated_at, p.archived_at
    FROM projects p LEFT JOIN project_repos r ON r.project_id = p.id AND r.is_main = 1
    WHERE ${where} ORDER BY p.created_at, p.id`.pipe(
    Effect.map((rows) =>
      rows.map((r): Project => ({
        id: r.id,
        workspaceId: r.workspace_id,
        name: r.name,
        key: r.key,
        color: r.color,
        description: r.description,
        repoPath: r.repo_path,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        archivedAt: r.archived_at,
      }))),
  )

interface StatusRow {
  id: string
  workspace_id: string
  name: string
  category: StatusCategory
  position: string
  color: string
  hidden: number
  created_at: number
  updated_at: number
}

/** Alias: `s`. */
export const selectStatuses = (sql: Sql, where: Where) =>
  sql<StatusRow>`SELECT s.* FROM statuses s WHERE ${where} ORDER BY s.position, s.id`.pipe(
    Effect.map((rows) =>
      rows.map((r): Status => ({
        id: r.id,
        workspaceId: r.workspace_id,
        name: r.name,
        category: r.category,
        position: r.position,
        color: r.color,
        hidden: r.hidden === 1,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }))),
  )

interface LabelRow {
  id: string
  workspace_id: string
  name: string
  color: string
  created_at: number
  updated_at: number
  archived_at: number | null
}

/** Alias: `l`. */
export const selectLabels = (sql: Sql, where: Where) =>
  sql<LabelRow>`SELECT l.* FROM labels l WHERE ${where} ORDER BY l.name, l.id`.pipe(
    Effect.map((rows) =>
      rows.map((r): Label => ({
        id: r.id,
        workspaceId: r.workspace_id,
        name: r.name,
        color: r.color,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        archivedAt: r.archived_at,
      }))),
  )

interface TaskRow {
  id: string
  project_id: string
  project_key: string
  number: number
  title: string
  description: string
  status_id: string
  priority: Priority
  position: string
  due_date: string | null
  parent_id: string | null
  assignee_actor_id: string | null
  assignee_session_id: string | null
  created_by_actor_id: string
  created_by_session_id: string | null
  version: number
  created_at: number
  updated_at: number
  archived_at: number | null
}

/** Aliases: `t` (tasks) and `p` (its project). */
export const selectTasks = (sql: Sql, where: Where) =>
  Effect.gen(function* () {
    const rows = yield* sql<TaskRow>`
      SELECT t.*, p.key AS project_key FROM tasks t JOIN projects p ON p.id = t.project_id
      WHERE ${where} ORDER BY t.project_id, t.number`
    const links = yield* sql<{ task_id: string; label_id: string }>`
      SELECT tl.task_id, tl.label_id FROM task_labels tl
      JOIN tasks t ON t.id = tl.task_id JOIN projects p ON p.id = t.project_id
      WHERE ${where} ORDER BY tl.created_at, tl.label_id`
    const labelIds = new Map<string, string[]>()
    for (const link of links) {
      const list = labelIds.get(link.task_id)
      if (list) list.push(link.label_id)
      else labelIds.set(link.task_id, [link.label_id])
    }
    return rows.map((r): Task => ({
      id: r.id,
      projectId: r.project_id,
      number: r.number,
      key: formatTaskKey(r.project_key, r.number),
      title: r.title,
      description: r.description,
      statusId: r.status_id,
      priority: r.priority,
      position: r.position,
      dueDate: r.due_date,
      parentId: r.parent_id,
      labelIds: labelIds.get(r.id) ?? [],
      assigneeActorId: r.assignee_actor_id,
      assigneeSessionId: r.assignee_session_id,
      createdByActorId: r.created_by_actor_id,
      createdBySessionId: r.created_by_session_id,
      version: r.version,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      archivedAt: r.archived_at,
    }))
  })

interface CommentRow {
  id: string
  task_id: string
  body: string
  actor_id: string
  session_id: string | null
  created_at: number
  updated_at: number
  deleted_at: number | null
}

const toComment = (r: CommentRow): Comment => ({
  id: r.id,
  taskId: r.task_id,
  body: r.body,
  actorId: r.actor_id,
  sessionId: r.session_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
})

/** Alias: `c`. */
export const selectComments = (sql: Sql, where: Where) =>
  sql<CommentRow>`SELECT c.* FROM comments c WHERE ${where} ORDER BY c.created_at, c.rowid`.pipe(
    Effect.map((rows) => rows.map(toComment)),
  )

type InboxRow = { [K in keyof CommentRow]: CommentRow[K] | null } & {
  item_id: string
  kind: InboxKind
  item_task_id: string
  ask_id: string | null
  detail: string | null
  item_created_at: number
  read_at: number | null
  task_number: number
  task_title: string
  project_key: string
  author: string
}

/**
 * Aliases: `i` (inbox_items), `c` (its comment, when it holds one), `t` (the task). Oldest first;
 * deleted comments are left out. An answers or withdrawn item comes with its ask; its author is the human.
 */
export const selectInboxItems = (sql: Sql, where: Where) =>
  Effect.gen(function* () {
    const rows = yield* sql<InboxRow>`
      SELECT c.*, i.id AS item_id, i.kind, i.task_id AS item_task_id, i.ask_id, i.detail, i.created_at AS item_created_at, i.read_at,
             t.number AS task_number, t.title AS task_title, p.key AS project_key,
             COALESCE(a.name, (SELECT name FROM actors WHERE kind = 'human' ORDER BY created_at LIMIT 1)) AS author
      FROM inbox_items i
      LEFT JOIN comments c ON c.id = i.comment_id
      JOIN tasks t ON t.id = i.task_id
      JOIN projects p ON p.id = t.project_id
      LEFT JOIN actors a ON a.id = c.actor_id
      WHERE (i.comment_id IS NULL OR c.deleted_at IS NULL) AND ${where}
      ORDER BY i.created_at, i.rowid`
    const askIds = rows.flatMap((r) => (r.ask_id === null ? [] : [r.ask_id]))
    const asks = askIds.length === 0 ? [] : yield* selectAsks(sql, sql.in("a.id", askIds))
    return rows.flatMap((r): InboxItem[] => {
      const common = {
        id: r.item_id,
        taskId: r.item_task_id,
        taskKey: formatTaskKey(r.project_key, r.task_number),
        taskTitle: r.task_title,
        author: r.author,
        createdAt: r.item_created_at,
        readAt: r.read_at,
      }
      if (r.kind === "answers" || r.kind === "withdrawn") {
        const ask = asks.find((k) => k.id === r.ask_id)
        if (!ask) return []
        return [r.kind === "answers" ? { ...common, kind: "answers", ask } : { ...common, kind: "withdrawn", ask, status: r.detail ?? "another status" }]
      }
      return [{ ...common, kind: r.kind, comment: toComment(r as CommentRow) }]
    })
  })

interface AttachmentRow {
  id: string
  task_id: string
  review_id: string | null
  ask_id: string | null
  answer_to: string | null
  kind: AttachmentKind
  name: string
  url: string | null
  caption: string
  mime: string | null
  bytes: number | null
  poster_path: string | null
  actor_id: string
  session_id: string | null
  created_at: number
  deleted_at: number | null
}

export const toAttachment = (r: AttachmentRow): Attachment => ({
  id: r.id,
  taskId: r.task_id,
  reviewId: r.review_id,
  askId: r.ask_id,
  kind: r.kind,
  name: r.name,
  url: r.url,
  caption: r.caption,
  mime: r.mime,
  bytes: r.bytes,
  hasPoster: r.poster_path !== null,
  actorId: r.actor_id,
  sessionId: r.session_id,
  createdAt: r.created_at,
  deletedAt: r.deleted_at,
})

interface ReviewRow {
  id: string
  task_id: string
  summary: string
  steps: string
  actor_id: string
  session_id: string | null
  created_at: number
  decided_at: number | null
  decision: ReviewDecision | null
  decision_note: string | null
  author_name: string
  author_session: string | null
}

interface DocumentRow {
  id: string
  workspace_id: string
  project_id: string
  kind: DocumentKind
  slug: string
  title: string
  summary: string
  version: number
  created_by_actor_id: string
  created_by_session_id: string | null
  updated_by_actor_id: string
  updated_by_session_id: string | null
  created_at: number
  updated_at: number
  archived_at: number | null
  author_name: string
  author_color: string
  author_session: string | null
}

/**
 * Aliases: `d` (documents) and `p` (its project). Newest first, without bodies; each comes with the
 * tasks it links to (oldest link first) and who saved its latest version.
 */
export const selectDocuments = (sql: Sql, where: Where) =>
  Effect.gen(function* () {
    const rows = yield* sql<DocumentRow>`
      SELECT d.id, d.workspace_id, d.project_id, d.kind, d.slug, d.title, d.summary, d.version,
             d.created_by_actor_id, d.created_by_session_id, d.updated_by_actor_id, d.updated_by_session_id,
             d.created_at, d.updated_at, d.archived_at,
             a.name AS author_name, a.color AS author_color, s.external_id AS author_session
      FROM documents d JOIN projects p ON p.id = d.project_id
      JOIN actors a ON a.id = d.updated_by_actor_id LEFT JOIN agent_sessions s ON s.id = d.updated_by_session_id
      WHERE ${where} ORDER BY d.updated_at DESC, d.id DESC`
    const links = rows.length === 0 ? [] : yield* sql<{ document_id: string; task_id: string; project_key: string; number: number }>`
      SELECT dt.document_id, t.id AS task_id, tp.key AS project_key, t.number
      FROM document_tasks dt JOIN tasks t ON t.id = dt.task_id JOIN projects tp ON tp.id = t.project_id
      WHERE ${sql.in("dt.document_id", rows.map((r) => r.id))} ORDER BY dt.created_at, t.number`
    return rows.map((r): DocumentSummary => ({
      id: r.id,
      workspaceId: r.workspace_id,
      projectId: r.project_id,
      kind: r.kind,
      slug: r.slug,
      title: r.title,
      summary: r.summary,
      version: r.version,
      tasks: links.filter((l) => l.document_id === r.id).map((l) => ({ id: l.task_id, key: formatTaskKey(l.project_key, l.number) })),
      createdByActorId: r.created_by_actor_id,
      createdBySessionId: r.created_by_session_id,
      updatedByActorId: r.updated_by_actor_id,
      updatedBySessionId: r.updated_by_session_id,
      updatedBy: { name: r.author_name, color: r.author_color, session: r.author_session },
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      archivedAt: r.archived_at,
    }))
  })

/**
 * Aliases: `r` (reviews), `t` (its task) and `p` (the task's project). Each review comes with its
 * attachments that aren't deleted, and its author's name and host session id.
 */
export const selectReviews = (sql: Sql, where: Where) =>
  Effect.gen(function* () {
    const rows = yield* sql<ReviewRow>`
      SELECT r.*, a.name AS author_name, s.external_id AS author_session
      FROM reviews r JOIN tasks t ON t.id = r.task_id JOIN projects p ON p.id = t.project_id
      JOIN actors a ON a.id = r.actor_id LEFT JOIN agent_sessions s ON s.id = r.session_id
      WHERE ${where} ORDER BY r.created_at, r.id`
    const files = rows.length === 0 ? [] : yield* sql<AttachmentRow>`
      SELECT * FROM attachments WHERE ${sql.in("review_id", rows.map((r) => r.id))} AND deleted_at IS NULL
      ORDER BY created_at, rowid`
    return rows.map((r): Review => ({
      id: r.id,
      taskId: r.task_id,
      summary: r.summary,
      steps: JSON.parse(r.steps) as string[],
      attachments: files.filter((f) => f.review_id === r.id).map(toAttachment),
      actorId: r.actor_id,
      sessionId: r.session_id,
      author: { name: r.author_name, session: r.author_session },
      createdAt: r.created_at,
      decidedAt: r.decided_at,
      decision: r.decision,
      decisionNote: r.decision_note,
    }))
  })

interface AskRow {
  id: string
  task_id: string
  actor_id: string
  session_id: string | null
  title: string
  intro: string
  questions: string
  state: AskState
  created_at: number
  answered_at: number | null
  answers: string | null
  note: string | null
  withdrawn_at: number | null
  withdrawn_by: string | null
  author_name: string
  author_session: string | null
}

/** How `asks.answers` is stored: the picks and comments; screenshots are attachments, by `answer_to`. */
export interface StoredAnswers {
  readonly questions: ReadonlyArray<{
    readonly questionId: string
    readonly optionIds: ReadonlyArray<string>
    readonly none: boolean
    readonly comment: string
  }>
}

/**
 * Aliases: `a` (asks), `t` (its task) and `p` (the task's project). Oldest first. Each ask comes with
 * its evidence, its author's name and host session id, and, once answered, Lucas's answers with the
 * screenshots he pasted into each (attachments whose `answer_to` is the question, or 'note').
 */
export const selectAsks = (sql: Sql, where: Where) =>
  Effect.gen(function* () {
    const rows = yield* sql<AskRow>`
      SELECT a.*, ac.name AS author_name, s.external_id AS author_session
      FROM asks a JOIN tasks t ON t.id = a.task_id JOIN projects p ON p.id = t.project_id
      JOIN actors ac ON ac.id = a.actor_id LEFT JOIN agent_sessions s ON s.id = a.session_id
      WHERE ${where} ORDER BY a.created_at, a.id`
    const files = rows.length === 0 ? [] : yield* sql<AttachmentRow>`
      SELECT * FROM attachments WHERE ${sql.in("ask_id", rows.map((r) => r.id))} AND deleted_at IS NULL
      ORDER BY created_at, rowid`
    return rows.map((r): Ask => {
      const mine = files.filter((f) => f.ask_id === r.id)
      const answering = (to: string) => mine.filter((f) => f.answer_to === to).map(toAttachment)
      const stored = r.answers === null ? null : (JSON.parse(r.answers) as StoredAnswers)
      return {
        id: r.id,
        taskId: r.task_id,
        title: r.title,
        intro: r.intro,
        questions: JSON.parse(r.questions) as AskQuestion[],
        attachments: mine.filter((f) => f.answer_to === null).map(toAttachment),
        actorId: r.actor_id,
        sessionId: r.session_id,
        author: { name: r.author_name, session: r.author_session },
        state: r.state,
        createdAt: r.created_at,
        answeredAt: r.answered_at,
        answers: stored === null ? null : {
          questions: stored.questions.map((q) => ({ ...q, attachments: answering(q.questionId) })),
          note: r.note ?? "",
          noteAttachments: answering("note"),
        },
        withdrawnAt: r.withdrawn_at,
        withdrawnBy: r.withdrawn_by,
      }
    })
  })
