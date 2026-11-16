// One plain line per history event, for the task panel and `cello task get`.
import type { BoardState } from "./sync/applyEvents.ts"
import type { CelloEvent } from "@cello/contract/events"
import { stageInfo } from "@cello/contract/stages"
import { NOT_WOKEN_TEXT, RUN_END_TEXT, runLength, WAKE_WHY_TEXT } from "@cello/contract/wake"
import { andList } from "@cello/shared/words"

const FIELD_NAMES: Record<string, string> = { title: "title", description: "description", priority: "priority", dueDate: "due date", parentId: "parent" }

const DECIDED = { approved: "approved the review", sent_back: "sent it back", superseded: "replaced the open review", withdrawn: "withdrew the review" }

const WITHDRAWN = { agent: "withdrew the questions", moved: "moved it out of Needs input, withdrawing the questions", superseded: "replaced the open questions" }

const TAKEN_BECAUSE = { holder_exited: " (its session had exited)", holder_idle: " (its session was quiet for 2 hours)", human: "" }

/**
 * `name`: who did it, when the caller knows better than the actor's name ("Claude Code session
 * 2fd0505c", "cello-builder · a13bfb89", CEL-55); else the actor's name.
 */
export const describeEvent = (e: CelloEvent, state: Pick<BoardState, "actors" | "statuses" | "labels">, name?: string): string => {
  const who = name ?? state.actors[e.actorId]?.name ?? "Someone"
  const status = (id: string) => state.statuses[id]?.name ?? "another status"
  const label = (id: string) => state.labels[id]?.name ?? "a label"
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
      return `${who}'s change ended the agent's claim`
    case "task.stage_changed":
      return e.after === null ? `${who} cleared the stage` : `${who} set the stage to ${stageInfo(e.after)?.label ?? e.after}`
    case "session.seen":
      return e.session.endedAt === null ? `${who} checked in` : `${who}'s session ended`
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
      return `Cello will wake ${who} (${WAKE_WHY_TEXT[e.why]})`
    case "session.not_woken":
      return `Cello didn't wake ${who}: ${NOT_WOKEN_TEXT[e.reason]}`
    case "session.run_started":
      return `Cello woke ${who} (${WAKE_WHY_TEXT[e.run.why]}, mode ${e.run.mode})`
    case "session.run_ended": {
      const length = e.run.endedAt === null ? "" : ` ${runLength(e.run.endedAt - e.run.startedAt)}`
      return `${who}'s woken run ${RUN_END_TEXT[e.run.outcome]}${length}${e.run.error ? `: ${e.run.error}` : ""}`
    }
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
