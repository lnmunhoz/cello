// One line for a tool call (CEL-106): what the Agents page shows as an agent's current step, and each
// tool call in its log ("Bash · bun run test", "Edit · FacetPanel.tsx"). The hook makes the current step
// from PostToolUse's tool_name and tool_input; the server makes the log's lines from the transcript's
// tool_use blocks, which carry the same two.

import { redact } from "./redact.ts"

/** Longest target kept: a line in a list, not the whole command. */
export const MAX_TARGET = 80

const text = (value: unknown): string => (typeof value === "string" ? value : "")

/** One line, keys masked first (a key cut in half would no longer look like one), then cut. */
const oneLine = (value: string): string => {
  const line = redact(value.replace(/\s+/g, " ").trim()).text
  return line.length > MAX_TARGET ? `${line.slice(0, MAX_TARGET - 1)}…` : line
}

const fileName = (value: unknown): string => text(value).split("/").filter(Boolean).at(-1) ?? ""

const host = (value: unknown): string => {
  try {
    return new URL(text(value)).host
  } catch {
    return text(value)
  }
}

/** What a call works on: the command, the file's name, the pattern, the agent it launches; empty when nothing says. */
export const toolTarget = (name: string, input: Readonly<Record<string, unknown>> | null): string => {
  const i = input ?? {}
  switch (name) {
    // Claude writes a short description for each command ("Show working tree status"); it reads better than the command (CEL-170).
    case "Bash":
      return oneLine(text(i.description).trim() || text(i.command))
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "Read":
      return oneLine(fileName(i.file_path))
    case "NotebookEdit":
      return oneLine(fileName(i.notebook_path))
    case "Grep":
    case "Glob":
      return oneLine(text(i.pattern))
    case "Agent":
    case "Task": {
      const type = text(i.subagent_type)
      const description = text(i.description)
      return oneLine(type && description ? `${type}: ${description}` : type || description)
    }
    case "WebFetch":
      return oneLine(host(i.url))
    case "WebSearch":
      return oneLine(text(i.query))
    case "Skill":
      return oneLine(text(i.skill))
    // What a Monitor watches, in its own words (CEL-133): its command is a shell loop nobody reads.
    case "Monitor":
      return oneLine(text(i.description))
    default:
      return ""
  }
}

/** The command a Bash or Monitor call ran, as written: the line shows Claude's description of it (CEL-170), the opened call shows this. Null for other tools. */
export const toolCommand = (name: string, input: Readonly<Record<string, unknown>> | null): string | null => {
  if (name !== "Bash" && name !== "Monitor") return null
  return text(input?.command) || null
}

/** "Bash · Run the tests" (Claude's description; the command when it gave none), or the tool's name alone when it has no target. */
export const stepLine = (name: string, input: Readonly<Record<string, unknown>> | null): string => {
  const target = toolTarget(name, input)
  return target ? `${name} · ${target}` : name
}
