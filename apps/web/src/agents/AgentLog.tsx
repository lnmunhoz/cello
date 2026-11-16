import { durationWords, filterSteps, type LogFilter, logKey, previewOf, unavailableWords } from "@cello/client/sync/agentLog"
import type { BoardState } from "@cello/client/sync/applyEvents"
import { type LogStep, LOG_DEFAULTS } from "@cello/contract/agentLog"
import { useAtomValue } from "@effect/atom-react"
import { Link } from "@tanstack/react-router"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { ArrowDownIcon, CheckIcon, ChevronRightIcon, EyeIcon, EyeOffIcon, ScrollTextIcon, XIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "../components/ui/Button.tsx"
import { Markdown } from "../components/ui/Markdown.tsx"
import { SegmentedControl, SegmentedControlItem } from "../components/ui/SegmentedControl.tsx"
import { Select } from "../components/ui/Select.tsx"
import { Switch } from "../components/ui/Switch.tsx"
import { agentLogFamily } from "../lib/cello.ts"
import type { AgentRow } from "./layout.ts"
import { atBottom, runLabel, runsOf } from "./log.ts"

const FILTERS: ReadonlyArray<{ readonly value: LogFilter; readonly label: string }> = [
  { value: "all", label: "All" },
  { value: "messages", label: "Messages" },
  { value: "tools", label: "Tools" },
  { value: "errors", label: "Errors" },
]

const isFilter = (value: unknown): value is LogFilter => FILTERS.some((f) => f.value === value)

/** The source picker's value for the agent's own transcript (the others are run ids). */
const TRANSCRIPT = "transcript"

/**
 * An agent's live log (CEL-106), the open row's right column on the Agents page: what it says, each tool
 * it calls (folded to one line, a click opens the result), the subagents it launches, and its thinking
 * behind the Thinking switch, newest at the bottom. It follows new steps as they arrive; scrolling up
 * pauses that, and "Jump to live" brings it back. Keys are masked; the human can show them.
 */
export function AgentLog({ board, row }: { readonly board: BoardState; readonly row: AgentRow }) {
  const [reveal, setReveal] = useState(false)
  const [filter, setFilter] = useState<LogFilter>("all")
  const [thinking, setThinking] = useState<boolean>(LOG_DEFAULTS.thinking)
  const [following, setFollowing] = useState(true)
  // A session Cello woke (CEL-92) can show a run's own log instead of its transcript.
  const [runId, setRunId] = useState<string | null>(null)
  const runs = row.kind === "session" ? runsOf(board.wakes, row.session.id) : []
  const scroller = useRef<HTMLDivElement>(null)
  const key = logKey({ sessionId: row.session.id, agentId: row.agent?.agentId, runId: runId ?? undefined, reveal })
  const result = useAtomValue(agentLogFamily(key))
  const log = AsyncResult.isSuccess(result) ? result.value : null
  const live = row.presence !== "ended" && (row.agent ? row.agent.endedAt : row.session.endedAt) === null
  const steps = log ? filterSteps(log.steps, filter, thinking) : []
  const masked = log?.steps.some((s) => s.masked) ?? false
  const last = steps.at(-1)
  // A step that changed (a result arriving) moves the bottom too: follow on its version, not just the count.
  const tip = last ? `${steps.length}:${last.id}:${last.tool?.status ?? ""}` : ""

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
    <section aria-label={live ? "Live log" : "Log"} data-agent-log data-log-follow={following ? "on" : "off"} className="flex min-w-0 flex-col gap-2">
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
            value={filter}
            onValueChange={(value) => {
              if (isFilter(value)) setFilter(value)
            }}
          >
            {FILTERS.map((f) => (
              <SegmentedControlItem key={f.value} value={f.value} data-log-filter={f.value}>
                {f.label}
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
          ) : log.status === "ready" && steps.length === 0 ? (
            <LogNote>{log.steps.length === 0 ? "Nothing in the log yet." : "No steps match this filter."}</LogNote>
          ) : (
            <ol className="flex flex-col gap-px py-1.5" aria-label="Steps">
              {log.older ? (
                <li className="px-3 py-1 text-xs text-faint">Earlier steps aren't shown: this log is long, so it opens near its end.</li>
              ) : log.skipped > 0 ? (
                <li className="px-3 py-1 text-xs text-faint">{log.skipped} earlier steps aren't shown.</li>
              ) : null}
              {/* A running call pulses only while the agent is working right now; a step that just arrived fades in (CEL-107). */}
              {steps.map((step) => (
                <Step key={step.id} step={step} row={row} working={row.presence === "active"} arrived={log.arrived.includes(step.id)} />
              ))}
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

const KIND_LABEL = { user: "Prompt", message: "Said", thinking: "Thinking", system: "Note" } as const

/**
 * One step: a prompt or message as markdown (CEL-107: rendered like a comment, from the already masked
 * text), a tool call or thinking folded to one line, a note in grey. `arrived`: it came in live just
 * now, so it fades in once (`log-arrive`, index.css); a step updated in place, or shown on opening the
 * log, doesn't.
 */
function Step({ step, row, working, arrived }: { readonly step: LogStep; readonly row: AgentRow; readonly working: boolean; readonly arrived: boolean }) {
  const data = {
    "data-log-step": step.id,
    "data-log-kind": step.kind,
    "data-log-status": step.tool?.status ?? "",
    ...(arrived ? { "data-log-arrived": "" } : {}),
  }
  const fade = arrived ? "log-arrive" : ""
  const time = step.at === null ? undefined : new Date(step.at).toLocaleTimeString()
  if (step.kind === "tool" || step.kind === "agent" || step.kind === "thinking") {
    return (
      <li {...data} className={fade}>
        <Folded step={step} row={row} working={working} time={time} />
      </li>
    )
  }
  if (step.kind === "system") {
    return (
      <li {...data} title={time} className={`px-3 py-1 text-xs text-faint ${fade}`}>
        {step.text}
      </li>
    )
  }
  return (
    <li {...data} title={time} className={`grid grid-cols-[64px_1fr] gap-2 px-3 py-1.5 ${fade}`}>
      <span className="pt-0.5 text-xs font-medium text-muted">{KIND_LABEL[step.kind]}</span>
      <div className="min-w-0 break-words" data-log-text>
        <Markdown source={step.text} />
      </div>
    </li>
  )
}

/** A tool call, a launch or a thought: one line, opened by a click to its result or its words. */
function Folded({ step, row, working, time }: { readonly step: LogStep; readonly row: AgentRow; readonly working: boolean; readonly time: string | undefined }) {
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  const tool = step.tool
  const body = tool ? tool.output : step.text
  const preview = previewOf(body, LOG_DEFAULTS.resultPreviewLines)
  const shown = all ? body : preview.text
  const label = step.kind === "thinking" ? `Thinking · ${step.text.split("\n")[0]}` : step.text
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        data-log-toggle
        title={time}
        onClick={() => setOpen(!open)}
        className="grid grid-cols-[16px_16px_1fr_auto] items-center gap-1.5 px-3 py-1 text-left text-[13px] outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ChevronRightIcon aria-hidden className={`size-3.5 text-faint transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-90" : ""}`} />
        <StatusMark step={step} working={working} />
        <span className={`truncate ${step.kind === "thinking" ? "text-muted italic" : "font-mono text-[12px] text-ink"}`}>{label}</span>
        <span className="text-xs text-faint tabular-nums">{tool ? durationWords(tool.durationMs) : ""}</span>
      </button>
      {open ? (
        <div data-log-output className="mx-3 mb-1.5 ml-[46px] flex flex-col gap-1">
          {step.kind === "agent" && step.agentId ? (
            <Link
              to="/agents"
              search={{ open: `agent:${row.session.id}/${step.agentId}` }}
              className="w-fit rounded-sm text-xs font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              Open this subagent
            </Link>
          ) : null}
          {shown && step.kind === "thinking" ? (
            <p className="rounded-md border border-line bg-raised px-2.5 py-2 text-[13px] whitespace-pre-wrap break-words text-muted">{shown}</p>
          ) : shown ? (
            <pre className="max-h-96 overflow-auto rounded-md border border-line bg-raised px-2.5 py-2 font-mono text-[12px] whitespace-pre-wrap break-words text-ink">
              {shown}
            </pre>
          ) : (
            <p className="text-xs text-faint">{tool?.status === "running" ? "No result yet." : "No output."}</p>
          )}
          {!all && preview.more > 0 ? (
            <span>
              <Button variant="more" size="sm" onClick={() => setAll(true)} data-log-show-all>
                Show all {preview.more + LOG_DEFAULTS.resultPreviewLines} lines
              </Button>
            </span>
          ) : null}
          {(all || preview.more === 0) && tool?.cut ? (
            <p className="text-xs text-faint">Cut at {body.split("\n").length} of {tool.lines} lines; the rest is in the transcript.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** ✓ or ✗ for a finished call; a dot for one still running (it pulses only while the agent works). */
function StatusMark({ step, working }: { readonly step: LogStep; readonly working: boolean }) {
  const status = step.tool?.status
  if (status === "ok") return <CheckIcon aria-label="Succeeded" className="size-3.5 text-answered" />
  if (status === "error") return <XIcon aria-label="Failed" className="size-3.5 text-danger" />
  if (status === "running") {
    return (
      <span aria-label="Running" className="flex size-3.5 items-center justify-center">
        <i className={`size-1.5 rounded-full bg-accent ${working ? "animate-pulse" : ""}`} />
      </span>
    )
  }
  return <span aria-hidden className="size-3.5" />
}
