import { durationWords, previewOf } from "@cello/client/sync/agentLog"
import { type LogStep, LOG_DEFAULTS } from "@cello/contract/agentLog"
import { Link } from "@tanstack/react-router"
import { CheckIcon, ChevronRightIcon, XIcon } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { Button } from "../components/ui/Button.tsx"
import { Markdown } from "../components/ui/Markdown.tsx"
import type { AgentRow } from "./layout.ts"

const KIND_LABEL = { user: "Prompt", message: "Said", thinking: "Thinking", system: "Note" } as const

/**
 * Whether a row fades in (CEL-107): it came in live just now, decided when the row first mounts, so a row
 * updated in place, shown on opening the log, or shown again after a view or the Thinking switch (`shown`
 * remembers the key of everything this log has put on screen) doesn't.
 */
export function useFades(key: string, arrived: boolean, shown: Set<string>): boolean {
  const [fades] = useState(() => arrived && !shown.has(key))
  useEffect(() => {
    shown.add(key)
  }, [shown, key])
  return fades
}

/**
 * One step: a prompt or message as markdown (CEL-107: rendered like a comment, from the already masked
 * text), a tool call or thinking folded to one line, a note in grey. `arrived`: it came in live just
 * now, so it fades in once (`log-arrive`, index.css). `live`: a call still running in the Story view
 * (CEL-170), marked for the specs.
 */
export function Step({
  step,
  row,
  working,
  arrived,
  shown,
  opened,
  live = false,
}: {
  readonly step: LogStep
  readonly row: AgentRow
  readonly working: boolean
  readonly arrived: boolean
  readonly shown: Set<string>
  /** The ids of the calls the human opened, so one that is remounted (it joined a group) stays open. */
  readonly opened: Set<string>
  readonly live?: boolean
}) {
  const fades = useFades(step.id, arrived, shown)
  const data = {
    "data-log-step": step.id,
    "data-log-kind": step.kind,
    "data-log-status": step.tool?.status ?? "",
    ...(live ? { "data-log-live": "" } : {}),
    ...(fades ? { "data-log-arrived": "" } : {}),
  }
  const fade = fades ? "log-arrive" : ""
  const time = step.at === null ? undefined : new Date(step.at).toLocaleTimeString()
  if (step.kind === "tool" || step.kind === "agent" || step.kind === "thinking") {
    return (
      <li {...data} className={fade}>
        <Folded step={step} row={row} working={working} time={time} opened={opened} />
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
        <Markdown source={step.text} images="text" />
      </div>
    </li>
  )
}

/** A row that opens: its chevron, a mark (✓, ✗, a dot, or nothing), what it says and, at the right, how long it took. */
export function ToggleRow({
  open,
  onToggle,
  mark,
  label,
  after,
  title,
}: {
  readonly open: boolean
  readonly onToggle: () => void
  readonly mark: ReactNode
  readonly label: ReactNode
  readonly after: string
  readonly title?: string | undefined
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      data-log-toggle
      title={title}
      onClick={onToggle}
      className="grid grid-cols-[16px_16px_1fr_auto] items-center gap-1.5 px-3 py-1 text-left text-[13px] outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <ChevronRightIcon aria-hidden className={`size-3.5 text-faint transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-90" : ""}`} />
      {mark}
      {label}
      <span className="text-xs text-faint tabular-nums">{after}</span>
    </button>
  )
}

/** A tool call, a launch or a thought: one line, opened by a click to its command and result, or its words. */
export function Folded({
  step,
  row,
  working,
  time,
  opened,
}: {
  readonly step: LogStep
  readonly row: AgentRow
  readonly working: boolean
  readonly time: string | undefined
  readonly opened: Set<string>
}) {
  const [open, setOpen] = useState(() => opened.has(step.id))
  const [all, setAll] = useState(false)
  const tool = step.tool
  const body = tool ? tool.output : step.text
  const preview = previewOf(body, LOG_DEFAULTS.resultPreviewLines)
  const shown = all ? body : preview.text
  const label = step.kind === "thinking" ? `Thinking · ${step.text.split("\n")[0]}` : step.text
  return (
    <div className="flex flex-col">
      <ToggleRow
        open={open}
        onToggle={() => {
          if (open) opened.delete(step.id)
          else opened.add(step.id)
          setOpen(!open)
        }}
        title={time}
        mark={<StatusMark step={step} working={working} />}
        label={<span className={`truncate ${step.kind === "thinking" ? "text-muted italic" : "font-mono text-[12px] text-ink"}`}>{label}</span>}
        after={tool ? durationWords(tool.durationMs) : ""}
      />
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
          {tool?.command ? (
            <pre data-log-command className="max-h-40 overflow-auto rounded-md border border-line bg-raised px-2.5 py-2 font-mono text-[12px] whitespace-pre-wrap break-words text-muted">
              $ {tool.command}
            </pre>
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
export function StatusMark({ step, working }: { readonly step: LogStep; readonly working: boolean }) {
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
