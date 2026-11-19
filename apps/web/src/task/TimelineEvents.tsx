// The one-line events between a task's comments (CEL-160): a stage, a status move, a subagent starting or
// finishing (with a reviewer's verdict), the merge, the release, and how a test run turned out (CEL-181:
// live while it runs, then its outcome in the same row). `TimelineLineRow` is one line,
// `TimelineFoldRow` a run of them folded into one row that opens and closes. The pure side (what lines
// there are, how a run folds, the words) is @cello/client/timeline.
import type { BoardState } from "@cello/client/sync/applyEvents"
import { foldText, timelineLineText, type TestsLine, type TestsLiveLine, type TimelineFold, type TimelineLine, verdictLabel } from "@cello/client/timeline"
import { agentKey, type ReviewVerdictSeen } from "@cello/contract/entities"
import { stageInfo, type TaskStage } from "@cello/contract/stages"
import { Link } from "@tanstack/react-router"
import { ChevronRightIcon, CircleCheckIcon, CircleDotIcon, CircleMinusIcon, CircleXIcon, GitMergeIcon, PackageIcon } from "lucide-react"
import { Fragment, type ReactNode, useState } from "react"
import { AgentMark } from "../components/ui/AgentMark.tsx"
import { Button } from "../components/ui/Button.tsx"
import { Chip } from "../components/ui/Chip.tsx"
import { relativeTime } from "../lib/format.ts"
import { agentPresenceSubject, agentColor, whoOf } from "../presence/model.ts"
import { PresenceDot, STAGE_ICONS } from "../presence/Presence.tsx"
import { TestRunFlask } from "../presence/TestRun.tsx"
import { useNow } from "../presence/useNow.ts"
import { presenceOf } from "@cello/domain/presence"

/** The stage whose colour a verdict borrows: merged (green), fixing (amber), agent review (indigo). */
const VERDICT_STAGE: Record<ReviewVerdictSeen, TaskStage | null> = { merge: "merged", fix_first: "fixing", ask: "review", other: null }

/** The verdict's dot: what the reviewer concluded, in the stage colours the board already uses. */
const verdictColor = (verdict: ReviewVerdictSeen): string => {
  const stage = VERDICT_STAGE[verdict]
  return (stage && stageInfo(stage)?.color) ?? "var(--faint)"
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

const failureLines = (failures: ReadonlyArray<string>) => failures.map((f) => `✘ ${f}`)

/**
 * A test run's hover (CEL-181): who ran it, the command, each failure as it happened, the runs a collapsed
 * line stands for, and where the results are once it's done.
 */
const testsTitle = (board: BoardState, line: TestsLine | TestsLiveLine): string =>
  [
    doerTitle(board, line),
    line.command,
    ...(line.kind === "tests" ? line.earlier.flatMap((e) => [`Earlier: ${e.words}`, ...failureLines(e.failures)]) : []),
    ...failureLines(line.failures),
    line.kind === "tests" && line.folder ? `${line.folder}/summary.txt` : undefined,
  ]
    .filter((part) => part !== undefined)
    .join("\n")

const lineTitle = (board: BoardState, line: TimelineLine): string | undefined =>
  line.kind === "tests" || line.kind === "tests_live" ? testsTitle(board, line) : doerTitle(board, line)

/**
 * One line: its icon, its words, and when it happened. A change's doer is in the hover. A finished test run
 * shows when it ended, though it sits where it started; a live one shows no time, its elapsed time is in its
 * words. Live and finished are one row (the same key), so the `<li>` stays when one turns into the other.
 */
export function TimelineLineRow({ board, line }: { board: BoardState; line: TimelineLine }) {
  return (
    <li
      data-timeline-line={line.kind}
      data-timeline-id={line.id}
      data-outcome={line.kind === "tests" ? line.outcome : undefined}
      title={lineTitle(board, line)}
      className="flex min-w-0 items-center gap-2 px-3 text-xs leading-5 text-muted"
    >
      <LineBody board={board} line={line} />
      {line.kind === "tests_live" ? null : <span className="shrink-0 text-faint">{relativeTime(line.kind === "tests" ? line.endedAt : line.ts)}</span>}
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
    case "tests":
      return <TestsBody line={line} />
    case "tests_live":
      return <TestsLiveBody line={line} />
  }
}

/** The icon and colour of how a finished run went: the merge's green, danger, faint. */
const OUTCOME_ICON = { passed: CircleCheckIcon, failed: CircleXIcon, ended: CircleMinusIcon } as const

/** A finished run (CEL-181): "web e2e passed · e2e/pages.spec.ts · 3 of 3 · 1m44s", its label and outcome in ink. */
function TestsBody({ line }: { line: TestsLine }) {
  const Icon = OUTCOME_ICON[line.outcome]
  const head = `${line.label} ${line.outcome}`
  return (
    <>
      <Slot>
        <Icon
          aria-hidden
          className={`size-3 ${line.outcome === "failed" ? "text-danger" : line.outcome === "ended" ? "text-faint" : ""}`}
          style={line.outcome === "passed" ? { color: stageInfo("merged")?.color } : undefined}
        />
      </Slot>
      <span className="min-w-0 truncate">
        <span className="font-medium text-ink">
          {line.label} <span className={line.outcome === "failed" ? "text-danger" : undefined}>{line.outcome}</span>
        </span>
        {line.words.slice(head.length)}
        {line.runs > 1 ? ` · ${line.runs} runs` : null}
      </span>
    </>
  )
}

/** A run going now (CEL-181): "Running web e2e · e2e/pages.spec.ts · 2 of 3 · 1m10s", the failures so far in danger. */
function TestsLiveBody({ line }: { line: TestsLiveLine }) {
  return (
    <>
      <Slot>
        <TestRunFlask />
      </Slot>
      <span className="min-w-0 truncate">
        <span className="font-medium text-ink">Running</span>{" "}
        {line.words.split(" · ").map((part, i) => (
          <Fragment key={i}>
            {i > 0 ? " · " : null}
            {/^\d+ failed$/.test(part) ? <span className="font-medium text-danger">{part}</span> : part}
          </Fragment>
        ))}
      </span>
    </>
  )
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
          <Chip size="sm" color={verdictColor(line.verdict)}>
            {verdictLabel(line.verdict, humanName(board))}
          </Chip>
        </span>
      ) : null}
    </>
  )
}

/**
 * A run of lines folded into one row: "3 earlier · show", then the lines that stay visible: its test runs,
 * which never fold away (CEL-181), and its newest line. Open, every line is listed in order, and the row
 * says "hide".
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
      {(open ? fold.lines : fold.visible).map((line) => (
        <TimelineLineRow key={line.id} board={board} line={line} />
      ))}
    </Fragment>
  )
}
