// Every change is one of these events. `before`/`after` hold only the fields that changed.
import * as Schema from "effect/Schema"
import { BuildRecord } from "./build.ts"
import { AgentSession, Comment, DocumentSummary, DueDate, Id, Label, Millis, Priority, Project, Review, ReviewDecision, Status, Task, Workspace } from "./entities.ts"
import { TaskStage } from "./stages.ts"

export const CURRENT_SCHEMA_VERSION = 1

const envelope = {
  seq: Schema.Number,
  ts: Millis,
  commandId: Schema.String,
  actorId: Id,
  sessionId: Schema.NullOr(Id),
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
export const LabelPatch = patch({ name: Schema.String, color: Schema.String })
export const TaskPatch = patch({
  title: Schema.String,
  description: Schema.String,
  priority: Priority,
  dueDate: Schema.NullOr(DueDate),
  parentId: Schema.NullOr(Id),
})
export const CommentPatch = patch({ body: Schema.String })
const Place = Schema.Struct({ statusId: Id, position: Schema.String })
/** Who held a claim: an agent session, or the human (sessionId null). */
export const ClaimHolder = Schema.Struct({ actorId: Id, sessionId: Schema.NullOr(Id) })

export const CelloEvent = Schema.Union([
  event("workspace.created", { workspace: Workspace }),
  event("workspace.updated", { id: Id, before: WorkspacePatch, after: WorkspacePatch }),
  event("project.created", { project: Project }),
  event("project.updated", { id: Id, before: ProjectPatch, after: ProjectPatch }),
  event("project.archived", { id: Id }),
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
  // A human change ends an agent's claim; it shares the version of the change that ended it.
  event("task.claim_ended", { id: Id, version: Schema.Number, from: ClaimHolder, reason: Schema.Literals(["human_change"]) }),
  // `cello task stage` (CEL-35). A status change clears the stage inside its own `task.moved`.
  event("task.stage_changed", { id: Id, version: Schema.Number, before: Schema.NullOr(TaskStage), after: Schema.NullOr(TaskStage) }),
  // An agent session holding a claim checked in (at most once every 30 s) or its process exited, so
  // boards show who is working right now (CEL-35). Workspace-level (no projectId): one per workspace
  // the session holds claims in. Not a task change: the task's version stays.
  event("session.seen", { session: AgentSession }),
  event("comment.added", { comment: Comment }),
  event("comment.edited", { id: Id, before: CommentPatch, after: CommentPatch }),
  event("comment.deleted", { id: Id }),
  // A review packet with its attachments. The same command then moves the task (task.moved).
  event("review.submitted", { review: Review }),
  // Approved, sent back, or superseded by a newer review. `ts` is when.
  event("review.decided", { id: Id, taskId: Id, decision: ReviewDecision, note: Schema.NullOr(Schema.String) }),
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
