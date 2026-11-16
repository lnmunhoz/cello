// The transcript parser (CEL-106) over invented transcripts in Claude Code's JSONL shape (fixtures/):
// session.jsonl is a session's transcript, run.jsonl a woken run's log (CEL-92's stream-json).
import * as fs from "node:fs"
import * as path from "node:path"
import type { LogStep } from "@cello/contract/agentLog"
import { MAX_OUTPUT_LINES } from "@cello/contract/agentLog"
import { describe, expect, it } from "vitest"
import { capOutput, redactStep, transcriptParser } from "./transcript.ts"

const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8").split("\n")

/** Every line through one parser: the steps as they stand at the end, in order. */
const parseAll = (lines: ReadonlyArray<string>) => {
  const parser = transcriptParser()
  const steps = new Map<string, LogStep>()
  for (const line of lines) for (const step of parser.push(line)) steps.set(step.id, step)
  return [...steps.values()]
}

const at = (iso: string) => Date.parse(iso)

describe("transcriptParser", () => {
  it("turns a session's transcript into prompts, thinking, messages, tool calls with results and launches, leaving out what Claude Code injects", () => {
    const steps = parseAll(fixture("session.jsonl"))
    expect(steps.map((s) => [s.kind, s.text])).toEqual([
      ["user", "Build the pancake timer, CLO-7. Read AGENTS.md first."],
      ["thinking", "The timer needs a test first."],
      ["message", "Starting with a failing test for the timer."],
      ["tool", "Read · timer.ts"],
      ["tool", "Bash · bun run test"],
      ["agent", "Agent · cello-builder: CLO-7 build the timer"],
      ["system", 'Agent "CLO-7 build the timer" completed'],
      ["user", "/review CLO-7"],
      ["tool", "Edit · timer.ts"],
      // A slash command's output is a note; "[Request interrupted by user…]" isn't something anyone typed.
      ["system", "Set model to Opus"],
    ])
    const [prompt, , , read, bash, launch, , , edit] = steps
    expect(prompt!.at).toBe(at("2026-11-16T09:00:00.000Z"))
    expect(read!.tool).toEqual({ name: "Read", status: "ok", durationMs: 250, output: "1\texport const flipAfter = 90\n2\texport const servings = 4", lines: 2, cut: false })
    expect(bash!.tool).toMatchObject({ name: "Bash", status: "error", durationMs: 2500, lines: 3 })
    expect(launch!.agentId).toBe("a5f00d1e2c3b4a596")
    expect(launch!.tool).toMatchObject({ status: "ok", output: "Async agent launched successfully." })
    // Its result hasn't been written yet: running.
    expect(edit!.tool).toEqual({ name: "Edit", status: "running", durationMs: null, output: "", lines: 0, cut: false })
  })

  it("sends a tool call when it's made, and again under the same id when its result arrives", () => {
    const parser = transcriptParser()
    const lines = fixture("session.jsonl")
    const call = lines.findIndex((l) => l.includes('"id":"toolu_bash"'))
    for (const line of lines.slice(0, call)) parser.push(line)
    const [made] = parser.push(lines[call]!)
    expect(made).toMatchObject({ id: "toolu_bash", kind: "tool", tool: { status: "running" } })
    const [done] = parser.push(lines[call + 1]!)
    expect(done).toMatchObject({ id: "toolu_bash", tool: { status: "error", durationMs: 2500 } })
  })

  it("reads a woken run's stream-json: no timestamps, its start, its stderr and how it ended", () => {
    const steps = parseAll(fixture("run.jsonl"))
    expect(steps.map((s) => [s.kind, s.text, s.at])).toEqual([
      ["system", "Cello woke this session (comment): The human commented on CLO-7.", null],
      ["message", "Reading the comment now.", null],
      ["tool", "Bash · cello inbox", null],
      ["system", "warning: something on stderr", null],
      ["system", "The run ended: completed", null],
    ])
    expect(steps[2]!.tool).toMatchObject({ status: "ok", durationMs: null, output: "Nothing new." })
  })

  it("skips blank lines, broken JSON and lines it doesn't know", () => {
    expect(parseAll(["", "{not json", '{"type":"ai-title","title":"x"}', "[1,2]", "null"])).toEqual([])
  })
})

describe("capOutput", () => {
  it("keeps short output whole and cuts long output, counting every line", () => {
    expect(capOutput("a\nb")).toEqual({ output: "a\nb", lines: 2, cut: false })
    const long = Array.from({ length: MAX_OUTPUT_LINES + 50 }, (_, i) => `line ${i}`).join("\n")
    const capped = capOutput(long)
    expect(capped.lines).toBe(MAX_OUTPUT_LINES + 50)
    expect(capped.cut).toBe(true)
    expect(capped.output.split("\n")).toHaveLength(MAX_OUTPUT_LINES)
    expect(capOutput("")).toEqual({ output: "", lines: 0, cut: false })
  })
})

describe("redactStep", () => {
  it("masks keys in a step's text and output and marks it, unless the human asked to see them", () => {
    const bash = parseAll(fixture("session.jsonl")).find((s) => s.id === "toolu_bash")!
    const masked = redactStep(bash, false)
    expect(masked.masked).toBe(true)
    expect(masked.tool!.output).not.toContain("Zx9Yw8Vu7Ts6")
    expect(redactStep(bash, true)).toEqual(bash)
    const read = parseAll(fixture("session.jsonl")).find((s) => s.id === "toolu_read")!
    expect(redactStep(read, false)).toEqual(read)
  })
})
