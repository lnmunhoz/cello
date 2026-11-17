// Entities as they travel on the wire and live in client state. Schemas only.
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { TaskStage } from "./stages.ts"

export const Id = Schema.String
export const Millis = Schema.Number
export const DueDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))

/** `waiting`: the task waits on the human's answers to an agent's questions (Needs input, CEL-47). */
export const StatusCategory = Schema.Literals(["backlog", "unstarted", "started", "waiting", "completed", "canceled"])
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

/**
 * Where a test run is (CEL-134), as the test runner reports it (`cello test progress`, from the progress.json
 * `scripts/test-in-docker.ts` writes in its run folder): the stage running ("web-e2e"), the tests passed and
 * failed so far of `total` (null until the runner knows it), the last spec file one finished in, each failure
 * as it happened ("e2e/board.spec.ts:40 › drags a card"), and once it's `done`, how it ended and its folder.
 */
export const TestProgress = Schema.Struct({
  stage: Schema.NullOr(Schema.String),
  passed: Schema.Number,
  failed: Schema.Number,
  skipped: Schema.Number,
  total: Schema.NullOr(Schema.Number),
  current: Schema.NullOr(Schema.String),
  failures: Schema.Array(Schema.String),
  done: Schema.Boolean,
  outcome: Schema.NullOr(Schema.Literals(["passed", "failed", "stopped"])),
  /** The run's results folder (summary.txt, logs/, videos), an absolute path on this machine. */
  folder: Schema.NullOr(Schema.String),
})
export type TestProgress = typeof TestProgress.Type

/**
 * An agent's test run (CEL-134): a tool call of it started a test command (`bun run test`, `bun run
 * test:e2e`, …; @cello/shared/testRun), the one running (`endedAt` null) or the last one. `label` is what
 * the board calls it ("web e2e"), `command` the command in one line, keys masked. A background run
 * (run_in_background) runs on after the call returns. `outcome`: passed or failed by the command's exit
 * or the runner's report; `ended` when the agent's turn ended without either.
 */
export const TestRun = Schema.Struct({
  label: Schema.String,
  command: Schema.String,
  startedAt: Millis,
  endedAt: Schema.NullOr(Millis),
  outcome: Schema.NullOr(Schema.Literals(["passed", "failed", "ended"])),
  background: Schema.Boolean,
  progress: Schema.NullOr(TestProgress),
})
export type TestRun = typeof TestRun.Type

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
  /**
   * A `cello inbox --wait` of the session is open right now (CEL-74, CEL-76): the server sees its
   * `inbox.wait` call, so a comment reaches it in about a second even while it's idle. Kept in memory,
   * so a restart starts with none. The server always sends it; events stored before CEL-76 leave it
   * out, which means false.
   */
  waiting: Schema.optionalKey(Schema.Boolean),
  /**
   * Its log (CEL-106): `hasLog` when a hook reported its Claude Code transcript (the path itself stays on
   * the server); `currentStep` its last tool call in one line ("Bash · bun run test", keys masked) and
   * when. Left out by events stored before CEL-106, which means none.
   */
  hasLog: Schema.optionalKey(Schema.Boolean),
  currentStep: Schema.optionalKey(Schema.NullOr(Schema.String)),
  currentStepAt: Schema.optionalKey(Schema.NullOr(Millis)),
  /**
   * Its current model and effort (CEL-119): the last ones read from its Claude Code transcript, as Claude
   * Code names them (`claude-opus-5-5`, `high`). Null or absent when unknown (no transcript yet, an agent
   * that isn't Claude Code, events stored before CEL-119).
   */
  model: Schema.optionalKey(Schema.NullOr(Schema.String)),
  effort: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /**
   * In orchestrate mode (CEL-124): `cello sessions orchestrate on`, which /cello:orchestrate runs, until
   * `off`. It runs work through agents with nobody watching its window, so the Claude Code hook turns its
   * AskUserQuestion away. Absent (events stored before CEL-124) means false.
   */
  orchestrating: Schema.optionalKey(Schema.Boolean),
  /** Its test run, running or the last one (CEL-134). Null or absent: none seen. */
  tests: Schema.optionalKey(Schema.NullOr(TestRun)),
  /**
   * Where it runs (CEL-137), with `entrypoint`: the terminal app it was started in (TERM_PROGRAM:
   * `WezTerm`, `iTerm.app`, `vscode`), as its first calls reported it. Null or absent when unknown.
   */
  terminal: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /**
   * Its latest woken run (CEL-92, CEL-137): going while `endedAt` is null, when the board says "Woken by
   * Cello" and counts the session as active. Null when Cello never woke it; absent where the server
   * didn't look (presence events from a sweep, events stored before CEL-137), which keeps what a board
   * knew.
   */
  lastRun: Schema.optionalKey(Schema.NullOr(Schema.Struct({ id: Id, startedAt: Millis, endedAt: Schema.NullOr(Millis) }))),
})
export type AgentSession = typeof AgentSession.Type

/**
 * A subagent working under an agent session (CEL-55): Claude Code's Agent tool runs builders and
 * reviewers inside the orchestrator's conversation, with its session id. `agentId` is the host's id for
 * the subagent run, unique within its session; `agentType` what it was launched as (`cello-builder`,
 * `general-purpose`). `taskId` is the task its launch named, when it named one. Claims and inbox
 * delivery stay on the session: an agent is who did the work, never a holder.
 */
export const SessionAgent = Schema.Struct({
  sessionId: Id,
  agentId: Schema.String,
  agentType: Schema.NullOr(Schema.String),
  taskId: Schema.NullOr(Id),
  /** The launch's short description ("CEL-55 which agent is on each card"), when the launch was seen. */
  description: Schema.NullOr(Schema.String),
  startedAt: Millis,
  lastSeenAt: Millis,
  /** When it finished (SubagentStop); a resumed agent clears it. */
  endedAt: Schema.NullOr(Millis),
  /**
   * Its log (CEL-106): `hasLog` when a hook reported its Claude Code transcript (the path itself stays on
   * the server); `currentStep` its last tool call in one line ("Bash · bun run test", keys masked) and
   * when. Left out by events stored before CEL-106, which means none.
   */
  hasLog: Schema.optionalKey(Schema.Boolean),
  currentStep: Schema.optionalKey(Schema.NullOr(Schema.String)),
  currentStepAt: Schema.optionalKey(Schema.NullOr(Millis)),
  /**
   * Its current model and effort (CEL-119): the last ones read from its Claude Code transcript, as Claude
   * Code names them (`claude-opus-5-5`, `high`). Null or absent when unknown (no transcript yet, an agent
   * that isn't Claude Code, events stored before CEL-119).
   */
  model: Schema.optionalKey(Schema.NullOr(Schema.String)),
  effort: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /**
   * What it's waiting on (CEL-133): it ended its turn while background work it started itself (a shell
   * run with run_in_background, a Monitor) was still running, so Claude Code resumes it when that work
   * ends. It isn't finished (`endedAt` stays null) until a stop with none of its work left. One line per
   * piece of work, as its step was ("Bash · bun run test:e2e", "Monitor · e2e run finishing"). Null or
   * absent: not waiting.
   */
  waitingOn: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
  /** Its test run, running or the last one (CEL-134). Null or absent: none seen. */
  tests: Schema.optionalKey(Schema.NullOr(TestRun)),
})
export type SessionAgent = typeof SessionAgent.Type

// ── Waking sessions (CEL-92) ────────────────────────────────────────────────────────────────────
// When Lucas acts on a task an agent session claimed and nothing of that session is running, Cello
// continues the same conversation itself, headless: a woken run.

/** What started a wake: one of Lucas's actions on the task, or `cello sessions wake` (`manual`). */
export const WakeWhy = Schema.Literals(["comment", "answers", "send_back", "reaction", "manual"])
export type WakeWhy = typeof WakeWhy.Type

/**
 * Why Cello didn't wake a session. `taken`: it took the comment itself before the wake was due;
 * `cancelled`: Lucas pressed "Don't wake". The rest are the checks (WakeService has them in order).
 */
export const NotWokenReason = Schema.Literals([
  "listening",
  "process_alive",
  "recent_check_in",
  "no_pid",
  "disabled",
  "cap",
  "bypass_mode",
  "unknown_mode",
  "no_conversation",
  "no_folder",
  "not_installed",
  "running",
  "taken",
  "cancelled",
])
export type NotWokenReason = typeof NotWokenReason.Type

/** Cello's own permission modes, which each agent CLI maps to its own (`bypass` is never used for a woken run). */
export const CelloMode = Schema.Literals(["ask", "edits", "auto", "plan", "bypass"])
export type CelloMode = typeof CelloMode.Type

/** How a woken run ended: its turn finished, it failed (or couldn't start), or it was stopped (Stop, or the server stopping). */
export const RunOutcome = Schema.Literals(["running", "completed", "failed", "stopped"])
export type RunOutcome = typeof RunOutcome.Type

/** One woken run of an agent session: what started it, the mode it ran in, and its log. */
export const SessionRun = Schema.Struct({
  id: Id,
  sessionId: Id,
  /** The task whose action woke it (the latest, when several were batched); null for none. */
  taskId: Schema.NullOr(Id),
  why: WakeWhy,
  /** Which adapter ran it (`claude-code`). */
  agentKind: Schema.String,
  /** The CLI's own permission mode it ran with (`auto`, `acceptEdits`…), and that mode in Cello's words. */
  mode: Schema.String,
  celloMode: CelloMode,
  pid: Schema.NullOr(Schema.Number),
  startedAt: Millis,
  endedAt: Schema.NullOr(Millis),
  exitCode: Schema.NullOr(Schema.Number),
  outcome: RunOutcome,
  /** What went wrong, when it failed or couldn't start: one line. */
  error: Schema.NullOr(Schema.String),
})
export type SessionRun = typeof SessionRun.Type

/**
 * Where a task's wake stands, for its card: due (`scheduled`, at `at`), not done and why (`not_woken`),
 * or a run going or ended. Only the latest wake of a task counts.
 */
export const TaskWake = Schema.Struct({
  taskId: Id,
  sessionId: Id,
  state: Schema.Literals(["scheduled", "not_woken", "running", "ended"]),
  why: WakeWhy,
  /** When it happened (the event's time). */
  ts: Millis,
  /** scheduled: when the wake is due. */
  at: Schema.NullOr(Millis),
  /** not_woken: why. */
  reason: Schema.NullOr(NotWokenReason),
  /** running and ended: the run. */
  run: Schema.NullOr(SessionRun),
})
export type TaskWake = typeof TaskWake.Type

/** A project's wake settings (CEL-92): off until Lucas turns it on; at most `capPerHour` wakes per task per hour. */
export const WakeSettings = Schema.Struct({
  projectId: Id,
  enabled: Schema.Boolean,
  capPerHour: Schema.Number,
  /**
   * How long Cello waits after Lucas's last action before it wakes (30 s), so the comment box can say it
   * beforehand (CEL-136). A server's own, the same for every project.
   */
  batchMs: Schema.optionalKey(Schema.Number),
  /** Woken runs bill ANTHROPIC_API_KEY when it's in the server's environment, not the subscription. */
  apiKeySet: Schema.Boolean,
  /** The agent CLIs Cello can wake sessions of, and whether each is installed here. */
  agents: Schema.Array(Schema.Struct({ kind: Schema.String, name: Schema.String, installed: Schema.Boolean })),
})
export type WakeSettings = typeof WakeSettings.Type

/** One agent's key in maps and lookups: its session and its id. */
export const agentKey = (sessionId: string, agentId: string): string => `${sessionId}/${agentId}`

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

/**
 * What a label says about a task (CEL-52): the kind of work (feature, bug), the part of the product it
 * touches (an area), its milestone, or none of these. The Issues tab's filter groups labels by it, and
 * matches any label within a group and every group picked.
 */
export const LABEL_GROUPS = ["kind", "area", "milestone", "none"] as const
export const LabelGroup = Schema.Literals(LABEL_GROUPS)
export type LabelGroup = typeof LabelGroup.Type

/** What every screen calls each group: the filter panel's headings, `cello label list`, Settings. */
export const LABEL_GROUP_NAMES: Record<LabelGroup, string> = { kind: "Kind", area: "Area", milestone: "Milestone", none: "Other" }

/**
 * A label belongs to one project (CEL-80): each project has its own kinds, areas and milestones, and a
 * name is unique within the project. Projects that use the same name ("bug") each have their own label.
 */
export const Label = Schema.Struct({
  id: Id,
  workspaceId: Id,
  /** Labels inside events stored before labels belonged to a project (CEL-80) read as "" (none). */
  projectId: Id.pipe(Schema.withDecodingDefaultKey(Effect.succeed(""))),
  name: Schema.String,
  color: Schema.String,
  /** Labels inside events stored before groups existed (CEL-52) read as `none`. */
  group: LabelGroup.pipe(Schema.withDecodingDefaultKey(Effect.succeed("none" as const))),
  createdAt: Millis,
  updatedAt: Millis,
  archivedAt: Schema.NullOr(Millis),
})
export type Label = typeof Label.Type

/** Open while its work goes on; closed by the human when it's done (CEL-113), which only he does. */
export const MilestoneState = Schema.Literals(["open", "closed"])
export type MilestoneState = typeof MilestoneState.Type

/**
 * A goal for a project, with an optional target date (CEL-113). Each task belongs to at most one
 * (`Task.milestoneId`); its progress is counted from those tasks (@cello/shared/milestone), never
 * stored. Names are unique within the project, ignoring case; `position` is the order the human set.
 */
export const Milestone = Schema.Struct({
  id: Id,
  projectId: Id,
  name: Schema.String,
  /** One line, markdown; empty when none. */
  goal: Schema.String,
  targetDate: Schema.NullOr(DueDate),
  position: Schema.String,
  state: MilestoneState,
  closedAt: Schema.NullOr(Millis),
  createdAt: Millis,
  updatedAt: Millis,
})
export type Milestone = typeof Milestone.Type

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
  /** Its milestone (CEL-113), at most one. The server always sends it; tasks inside events stored before milestones leave it out, which means none. */
  milestoneId: Schema.optionalKey(Schema.NullOr(Id)),
  assigneeActorId: Schema.NullOr(Id),
  assigneeSessionId: Schema.NullOr(Id),
  /**
   * The agent session that last held its claim (CEL-110), kept after the claim ends (approved, released,
   * ended by a change of the human's). A comment of the human's while nobody holds the task reopens it
   * for that session. Absent in tasks stored inside events before it existed; null when no agent ever held it.
   */
  lastHolderSessionId: Schema.optionalKey(Schema.NullOr(Id)),
  createdByActorId: Id,
  createdBySessionId: Schema.NullOr(Id),
  /**
   * Who changed it last (CEL-5): every task change sets it. Tasks inside events stored before it
   * existed read as null (`withDecodingDefaultKey`); the UI then names the creator.
   */
  updatedByActorId: Schema.NullOr(Id).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  updatedBySessionId: Schema.NullOr(Id).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  /** The subagent of that session that changed it (CEL-55); absent or null when the session itself did. */
  updatedByAgentId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /** Where it is inside In Progress (CEL-35), set with `cello task stage`; null outside it. */
  stage: Schema.NullOr(TaskStage).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  /**
   * Its comments that aren't deleted, and when the latest of them was written or edited. Not columns:
   * read with the task. Adding, editing or deleting a comment is activity on the task, so it also sets
   * `updatedAt` and `updatedBy*`. When `lastCommentAt` is at or after `updatedAt`, the latest activity
   * was a comment written or edited; a delete is a change, not a comment (it leaves `lastCommentAt`
   * at the latest remaining comment, before `updatedAt`).
   */
  commentCount: Schema.Number.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
  lastCommentAt: Schema.NullOr(Millis).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  version: Schema.Number,
  createdAt: Millis,
  updatedAt: Millis,
  archivedAt: Schema.NullOr(Millis),
})
export type Task = typeof Task.Type

/**
 * An emoji reaction on a comment (CEL-77): one per reacting party (the human, or an agent session) and
 * emoji. Removing it deletes the row; the events keep the history.
 */
export const Reaction = Schema.Struct({
  id: Id,
  commentId: Id,
  taskId: Id,
  emoji: Schema.String,
  actorId: Id,
  sessionId: Schema.NullOr(Id),
  /** The subagent of the session that reacted; absent or null when the session itself did. */
  agentId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  createdAt: Millis,
})
export type Reaction = typeof Reaction.Type

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
  /**
   * The ask it's evidence for, or (Lucas's own screenshots) the ask whose answers it belongs to.
   * Events stored before asks existed (CEL-47) have no key: they decode as null.
   */
  askId: Schema.NullOr(Id).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
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

/** How an agent session took an inbox item (CEL-76): its hook (PostToolUse or Stop), `cello inbox`, or `cello inbox --wait`. */
export const DeliveryVia = Schema.Literals(["hook", "inbox", "wait"])
export type DeliveryVia = typeof DeliveryVia.Type

/**
 * Where one of Lucas's comments went (CEL-76): the agent session that held the task's claim when he
 * wrote it, and when (and how) that session took it; `readAt` null while it waits in the inbox.
 */
export const CommentDelivery = Schema.Struct({
  sessionId: Id,
  readAt: Schema.NullOr(Millis),
  via: Schema.NullOr(DeliveryVia),
})
export type CommentDelivery = typeof CommentDelivery.Type

export const Comment = Schema.Struct({
  id: Id,
  taskId: Id,
  body: Schema.String,
  actorId: Id,
  sessionId: Schema.NullOr(Id),
  /** The subagent of the session that wrote it (CEL-55); absent or null when the session itself did. */
  agentId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /**
   * The model and effort that wrote it (CEL-119), as they were then (`claude-sonnet-5-5`, `medium`): a
   * model switch later leaves it as it was. Null or absent when unknown: the human's comments, agents
   * that aren't Claude Code, comments written before CEL-119.
   */
  model: Schema.optionalKey(Schema.NullOr(Schema.String)),
  effort: Schema.optionalKey(Schema.NullOr(Schema.String)),
  createdAt: Millis,
  updatedAt: Millis,
  deletedAt: Schema.NullOr(Millis),
  /**
   * Its screenshots (CEL-73): images Lucas pasted or dropped into the comment box, or an agent attached
   * with `cello task comment --attach`. The server always sends it; comments in events stored before
   * CEL-73 have no key, which means none.
   */
  attachments: Schema.optionalKey(Schema.Array(Attachment)),
  /**
   * Its emoji reactions (CEL-77), oldest first. Read with the comment, so `comment.added` carries an
   * empty list; events stored before reactions existed leave it out. A reaction changing is its own
   * event (`reaction.added`, `reaction.removed`), never a comment event.
   */
  reactions: Schema.optionalKey(Schema.Array(Reaction)),
  /**
   * Its delivery (CEL-76): null when it went to nobody (an agent's comment, or no session held the
   * claim). The server always sends it; `comment.added` carries it as written (not taken yet), and
   * `comment.delivered` fills in when the session took it. Events stored before CEL-76 leave it out.
   */
  delivery: Schema.optionalKey(Schema.NullOr(CommentDelivery)),
})
export type Comment = typeof Comment.Type

/**
 * How a review closed. `superseded`: a newer review of the same task replaced it before anyone decided.
 * `withdrawn`: the task left In Review some other way than a decision (a plain move, CEL-71).
 */
export const ReviewDecision = Schema.Literals(["approved", "sent_back", "superseded", "withdrawn"])
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

/**
 * What the agent expects: one pick, any number, or text only (no options). Lucas may pick several
 * options on any question that has them (Nov 15), so `one` only says what the agent asked for.
 */
export const QuestionKind = Schema.Literals(["one", "any", "text"])
export type QuestionKind = typeof QuestionKind.Type

export const AskOption = Schema.Struct({
  /** Stable within its ask: "q1o2" is question 1's second option. */
  id: Schema.String,
  label: Schema.String,
  /** One line under the label; "" for none. */
  description: Schema.String,
  /** One of the ask's screenshots (an attachment id), shown as the option's thumbnail. */
  imageId: Schema.NullOr(Id),
  recommended: Schema.Boolean,
  /** Why the agent recommends it; "" when it doesn't. */
  because: Schema.String,
})
export type AskOption = typeof AskOption.Type

export const AskQuestion = Schema.Struct({
  /** Stable within its ask: "q1", "q2", … */
  id: Schema.String,
  prompt: Schema.String,
  kind: QuestionKind,
  /** Empty for a text-only question. */
  options: Schema.Array(AskOption),
})
export type AskQuestion = typeof AskQuestion.Type

/**
 * One question answered: the options picked (by id; several are fine), or "None of these" (`none`,
 * with the comment saying what instead), Lucas's comment, and the screenshots he pasted into it.
 */
export const AskAnswer = Schema.Struct({
  questionId: Schema.String,
  optionIds: Schema.Array(Schema.String),
  none: Schema.Boolean,
  comment: Schema.String,
  attachments: Schema.Array(Attachment),
})
export type AskAnswer = typeof AskAnswer.Type

/** Every question answered, plus the overall note and its screenshots. Saved as one record when Lucas sends them. */
export const AskAnswers = Schema.Struct({
  questions: Schema.Array(AskAnswer),
  note: Schema.String,
  noteAttachments: Schema.Array(Attachment),
})
export type AskAnswers = typeof AskAnswers.Type

/**
 * `open` until Lucas answers it (`answered`), the agent withdraws it or Lucas moves the card himself
 * (`withdrawn`), or a newer ask on the same task replaces it (`superseded`).
 */
export const AskState = Schema.Literals(["open", "answered", "withdrawn", "superseded"])
export type AskState = typeof AskState.Type

/**
 * An agent's request for decisions on one task (CEL-47): questions with options, plus evidence. A
 * task has at most one open ask; while it's open the task sits in Needs input.
 */
export const Ask = Schema.Struct({
  id: Id,
  taskId: Id,
  title: Schema.String,
  /** Markdown; "" for none. */
  intro: Schema.String,
  questions: Schema.Array(AskQuestion),
  /** The evidence: screenshots (option images among them), videos, files and links. */
  attachments: Schema.Array(Attachment),
  actorId: Id,
  sessionId: Schema.NullOr(Id),
  author: ReviewAuthor,
  state: AskState,
  createdAt: Millis,
  answeredAt: Schema.NullOr(Millis),
  answers: Schema.NullOr(AskAnswers),
  /** When it was withdrawn or superseded, and by whom (the agent, or the human who moved the card). */
  withdrawnAt: Schema.NullOr(Millis),
  withdrawnBy: Schema.NullOr(Id),
})
export type Ask = typeof Ask.Type

/**
 * Why something reached an agent's inbox: a comment on its task, the note of a review Lucas sent back,
 * his answers to the questions it asked on the card (CEL-47), his moving that card himself, which
 * withdrew the ask (`withdrawn`), his emoji reaction to one of its comments (`reaction`, CEL-77), or a
 * change of his to its task that ended its claim (`claim_ended`, CEL-46).
 */
export const InboxKind = Schema.Literals(["comment", "send_back", "answers", "withdrawn", "reaction", "claim_ended"])
export type InboxKind = typeof InboxKind.Type

const inboxFields = {
  id: Id,
  taskId: Id,
  /** Keys and titles, so a hook can print the item without another call. */
  taskKey: Schema.String,
  taskTitle: Schema.String,
  /** Who wrote it: the human's name. */
  author: Schema.String,
  /** When it was delivered: the comment's (or the answers') time. */
  createdAt: Millis,
  /** When the session read it (`cello inbox`, `cello context`, the hook, or `cello wait`); null while it's new. */
  readAt: Schema.NullOr(Millis),
}

/**
 * A human comment, or a Send back note, delivered to the agent session holding the task's claim (CEL-15),
 * or, for a comment on a task nobody held, to the session that last held it, which holds it again (CEL-110).
 */
export const InboxComment = Schema.Struct({
  ...inboxFields,
  kind: Schema.Literals(["comment", "send_back"]),
  /** As it is now: edits show; deleted comments drop out of the inbox. */
  comment: Comment,
  /**
   * The comment came while nobody held the task, so it reopened the task for this session (CEL-110):
   * the status it was in (`from`, e.g. Done) and the one it's in now (`to`), and the session holds the
   * claim again. Absent for a comment on a task the session held.
   */
  reopened: Schema.optionalKey(Schema.Struct({ from: Schema.String, to: Schema.String })),
})
export type InboxComment = typeof InboxComment.Type

/** Lucas's answers to an ask, delivered to the session holding the claim (else the one that asked). */
export const InboxAnswers = Schema.Struct({ ...inboxFields, kind: Schema.Literal("answers"), ask: Ask })
export type InboxAnswers = typeof InboxAnswers.Type

/** Lucas moved the card out of Needs input himself: the ask is withdrawn; `status` is where the card went. Delivered to the session that asked. */
export const InboxWithdrawn = Schema.Struct({ ...inboxFields, kind: Schema.Literal("withdrawn"), ask: Ask, status: Schema.String })
export type InboxWithdrawn = typeof InboxWithdrawn.Type

/**
 * Lucas reacted to a comment the session wrote (CEL-77). Delivered to that session, or to the claim
 * holder once that session ended; removing the reaction before it's read takes it back. `comment` is
 * the comment reacted to, as it is now; `createdAt` is when he reacted.
 */
export const InboxReaction = Schema.Struct({ ...inboxFields, kind: Schema.Literal("reaction"), comment: Comment, emoji: Schema.String })
export type InboxReaction = typeof InboxReaction.Type

/**
 * What Lucas did that ended a session's claim (CEL-46): moved the card to another status (`moved`),
 * edited its fields (`edited`), changed its labels (`labels`), archived it (`archived`), claimed it
 * himself (`claimed`) or released the session's claim (`released`). Approving its packet ends the
 * claim too, but tells no one: the work is done.
 */
export const ClaimEndCause = Schema.Literals(["moved", "edited", "labels", "archived", "claimed", "released"])
export type ClaimEndCause = typeof ClaimEndCause.Type

/**
 * A change Lucas made to a task the session held ended its claim (CEL-46): the session should stop
 * working on it. `status` is where the card is after the change; `createdAt` is when he made it.
 * Delivered once, to the session that held the claim. Moving a card out of Needs input tells the
 * session that asked with its `withdrawn` item instead, so it doesn't hear it twice.
 */
export const InboxClaimEnded = Schema.Struct({ ...inboxFields, kind: Schema.Literal("claim_ended"), cause: ClaimEndCause, status: Schema.String })
export type InboxClaimEnded = typeof InboxClaimEnded.Type

/**
 * Something delivered to an agent session's inbox: a comment (CEL-15), Lucas's answers or a withdrawn
 * ask (CEL-47), his reaction (CEL-77), word that he ended its claim (CEL-46).
 */
export const InboxItem = Schema.Union([InboxComment, InboxAnswers, InboxWithdrawn, InboxReaction, InboxClaimEnded])
export type InboxItem = typeof InboxItem.Type

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

/**
 * A file published with a document (an image, a video, a text file), served at `/attachments/<id>`.
 * The reader looks a link's target up here to play a linked video instead of following the link.
 */
export const DocumentFile = Schema.Struct({
  id: Id,
  kind: Schema.Literals(["image", "video", "file"]),
  /** The original file name. */
  name: Schema.String,
  mime: Schema.String,
  /** A video with a poster frame, served at `/attachments/<id>/poster`. */
  hasPoster: Schema.Boolean,
})
export type DocumentFile = typeof DocumentFile.Type

/**
 * A document with its markdown body (links to its files point at `/attachments/<id>`), and the files
 * every version of it has published, oldest first.
 */
export const Document = Schema.Struct({ ...documentFields, body: Schema.String, files: Schema.Array(DocumentFile) })
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

/**
 * One field of a project's testing profile (CEL-89): how to install, test, start the app or collect
 * evidence in its repo. `source` says who set it last (`cello init`'s detection, an agent, or the
 * human), `updatedAt` when it was last set or confirmed. Field names are in @cello/shared/testingProfile.
 */
export const ProfileSource = Schema.Literals(["detected", "agent", "human"])
export type ProfileSource = typeof ProfileSource.Type

export const ProfileField = Schema.Struct({
  field: Schema.String,
  value: Schema.String,
  source: ProfileSource,
  updatedAt: Millis,
  actorId: Id,
  sessionId: Schema.NullOr(Id),
})
export type ProfileField = typeof ProfileField.Type

/** A project's testing profile: its fields that are set, in display order. Current best knowledge, not fixed. */
export const TestingProfile = Schema.Struct({ projectId: Id, fields: Schema.Array(ProfileField) })
export type TestingProfile = typeof TestingProfile.Type

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
  /** The projects' milestones (CEL-113), closed ones included. The server always sends it; left out means none. */
  milestones: Schema.optionalKey(Schema.Array(Milestone)),
  tasks: Schema.Array(Task),
  /**
   * The agent sessions the tasks in scope name (creator, claim, last change), so cards can say who
   * and whether they're still working (CEL-5, CEL-35). `session.seen` events keep them current.
   */
  sessions: Schema.Array(AgentSession),
  /**
   * Subagents of those sessions (CEL-55): the ones still working, and the ones on or last changing a
   * task in scope. `agent.seen` events keep them current; their sessions are in `sessions`.
   */
  agents: Schema.Array(SessionAgent),
  /** Open reviews of the tasks in scope: everything the Review page and the cards need. */
  reviews: Schema.Array(Review),
  /** Open asks of the tasks in scope: the Needs input group, the sidebar count and the cards' badges. */
  asks: Schema.Array(Ask),
  /** Documents of the projects in scope, archived ones included, without their bodies. */
  documents: Schema.Array(DocumentSummary),
  /**
   * The latest wake of each task in scope that has one (CEL-92), for the Working on it row; the
   * `session.*` wake events keep them current. The server always sends it; left out means none.
   */
  wakes: Schema.optionalKey(Schema.Array(TaskWake)),
})
export type Snapshot = typeof Snapshot.Type
