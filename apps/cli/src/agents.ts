// What `cello agents` and `cello agents log` print (CEL-107): the agents working (and, with --all, the
// ones that finished today), which one an id means, and an agent's log as plain text, the same steps the
// Agents page shows. Which agents count, and the log's words, are shared with the page
// (@cello/client/sync/agents, @cello/client/sync/agentLog).
import { doingNowOf, durationWords, previewOf, thinkingNote } from "@cello/client/sync/agentLog"
import type { FinishedAgent, WorkingSessionOf } from "@cello/client/sync/agents"
import type { LogStep, LogUpdate } from "@cello/contract/agentLog"
import type { AgentSession, SessionAgent, Task } from "@cello/contract/entities"
import { modelLabel } from "@cello/shared/model"
import { originText } from "@cello/shared/origin"
import { shortSession } from "@cello/shared/session"
import { presenceWords } from "@cello/shared/presence"
import { columns, plural, sessionName } from "./format.ts"

/** A subagent as --agent and `cello agents log` take it: "cello-builder/a13bfb89". */
export const agentId = (agent: Pick<SessionAgent, "agentId" | "agentType">): string => `${agent.agentType ?? "agent"}/${agent.agentId.slice(0, 8)}`

const sessionKey = (session: AgentSession) => session.externalId ?? session.id

// ── which agent an id means ─────────────────────────────────────────────────────────────────────

export type Found =
  | { readonly _tag: "found"; readonly session: AgentSession; readonly agent: SessionAgent | null }
  | { readonly _tag: "none" }
  /** More than one starts with it: their names, so a longer id can be given. */
  | { readonly _tag: "ambiguous"; readonly names: ReadonlyArray<string> }

/**
 * The agent `query` means: a session by the start of its host id (2fd0505c), or a subagent by the start
 * of its id (a13bfb89), with its type in front or not (cello-builder/a13bfb89, or as the board names it,
 * "cello-builder · a13bfb89"). An exact id wins over ids it starts.
 */
export const findAgent = (
  query: string,
  board: { readonly sessions: ReadonlyArray<AgentSession>; readonly agents: ReadonlyArray<SessionAgent> },
): Found => {
  const text = query.trim().replace(/\s*·\s*/, "/")
  if (text === "") return { _tag: "none" }
  const slash = text.indexOf("/")
  const type = slash === -1 ? null : text.slice(0, slash).toLowerCase()
  const id = slash === -1 ? text : text.slice(slash + 1)
  if (id === "") return { _tag: "none" }
  const agents = board.agents.filter((a) => a.agentId.startsWith(id) && (type === null || (a.agentType ?? "agent").toLowerCase() === type))
  const sessions = type === null ? board.sessions.filter((s) => sessionKey(s).startsWith(id) || s.id.startsWith(id)) : []
  const matches = [
    ...sessions.map((session) => ({ session, agent: null, exact: sessionKey(session) === id || session.id === id })),
    ...agents.flatMap((agent) => {
      const session = board.sessions.find((s) => s.id === agent.sessionId)
      return session ? [{ session, agent, exact: agent.agentId === id }] : []
    }),
  ]
  const exact = matches.filter((m) => m.exact)
  const pick = exact.length === 1 ? exact : matches
  if (pick.length === 0) return { _tag: "none" }
  if (pick.length === 1) return { _tag: "found", session: pick[0]!.session, agent: pick[0]!.agent }
  return { _tag: "ambiguous", names: pick.map((m) => (m.agent ? agentId(m.agent) : sessionName(m.session))) }
}

// ── `cello agents` ──────────────────────────────────────────────────────────────────────────────

const keys = (tasks: ReadonlyArray<Pick<Task, "key">>) => tasks.map((t) => t.key).join(", ")

/** " (Sonnet 5.5, medium)": the model an agent is on, when it's known (CEL-119). */
const model = (agent: Pick<SessionAgent, "model" | "effort">) => {
  const label = modelLabel(agent.model, agent.effort)
  return label ? ` (${label})` : ""
}

const LOG_HINT = "`cello agents log <id>` prints one's log: a session's short id (2fd0505c) or a subagent's (cello-builder/a13bfb89)."

/** "14:02", in local time. */
const clock = (ts: number) => {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

/**
 * The agents working (sessions, their subagents under them), each with its presence, its tasks and what
 * it's doing right now; then, with `all`, the ones that finished today, newest first, or else how many did.
 */
export const agentsText = (input: {
  readonly working: ReadonlyArray<WorkingSessionOf>
  readonly finished: ReadonlyArray<FinishedAgent>
  readonly all: boolean
  readonly now: number
}): string => {
  const working = input.working.filter((w) => w.presence !== "ended")
  const rows = working.flatMap((w) => [
    [
      `  ${sessionName(w.session, w.session)}`,
      w.agents.length > 0 ? "orchestrator" : "session",
      presenceWords(w.session, input.now),
      // Where it runs (CEL-137): "Terminal · WezTerm", "Woken by Cello".
      originText(w.session, input.now) ?? "",
      w.tasks.length > 0 ? `holds ${keys(w.tasks)}` : "",
      doingNowOf({ presence: w.presence, session: w.session, agent: null }, input.now) ?? "",
    ],
    ...w.agents.map((a) => [
      `    ${agentId(a.agent)}${model(a.agent)}`,
      "",
      presenceWords(a.agent, input.now),
      "",
      a.task ? `on ${a.task.key}` : "",
      doingNowOf({ presence: a.presence, session: w.session, agent: a.agent }, input.now) ?? "",
    ]),
  ])
  // An empty cell at the end would pad the line: drop trailing empties.
  const trimmed = rows.map((row) => {
    const cells = [...row]
    while (cells.length > 1 && cells.at(-1) === "") cells.pop()
    return cells
  })
  const lines = rows.length > 0 ? [`Agents working (${rows.length}):`, ...columns(trimmed)] : ["No agent is working."]
  if (input.finished.length > 0) {
    lines.push("")
    if (input.all) {
      lines.push(`Finished today (${input.finished.length}):`, ...columns(input.finished.map((f) => [
        `  ${f.agent ? `${agentId(f.agent)} under ${shortSession(sessionKey(f.session))}` : sessionName(f.session)}`,
        `finished ${clock(f.endedAt)}`,
        f.tasks.length === 0 ? "" : f.agent ? `on ${keys(f.tasks)}` : `holds ${keys(f.tasks)}`,
      ].filter((cell, i) => i < 2 || cell !== ""))))
    } else {
      lines.push(`${plural(input.finished.length, "agent")} finished today: \`cello agents --all\` lists them.`)
    }
  }
  if (rows.length > 0 || input.finished.length > 0) lines.push(LOG_HINT)
  return lines.join("\n")
}

// ── `cello agents log` ──────────────────────────────────────────────────────────────────────────

export interface LogTextOptions {
  /** Whole results instead of their first RESULT_LINES lines. */
  readonly full: boolean
  /** The agent's thinking too (hidden by default, like the Agents page's Thinking switch). */
  readonly thinking: boolean
}

/** How many lines of a result (or a thought) show under its call before --full. */
export const RESULT_LINES = 3

const TIME_WIDTH = 8
const INDENT = " ".repeat(TIME_WIDTH + 4)

/** "09:00:04", in local time; blank when the step has no time. */
const timeOf = (step: LogStep) => {
  if (step.at === null) return " ".repeat(TIME_WIDTH)
  const d = new Date(step.at)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":")
}

const LABEL = { user: "Prompt", message: "Said", system: "Note" } as const
const LABEL_WIDTH = 6

/** A result or a thought under its line: folded to its first lines, or whole with --full. */
const body = (text: string, options: LogTextOptions, cut: { readonly lines: number } | null): string[] => {
  if (text === "") return []
  const shown = options.full ? { text, more: 0 } : previewOf(text, RESULT_LINES)
  return [
    ...shown.text.split("\n").map((line) => `${INDENT}${line}`.trimEnd()),
    ...(shown.more > 0 ? [`${INDENT}… ${plural(shown.more, "more line")} (--full shows them)`] : []),
    ...(options.full && cut ? [`${INDENT}(cut at ${text.split("\n").length} of ${cut.lines} lines; the rest is in the transcript)`] : []),
  ]
}

/** A call's command under its line (--full): after its `$`, a multi-line one indented under it. */
const commandLines = (command: string): string[] => {
  const [first = "", ...rest] = command.split("\n")
  return [`${INDENT}$ ${first}`, ...rest.map((line) => `${INDENT}  ${line}`)].map((line) => line.trimEnd())
}

const MARK = { ok: "✓", error: "✗", running: "▸" } as const

/** One step as the terminal prints it: its time, then what it is; nothing for thinking without --thinking. */
export const stepLines = (step: LogStep, options: LogTextOptions): string[] => {
  const time = timeOf(step)
  if (step.kind === "thinking") return options.thinking ? [`${time}  Thinking`, ...body(step.text, options, null)] : []
  if (step.kind === "tool" || step.kind === "agent") {
    const tool = step.tool
    const status = tool?.status ?? "ok"
    const after = status === "running" ? "(running)" : durationWords(tool?.durationMs ?? null)
    const launched = step.kind === "agent" && step.agentId ? `→ ${step.agentId.slice(0, 8)}` : ""
    const line = [`${time}  ${MARK[status]} ${step.text}`, after, launched].filter((part) => part !== "").join("  ")
    if (!tool || status === "running") return [line]
    return [line, ...(options.full && tool.command ? commandLines(tool.command) : []), ...body(tool.output, options, tool.cut ? tool : null)]
  }
  const [first = "", ...rest] = step.text.split("\n")
  const pad = " ".repeat(TIME_WIDTH + 2 + LABEL_WIDTH + 2)
  return [`${time}  ${LABEL[step.kind].padEnd(LABEL_WIDTH)}  ${first}`.trimEnd(), ...rest.map((line) => `${pad}${line}`.trimEnd())]
}

/**
 * Prints a log as its updates arrive: each step once, a tool call again when its result comes (it was
 * printed running). A first batch sent again (after a reconnect) prints only what's new.
 */
export const logPrinter = (options: LogTextOptions) => {
  /** Each step printed, and the status it was printed with. */
  const printed = new Map<string, string>()
  let noted = false
  let sawThought = false
  let thinkingNoted = false
  return {
    steps: (update: Extract<LogUpdate, { _tag: "steps" }>): string[] => {
      const lines: string[] = []
      if (update.reset && !noted && (update.skipped > 0 || update.older)) {
        lines.push(update.older
          ? "(Earlier steps aren't shown: this log is long, so it starts near its end)"
          : `(${update.skipped} earlier ${update.skipped === 1 ? "step isn't" : "steps aren't"} shown)`)
      }
      if (update.reset) noted = true
      for (const step of update.steps) {
        const status = step.tool?.status ?? ""
        if (printed.get(step.id) === status) continue
        const shown = stepLines(step, options)
        if (shown.length === 0) continue
        printed.set(step.id, status)
        lines.push(...shown)
      }
      sawThought ||= update.steps.some((step) => step.kind === "thinking")
      // Once: Claude Code saved the thoughts without their words, so --thinking has nothing to print (CEL-170).
      const unsaved = sawThought ? null : thinkingNote({ unsavedThinking: update.unsavedThinking ?? 0, steps: [] })
      if (options.thinking && !thinkingNoted && unsaved !== null) {
        thinkingNoted = true
        lines.push(`(${unsaved})`)
      }
      return lines
    },
  }
}
