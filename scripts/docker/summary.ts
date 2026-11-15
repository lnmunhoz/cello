// summary.txt for a Docker test run: what ran, what passed, how long it took, and where the videos
// and screenshots are. Built on the Mac from what the container left in the run's folder: steps.tsv
// (each step's exit code and seconds) and logs/<step>.log.
import { MODE_STEPS, type Mode } from "./container.ts"

export interface Step {
  readonly name: string
  readonly code: number
  readonly seconds: number
}

/** steps.tsv: one `name<TAB>exit code<TAB>seconds` line per step that ran. */
export const parseSteps = (tsv: string): Step[] =>
  tsv.split("\n").filter((line) => line.trim()).map((line) => {
    const [name = "", code = "1", seconds = "0"] = line.split("\t")
    return { name, code: Number(code), seconds: Number(seconds) }
  })

const ANSI = /\u001b\[[0-9;]*m/g
const PLAYWRIGHT_TOTAL = /^\s+(\d+ (?:failed|flaky|interrupted|skipped|did not run|passed))\b/

/** The totals a step's log ends with: Vitest's files and tests, or Playwright's counts. Empty when it has none. */
export const countsFrom = (log: string): string => {
  const lines = log.replace(ANSI, "").split("\n")
  const files = lines.map((line) => line.match(/^\s*Test Files\s+.*\((\d+)\)\s*$/)).find(Boolean)
  const tests = lines.map((line) => line.match(/^\s*Tests\s+(.*?)\s*\(\d+\)\s*$/)).find(Boolean)
  if (files && tests) return `${files[1]} files, ${tests[1]!.split(" | ").join(", ")}`
  return lines.map((line) => line.match(PLAYWRIGHT_TOTAL)?.[1]).filter(Boolean).join(", ")
}

export const duration = (seconds: number): string =>
  seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`

const stamp = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export interface SummaryInput {
  readonly mode: Mode
  readonly args: ReadonlyArray<string>
  readonly started: Date
  readonly seconds: number
  readonly image: string
  readonly repo: string
  /** The commit tested, e.g. "583cf28 with uncommitted changes". */
  readonly commit: string
  readonly limits: string
  /** The variables passed into the container (CELLO_E2E_SLOWMO…). */
  readonly env: Readonly<Record<string, string>>
  readonly steps: ReadonlyArray<Step>
  readonly logs: Readonly<Record<string, string>>
  /** Files copied out, by folder: { "desktop/videos": 4 }. */
  readonly files: Readonly<Record<string, number>>
}

export const summarize = (input: SummaryInput): string => {
  const rows = input.steps.map((step) =>
    `${step.code === 0 ? "PASS" : "FAIL"}  ${step.name.padEnd(13)}${duration(step.seconds).padEnd(9)}${countsFrom(input.logs[step.name] ?? "")}`.trimEnd())
  const failed = input.steps.filter((step) => step.code !== 0).map((step) => `${step.name} (logs/${step.name}.log)`)
  const missing = MODE_STEPS[input.mode].filter((name) => !input.steps.some((step) => step.name === name))
  const problems = [failed.join(", "), missing.length > 0 ? `didn't run: ${missing.join(", ")}` : ""].filter(Boolean)
  const files = Object.entries(input.files).map(([folder, count]) => `${folder}: ${count}`).join(", ")
  const env = Object.entries(input.env).map(([name, value]) => `${name}=${value}`).join(" ")
  return [
    `Cello tests in Docker: ${[input.mode, ...input.args].join(" ")}`,
    `Started ${stamp(input.started)}, took ${duration(input.seconds)}`,
    `Image ${input.image} (${input.limits})`,
    `Repo ${input.repo} at ${input.commit}`,
    ...(env ? [env] : []),
    "",
    ...rows,
    "",
    problems.length === 0 ? "PASSED" : `FAILED: ${problems.join("; ")}`,
    `Files: ${files || "none"}`,
    "",
  ].join("\n")
}
