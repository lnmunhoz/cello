// Every change is one of these events. `before`/`after` hold only the fields that changed.
import * as Schema from "effect/Schema"
import { BuildRecord } from "./build.ts"
import {
  AgentSession,
  Ask,
  Comment,
  DeliveryVia,
  DocumentSummary,
  DueDate,
  Id,
  Label,
  LabelGroup,
  Millis,
  NotWokenReason,
  Priority,
  ProfileField,
  Project,
  Reaction,
  Review,
  ReviewDecision,
  SessionAgent,
  SessionRun,
  Status,
  Task,
  WakeWhy,
  Workspace,
} from "./entities.ts"
import { TaskStage } from "./stages.ts"

export const CURRENT_SCHEMA_VERSION = 1

const envelope = {
  seq: Schema.Number,
  ts: Millis,
  commandId: Schema.String,
  actorId: Id,
  sessionId: Schema.NullOr(Id),
  /** The session's subagent that caused it (CEL-55); absent (older events) or null when the session itself did. */
  agentId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /** The model and effort the agent was on when it caused it (CEL-119); absent (older events) or null when unknown. */
  model: Schema.optionalKey(Schema.NullOr(Schema.String)),
  effort: Schema.optionalKey(Schema.NullOr(Schema.String)),
  workspaceId: Id,
  projectId: Schema.NullOr(Id),
  schemaVersion: Schema.Literal(CURRENT_SCHEMA_VERSION),
}

const event = <const T extends string, F extends Schema.Struct.Fields>(type: T, fields: F) =>
  Schema.Struct({ ...envelope, type: Schema.Literal(type), ...fields })

const patch = <F extends Schema.Struct.Fields>(fields: F) =>
  Schema.Struct(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, Schema.optionalKey(v)])) as {
    [K in keyof F]: Schema.optionalKey<F[K]>
  })

export const WorkspacePatch = patch({ name: Schema.String })
export const ProjectPatch = patch({ name: Schema.String, color: Schema.String, description: Schema.String })
export const StatusPatch = patch({ name: Schema.String, color: Schema.String, hidden: Schema.Boolean, position: Schema.String })
export const LabelPatch = patch({ name: Schema.String, color: Schema.String, group: LabelGroup })
export const TaskPatch = patch({
  title: Schema.String,
  description: Schema.String,
  priority: Priority,
  dueDate: Schema.NullOr(DueDate),
  parentId: Schema.NullOr(Id),
})
export const CommentPatch = patch({ body: Schema.String })
export const WakeSettingsPatch = patch({ enabled: Schema.Boolean, capPerHour: Schema.Number })
const Place = Schema.Struct({ statusId: Id, position: Schema.String })
/** Who held a claim: an agent session, or the human (sessionId null). */
export const ClaimHolder = Schema.Struct({ actorId: Id, sessionId: Schema.NullOr(Id) })
/** `agent`: `cello task ask --withdraw`; `moved`: Lucas moved the card out of Needs input; `superseded`: a newer ask replaced it. */
export const AskWithdrawReason = Schema.Literals(["agent", "moved", "superseded"])
export type AskWithdrawReason = typeof AskWithdrawReason.Type

export const CelloEvent = Schema.Union([
  event("workspace.created", { workspace: Workspace }),
  event("workspace.updated", { id: Id, before: WorkspacePatch, after: WorkspacePatch }),
  event("project.created", { project: Project }),
  event("project.updated", { id: Id, before: ProjectPatch, after: ProjectPatch }),
  event("project.archived", { id: Id }),
  // The project's testing profile changed (CEL-89): fields set, unset, or confirmed (same value, new
  // time). `before` is null for a field that wasn't set, `after` null for one unset. `project` is the
  // project's id (the profile's entity id), the same as the envelope's projectId.
  event("profile.changed", {
    project: Id,
    changes: Schema.Array(Schema.Struct({ field: Schema.String, before: Schema.NullOr(ProfileField), after: Schema.NullOr(ProfileField) })),
  }),
  event("status.updated", { id: Id, before: StatusPatch, after: StatusPatch }),
  event("label.created", { label: Label }),
  event("label.updated", { id: Id, before: LabelPatch, after: LabelPatch }),
  event("label.archived", { id: Id }),
  event("task.created", { task: Task }),
  event("task.updated", { id: Id, before: TaskPatch, after: TaskPatch, version: Schema.Number }),
  event("task.moved", { id: Id, from: Place, to: Place, version: Schema.Number, task: Task }),
  event("task.labels_changed", { id: Id, added: Schema.Array(Id), removed: Schema.Array(Id), version: Schema.Number }),
  event("task.archived", { id: Id, version: Schema.Number }),
  event("task.unarchived", { id: Id, version: Schema.Number }),
  // Claims carry the whole task: a claim sets the assignee and may move it to a started status.
  event("task.claimed", { id: Id, version: Schema.Number, task: Task }),
  event("task.claim_taken", {
    id: Id,
    version: Schema.Number,
    task: Task,
    from: ClaimHolder,
    reason: Schema.Literals(["holder_exited", "holder_idle", "human"]),
  }),
  event("task.released", { id: Id, version: Schema.Number, task: Task }),
  // The human commented on a task nobody held, so it went back to the agent session that last held its
  // claim (CEL-110): `session` holds the claim again. `from` is the status it was in before the
  // comment's command; when that moved it (Done to In Progress), its own `task.moved` comes first.
  // Written as the human, in the comment's command.
  event("task.reopened", { id: Id, version: Schema.Number, task: Task, from: Id, session: Id }),
  // A human change ends an agent's claim; it shares the version of the change that ended it.
  event("task.claim_ended", { id: Id, version: Schema.Number, from: ClaimHolder, reason: Schema.Literals(["human_change"]) }),
  // `cello task stage` (CEL-35). A status change clears the stage inside its own `task.moved`.
  event("task.stage_changed", { id: Id, version: Schema.Number, before: Schema.NullOr(TaskStage), after: Schema.NullOr(TaskStage) }),
  // An agent session holding a claim checked in (at most once a minute) or its process exited, so
  // boards show who is working right now (CEL-35). Workspace-level (no projectId): one per workspace
  // the session holds claims in. Not a task change: the task's version stays.
  event("session.seen", { session: AgentSession }),
  // A subagent of a session started, was launched on a task, checked in (at most once a minute)
  // or stopped (CEL-55). Workspace-level like session.seen: one per workspace its task (else its
  // session's claims) is in. Carries the whole agent; a board keeps the latest.
  event("agent.seen", { agent: SessionAgent }),
  // A session's `cello inbox --wait` started or stopped (CEL-76): the server sees its `inbox.wait` open
  // and close, so boards can say a comment reaches it at once. Sent when the first opens and the last
  // closes (at most twice a turn). Workspace-level like session.seen: one per workspace it holds claims in.
  event("session.waiting", { session: Id, waiting: Schema.Boolean }),
  // A session went into orchestrate mode or out of it (CEL-124, `cello sessions orchestrate on|off`).
  // Written as the session itself, in the project it ran the command in; running it again changes nothing.
  event("session.orchestrating", { session: Id, orchestrating: Schema.Boolean }),
  // Waking sessions (CEL-92). Lucas acted on a task the session claimed while nothing of it was
  // running: a wake is due `at` (30 s after his last action, reset by each new one); or it won't happen
  // and why; or a woken run started or ended (its row in session_runs is written in the same command).
  // Written as the session itself, in the task's project; each names the task, so they're its history.
  event("session.wake_scheduled", { session: Id, taskId: Id, why: WakeWhy, at: Millis }),
  event("session.not_woken", { session: Id, taskId: Id, why: WakeWhy, reason: NotWokenReason }),
  event("session.run_started", { run: SessionRun }),
  event("session.run_ended", { run: SessionRun }),
  // A project's wake settings changed (CEL-92): `project` is its id, the same as the envelope's projectId.
  event("wake.settings_changed", { project: Id, before: WakeSettingsPatch, after: WakeSettingsPatch }),
  // A comment is activity on its task: the same command sets the task's last change and version (no
  // task event). Edits and deletes name their task so a board can follow; ones stored before don't. A
  // delete carries the task's new `lastCommentAt` (the latest remaining comment, or null).
  event("comment.added", { comment: Comment }),
  event("comment.edited", { id: Id, taskId: Schema.optionalKey(Id), before: CommentPatch, after: CommentPatch }),
  event("comment.deleted", { id: Id, taskId: Schema.optionalKey(Id), lastCommentAt: Schema.optionalKey(Schema.NullOr(Millis)) }),
  // The agent session a comment (or a Send back note) went to took it (CEL-76): written by the same
  // statement that marks the inbox item read, so Lucas sees "Delivered". Not activity on the task.
  event("comment.delivered", { commentId: Id, taskId: Id, session: Id, via: DeliveryVia }),
  // An emoji reaction on a comment (CEL-77), added or removed (removed carries it as it was). Not
  // activity on the task: its version and last change stay, and a claim doesn't end.
  event("reaction.added", { reaction: Reaction }),
  event("reaction.removed", { reaction: Reaction }),
  // A review packet with its attachments. The same command then moves the task (task.moved).
  event("review.submitted", { review: Review }),
  // Approved, sent back, or superseded by a newer review. `ts` is when.
  event("review.decided", { id: Id, taskId: Id, decision: ReviewDecision, note: Schema.NullOr(Schema.String) }),
  // The task left In Review by a plain move (an agent's `cello task move`, Lucas dragging the card), so
  // its open packet closed undecided (decision `withdrawn`, CEL-71). `to` is the status it was moved to;
  // the envelope says who moved it. The same command then moves the task (task.moved).
  event("review.withdrawn", { id: Id, taskId: Id, to: Id }),
  // Needs input (CEL-47). An ask with its questions and evidence; the same command moves the task to
  // Needs input (task.moved). Answered carries the whole ask with Lucas's answers; the same command
  // moves the task back to In Progress. Withdrawn: by the agent, by Lucas moving the card himself, or
  // replaced by a newer ask on the same task (state `superseded`). `ts` is when.
  event("ask.created", { ask: Ask }),
  event("ask.answered", { ask: Ask }),
  event("ask.withdrawn", { id: Id, taskId: Id, reason: AskWithdrawReason }),
  // Documents travel without their bodies (every version's body is in `document_versions`); a reader
  // fetches the new body when the version changes.
  event("document.published", { document: DocumentSummary }),
  event("document.updated", { id: Id, version: Schema.Number, document: DocumentSummary }),
  event("document.archived", { id: Id }),
  // A server started on a build it hadn't run before (CEL-50). Builds belong to no workspace, so the
  // same event goes to every workspace, for each one's subscribers. `liveUntil` is null in it.
  event("build.recorded", { build: BuildRecord }),
])
export type CelloEvent = typeof CelloEvent.Type
export type CelloEventType = CelloEvent["type"]
export type EventOf<T extends CelloEventType> = Extract<CelloEvent, { type: T }>

/** Body of an event before the store assigns its envelope. */
export type EventBody = CelloEvent extends infer E
  ? E extends CelloEvent ? Omit<E, keyof typeof envelope> : never
  : never

const decodeCurrent = Schema.decodeUnknownSync(CelloEvent)

export class UnknownSchemaVersion extends Error {
  constructor(readonly version: unknown, readonly type: unknown) {
    super(`Stored event ${String(type)} has schema version ${String(version)}, which this build can't read.`)
  }
}

/**
 * Decode a stored or received event. Older schema versions are upgraded here;
 * an unknown version is a defect and throws.
 */
export const decodeEvent = (raw: unknown): CelloEvent => {
  const version = (raw as { schemaVersion?: unknown } | null)?.schemaVersion
  if (version !== CURRENT_SCHEMA_VERSION) {
    throw new UnknownSchemaVersion(version, (raw as { type?: unknown } | null)?.type)
  }
  return decodeCurrent(raw)
}
