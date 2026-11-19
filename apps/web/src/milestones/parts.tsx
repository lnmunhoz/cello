// What the Milestones page and a milestone's page share (CEL-132): the progress bar with its numbers,
// the due date in words, and the agent marks of the sessions working on a milestone's tasks.
import type { BoardState } from "@cello/client/sync/applyEvents"
import { statusesOf } from "@cello/client/sync/selectors"
import type { Milestone } from "@cello/contract/entities"
import { dueText, localDay, progressParts, progressText, type MilestoneProgress } from "@cello/domain/milestone"
import { isReviewStatus } from "@cello/domain/review"
import { formatDay, formatDue } from "../lib/format.ts"
import { agentOn, workingMark, workingSessions } from "../presence/model.ts"
import { AgentMarkOf, MARK_SIZE } from "../presence/Presence.tsx"
import { useNow } from "../presence/useNow.ts"

/** The default statuses' colours, for a workspace whose statuses don't say (they always do). */
const FALLBACK = { done: "#10B981", inReview: "#8B5CF6", inProgress: "#F59E0B", todo: "#6B7280", backlog: "#9CA3AF" }

/** Each part of the bar in its status's colour, so a status recoloured in Settings recolours its part. */
const segmentColors = (board: BoardState, workspaceId: string) => {
  const statuses = statusesOf(board, workspaceId)
  const first = (match: (s: (typeof statuses)[number]) => boolean, fallback: string) => statuses.find(match)?.color ?? fallback
  return {
    done: first((s) => s.category === "completed", FALLBACK.done),
    inReview: first((s) => s.category === "started" && isReviewStatus(s.name), FALLBACK.inReview),
    inProgress: first((s) => s.category === "started" && !isReviewStatus(s.name), FALLBACK.inProgress),
    todo: first((s) => s.category === "unstarted", FALLBACK.todo),
    backlog: first((s) => s.category === "backlog", FALLBACK.backlog),
  }
}

/**
 * A milestone's bar: Done, In Review, In Progress (Needs input with it) and Todo, then Backlog as a lighter,
 * striped tail, since it isn't committed yet. Todo is a tint of its colour, so the parts being worked on
 * stand out; the empty track is the line colour, visible on a card in both themes.
 */
export function ProgressBar({ progress, board, workspaceId, size = "md" }: {
  progress: MilestoneProgress
  board: BoardState
  workspaceId: string
  size?: "sm" | "md"
}) {
  const colors = segmentColors(board, workspaceId)
  const parts = [
    { key: "done", count: progress.done, color: colors.done },
    { key: "in-review", count: progress.inReview, color: colors.inReview },
    { key: "in-progress", count: progress.inProgress, color: colors.inProgress },
    { key: "todo", count: progress.todo, color: `color-mix(in srgb, ${colors.todo} 45%, transparent)` },
    { key: "backlog", count: progress.backlog, color: `repeating-linear-gradient(135deg, color-mix(in srgb, ${colors.backlog} 70%, transparent) 0 3px, transparent 3px 6px)` },
  ]
  const words = [progressText(progress), ...progressParts(progress)].join(", ")
  return (
    <div
      role="img"
      aria-label={words}
      title={words}
      data-progress-bar
      data-done={progress.done}
      data-total={progress.total}
      className={`flex w-full gap-px overflow-hidden rounded-full bg-line dark:bg-line-strong ${size === "sm" ? "h-1" : "h-1.5"}`}
    >
      {progress.total === 0
        ? null
        : parts.map((p) =>
          p.count === 0 ? null : <span key={p.key} data-segment={p.key} style={{ width: `${(p.count / progress.total) * 100}%`, background: p.color }} />
        )}
    </div>
  )
}

/**
 * "6 of 7 done · 86%", tabular so numbers don't jump as cards move, right-aligned in a column of its own
 * width so the bars beside it end at the same place on every row.
 */
export function ProgressNumbers({ progress }: { progress: MilestoneProgress }) {
  return (
    <span className="w-34 shrink-0 text-right text-xs whitespace-nowrap tabular-nums text-muted" data-progress-text>
      {progressText(progress)}
    </span>
  )
}

/** "3 days left", "due today", or "4 days late" in red, with the date on hover; nothing without a date. */
export function DueWords({ milestone }: { milestone: Milestone }) {
  const now = useNow()
  if (milestone.targetDate === null) return null
  const due = dueText(milestone.targetDate, localDay(now))
  return (
    <span
      title={`Due ${formatDue(milestone.targetDate, now)}`}
      data-due={due.late ? "late" : "on-time"}
      className={`shrink-0 text-xs tabular-nums ${due.late ? "font-medium text-danger" : "text-muted"}`}
    >
      {due.text}
    </span>
  )
}

/** "Closed Nov 12". */
export const closedWords = (milestone: Milestone, now: number): string =>
  milestone.closedAt === null ? "Closed" : `Closed ${formatDay(milestone.closedAt, now)}`

/**
 * The agent marks of the sessions and subagents working on a milestone's tasks right now, each in the
 * mood its card shows (presence/model.ts), as the Agents page draws them.
 */
export function MilestoneAgents({ board, workspaceId, milestoneId }: { board: BoardState; workspaceId: string; milestoneId: string }) {
  const now = useNow()
  const marks = workingSessions(board, workspaceId, now).flatMap((s) => {
    const own = s.tasks.filter((t) => t.milestoneId === milestoneId && agentOn(board, t, now) === null)
    return [
      ...(own.length ? [{ key: s.session.id, session: s.session, agent: null, who: s.who, look: workingMark(board, own, s.presence) }] : []),
      ...s.agents
        .filter((a) => a.task?.milestoneId === milestoneId)
        .map((a) => ({ key: `${a.agent.sessionId}/${a.agent.agentId}`, session: s.session, agent: a.agent, who: a.who, look: a.mark })),
    ]
  })
  if (marks.length === 0) return null
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted" data-milestone-agents={marks.length} title={marks.map((m) => m.who.name).join(", ")}>
      <span className="flex items-center gap-0.5">
        {marks.map((m) => (
          <span key={m.key} className="flex size-5 items-center justify-center">
            <AgentMarkOf board={board} session={m.session} agent={m.agent} who={m.who} look={m.look} size={MARK_SIZE} place={`milestone:${milestoneId}`} />
          </span>
        ))}
      </span>
      <span data-milestone-agents-text>
        {marks.length} {marks.length === 1 ? "agent" : "agents"} working
      </span>
    </span>
  )
}
