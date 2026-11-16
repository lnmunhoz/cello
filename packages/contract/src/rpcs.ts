// Every RPC. Writes carry a client-made commandId and return { result, seq }.
import * as Context from "effect/Context"
import * as Schema from "effect/Schema"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import * as RpcMiddleware from "effect/rpc/RpcMiddleware"
import { Backup } from "./backups.ts"
import { BuildPage, ServerBuild } from "./build.ts"
import {
  Ask,
  Comment,
  Document,
  DocumentKind,
  DocumentSummary,
  DocumentVersion,
  DueDate,
  Id,
  Label,
  LabelGroup,
  Priority,
  Project,
  ProjectRef,
  QuestionKind,
  Review,
  Scope,
  SessionAgent,
  Snapshot,
  Status,
  Task,
  Workspace,
} from "./entities.ts"
import { AskRequired, HumanOnly, Invalid, KeyTaken, NotFound, ReviewRequired, SnapshotRequired, TaskClaimed, VersionConflict } from "./errors.ts"
import { CelloEvent } from "./events.ts"
import { SearchKind, SearchResults } from "./search.ts"
import { TaskStage } from "./stages.ts"
import { DocumentList, Inbox, LabelList, ProjectContext, TaskDetail, TaskList, Whoami } from "./views.ts"

/**
 * Who is calling, resolved by the server from per-request RPC headers. `agentId`: the session's subagent
 * making the call (CEL-55), when it said so (`x-cello-agent`); absent or null for the session itself.
 */
export class Caller extends Context.Service<Caller, {
  readonly actorId: string
  readonly sessionId: string | null
  readonly agentId?: string | null
}>()("cello/Caller") {}

/** What `agent.report` says happened to a subagent. */
export const AgentReportState = Schema.Literals(["started", "launched", "stopped"])
export type AgentReportState = typeof AgentReportState.Type

export class CallerMiddleware extends RpcMiddleware.Service<CallerMiddleware, {
  provides: Caller
}>()("cello/CallerMiddleware", { requiredForClient: true }) {}

/** Sent by the CLI on every request. A session of "me", or none, is the human. */
export const IDENTITY_HEADERS = {
  session: "x-cello-session",
  client: "x-cello-client",
  cwd: "x-cello-cwd",
  pid: "x-cello-pid",
  entrypoint: "x-cello-entrypoint",
  /** The session's subagent making the call (CEL-55): its host id, and what it was launched as. */
  agent: "x-cello-agent",
  agentType: "x-cello-agent-type",
} as const

/** The `x-cello-session` value that records the human, whatever agent variables are set. */
export const HUMAN_SESSION = "me"

const commandId = Schema.String
const write = <S extends Schema.Top>(result: S) => Schema.Struct({ result, seq: Schema.NullOr(Schema.Number) })
const neighbors = { before: Schema.optionalKey(Schema.NullOr(Id)), after: Schema.optionalKey(Schema.NullOr(Id)) }

/** A file for a review: an absolute path on the server's machine (the CLI runs on the same one). */
export const EvidenceFile = Schema.Struct({ path: Schema.String, caption: Schema.optionalKey(Schema.String) })
export type EvidenceFile = typeof EvidenceFile.Type
export const EvidenceLink = Schema.Struct({ url: Schema.String, caption: Schema.optionalKey(Schema.String) })
export type EvidenceLink = typeof EvidenceLink.Type

/** An option as an agent writes it; ids are given by the server. */
export const AskOptionInput = Schema.Struct({
  label: Schema.String,
  description: Schema.optionalKey(Schema.String),
  /** An image file (an absolute path on this machine), stored with the ask's evidence and shown as the option's thumbnail. */
  image: Schema.optionalKey(Schema.String),
  recommended: Schema.optionalKey(Schema.Boolean),
  /** Why it's recommended; required when `recommended` is set. A recommended option comes picked for Lucas. */
  because: Schema.optionalKey(Schema.String),
})
export type AskOptionInput = typeof AskOptionInput.Type

export const AskQuestionInput = Schema.Struct({
  prompt: Schema.String,
  /** Default: "one" with options, "text" without. */
  kind: Schema.optionalKey(QuestionKind),
  options: Schema.optionalKey(Schema.Array(AskOptionInput)),
})
export type AskQuestionInput = typeof AskQuestionInput.Type

/** One question answered: option ids from the ask (several are fine) or None of these, a comment, and screenshots uploaded for it (attachment ids). */
export const AnswerInput = Schema.Struct({
  questionId: Schema.String,
  optionIds: Schema.Array(Schema.String),
  /** "None of these": no option fits; the comment says what instead. */
  none: Schema.optionalKey(Schema.Boolean),
  comment: Schema.optionalKey(Schema.String),
  attachmentIds: Schema.optionalKey(Schema.Array(Id)),
})
export type AnswerInput = typeof AnswerInput.Type

export const CelloRpcs = RpcGroup.make(
  // No scope: the first non-archived workspace by position. Every snapshot lists all non-archived workspaces.
  Rpc.make("snapshot.get", { payload: { scope: Schema.optionalKey(Scope) }, success: Snapshot, error: NotFound }),
  Rpc.make("events.subscribe", {
    payload: { scope: Scope, afterSeq: Schema.Number },
    success: CelloEvent,
    error: SnapshotRequired,
    stream: true,
  }),

  Rpc.make("workspace.create", { payload: { commandId, name: Schema.String }, success: write(Workspace), error: Invalid }),
  Rpc.make("workspace.update", {
    payload: { commandId, id: Id, name: Schema.optionalKey(Schema.String) },
    success: write(Workspace),
    error: Schema.Union([NotFound, Invalid]),
  }),

  Rpc.make("project.create", {
    payload: {
      commandId,
      workspaceId: Id,
      name: Schema.String,
      /** Without one, the server picks a free key made from the name. */
      key: Schema.optionalKey(Schema.String),
      color: Schema.optionalKey(Schema.String),
      repoPath: Schema.optionalKey(Schema.String),
    },
    success: write(Project),
    error: Schema.Union([NotFound, Invalid, KeyTaken]),
  }),
  Rpc.make("project.update", {
    payload: {
      commandId,
      id: Id,
      name: Schema.optionalKey(Schema.String),
      color: Schema.optionalKey(Schema.String),
      description: Schema.optionalKey(Schema.String),
    },
    success: write(Project),
    error: Schema.Union([NotFound, Invalid]),
  }),
  Rpc.make("project.archive", { payload: { commandId, id: Id }, success: write(Project), error: NotFound }),

  Rpc.make("status.update", {
    payload: {
      commandId,
      id: Id,
      name: Schema.optionalKey(Schema.String),
      color: Schema.optionalKey(Schema.String),
      hidden: Schema.optionalKey(Schema.Boolean),
      ...neighbors,
    },
    success: write(Status),
    error: Schema.Union([NotFound, Invalid]),
  }),

  Rpc.make("label.create", {
    payload: { commandId, workspaceId: Id, name: Schema.String, color: Schema.String, group: Schema.optionalKey(LabelGroup) },
    success: write(Label),
    error: Schema.Union([NotFound, Invalid]),
  }),
  Rpc.make("label.update", {
    payload: {
      commandId,
      id: Id,
      name: Schema.optionalKey(Schema.String),
      color: Schema.optionalKey(Schema.String),
      group: Schema.optionalKey(LabelGroup),
    },
    success: write(Label),
    error: Schema.Union([NotFound, Invalid]),
  }),
  // Archiving hides a label everywhere (cards, pickers, `cello context`) and it can't be added to a task any more;
  // tasks keep the link, so their history still names it. Its name stays taken.
  Rpc.make("label.archive", { payload: { commandId, id: Id }, success: write(Label), error: NotFound }),

  Rpc.make("task.create", {
    payload: {
      commandId,
      projectId: Id,
      title: Schema.String,
      description: Schema.optionalKey(Schema.String),
      statusId: Schema.optionalKey(Id),
      priority: Schema.optionalKey(Priority),
      labelIds: Schema.optionalKey(Schema.Array(Id)),
      dueDate: Schema.optionalKey(Schema.NullOr(DueDate)),
      parentId: Schema.optionalKey(Schema.NullOr(Id)),
      ...neighbors,
    },
    success: write(Task),
    error: Schema.Union([NotFound, Invalid]),
  }),
  Rpc.make("task.update", {
    payload: {
      commandId,
      id: Id,
      expectedVersion: Schema.Number,
      title: Schema.optionalKey(Schema.String),
      description: Schema.optionalKey(Schema.String),
      priority: Schema.optionalKey(Priority),
      dueDate: Schema.optionalKey(Schema.NullOr(DueDate)),
      parentId: Schema.optionalKey(Schema.NullOr(Id)),
    },
    success: write(Task),
    error: Schema.Union([NotFound, Invalid, VersionConflict]),
  }),
  // An agent can't move a task into In Review without an open review (ReviewRequired); the human can.
  // No one moves a task into Needs input (AskRequired: an agent's `ask.create` does that). Moving a task
  // out of Needs input withdraws its open ask.
  Rpc.make("task.move", {
    payload: { commandId, id: Id, expectedVersion: Schema.optionalKey(Schema.Number), statusId: Id, ...neighbors },
    success: write(Task),
    error: Schema.Union([NotFound, Invalid, VersionConflict, ReviewRequired, AskRequired]),
  }),
  Rpc.make("task.setLabels", {
    payload: { commandId, id: Id, add: Schema.Array(Id), remove: Schema.Array(Id) },
    success: write(Task),
    error: Schema.Union([NotFound, Invalid]),
  }),
  Rpc.make("task.archive", { payload: { commandId, id: Id }, success: write(Task), error: NotFound }),
  Rpc.make("task.unarchive", { payload: { commandId, id: Id }, success: write(Task), error: NotFound }),
  Rpc.make("task.history", { payload: { id: Id }, success: Schema.Array(CelloEvent), error: NotFound }),

  // For the CLI. Tasks are named by key ("CEL-3"); projects by key or repository folder.
  Rpc.make("whoami", { payload: { project: ProjectRef }, success: Whoami }),
  Rpc.make("context", { payload: { project: ProjectRef }, success: ProjectContext, error: Schema.Union([NotFound, Invalid]) }),
  Rpc.make("task.list", {
    payload: {
      project: ProjectRef,
      status: Schema.optionalKey(Schema.String),
      label: Schema.optionalKey(Schema.String),
      mine: Schema.optionalKey(Schema.Boolean),
    },
    success: TaskList,
    error: Schema.Union([NotFound, Invalid]),
  }),
  Rpc.make("task.get", { payload: { key: Schema.String }, success: TaskDetail, error: NotFound }),
  // The project's workspace labels, archived ones too, with how many tasks carry each.
  Rpc.make("label.list", { payload: { project: ProjectRef }, success: LabelList, error: Schema.Union([NotFound, Invalid]) }),
  Rpc.make("task.claim", {
    payload: { commandId, key: Schema.String },
    success: write(Task),
    error: Schema.Union([NotFound, TaskClaimed]),
  }),
  Rpc.make("task.release", {
    payload: { commandId, key: Schema.String },
    success: write(Task),
    error: Schema.Union([NotFound, Invalid]),
  }),
  // Where a task is inside In Progress (CEL-35); null clears it. The claim holder or the human; only
  // while the task is in In Progress.
  Rpc.make("task.stage", {
    payload: { commandId, key: Schema.String, stage: Schema.NullOr(TaskStage) },
    success: write(Task),
    error: Schema.Union([NotFound, Invalid]),
  }),

  // The caller's inbox (CEL-15): the human's comments on tasks its session claimed. Takes the new items
  // and marks them read in one step, so each is handed over once, even to takers running at the same
  // time; `unreadOnly` leaves out the ones read before. Read marks are the session's own bookkeeping,
  // not board changes: no commandId, no event. (`context` shows new items without taking them.)
  Rpc.make("inbox.take", { payload: { unreadOnly: Schema.optionalKey(Schema.Boolean) }, success: Inbox }),
  // Blocks until the caller has at least one new item, then takes them as `inbox.take` with `unreadOnly`
  // does (CEL-74: `cello inbox --wait`, so an idle agent session wakes on a comment). Returns at once
  // when items are waiting, and for the human. Items a live `ask.wait` is handing over are left to it.
  Rpc.make("inbox.wait", { payload: {}, success: Inbox }),

  // A subagent of the caller's session (CEL-55), as Claude Code's hooks see it: `started` (SubagentStart),
  // `launched` (the parent's Agent tool returned its id, with the launch's description and prompt, which
  // name the task) or `stopped` (SubagentStop). Presence bookkeeping like a check-in: no commandId; boards
  // hear it as `agent.seen`. The human, or a session-less call, changes nothing.
  Rpc.make("agent.report", {
    payload: {
      agentId: Schema.String,
      agentType: Schema.NullOr(Schema.String),
      state: AgentReportState,
      description: Schema.optionalKey(Schema.String),
      prompt: Schema.optionalKey(Schema.String),
    },
    success: Schema.NullOr(SessionAgent),
  }),

  // Review packets. `review.submit` copies the files (absolute paths on this machine) into the data
  // folder and moves the task to In Review, in one command. Only the human approves or sends back.
  Rpc.make("review.submit", {
    payload: {
      commandId,
      key: Schema.String,
      summary: Schema.String,
      steps: Schema.Array(Schema.String),
      files: Schema.Array(EvidenceFile),
      links: Schema.Array(EvidenceLink),
    },
    success: write(Schema.Struct({ review: Review, task: Task })),
    error: Schema.Union([NotFound, Invalid]),
  }),
  // With `attachmentIds` (screenshots pasted into the Review page's box, CEL-73), they and the note go in
  // a comment in the same command, and the approval carries no note.
  Rpc.make("review.approve", {
    payload: { commandId, key: Schema.String, note: Schema.optionalKey(Schema.String), attachmentIds: Schema.optionalKey(Schema.Array(Id)) },
    success: write(Task),
    error: Schema.Union([NotFound, Invalid, HumanOnly]),
  }),
  // The note becomes a comment; `attachmentIds`: screenshots pasted into the Review page's box with it (CEL-73).
  Rpc.make("review.sendBack", {
    payload: { commandId, key: Schema.String, note: Schema.String, attachmentIds: Schema.optionalKey(Schema.Array(Id)) },
    success: write(Task),
    error: Schema.Union([NotFound, Invalid, HumanOnly]),
  }),
  // Every review of a task, open and decided, oldest first.
  Rpc.make("review.list", { payload: { taskId: Id }, success: Schema.Array(Review), error: NotFound }),

  // Needs input (CEL-47). `ask.create` copies the evidence (absolute paths on this machine) into the
  // data folder and moves the task to Needs input, in one command; asking again replaces the open ask.
  // Only the human answers: every question, with valid option ids; the task goes back to In Progress
  // and the answers wait in the asking session's inbox. Lucas's pasted screenshots are uploaded first
  // (POST /asks/<id>/uploads) and referenced by id.
  Rpc.make("ask.create", {
    payload: {
      commandId,
      key: Schema.String,
      title: Schema.String,
      intro: Schema.optionalKey(Schema.String),
      questions: Schema.Array(AskQuestionInput),
      files: Schema.Array(EvidenceFile),
      links: Schema.Array(EvidenceLink),
    },
    success: write(Schema.Struct({ ask: Ask, task: Task })),
    error: Schema.Union([NotFound, Invalid, TaskClaimed]),
  }),
  Rpc.make("ask.answer", {
    payload: {
      commandId,
      askId: Id,
      answers: Schema.Array(AnswerInput),
      note: Schema.optionalKey(Schema.String),
      noteAttachmentIds: Schema.optionalKey(Schema.Array(Id)),
    },
    success: write(Schema.Struct({ ask: Ask, task: Task })),
    error: Schema.Union([NotFound, Invalid, HumanOnly]),
  }),
  // The asking agent changed its mind: the task returns to In Progress. Only the claim holder asks or
  // withdraws (TaskClaimed otherwise); the human answers, and withdraws by moving the card.
  Rpc.make("ask.withdraw", {
    payload: { commandId, key: Schema.String },
    success: write(Schema.Struct({ ask: Ask, task: Task })),
    error: Schema.Union([NotFound, Invalid, TaskClaimed]),
  }),
  // The task's latest ask, open or not.
  Rpc.make("ask.get", { payload: { key: Schema.String }, success: Ask, error: NotFound }),
  // Every ask of a task, oldest first.
  Rpc.make("ask.list", { payload: { taskId: Id }, success: Schema.Array(Ask), error: NotFound }),
  // Waits until the task's latest ask is answered or withdrawn, then returns it (at once when it
  // already is). Hands the answers over: the caller's inbox item for them is marked read, so the hook
  // doesn't deliver them a second time.
  Rpc.make("ask.wait", { payload: { key: Schema.String }, success: Ask, error: NotFound }),

  // Documents (docs, specs, pages). `document.publish` creates a page or saves a new version of one:
  // the same slug, else the same source file, updates it. `files` are absolute paths on this machine
  // (the CLI runs on the same one), copied into the data folder; links in the body that point at them
  // are rewritten to `/attachments/<id>`. Republishing what's already there changes nothing (seq null).
  Rpc.make("document.publish", {
    payload: {
      commandId,
      project: ProjectRef,
      body: Schema.String,
      /** Default: the document's kind, or "page" for a new one. */
      kind: Schema.optionalKey(DocumentKind),
      slug: Schema.optionalKey(Schema.String),
      /** Default: the frontmatter `title:`, the first `# heading`, or the source file's name. */
      title: Schema.optionalKey(Schema.String),
      /** Default: the frontmatter `summary:`, else the first paragraph. */
      summary: Schema.optionalKey(Schema.String),
      /** The markdown file's absolute path: republishing it updates the same page; relative links resolve from it. */
      sourcePath: Schema.optionalKey(Schema.String),
      /** Tasks to link the document to ("CEL-12"); links are only ever added. */
      taskKeys: Schema.optionalKey(Schema.Array(Schema.String)),
      files: Schema.optionalKey(Schema.Array(Schema.String)),
    },
    success: write(Document),
    error: Schema.Union([NotFound, Invalid]),
  }),
  // The latest version, or an older one (its kind, title, summary and body, and its number in `version`).
  Rpc.make("document.get", {
    payload: { project: ProjectRef, slug: Schema.String, version: Schema.optionalKey(Schema.Number) },
    success: Document,
    error: Schema.Union([NotFound, Invalid]),
  }),
  // A project's documents that aren't archived, newest first.
  Rpc.make("document.list", {
    payload: { project: ProjectRef, kind: Schema.optionalKey(DocumentKind) },
    success: DocumentList,
    error: Schema.Union([NotFound, Invalid]),
  }),
  // Every version of a document, newest first.
  Rpc.make("document.history", { payload: { id: Id }, success: Schema.Array(DocumentVersion), error: NotFound }),
  Rpc.make("document.archive", {
    payload: { commandId, project: ProjectRef, slug: Schema.String },
    success: write(DocumentSummary),
    error: Schema.Union([NotFound, Invalid]),
  }),

  // Backups of the data folder (database and assets). `backup.create` takes a manual one now and
  // prunes old ones; `backup.list` is newest first. Restoring happens offline, in the CLI.
  Rpc.make("backup.create", { payload: {}, success: Backup }),
  Rpc.make("backup.list", { payload: {}, success: Schema.Array(Backup) }),

  // The server's build (CEL-37): version, commit, start time and the web app it serves. A tab asks on
  // every (re)connect and offers a reload when the web build differs from the one it loaded.
  Rpc.make("server.build", { payload: {}, success: ServerBuild }),
  // Every build the server has run (CEL-50), newest first, a page at a time: `before` is the previous
  // page's `next` (a build number); `limit` defaults to 50, at most 200.
  Rpc.make("builds.list", {
    payload: { before: Schema.optionalKey(Schema.Number), limit: Schema.optionalKey(Schema.Number) },
    success: BuildPage,
    error: Invalid,
  }),

  // Search (CEL-11, CEL-43): tasks (key, title, description), comments, review packets and documents
  // through one SQLite FTS5 index kept current in the same transaction as each change, plus project and
  // label names. `workspaceId` searches a workspace (the ⌘K bar); otherwise `project` searches one
  // project (`cello search`). A task key ("CEL-15") jumps to it and finds what mentions it; words match
  // the start of words, stemmed ("videos" finds "video"), all of them required. `limit`: hits per kind,
  // 5 by default, at most 50.
  Rpc.make("search.query", {
    payload: {
      query: Schema.String,
      workspaceId: Schema.optionalKey(Id),
      project: Schema.optionalKey(ProjectRef),
      kinds: Schema.optionalKey(Schema.Array(SearchKind)),
      limit: Schema.optionalKey(Schema.Number),
    },
    success: SearchResults,
    error: Schema.Union([NotFound, Invalid]),
  }),

  Rpc.make("comment.list", { payload: { taskId: Id }, success: Schema.Array(Comment), error: NotFound }),
  // Screenshots in comments (CEL-73): Lucas's are uploaded while he writes (POST /tasks/<id>/uploads)
  // and sent by id (`attachmentIds`); an agent's are image files on this machine (`files`, absolute
  // paths), copied into the data folder. The body may be empty when the comment carries a screenshot.
  Rpc.make("comment.add", {
    payload: {
      commandId,
      taskId: Id,
      body: Schema.String,
      attachmentIds: Schema.optionalKey(Schema.Array(Id)),
      files: Schema.optionalKey(Schema.Array(EvidenceFile)),
    },
    success: write(Comment),
    error: Schema.Union([NotFound, Invalid]),
  }),
  Rpc.make("comment.edit", {
    payload: { commandId, id: Id, body: Schema.String },
    success: write(Comment),
    error: Schema.Union([NotFound, Invalid]),
  }),
  Rpc.make("comment.delete", { payload: { commandId, id: Id }, success: write(Comment), error: NotFound }),
  // An emoji reaction on a comment (CEL-77): `on` adds the caller's reaction with that emoji, false
  // removes it; either is a no-op (no event) when it's already so. Returns the comment with its reactions.
  Rpc.make("comment.react", {
    payload: { commandId, commentId: Id, emoji: Schema.String, on: Schema.Boolean },
    success: write(Comment),
    error: Schema.Union([NotFound, Invalid]),
  }),
).middleware(CallerMiddleware)

export type CelloRpcs = typeof CelloRpcs
