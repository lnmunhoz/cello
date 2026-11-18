import { filterSteps, type LogShow, logKey, storyOf, thinkingNote, unavailableWords } from "@cello/client/sync/agentLog"
import type { BoardState } from "@cello/client/sync/applyEvents"
import { LOG_DEFAULTS } from "@cello/contract/agentLog"
import { useAtomValue } from "@effect/atom-react"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { ArrowDownIcon, EyeIcon, EyeOffIcon, ScrollTextIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "../components/ui/Button.tsx"
import { SegmentedControl, SegmentedControlItem } from "../components/ui/SegmentedControl.tsx"
import { Select } from "../components/ui/Select.tsx"
import { Switch } from "../components/ui/Switch.tsx"
import { agentLogFamily } from "../lib/cello.ts"
import type { AgentRow } from "./layout.ts"
import { atBottom, runLabel, runsOf } from "./log.ts"
import { Step } from "./LogStep.tsx"
import { StoryList } from "./LogStory.tsx"

const VIEWS: ReadonlyArray<{ readonly value: LogShow; readonly label: string }> = [
  { value: "story", label: "Story" },
  { value: "everything", label: "Everything" },
  { value: "errors", label: "Errors" },
]

const isView = (value: unknown): value is LogShow => VIEWS.some((v) => v.value === value)

/** The source picker's value for the agent's own transcript (the others are run ids). */
const TRANSCRIPT = "transcript"

/**
 * An agent's live log (CEL-106), the open row's right column on the Agents page: what it says, each tool
 * it calls (folded to one line, a click opens its command and result), the subagents it launches, and its
 * thinking behind the Thinking switch, newest at the bottom. It opens on Story (CEL-170): calls grouped,
 * the one running now on its own, a finished turn folded; Everything lists every step, Errors the failed calls. It follows new steps as they arrive; scrolling up
 * pauses that, and "Jump to live" brings it back. Keys are masked; the human can show them.
 */
export function AgentLog({ board, row }: { readonly board: BoardState; readonly row: AgentRow }) {
  const [reveal, setReveal] = useState(false)
  const [show, setShow] = useState<LogShow>(LOG_DEFAULTS.show)
  const [thinking, setThinking] = useState<boolean>(LOG_DEFAULTS.thinking)
  const [following, setFollowing] = useState(true)
  // A session Cello woke (CEL-92) can show a run's own log instead of its transcript.
  const [runId, setRunId] = useState<string | null>(null)
  const runs = row.kind === "session" ? runsOf(board.wakes, row.session.id) : []
  const scroller = useRef<HTMLDivElement>(null)
  // Everything this log has put on screen (CEL-107): a row shown again after a view or the Thinking switch never fades in twice.
  const [shown] = useState(() => new Set<string>())
  const key = logKey({ sessionId: row.session.id, agentId: row.agent?.agentId, runId: runId ?? undefined, reveal })
  const result = useAtomValue(agentLogFamily(key))
  const log = AsyncResult.isSuccess(result) ? result.value : null
  const live = row.presence !== "ended" && (row.agent ? row.agent.endedAt : row.session.endedAt) === null
  const working = row.presence === "active"
  const flat = log && show !== "story" ? filterSteps(log.steps, show, thinking) : []
  const items = log && show === "story" ? storyOf(log.steps, { thinking, live: working }) : []
  const empty = show === "story" ? items.length === 0 : flat.length === 0
  const masked = log?.steps.some((s) => s.masked) ?? false
  const note = thinking && log ? thinkingNote(log) : null
  const last = log?.steps.at(-1)
  // A step that changed (a result arriving, an answer ending the turn) moves the bottom too: follow on its version, not just the count.
  // Taken from the whole log, so a call joining a group that's closed still scrolls.
  const tip = last && log ? `${show}:${thinking}:${log.steps.length}:${last.id}:${last.tool?.status ?? ""}:${last.endsTurn ? 1 : 0}` : show

  useEffect(() => {
    const el = scroller.current
    if (following && el) el.scrollTop = el.scrollHeight
  }, [tip, following])

  const jumpToLive = () => {
    setFollowing(true)
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }

  return (
    <section aria-label={live ? "Live log" : "Log"} data-agent-log data-log-show={show} data-log-follow={following ? "on" : "off"} className="flex min-w-0 flex-col gap-2">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted">
          <ScrollTextIcon aria-hidden className="size-3.5 text-faint" />
          {live ? "Live log" : "Log"}
        </h3>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {runs.length > 0 ? (
            <Select
              variant="chip"
              label="Which log"
              value={runId ?? TRANSCRIPT}
              options={[{ value: TRANSCRIPT, label: "Transcript" }, ...runs.map((run) => ({ value: run.id, label: runLabel(run) }))]}
              onValueChange={(value) => setRunId(value === null || value === TRANSCRIPT ? null : value)}
            />
          ) : null}
          <SegmentedControl
            size="sm"
            aria-label="Show"
            value={show}
            onValueChange={(value) => {
              if (isView(value)) setShow(value)
            }}
          >
            {VIEWS.map((v) => (
              <SegmentedControlItem key={v.value} value={v.value} data-log-view={v.value}>
                {v.label}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <Switch checked={thinking} onCheckedChange={setThinking} data-log-thinking />
            Thinking
          </label>
          {masked || reveal ? (
            <Button variant="ghost" size="sm" onClick={() => setReveal(!reveal)} data-log-reveal aria-pressed={reveal}>
              {reveal ? <EyeOffIcon aria-hidden className="size-3.5" /> : <EyeIcon aria-hidden className="size-3.5" />}
              {reveal ? "Hide secrets" : "Show secrets"}
            </Button>
          ) : null}
        </div>
      </header>
      {note ? (
        <p data-log-thinking-note className="px-1 text-xs text-muted">
          {note}
        </p>
      ) : null}
      <div className="relative">
        <div
          ref={scroller}
          data-log-scroller
          onScroll={(e) => {
            const bottom = atBottom(e.currentTarget)
            if (bottom !== following) setFollowing(bottom)
          }}
          className="flex h-[min(60vh,520px)] flex-col overflow-y-auto rounded-lg border border-line bg-sunken"
        >
          {!live && !LOG_DEFAULTS.finishedLogs ? (
            <LogNote>This agent finished.</LogNote>
          ) : log === null ? (
            <LogNote>{AsyncResult.isFailure(result) ? "The log couldn't be read." : "Opening the log…"}</LogNote>
          ) : log.status === "unavailable" && log.reason ? (
            <LogNote data-log-unavailable={log.reason}>{unavailableWords(log.reason, live)}</LogNote>
          ) : log.status === "ready" && empty ? (
            <LogNote>{show === "errors" && log.steps.length > 0 ? "No failed calls." : "Nothing in the log yet."}</LogNote>
          ) : (
            <ol className="flex flex-col gap-px py-1.5" aria-label="Steps">
              {log.older ? (
                <li className="px-3 py-1 text-xs text-faint">Earlier steps aren't shown: this log is long, so it opens near its end.</li>
              ) : log.skipped > 0 ? (
                <li className="px-3 py-1 text-xs text-faint">{log.skipped} earlier steps aren't shown.</li>
              ) : null}
              {/* A running call pulses only while the agent is working right now; a row that just arrived fades in (CEL-107). */}
              {show === "story" ? (
                <StoryList items={items} context={{ row, working, arrived: log.arrived, shown }} />
              ) : (
                flat.map((step) => <Step key={step.id} step={step} row={row} working={working} arrived={log.arrived.includes(step.id)} shown={shown} />)
              )}
            </ol>
          )}
        </div>
        {following ? null : (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <span className="pointer-events-auto">
              <Button variant="secondary" size="sm" onClick={jumpToLive} data-log-jump>
                <ArrowDownIcon aria-hidden className="size-3.5" />
                Jump to live
              </Button>
            </span>
          </div>
        )}
      </div>
    </section>
  )
}

function LogNote({ children, ...data }: { readonly children: string } & Readonly<Record<`data-${string}`, string>>) {
  return (
    <p {...data} className="m-auto max-w-sm px-6 py-10 text-center text-[13px] text-muted">
      {children}
    </p>
  )
}
