// The one-line events between a task's comments (CEL-160): a stage, a status move, a subagent starting or
// finishing (with a reviewer's verdict), the merge, the release. `TimelineLineRow` is one line,
// `TimelineFoldRow` a run of them folded into one row that opens and closes. The pure side (what lines
// there are, how a run folds, the words) is @cello/client/timeline.
import type { BoardState } from "@cello/client/sync/applyEvents"
import { foldText, timelineLineText, type TimelineFold, type TimelineLine, verdictLabel } from "@cello/client/timeline"
import { agentKey, type ReviewVerdictSeen } from "@cello/contract/entities"
import { stageInfo } from "@cello/contract/stages"
import { Link } from "@tanstack/react-router"
import { ChevronRightIcon, CircleDotIcon, GitMergeIcon, PackageIcon } from "lucide-react"
import { Fragment, type ReactNode, useState } from "react"
import { AgentMark } from "../components/ui/AgentMark.tsx"
import { Button } from "../components/ui/Button.tsx"
import { Chip } from "../components/ui/Chip.tsx"
import { relativeTime } from "../lib/format.ts"
import { agentPresenceSubject, agentColor, whoOf } from "../presence/model.ts"
import { PresenceDot, STAGE_ICONS } from "../presence/Presence.tsx"
import { useNow } from "../presence/useNow.ts"
import { presenceOf } from "@cello/shared/presence"

/** The verdict's dot: what the reviewer concluded, in the stage colours the board already uses. */
const VERDICT_COLOR: Record<ReviewVerdictSeen, string> = {
  merge: "#10B981",
  fix_first: "#F59E0B",
  ask: "#6366F1",
  other: "var(--faint)",
}

/** The human's first name, for "Ask Lucas": the board's human actor. */
const humanName = (board: BoardState): string | null => {
  const human = Object.values(board.actors).find((a) => a.kind === "human")
  return human ? (human.name.split(" ")[0] ?? human.name) : null
}

/** Who did it, for the hover: "cello-builder · a13bfb89, under Claude Code session 2fd0505c". */
const doerTitle = (board: BoardState, line: TimelineLine): string | undefined => {
  const who =
    line.kind === "run_start" || line.kind === "run_end"
      ? whoOf(board, "", line.sessionId, line.agentId)
      : line.kind === "release"
        ? null
        : whoOf(board, line.doer.actorId, line.doer.sessionId, line.doer.agentId)
  return who ? (who.parent ? `${who.name}, under ${who.parent}` : who.name) : undefined
}

/** One line: its icon, its words, and when it happened. A change's doer is in the hover. */
export function TimelineLineRow({ board, line }: { board: BoardState; line: TimelineLine }) {
  return (
    <li
      data-timeline-line={line.kind}
      data-timeline-id={line.id}
      title={doerTitle(board, line)}
      className="flex min-w-0 items-center gap-2 px-3 text-xs leading-5 text-muted"
    >
      <LineBody board={board} line={line} />
      <span className="shrink-0 text-faint">{relativeTime(line.ts)}</span>
    </li>
  )
}

function Slot({ children }: { children: ReactNode }) {
  return <span className="flex size-4 shrink-0 items-center justify-center">{children}</span>
}

function LineBody({ board, line }: { board: BoardState; line: TimelineLine }) {
  const text = timelineLineText(line)
  switch (line.kind) {
    case "stage": {
      const info = stageInfo(line.stage)
      const Icon = (info && STAGE_ICONS[info.icon]) || CircleDotIcon
      return (
        <>
          <Slot>
            <Icon aria-hidden className="size-3" style={{ color: info?.color }} />
          </Slot>
          <span className="min-w-0 truncate" data-stage={line.stage}>
            Stage: <span className="font-medium text-ink">{info?.label ?? line.stage}</span>
          </span>
        </>
      )
    }
    case "merge":
      return (
        <>
          <Slot>
            <GitMergeIcon aria-hidden className="size-3" style={{ color: stageInfo("merged")?.color }} />
          </Slot>
          <span className="min-w-0 truncate font-medium text-ink">{text}</span>
        </>
      )
    case "status":
      return (
        <>
          <Slot>
            <CircleDotIcon aria-hidden className="size-3 text-faint" />
          </Slot>
          <span className="min-w-0 truncate">{text}</span>
        </>
      )
    case "release":
      return (
        <>
          <Slot>
            <PackageIcon aria-hidden className="size-3" style={{ color: stageInfo("merged")?.color }} />
          </Slot>
          <Link to="/builds" className="min-w-0 truncate font-medium text-ink hover:underline">
            {text}
          </Link>
        </>
      )
    case "run_start":
    case "run_end":
      return <RunBody board={board} line={line} text={text} />
  }
}

/** A subagent starting or finishing: its mark, its name, the model it's on, and a reviewer's verdict. */
function RunBody({ board, line, text }: { board: BoardState; line: Extract<TimelineLine, { kind: "run_start" | "run_end" }>; text: string }) {
  const name = line.agentType ?? "A subagent"
  const agent = board.agents[agentKey(line.sessionId, line.agentId)]
  const color = agentColor({ agentId: line.agentId })
  const now = useNow()
  const working = line.kind === "run_start" && line.running && agent !== undefined && presenceOf(agentPresenceSubject(board, agent), now) === "active"
  return (
    <>
      <Slot>
        {working && agent ? <PresenceDot of={agentPresenceSubject(board, agent)} color={color} /> : <AgentMark size={13} body={color} eye="white" />}
      </Slot>
      <span className="min-w-0 truncate" data-agent={line.agentId}>
        <span className="font-medium text-ink">{name}</span>
        {text.slice(name.length)}
        {line.kind === "run_start" && line.model ? <span className="text-faint"> · {line.model}</span> : null}
      </span>
      {working ? (
        <span className="shrink-0 font-medium text-ink" data-timeline-working>
          working
        </span>
      ) : null}
      {line.kind === "run_end" && line.verdict ? (
        <span className="shrink-0" data-verdict={line.verdict}>
          <Chip size="sm" color={VERDICT_COLOR[line.verdict]}>
            {verdictLabel(line.verdict, humanName(board))}
          </Chip>
        </span>
      ) : null}
    </>
  )
}

/**
 * A run of lines folded into one row: "4 changes · show", or with its newest line showing, that line and
 * "+2 earlier · show". Open, every line is listed in order, and the row says "hide".
 */
export function TimelineFoldRow({ board, fold }: { board: BoardState; fold: TimelineFold }) {
  const [open, setOpen] = useState(false)
  return (
    <Fragment>
      <li data-timeline-fold={fold.id} data-open={open ? "" : undefined} className="flex items-center px-1.5">
        <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          <ChevronRightIcon aria-hidden className={`size-3 ${open ? "rotate-90" : ""}`} />
          {open ? "Hide" : `${foldText(fold)} · show`}
        </Button>
      </li>
      {open ? fold.lines.map((line) => <TimelineLineRow key={line.id} board={board} line={line} />) : null}
      {!open && fold.shown ? <TimelineLineRow board={board} line={fold.shown} /> : null}
    </Fragment>
  )
}
