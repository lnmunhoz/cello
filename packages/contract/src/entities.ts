// Entities as they travel on the wire and live in client state. Schemas only.
import * as Schema from "effect/Schema"

export const Id = Schema.String
export const Millis = Schema.Number
export const DueDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))

export const StatusCategory = Schema.Literals(["backlog", "unstarted", "started", "completed", "canceled"])
export type StatusCategory = typeof StatusCategory.Type

/** 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
export const Priority = Schema.Literals([0, 1, 2, 3, 4])
export type Priority = typeof Priority.Type

export const Actor = Schema.Struct({
  id: Id,
  kind: Schema.Literals(["human", "agent"]),
  name: Schema.String,
  client: Schema.NullOr(Schema.String),
  color: Schema.String,
  createdAt: Millis,
})
export type Actor = typeof Actor.Type

/** One agent conversation, keyed by its host's session id (`externalId`, e.g. CLAUDE_CODE_SESSION_ID). */
export const AgentSession = Schema.Struct({
  id: Id,
  actorId: Id,
  externalId: Schema.NullOr(Schema.String),
  clientName: Schema.String,
  entrypoint: Schema.NullOr(Schema.String),
  cwd: Schema.NullOr(Schema.String),
  pid: Schema.NullOr(Schema.Number),
  startedAt: Millis,
  lastSeenAt: Millis,
  endedAt: Schema.NullOr(Millis),
})
export type AgentSession = typeof AgentSession.Type

export const Workspace = Schema.Struct({
  id: Id,
  name: Schema.String,
  slug: Schema.String,
  position: Schema.String,
  createdAt: Millis,
  updatedAt: Millis,
  archivedAt: Schema.NullOr(Millis),
})
export type Workspace = typeof Workspace.Type

export const Project = Schema.Struct({
  id: Id,
  workspaceId: Id,
  name: Schema.String,
  key: Schema.String,
  color: Schema.String,
  description: Schema.String,
  repoPath: Schema.NullOr(Schema.String),
  createdAt: Millis,
  updatedAt: Millis,
  archivedAt: Schema.NullOr(Millis),
})
export type Project = typeof Project.Type

export const Status = Schema.Struct({
  id: Id,
  workspaceId: Id,
  name: Schema.String,
  category: StatusCategory,
  position: Schema.String,
  color: Schema.String,
  hidden: Schema.Boolean,
  createdAt: Millis,
  updatedAt: Millis,
})
export type Status = typeof Status.Type

export const Label = Schema.Struct({
  id: Id,
  workspaceId: Id,
  name: Schema.String,
  color: Schema.String,
  createdAt: Millis,
  updatedAt: Millis,
  archivedAt: Schema.NullOr(Millis),
})
export type Label = typeof Label.Type

export const Task = Schema.Struct({
  id: Id,
  projectId: Id,
  number: Schema.Number,
  key: Schema.String,
  title: Schema.String,
  description: Schema.String,
  statusId: Id,
  priority: Priority,
  position: Schema.String,
  dueDate: Schema.NullOr(DueDate),
  parentId: Schema.NullOr(Id),
  labelIds: Schema.Array(Id),
  assigneeActorId: Schema.NullOr(Id),
  assigneeSessionId: Schema.NullOr(Id),
  createdByActorId: Id,
  createdBySessionId: Schema.NullOr(Id),
  version: Schema.Number,
  createdAt: Millis,
  updatedAt: Millis,
  archivedAt: Schema.NullOr(Millis),
})
export type Task = typeof Task.Type

export const Comment = Schema.Struct({
  id: Id,
  taskId: Id,
  body: Schema.String,
  actorId: Id,
  sessionId: Schema.NullOr(Id),
  createdAt: Millis,
  updatedAt: Millis,
  deletedAt: Schema.NullOr(Millis),
})
export type Comment = typeof Comment.Type

export const AttachmentKind = Schema.Literals(["image", "video", "file", "link"])
export type AttachmentKind = typeof AttachmentKind.Type

/**
 * Evidence on a task: a file the server copied into `<dataDir>/assets/` (served at
 * `/attachments/<id>`), or a link. Files are never edited; a deleted one keeps its row.
 */
export const Attachment = Schema.Struct({
  id: Id,
  taskId: Id,
  reviewId: Schema.NullOr(Id),
  kind: AttachmentKind,
  /** The original file name; for a link, its URL. */
  name: Schema.String,
  /** Links only. */
  url: Schema.NullOr(Schema.String),
  caption: Schema.String,
  /** Files only. */
  mime: Schema.NullOr(Schema.String),
  bytes: Schema.NullOr(Schema.Number),
  /** A video with a poster frame, served at `/attachments/<id>/poster`. */
  hasPoster: Schema.Boolean,
  actorId: Id,
  sessionId: Schema.NullOr(Id),
  createdAt: Millis,
  deletedAt: Schema.NullOr(Millis),
})
export type Attachment = typeof Attachment.Type

/** `superseded`: a newer review of the same task replaced it before anyone decided. */
export const ReviewDecision = Schema.Literals(["approved", "sent_back", "superseded"])
export type ReviewDecision = typeof ReviewDecision.Type

/**
 * Who submitted a review, for display: the actor's name ("Claude Code") and its host session id. A
 * page may not know the actor yet (agents appear after its snapshot), so the review carries it.
 */
export const ReviewAuthor = Schema.Struct({
  name: Schema.String,
  /** The host's session id (e.g. CLAUDE_CODE_SESSION_ID); null for the human. */
  session: Schema.NullOr(Schema.String),
})
export type ReviewAuthor = typeof ReviewAuthor.Type

/**
 * A review packet: what an agent hands Lucas when it moves a task to In Review. A review is open
 * until it's decided; a task has at most one open review.
 */
export const Review = Schema.Struct({
  id: Id,
  taskId: Id,
  /** Markdown. */
  summary: Schema.String,
  /** How to check the work, in order. */
  steps: Schema.Array(Schema.String),
  attachments: Schema.Array(Attachment),
  actorId: Id,
  sessionId: Schema.NullOr(Id),
  author: ReviewAuthor,
  createdAt: Millis,
  decidedAt: Schema.NullOr(Millis),
  decision: Schema.NullOr(ReviewDecision),
  decisionNote: Schema.NullOr(Schema.String),
})
export type Review = typeof Review.Type

/** Docs, specs and pages share one table and one reader; `kind` says what a document is for. */
export const DocumentKind = Schema.Literals(["doc", "spec", "page"])
export type DocumentKind = typeof DocumentKind.Type

/**
 * Who saved a document's latest version, for display: the actor's name and color, and its host
 * session id (null for the human). Like reviews, documents carry it because a page may not know an
 * agent that appeared after its snapshot.
 */
export const DocumentAuthor = Schema.Struct({
  name: Schema.String,
  color: Schema.String,
  session: Schema.NullOr(Schema.String),
})
export type DocumentAuthor = typeof DocumentAuthor.Type

/** A task a document links to. Keys never change, so the link carries it for clients that don't have the task. */
export const DocumentTask = Schema.Struct({ id: Id, key: Schema.String })
export type DocumentTask = typeof DocumentTask.Type

const documentFields = {
  id: Id,
  workspaceId: Id,
  projectId: Id,
  kind: DocumentKind,
  /** Unique in its project; the reader's URL is `/<project key>/pages/<slug>` and never changes. */
  slug: Schema.String,
  title: Schema.String,
  /** The frontmatter `summary:`, else the first paragraph as plain text. */
  summary: Schema.String,
  /** Bumped by every save that changes something; each one is kept in `document_versions`. */
  version: Schema.Number,
  tasks: Schema.Array(DocumentTask),
  createdByActorId: Id,
  createdBySessionId: Schema.NullOr(Id),
  updatedByActorId: Id,
  updatedBySessionId: Schema.NullOr(Id),
  updatedBy: DocumentAuthor,
  createdAt: Millis,
  updatedAt: Millis,
  archivedAt: Schema.NullOr(Millis),
}

/** A document without its body: what board state, the Docs tab and events carry. */
export const DocumentSummary = Schema.Struct(documentFields)
export type DocumentSummary = typeof DocumentSummary.Type

/** A document with its markdown body (images point at `/attachments/<id>`). */
export const Document = Schema.Struct({ ...documentFields, body: Schema.String })
export type Document = typeof Document.Type

/** One saved version of a document, without its body, for the version history. */
export const DocumentVersion = Schema.Struct({
  documentId: Id,
  version: Schema.Number,
  kind: DocumentKind,
  title: Schema.String,
  summary: Schema.String,
  actorId: Id,
  sessionId: Schema.NullOr(Id),
  author: DocumentAuthor,
  createdAt: Millis,
})
export type DocumentVersion = typeof DocumentVersion.Type

/** Which project a CLI call is about: by key (`--project CEL`), or by the repository folder it runs in. */
export const ProjectRef = Schema.Struct({
  key: Schema.optionalKey(Schema.String),
  /** The main checkout's folder: the parent of `git rev-parse --git-common-dir`. */
  repoPath: Schema.optionalKey(Schema.String),
})
export type ProjectRef = typeof ProjectRef.Type

/** What a subscription or snapshot covers. */
export const Scope = Schema.Union([
  Schema.Struct({ workspaceId: Id }),
  Schema.Struct({ projectId: Id }),
])
export type Scope = typeof Scope.Type

export const Snapshot = Schema.Struct({
  seq: Schema.Number,
  actors: Schema.Array(Actor),
  workspaces: Schema.Array(Workspace),
  projects: Schema.Array(Project),
  statuses: Schema.Array(Status),
  labels: Schema.Array(Label),
  tasks: Schema.Array(Task),
  /** Open reviews of the tasks in scope: everything the Review page and the cards need. */
  reviews: Schema.Array(Review),
  /** Documents of the projects in scope, archived ones included, without their bodies. */
  documents: Schema.Array(DocumentSummary),
})
export type Snapshot = typeof Snapshot.Type
