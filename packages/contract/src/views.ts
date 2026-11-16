// Read models for the CLI (and later MCP): one RPC returns everything a command prints.
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { Actor, AgentSession, Ask, Comment, DeliveryVia, DocumentSummary, InboxItem, Label, Milestone, Millis, Project, Review, SessionAgent, Status, Task, TestingProfile } from "./entities.ts"
import { CelloEvent } from "./events.ts"

/**
 * Who the server sees: the actor, its agent session (null for the human), the session's subagent making
 * the call when it said so (CEL-55), and the project if one resolved.
 */
export const Whoami = Schema.Struct({
  actor: Actor,
  session: Schema.NullOr(AgentSession),
  agent: Schema.NullOr(SessionAgent).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  project: Schema.NullOr(Project),
})
export type Whoami = typeof Whoami.Type

/** A project with the names a command needs to print ids: statuses, labels, milestones, actors, sessions and their subagents. */
const projectFields = {
  project: Project,
  statuses: Schema.Array(Status),
  labels: Schema.Array(Label),
  /** The project's milestones in order, closed ones too (CEL-113); a server from before them sends none. */
  milestones: Schema.Array(Milestone).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  actors: Schema.Array(Actor),
  sessions: Schema.Array(AgentSession),
  /** The subagents the tasks, comments and events name (CEL-55); their sessions are in `sessions`. */
  agents: Schema.Array(SessionAgent),
}

/**
 * How far along a milestone is (CEL-113): its tasks that aren't archived, by status category. Canceled
 * ones are left out of `total`; Backlog ones are in it, and counted apart. See @cello/shared/milestone.
 */
export const MilestoneProgress = Schema.Struct({
  total: Schema.Number,
  done: Schema.Number,
  inReview: Schema.Number,
  inProgress: Schema.Number,
  todo: Schema.Number,
  backlog: Schema.Number,
  canceled: Schema.Number,
  percent: Schema.Number,
})
export type MilestoneProgress = typeof MilestoneProgress.Type

export const MilestoneSummary = Schema.Struct({ milestone: Milestone, progress: MilestoneProgress })
export type MilestoneSummary = typeof MilestoneSummary.Type

/** An event with the key of the task it's about (null for non-task events). */
export const Activity = Schema.Struct({ event: CelloEvent, taskKey: Schema.NullOr(Schema.String) })
export type Activity = typeof Activity.Type

export const ProjectContext = Schema.Struct({
  ...projectFields,
  actor: Actor,
  session: Schema.NullOr(AgentSession),
  /** Tasks this caller holds: assigned to its session (or, for the human, to the human with no session). */
  claimed: Schema.Array(Task),
  /** The project's latest events, newest first. */
  recent: Schema.Array(Activity),
  /** Claims this session lost, newest first: taken over by another session, or ended by a human change. */
  lostClaims: Schema.Array(Activity),
  /**
   * New comments waiting in this session's inbox, from every project, oldest first (empty for the
   * human). Showing them doesn't mark them read: subagents share their parent's session.
   */
  inbox: Schema.Array(InboxItem),
  /**
   * The project's testing profile (CEL-89): how to test the repo and collect evidence. Optional so a
   * newer CLI still reads an older server's context.
   */
  profile: Schema.optionalKey(TestingProfile),
  /** The project's open milestones in order, with their progress (CEL-113): what's current. */
  openMilestones: Schema.optionalKey(Schema.Array(MilestoneSummary)),
})
export type ProjectContext = typeof ProjectContext.Type

/** What `inbox.take` hands an agent session (`cello inbox`, the hook): the human's comments on tasks it claimed. */
export const Inbox = Schema.Struct({
  /** The caller's session; null for the human, who has no inbox. */
  session: Schema.NullOr(AgentSession),
  /** The new items this call handed over, now marked read, oldest first. Another call never gets them. */
  items: Schema.Array(InboxItem),
  /** The latest items read before, oldest first; empty when only new ones were asked for. */
  earlier: Schema.Array(InboxItem),
  /**
   * The keys of the tasks the session holds a claim on now (CEL-74): comments on them come to it, so
   * the Stop hook asks it to wait for them when it goes idle. Empty for the human. Optional, like
   * `human`, so a newer CLI still reads an older server's inbox: read it as `claimed ?? []`.
   */
  claimed: Schema.optionalKey(Schema.Array(Schema.String)),
  /** The human's name, for what the hook and `cello inbox --wait` tell the agent (CEL-74). */
  human: Schema.optionalKey(Schema.String),
})
export type Inbox = typeof Inbox.Type

/** When and how an ask's answers reached the calling session before a wait could hand them over (CEL-78). */
export const AnswersDelivered = Schema.Struct({
  /** Its hook, `cello inbox`, or another wait; null for answers taken before Cello kept track of how. */
  via: Schema.NullOr(DeliveryVia),
  at: Millis,
})
export type AnswersDelivered = typeof AnswersDelivered.Type

/**
 * What `ask.wait` returns: the task's latest ask, closed, and `alreadyDelivered` when its answers reached
 * the calling session before (its hook or `cello inbox` took them while the wait was reconnecting, or an
 * earlier wait handed them over), so the CLI doesn't print them a second time. Null when this wait
 * handed them over, for the human, for a session they weren't sent to, and for an ask that wasn't
 * answered. The ask's own fields stay at the top, and the field is optional, so a CLI and a server of
 * different versions still read each other: read it as `alreadyDelivered ?? null`.
 */
export const AskWaited = Schema.Struct({
  ...Ask.fields,
  alreadyDelivered: Schema.optionalKey(Schema.NullOr(AnswersDelivered)),
})
export type AskWaited = typeof AskWaited.Type

export const TaskList = Schema.Struct({ ...projectFields, tasks: Schema.Array(Task) })
export type TaskList = typeof TaskList.Type

export const TaskDetail = Schema.Struct({
  ...projectFields,
  task: Task,
  comments: Schema.Array(Comment),
  /** Every review packet, oldest first. */
  reviews: Schema.Array(Review),
  /** Every ask (questions for Lucas, CEL-47) with its answers, oldest first. */
  asks: Schema.Array(Ask),
  /** Documents linked to the task that aren't archived, newest first. */
  documents: Schema.Array(DocumentSummary),
  /** Every event about the task, oldest first. */
  history: Schema.Array(CelloEvent),
})
export type TaskDetail = typeof TaskDetail.Type

/**
 * A project's labels, archived ones included, for `cello label list`: each with how many of the
 * project's tasks that aren't archived carry it.
 */
export const LabelList = Schema.Struct({
  project: Project,
  labels: Schema.Array(Schema.Struct({ label: Label, tasks: Schema.Number })),
})
export type LabelList = typeof LabelList.Type

/** A project's milestones in order, closed ones too, each with its progress: `cello milestone list` (CEL-113). */
export const MilestoneList = Schema.Struct({ project: Project, milestones: Schema.Array(MilestoneSummary) })
export type MilestoneList = typeof MilestoneList.Type

/** One milestone with its progress and its tasks that aren't archived, in every status: `cello milestone show`. */
export const MilestoneDetail = Schema.Struct({ ...projectFields, milestone: Milestone, progress: MilestoneProgress, tasks: Schema.Array(Task) })
export type MilestoneDetail = typeof MilestoneDetail.Type

/** A project's documents, for `cello doc list`. */
export const DocumentList = Schema.Struct({ project: Project, documents: Schema.Array(DocumentSummary) })
export type DocumentList = typeof DocumentList.Type
