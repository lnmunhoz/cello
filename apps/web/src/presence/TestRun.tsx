// An agent running tests (CEL-134), on screen: the Agents page row's line ("Running tests · web e2e 7 of
// 13 · 1 failed · 3m12s", with a bar), the card's and task panel's stage line ("e2e 7/13"), and the open
// row's facts (each failure as it happened, the run's folder). The words are @cello/shared/testRun. The
// bar's width moves only when a report arrives, and the flask pulses only while the run runs.
import type { AgentSession, SessionAgent, TestRun } from "@cello/contract/entities"
import { isRunning, testRunShort, testRunWords } from "@cello/shared/testRun"
import { FlaskConicalIcon } from "lucide-react"
import { useNow } from "./useNow.ts"

/** The run of a session, or of its subagent. */
export const testRunOf = (session: AgentSession | null, agent: SessionAgent | null): TestRun | null =>
  (agent ? agent.tests : session?.tests) ?? null

/** Everything a run's hover says: where it is, then each failure on its own line. */
const runTitle = (run: TestRun, now: number) =>
  [testRunWords(run, now), ...(run.progress?.failures ?? []).map((f) => `✘ ${f}`)].join("\n")

/** How far a running run is, 0 to 1; null without a total. */
const fraction = (run: TestRun): number | null => {
  const p = run.progress
  if (!p || p.total === null || p.total === 0) return null
  return Math.min(1, (p.passed + p.failed + p.skipped) / p.total)
}

/** The Agents page row's line while the run runs: "Running tests · web e2e 7 of 13 · 1 failed · 3m12s", and a bar. */
export function TestRunLine({ run }: { run: TestRun }) {
  const now = useNow()
  if (!isRunning(run, now)) return null
  const done = fraction(run)
  return (
    <>
      <span className="text-faint">·</span>
      <span className="flex min-w-0 items-center gap-1.5 text-ink" data-agent-tests title={runTitle(run, now)}>
        <FlaskConicalIcon aria-hidden className="size-3 shrink-0 text-accent motion-safe:animate-pulse" />
        <span className="shrink-0 font-medium">Running tests</span>
        <span className="min-w-0 truncate text-muted tabular-nums">
          {testRunWords(run, now, { failed: false })}
        </span>
        {run.progress && run.progress.failed > 0 ? (
          <span className="shrink-0 font-medium text-danger tabular-nums" data-tests-failed>{run.progress.failed} failed</span>
        ) : null}
        {done === null ? null : (
          <span aria-hidden className="h-1 w-14 shrink-0 overflow-hidden rounded-full bg-line">
            <span
              className={`block h-full rounded-full transition-[width] duration-500 ${run.progress && run.progress.failed > 0 ? "bg-danger" : "bg-accent"}`}
              style={{ width: `${Math.round(done * 100)}%` }}
            />
          </span>
        )}
      </span>
    </>
  )
}

/**
 * The task panel's stage line while the run runs: "· running web e2e 7/13 · 1 failed", its failures in red.
 * `compact`, for a card's narrow stage line: the flask and "7/13 · 1 failed"; the hover has the rest.
 */
export function TestRunWord({ run, compact = false }: { run: TestRun | null; compact?: boolean }) {
  const now = useNow()
  if (run === null || !isRunning(run, now)) return null
  const failed = run.progress?.failed ?? 0
  const p = run.progress
  const where = compact ? (p === null ? "tests" : p.total === null ? `${p.passed + p.failed} done` : `${p.passed + p.failed}/${p.total}`) : `running ${testRunShort(run)}`
  return (
    <span className="flex shrink-0 items-center gap-1 text-muted tabular-nums" data-tests-word title={runTitle(run, now)}>
      <span className="text-faint">·</span>
      <FlaskConicalIcon aria-hidden className="size-3 text-accent" />
      {where}
      {failed > 0 ? <span className="font-medium text-danger">· {failed} failed</span> : null}
    </span>
  )
}

/** The open row's Tests fact: the run in words, each failure, and where its results are once it's done. */
export function TestRunFacts({ run }: { run: TestRun }) {
  const now = useNow()
  const failures = run.progress?.failures ?? []
  const folder = run.progress?.folder
  return (
    <dd className="flex min-w-0 flex-col gap-1 text-ink" data-agent-tests-facts>
      <span className="tabular-nums" data-outcome={run.endedAt === null ? "running" : run.outcome}>
        {isRunning(run, now) ? "Running: " : run.endedAt === null ? "" : "Last run: "}
        {testRunWords(run, now)}
      </span>
      {failures.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-[12px]" aria-label="Failed tests">
          {failures.map((f) => (
            <li key={f} className="truncate font-mono text-danger" title={f}>✘ {f}</li>
          ))}
        </ul>
      ) : null}
      {folder && run.endedAt !== null ? (
        <span className="font-mono text-[12px] break-all text-muted" title={`${folder}/summary.txt`} data-tests-folder>
          {folder.split("/").slice(-3).join("/")}/summary.txt
        </span>
      ) : null}
      <span className="truncate font-mono text-[12px] text-faint" title={run.command}>{run.command}</span>
    </dd>
  )
}
