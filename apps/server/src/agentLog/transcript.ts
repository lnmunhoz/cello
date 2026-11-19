// Claude Code's transcripts as log steps (CEL-106). A transcript is JSON lines, one per event: the
// session's transcript (`~/.claude/projects/<repo>/<session>.jsonl`), a subagent's (`<session>/subagents/
// agent-<id>.jsonl`), or a woken run's log (CEL-92: the CLI's stream-json, wrapped in `cello.*` lines).
// The shapes, as read from Claude Code 2.x transcripts (Nov 2026):
//
//   { type: "user", message: { content: "<prompt>" | [{ type: "tool_result", tool_use_id, content, is_error }, { type: "text" }…] },
//     isMeta?, toolUseResult?: { agentId… } | string, uuid, timestamp }
//   { type: "assistant", message: { id, content: [{ type: "text" | "thinking" | "tool_use", id?, name?, input? }] }, uuid, timestamp }
//   anything else (attachment, permission-mode, ai-title, system, result, api-request…): not a step
//
// A user line with `isMeta` is context Claude Code added (reminders, skills), never what anyone typed.
// The parser is pure and keeps the open tool calls, so a result found later updates its call.
import type { LogStep, ToolCall } from "@cello/contract/agentLog"
import { MAX_COMMAND_CHARS, MAX_OUTPUT_CHARS, MAX_OUTPUT_LINES } from "@cello/contract/agentLog"
import { redact } from "@cello/text/redact"
import { stepLine, toolCommand } from "@cello/text/toolSummary"
import { isRecord } from "@cello/domain/record"

type Json = Readonly<Record<string, unknown>>


const str = (value: unknown): string => (typeof value === "string" ? value : "")

/** The Agent tool's names: `Agent`, and `Task` before Claude Code renamed it. */
const AGENT_TOOLS = new Set(["Agent", "Task"])

/** A tool result as the stream carries it: at most MAX_OUTPUT_LINES lines and MAX_OUTPUT_CHARS characters, every line counted. */
export const capOutput = (text: string): Pick<ToolCall, "output" | "lines" | "cut"> => {
  if (text === "") return { output: "", lines: 0, cut: false }
  const all = text.split("\n")
  let output = all.slice(0, MAX_OUTPUT_LINES).join("\n")
  let cut = all.length > MAX_OUTPUT_LINES
  if (output.length > MAX_OUTPUT_CHARS) {
    output = output.slice(0, MAX_OUTPUT_CHARS)
    cut = true
  }
  return { output, lines: all.length, cut }
}

/** A tool result's text: a string, or its text blocks joined (an image says so). */
const resultText = (content: unknown): string => {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((block) => (isRecord(block) ? (block.type === "text" ? str(block.text) : block.type === "image" ? "[image]" : "") : ""))
    .filter((t) => t !== "")
    .join("\n")
}

const tag = (text: string, name: string): string | null => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1]?.trim() ?? null

/**
 * A prompt as a step: what someone typed, a slash command ("/review CLO-7"), or Claude Code's word that a
 * background task finished (a `system` step). Reminders inside it go; a prompt that was only those is none.
 */
const promptStep = (raw: string): { kind: "user" | "system"; text: string } | null => {
  if (raw.includes("<task-notification>")) {
    return { kind: "system", text: tag(raw, "summary") ?? `A background task ${tag(raw, "status") ?? "finished"}` }
  }
  const command = tag(raw, "command-name")
  if (command !== null) return { kind: "user", text: [command, tag(raw, "command-args")].filter(Boolean).join(" ") }
  // A slash command's output (`/model`, `/cost`): a note, not a prompt.
  const output = tag(raw, "local-command-stdout")
  if (output !== null) return output ? { kind: "system", text: output } : null
  const text = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim()
  // Claude Code's own marker when the human pressed Esc, not words anyone typed.
  if (/^\[Request interrupted by user[^\]]*\]$/.test(text)) return null
  return text ? { kind: "user", text } : null
}

const timeOf = (line: Json): number | null => {
  const ms = Date.parse(str(line.timestamp))
  return Number.isFinite(ms) ? ms : null
}

export interface TranscriptParser {
  /** One line of the file: the steps it adds, and the steps it changes (a call whose result it holds), each whole. */
  readonly push: (line: string) => ReadonlyArray<LogStep>
  /**
   * How many thoughts so far Claude Code wrote without their words (CEL-170): a thinking block with only a
   * signature, or a redacted one. It saves them empty unless its `showThinkingSummaries` setting is on.
   */
  readonly unsavedThinking: () => number
}

export const transcriptParser = (): TranscriptParser => {
  /** Tool calls by their id, kept to pair with their results. */
  const calls = new Map<string, LogStep>()
  /** For lines without a uuid (a run's stream): a counter. */
  let n = 0
  let unsaved = 0

  const assistant = (line: Json, message: Json): LogStep[] => {
    const content = Array.isArray(message.content) ? message.content : []
    const base = str(line.uuid) || `${str(message.id) || "m"}-${n++}`
    const at = timeOf(line)
    // The line's last words before the agent waits (CEL-170); every other line says `tool_use`.
    const endsTurn = message.stop_reason === "end_turn"
    const steps: LogStep[] = []
    content.forEach((block, i) => {
      if (!isRecord(block)) return
      const id = `${base}:${i}`
      if (block.type === "text" && str(block.text).trim()) {
        steps.push({ id, kind: "message", at, text: str(block.text).trim(), ...(endsTurn ? { endsTurn: true } : {}) })
      } else if (block.type === "thinking") {
        if (str(block.thinking).trim()) steps.push({ id, kind: "thinking", at, text: str(block.thinking).trim() })
        else unsaved++
      } else if (block.type === "redacted_thinking") unsaved++
      else if (block.type === "tool_use") {
        const name = str(block.name) || "Tool"
        const input = isRecord(block.input) ? block.input : null
        const command = toolCommand(name, input)
        const launch = AGENT_TOOLS.has(name)
        const step: LogStep = {
          id: str(block.id) || id,
          kind: launch ? "agent" : "tool",
          at,
          text: stepLine(name, input),
          tool: { name, status: "running", durationMs: null, output: "", lines: 0, cut: false, ...(command === null ? {} : { command }) },
          ...(launch ? { agentId: null } : {}),
        }
        calls.set(step.id, step)
        steps.push(step)
      }
    })
    return steps
  }

  const user = (line: Json, message: Json): LogStep[] => {
    if (line.isMeta === true) return []
    const at = timeOf(line)
    const base = str(line.uuid) || `u-${n++}`
    if (typeof message.content === "string") {
      const prompt = promptStep(message.content)
      return prompt ? [{ id: base, at, ...prompt }] : []
    }
    if (!Array.isArray(message.content)) return []
    const steps: LogStep[] = []
    const texts: string[] = []
    for (const block of message.content) {
      if (!isRecord(block)) continue
      if (block.type === "text") texts.push(str(block.text))
      if (block.type !== "tool_result") continue
      const call = calls.get(str(block.tool_use_id))
      if (!call?.tool) continue
      const launched = isRecord(line.toolUseResult) ? str(line.toolUseResult.agentId) : ""
      const done: LogStep = {
        ...call,
        tool: {
          ...call.tool,
          status: block.is_error === true ? "error" : "ok",
          durationMs: at !== null && call.at !== null ? Math.max(0, at - call.at) : null,
          ...capOutput(resultText(block.content)),
        },
        ...(call.kind === "agent" ? { agentId: launched || null } : {}),
      }
      calls.delete(call.id)
      steps.push(done)
    }
    const prompt = promptStep(texts.join("\n"))
    if (prompt) steps.push({ id: base, at, ...prompt })
    return steps
  }

  /** The lines a woken run's log adds around the CLI's own (SessionHost). */
  const cello = (line: Json): LogStep[] => {
    const id = `cello-${n++}`
    if (line.type === "cello.run") {
      const why = isRecord(line.run) ? str(line.run.why) : ""
      return [{ id, kind: "system", at: null, text: `Cello woke this session${why ? ` (${why})` : ""}: ${str(line.prompt).trim()}` }]
    }
    if (line.type === "cello.stderr" && str(line.text).trim()) return [{ id, kind: "system", at: null, text: str(line.text).trim() }]
    if (line.type === "cello.ended") {
      const error = str(line.error)
      return [{ id, kind: "system", at: null, text: `The run ended: ${str(line.outcome) || "unknown"}${error ? ` (${error})` : ""}` }]
    }
    return []
  }

  return {
    push: (raw) => {
      if (raw.trim() === "") return []
      let line: unknown
      try {
        line = JSON.parse(raw)
      } catch {
        return []
      }
      if (!isRecord(line)) return []
      if (typeof line.type === "string" && line.type.startsWith("cello.")) return cello(line)
      const message = isRecord(line.message) ? line.message : null
      if (message === null) return []
      if (line.type === "assistant") return assistant(line, message)
      if (line.type === "user") return user(line, message)
      return []
    },
    unsavedThinking: () => unsaved,
  }
}

/** A command as the stream carries it: at most MAX_COMMAND_CHARS characters, "…" last when cut. */
const capCommand = (command: string): string => (command.length > MAX_COMMAND_CHARS ? `${command.slice(0, MAX_COMMAND_CHARS - 1)}…` : command)

/**
 * A step as it leaves the server: keys and tokens in its text, command and output masked, and `masked` set
 * when anything was, unless `reveal` (the human asked to see them). A command is cut either way, after the
 * masking, so a key cut in half can't slip through.
 */
export const redactStep = (step: LogStep, reveal: boolean): LogStep => {
  const tool = step.tool
  const command = tool?.command === undefined ? null : reveal ? { text: tool.command, masked: false } : redact(tool.command)
  const capped = command === null ? null : capCommand(command.text)
  const withCommand = (base: LogStep): LogStep => (capped === null || !base.tool ? base : { ...base, tool: { ...base.tool, command: capped } })
  if (reveal) return withCommand(step)
  const text = redact(step.text)
  const output = tool ? redact(tool.output) : null
  if (!text.masked && !output?.masked && !command?.masked) return withCommand(step)
  return withCommand({
    ...step,
    text: text.text,
    ...(tool && output ? { tool: { ...tool, output: output.text } } : {}),
    masked: true,
  })
}
