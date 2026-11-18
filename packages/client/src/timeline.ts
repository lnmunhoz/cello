// A task's thread in time order (CEL-160): its comments as cards, and between them one line for each thing
// that happened: a stage, a move to another status, a subagent starting or finishing (with a reviewer's
// verdict), the merge, the release that took it live. Pure: the web app draws what this returns, the same
// on the task panel and the Review page.
//
// Lines come from the task's history (stage changes, status moves), `task.timeline` (the runs of every
// subagent on it, and the builds that name it). Left out on purpose: label, milestone and title edits,
// claims, comments and reactions (History keeps them), and test runs.
import type { BuildRecord } from "@cello/contract/build"
import type { ReviewVerdictSeen } from "@cello/contract/entities"
import { type CelloEvent, isReadable, type StreamedEvent } from "@cello/contract/events"
import { stageInfo, type TaskStage } from "@cello/contract/stages"
import type { AgentRun, TaskTimeline } from "@cello/contract/views"
import { modelLabel } from "@cello/shared/model"
import { runLength } from "@cello/contract/wake"

/** Who did what a history line says: the actor, its session, and the subagent when it was one (CEL-55). */
export interface LineDoer {
  readonly actorId: string
  readonly sessionId: string | null
  readonly agentId: string | null
}

interface LineBase {
  /** Stable across refreshes: the key a list item and its fold state use. */
  readonly id: string
  readonly ts: number
}

export type TimelineLine =
  | (LineBase & { readonly kind: "stage"; readonly stage: TaskStage; readonly doer: LineDoer })
  | (LineBase & { readonly kind: "merge"; readonly doer: LineDoer })
  | (LineBase & { readonly kind: "status"; readonly from: string; readonly to: string; readonly doer: LineDoer })
  | (LineBase & {
    readonly kind: "run_start"
    readonly agentType: string | null
    readonly sessionId: string
    readonly agentId: string
    /** "Sonnet 5.5, medium": the agent's latest model and effort, when known. */
    readonly model: string | null
    /** Its second run or later: it was resumed. */
    readonly resumed: boolean
    /** It hasn't finished: the line says it's working. */
    readonly running: boolean
  })
  | (LineBase & {
    readonly kind: "run_end"
    readonly agentType: string | null
    readonly sessionId: string
    readonly agentId: string
    readonly model: string | null
    readonly durationMs: number
    /** A reviewer's verdict, when it left one. */
    readonly verdict: ReviewVerdictSeen | null
  })
  | (LineBase & { readonly kind: "release"; readonly build: BuildRecord })

export type TimelineLineKind = TimelineLine["kind"]

/** The names a line needs: statuses by id. */
export interface TimelineNames {
  readonly statuses: Readonly<Record<string, { readonly name: string }>>
}

export interface TimelineInput<C extends { readonly id: string; readonly createdAt: number }> {
  readonly comments: ReadonlyArray<C>
  readonly history: ReadonlyArray<StreamedEvent>
  readonly timeline: TaskTimeline
  readonly statuses: TimelineNames["statuses"]
}

export type TimelineItem<C> =
  | { readonly kind: "comment"; readonly id: string; readonly ts: number; readonly comment: C }
  | { readonly kind: "line"; readonly id: string; readonly ts: number; readonly line: TimelineLine }

/** A run of lines folded into one row. `shown` is the newest of them when the variant keeps it visible. */
export interface TimelineFold {
  readonly kind: "fold"
  readonly id: string
  readonly lines: ReadonlyArray<TimelineLine>
  readonly shown: TimelineLine | null
}

export type ThreadItem<C> = TimelineItem<C> | TimelineFold

/**
 * Which way a run of lines folds (CEL-160; Lucas picks one, then this goes). `count`: two or more fold into
 * "N changes". `latest`: three or more fold, the folded row keeps the newest line visible, and the run
 * after the newest comment stays open.
 */
export type FoldVariant = "count" | "latest"

const doerOf = (e: CelloEvent): LineDoer => ({ actorId: e.actorId, sessionId: e.sessionId ?? null, agentId: e.agentId ?? null })

const historyLine = (e: StreamedEvent, statuses: TimelineNames["statuses"]): TimelineLine | null => {
  if (!isReadable(e)) return null
  if (e.type === "task.stage_changed") {
    if (e.after === null) return null
    const base = { id: `stage:${e.seq}`, ts: e.ts, doer: doerOf(e) }
    return e.after === "merged" ? { ...base, kind: "merge" } : { ...base, kind: "stage", stage: e.after }
  }
  if (e.type === "task.moved" && e.from.statusId !== e.to.statusId) {
    return {
      kind: "status",
      id: `status:${e.seq}`,
      ts: e.ts,
      from: statuses[e.from.statusId]?.name ?? "another status",
      to: statuses[e.to.statusId]?.name ?? "another status",
      doer: doerOf(e),
    }
  }
  return null
}

const runLines = (runs: ReadonlyArray<AgentRun>): ReadonlyArray<TimelineLine> => {
  const seen = new Map<string, number>()
  return [...runs].sort((a, b) => a.startedAt - b.startedAt).flatMap((run): TimelineLine[] => {
    const key = `${run.sessionId}/${run.agentId}`
    const index = seen.get(key) ?? 0
    seen.set(key, index + 1)
    const id = `run:${key}:${run.startedAt}`
    const model = modelLabel(run.model, run.effort)
    const head: TimelineLine = {
      kind: "run_start", id: `${id}:start`, ts: run.startedAt, agentType: run.agentType, sessionId: run.sessionId, agentId: run.agentId,
      model, resumed: index > 0, running: run.endedAt === null,
    }
    if (run.endedAt === null) return [head]
    return [head, {
      kind: "run_end", id: `${id}:end`, ts: run.endedAt, agentType: run.agentType, sessionId: run.sessionId, agentId: run.agentId,
      model, durationMs: run.endedAt - run.startedAt, verdict: run.verdict,
    }]
  })
}

/**
 * The thread in time order: `comments` and one line for each stage, status move, subagent start and finish,
 * merge and release. Equal times keep this order: comments, history, runs, releases.
 */
export const timelineOf = <C extends { readonly id: string; readonly createdAt: number }>(input: TimelineInput<C>): ReadonlyArray<TimelineItem<C>> => {
  const items: Array<TimelineItem<C>> = [
    ...input.comments.map((comment): TimelineItem<C> => ({ kind: "comment", id: comment.id, ts: comment.createdAt, comment })),
    ...input.history.flatMap((e): Array<TimelineItem<C>> => {
      const line = historyLine(e, input.statuses)
      return line ? [{ kind: "line", id: line.id, ts: line.ts, line }] : []
    }),
    ...runLines(input.timeline.runs).map((line): TimelineItem<C> => ({ kind: "line", id: line.id, ts: line.ts, line })),
    ...input.timeline.releases.map((build): TimelineItem<C> => {
      const line: TimelineLine = { kind: "release", id: `release:${build.id}`, ts: build.startedAt, build }
      return { kind: "line", id: line.id, ts: line.ts, line }
    }),
  ]
  // Array.prototype.sort is stable, so equal times keep the order above.
  return items.sort((a, b) => a.ts - b.ts)
}

const MIN_TO_FOLD: Record<FoldVariant, number> = { count: 2, latest: 3 }

/**
 * Folds each run of lines between two comments (or before the first, or after the last) into one row,
 * as `variant` says. Comments never fold.
 */
export const foldRuns = <C>(items: ReadonlyArray<TimelineItem<C>>, variant: FoldVariant): ReadonlyArray<ThreadItem<C>> => {
  const out: Array<ThreadItem<C>> = []
  let run: Array<Extract<TimelineItem<C>, { kind: "line" }>> = []
  const flush = (trailing: boolean) => {
    const open = variant === "latest" && trailing
    if (run.length >= MIN_TO_FOLD[variant] && !open) {
      const lines = run.map((r) => r.line)
      out.push({ kind: "fold", id: `fold:${lines[0]!.id}`, lines, shown: variant === "latest" ? lines[lines.length - 1]! : null })
    } else {
      out.push(...run)
    }
    run = []
  }
  for (const item of items) {
    if (item.kind === "line") run.push(item)
    else {
      flush(false)
      out.push(item)
    }
  }
  flush(true)
  return out
}

/** "4 changes" for a fold; with its newest line showing, "3 earlier". */
export const foldText = (fold: TimelineFold): string =>
  fold.shown === null ? `${fold.lines.length} changes` : `${fold.lines.length - 1} earlier`

const agentName = (agentType: string | null): string => agentType ?? "A subagent"

/** One line in plain words: "In Progress → In Review", "cello-code-reviewer finished in 12 min", "Merged into main". */
export const timelineLineText = (line: TimelineLine): string => {
  switch (line.kind) {
    case "stage":
      return `Stage: ${stageInfo(line.stage)?.label ?? line.stage}`
    case "merge":
      return "Merged into main"
    case "status":
      return `${line.from} → ${line.to}`
    case "run_start":
      return `${agentName(line.agentType)} ${line.resumed ? "resumed" : "started"}`
    case "run_end":
      return `${agentName(line.agentType)} finished in ${runLength(line.durationMs)}`
    case "release":
      return `Released in v${line.build.version} · build #${line.build.number}`
  }
}
