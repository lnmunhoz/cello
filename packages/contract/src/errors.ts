// API errors. Storage failures are defects, never one of these.
import * as Schema from "effect/Schema"

export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  entity: Schema.String,
  id: Schema.String,
}) {}

export class Invalid extends Schema.TaggedError<Invalid>()("Invalid", {
  field: Schema.String,
  reason: Schema.String,
}) {}

export class KeyTaken extends Schema.TaggedError<KeyTaken>()("KeyTaken", {
  key: Schema.String,
  projectName: Schema.String,
}) {}

export class VersionConflict extends Schema.TaggedError<VersionConflict>()("VersionConflict", {
  entity: Schema.String,
  id: Schema.String,
  currentVersion: Schema.Number,
  changedBy: Schema.String,
}) {}

export class SnapshotRequired extends Schema.TaggedError<SnapshotRequired>()("SnapshotRequired", {
  latestSeq: Schema.Number,
}) {}

/** Another live session (or the human) holds the task's claim. */
export class TaskClaimed extends Schema.TaggedError<TaskClaimed>()("TaskClaimed", {
  key: Schema.String,
  /** The holder's client ("Claude Code"), or the human's name. */
  holder: Schema.String,
  /** The holder's host session id (e.g. its CLAUDE_CODE_SESSION_ID); null for the human. */
  sessionId: Schema.NullOr(Schema.String),
  lastSeenAt: Schema.NullOr(Schema.Number),
}) {}
