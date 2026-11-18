// Which board events get an agent cursor, and what kind of step each one plays. Pure.
import { agentKey } from "@cello/contract/entities"
import type { CelloEvent } from "@cello/contract/events"
import { commentGist } from "@cello/domain/comment"
import type { StepKind } from "./pacing.ts"

/** What an agent session did to a card, before the board decides how to show it. */
export interface Change {
  /** The agent session, or `<session>/<agent>` for its subagent (CEL-55): its cursor and its lane in the queue. */
  readonly lane: string
  readonly actorId: string
  /** The task. */
  readonly card: string
  readonly kind: StepKind
  /** What a bubble says: the start of a comment, or "Claimed". */
  readonly note: string | null
}

/** Where a card was on the board before an event, if the board showed it. */
export type Before = (taskId: string) => { readonly statusId: string; readonly position: string } | undefined

const claimNote = { "task.claimed": "Claimed", "task.claim_taken": "Took over", "task.released": "Released" } as const

/**
 * The change an event shows on `projectId`'s board, or null for none. Only agent sessions get a
 * cursor: Lucas's own changes, from this tab or any other, carry no session.
 */
export const changeOf = (e: CelloEvent, projectId: string, before: Before): Change | null => {
  if (e.sessionId === null || e.projectId !== projectId) return null
  // Each subagent of a session gets its own cursor (CEL-55): `<session>/<agent>`, as agentKey.
  const lane = e.agentId ? agentKey(e.sessionId, e.agentId) : e.sessionId
  const change = (card: string, kind: StepKind, note: string | null = null): Change => ({ lane, actorId: e.actorId, card, kind, note })
  switch (e.type) {
    case "task.created":
      return change(e.task.id, "create")
    case "task.moved":
      return change(e.id, "move")
    case "task.updated":
      return change(e.id, "title" in e.after ? "title" : "field")
    case "task.labels_changed":
      return change(e.id, "field")
    case "comment.added":
      return change(e.comment.taskId, "comment", excerpt(commentGist(e.comment)))
    case "task.claimed":
    case "task.claim_taken":
    case "task.released": {
      // A claim may also move the card to a started column: then it flies like a move.
      const was = before(e.id)
      const moved = was !== undefined && (was.statusId !== e.task.statusId || was.position !== e.task.position)
      return change(e.id, moved ? "move" : "claim", claimNote[e.type])
    }
    default:
      return null
  }
}

const EXCERPT = 60

/** The first line of some markdown as plain text, cut at a word near 60 characters: what a bubble shows. */
export const excerpt = (markdown: string): string => {
  const line = markdown.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? ""
  const text = line.replace(/^#+\s*/, "").replace(/[*_`~]/g, "").replace(/\s+/g, " ").trim()
  if (text.length <= EXCERPT) return text
  const cut = text.slice(0, EXCERPT)
  const space = cut.lastIndexOf(" ")
  return `${(space > 20 ? cut.slice(0, space) : cut).trim()}…`
}
