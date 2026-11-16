// One plain line per history event, for the task panel and `cello task get`.
import type { BoardState } from "./sync/applyEvents.ts"
import type { CelloEvent } from "@cello/contract/events"
import { stageInfo } from "@cello/contract/stages"
import { NOT_WOKEN_TEXT, RUN_END_TEXT, runLength, WAKE_WHY_TEXT } from "@cello/contract/wake"
import { andList } from "@cello/shared/words"

const FIELD_NAMES: Record<string, string> = { title: "title", description: "description", priority: "priority", dueDate: "due date", parentId: "parent" }

const MILESTONE_FIELDS: Record<string, string> = { name: "name", goal: "goal", targetDate: "target date", position: "place in the order" }

const DECIDED = { approved: "approved the review", sent_back: "sent it back", superseded: "replaced the open review", withdrawn: "withdrew the review" }

const WITHDRAWN = { agent: "withdrew the questions", moved: "moved it out of Needs input, withdrawing the questions", superseded: "replaced the open questions" }

const TAKEN_BECAUSE = { holder_exited: " (its session had exited)", holder_idle: " (its session was quiet for 2 hours)", human: "" }

/**
 * The names an event's line needs. `sessionName` names an agent session the event is about but didn't
 * write ("Claude Code session 7330433e": who a comment reopened the task for, CEL-110).
 */
export type HistoryNames = Pick<BoardState, "actors" | "statuses" | "labels"> & {
  readonly sessionName?: (sessionId: string) => string | undefined
  /** Milestones by id (CEL-113); without them a milestone reads as "a milestone". */
  readonly milestones?: BoardState["milestones"]
}

/**
 * Who did it, two ways (CEL-119): `subject` leads a line ("cello-builder (Sonnet 5.5), subagent of
 * d0d47d35," set the stage…, its closing comma included), `plain` is the name where it's possessive or
 * what Cello did to it ("Claude Code session d0d47d35's comment…", "Cello woke Claude Code session d0d47d35").
 */
export interface EventDoer {
  readonly subject: string
  readonly plain: string
}

/**
 * `name`: who did it, when the caller knows better than the actor's name ("Claude Code session
 * 2fd0505c", "cello-builder · a13bfb89", CEL-55; or a subject and a plain name, CEL-119); else the actor's name.
 */
export const describeEvent = (e: CelloEvent, state: HistoryNames, name?: string | EventDoer): string => {
  const fallback = state.actors[e.actorId]?.name ?? "Someone"
  const who = typeof name === "object" ? name.subject : name ?? fallback
  const plain = typeof name === "object" ? name.plain : name ?? fallback
  const status = (id: string) => state.statuses[id]?.name ?? "another status"
  const label = (id: string) => state.labels[id]?.name ?? "a label"
  const milestone = (id: string) => state.milestones?.[id]?.name ?? "a milestone"
  switch (e.type) {
    case "task.created":
      return `${who} created the task`
    case "task.updated":
      return `${who} changed the ${andList(Object.keys(e.after).map((k) => FIELD_NAMES[k] ?? k))}`
    case "task.moved":
      return e.from.statusId === e.to.statusId
        ? `${who} reordered it in ${status(e.to.statusId)}`
        : `${who} moved it from ${status(e.from.statusId)} to ${status(e.to.statusId)}`
    case "task.labels_changed": {
      const parts = [
        ...(e.added.length ? [`added ${andList(e.added.map(label))}`] : []),
        ...(e.removed.length ? [`removed ${andList(e.removed.map(label))}`] : []),
      ]
      return `${who} ${parts.join(" and ")}`
    }
    case "task.milestone_changed": {
      // The migration that turned Milestone labels into milestones (CEL-113) was Cello's doing.
      if (e.fromLabels && e.after !== null) {
        const [kept, ...others] = e.fromLabels
        const also = others.length ? ` (it also had ${andList(others)}; a task is in one milestone, so the later one)` : ""
        return `Cello turned its ${kept} label into the milestone ${milestone(e.after)}${also}`
      }
      if (e.before === null) return `${who} put it in ${e.after === null ? "no milestone" : milestone(e.after)}`
      if (e.after === null) return `${who} took it out of ${milestone(e.before)}`
      return `${who} moved it from ${milestone(e.before)} to ${milestone(e.after)}`
    }
    case "milestone.created":
      return `${who} created the milestone ${e.milestone.name}`
    case "milestone.updated":
      return `${who} changed ${milestone(e.id)}'s ${andList(Object.keys(e.after).map((k) => MILESTONE_FIELDS[k] ?? k))}`
    case "milestone.closed":
      return `${who} closed ${milestone(e.id)}`
    case "milestone.reopened":
      return `${who} reopened ${milestone(e.id)}`
    case "task.archived":
      return `${who} archived it`
    case "task.unarchived":
      return `${who} restored it`
    case "task.claimed":
      return `${who} claimed it`
    case "task.claim_taken":
      return `${who} took over the claim${TAKEN_BECAUSE[e.reason]}`
    case "task.released":
      return `${who} released it`
    case "task.claim_ended":
      return `${plain}'s change ended the agent's claim`
    case "task.reopened": {
      const session = state.sessionName?.(e.session) ?? "the agent session that last held it"
      return e.from === e.task.statusId ? `${plain}'s comment gave it back to ${session}` : `${plain}'s comment reopened it for ${session}`
    }
    case "task.stage_changed":
      return e.after === null ? `${who} cleared the stage` : `${who} set the stage to ${stageInfo(e.after)?.label ?? e.after}`
    case "session.seen":
      return e.session.endedAt === null ? `${who} checked in` : `${plain}'s session ended`
    case "agent.seen":
      return e.agent.endedAt === null ? `${who} checked in` : `${who} finished`
    case "comment.added":
      return `${who} commented`
    case "comment.edited":
      return `${who} edited a comment`
    case "comment.deleted":
      return `${who} deleted a comment`
    case "reaction.added":
      return `${who} reacted ${e.reaction.emoji} to a comment`
    case "reaction.removed":
      return `${who} took back their ${e.reaction.emoji}`
    case "comment.delivered": {
      const human = Object.values(state.actors).find((a) => a.kind === "human")
      return human ? `${who} took ${human.name}'s comment` : `${who} took a comment`
    }
    case "review.submitted":
      return `${who} submitted a review`
    case "review.decided":
      return `${who} ${DECIDED[e.decision]}`
    case "review.withdrawn":
      return `${who} moved it to ${status(e.to)}, withdrawing the open review`
    case "ask.created": {
      const count = e.ask.questions.length
      return `${who} asked ${count === 1 ? "a question" : `${count} questions`}: “${e.ask.title}”`
    }
    case "ask.answered":
      return `${who} answered “${e.ask.title}”`
    case "ask.withdrawn":
      return `${who} ${WITHDRAWN[e.reason]}`
    case "document.published":
      return `${who} published the ${e.document.kind} “${e.document.title}”`
    case "document.updated":
      return `${who} updated the ${e.document.kind} “${e.document.title}”`
    case "document.archived":
      return `${who} archived a document`
    case "profile.changed": {
      const verb = (c: (typeof e.changes)[number]) => c.after === null ? "unset" : c.before?.value === c.after.value ? "confirmed" : "set"
      const [only] = e.changes
      if (e.changes.length === 1 && only) {
        const what = `the testing profile's ${only.field}`
        return verb(only) === "set" ? `${who} set ${what} to \`${only.after!.value}\`` : `${who} ${verb(only)} ${what}`
      }
      return `${who} changed the testing profile: ${e.changes.map((c) => `${verb(c)} ${c.field}`).join(", ")}`
    }
    // Waking sessions (CEL-92): written as the session, about Cello's doing.
    case "session.wake_scheduled":
      return `Cello will wake ${plain} (${WAKE_WHY_TEXT[e.why]})`
    case "session.not_woken":
      return `Cello didn't wake ${plain}: ${NOT_WOKEN_TEXT[e.reason]}`
    case "session.run_started":
      return `Cello woke ${plain} (${WAKE_WHY_TEXT[e.run.why]}, mode ${e.run.mode})`
    case "session.run_ended": {
      const length = e.run.endedAt === null ? "" : ` ${runLength(e.run.endedAt - e.run.startedAt)}`
      return `${plain}'s woken run ${RUN_END_TEXT[e.run.outcome]}${length}${e.run.error ? `: ${e.run.error}` : ""}`
    }
    case "session.orchestrating":
      return e.orchestrating ? `${who} started orchestrating` : `${who} stopped orchestrating`
    case "wake.settings_changed": {
      const parts = [
        ...(e.after.enabled === undefined ? [] : [e.after.enabled ? "turned waking agent sessions on" : "turned waking agent sessions off"]),
        ...(e.after.capPerHour === undefined ? [] : [`set the wake limit to ${e.after.capPerHour} per task per hour`]),
      ]
      return `${who} ${parts.join(" and ")}`
    }
    default:
      return `${who} changed it`
  }
}
