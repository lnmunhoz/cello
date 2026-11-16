// The runner keeps progress.json current and reports it to the board (CEL-134): at once for a new
// failure and at the end, else at most every REPORT_EVERY_MS; with nobody to report to, only the file.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { progressReporter, REPORT_EVERY_MS, type ReporterDeps, writeAtomically } from "./reporter.ts"

/** A clock and a timer queue the test moves by hand, the files written, and the reports made. */
const harness = (reporting = true) => {
  let now = 0
  const timers: Array<{ at: number; run: () => void }> = []
  const files = new Map<string, string>()
  const reports: Array<{ at: number; passed: number; failed: number; done: boolean }> = []
  const finishReport: Array<() => void> = []
  const deps: ReporterDeps = {
    now: () => now,
    write: (file, text) => void files.set(file, text),
    report: reporting
      ? (file) => {
        const p = JSON.parse(files.get(file)!)
        reports.push({ at: now, passed: p.passed, failed: p.failed, done: p.done })
        return new Promise<void>((resolve) => finishReport.push(resolve))
      }
      : null,
    schedule: (run, ms) => void timers.push({ at: now + ms, run }),
  }
  return {
    deps,
    files,
    reports,
    /** The report in flight exits. */
    exit: async () => {
      finishReport.shift()?.()
      await Promise.resolve()
      await Promise.resolve()
    },
    advance: (ms: number) => {
      now += ms
      for (const t of timers.filter((t) => t.at <= now)) {
        timers.splice(timers.indexOf(t), 1)
        t.run()
      }
    },
  }
}

const pass = (n: number) => `  ✓   ${n} e2e/a.spec.ts:${n}:1 › test ${n} (1s)`
const fail = (n: number) => `  ✘   ${n} e2e/a.spec.ts:${n}:1 › test ${n} (1s)`

describe("writeAtomically", () => {
  it("writes the file whole, and replaces a link at its name instead of writing through it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cel134-write-"))
    try {
      const file = path.join(dir, "progress.json")
      writeAtomically(file, "{\"a\":1}\n")
      expect(fs.readFileSync(file, "utf8")).toBe("{\"a\":1}\n")
      const elsewhere = path.join(dir, "elsewhere.txt")
      fs.writeFileSync(elsewhere, "keep me")
      fs.rmSync(file)
      fs.symlinkSync(elsewhere, file)
      writeAtomically(file, "{\"a\":2}\n")
      expect(fs.lstatSync(file).isSymbolicLink()).toBe(false)
      expect(fs.readFileSync(file, "utf8")).toBe("{\"a\":2}\n")
      expect(fs.readFileSync(elsewhere, "utf8")).toBe("keep me")
      expect(fs.readdirSync(dir).sort()).toEqual(["elsewhere.txt", "progress.json"])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("progressReporter", () => {
  it("writes progress.json in the run folder on every change", () => {
    const h = harness(false)
    const reporter = progressReporter("/repo/test-results/docker/run-1", h.deps)
    reporter.line("== web-e2e")
    reporter.line("noise that changes nothing")
    reporter.line(pass(1))
    expect(JSON.parse(h.files.get("/repo/test-results/docker/run-1/progress.json")!)).toMatchObject({ stage: "web-e2e", passed: 1, done: false })
    expect(h.reports).toEqual([])
  })

  it("reports the first change, then at most every REPORT_EVERY_MS (the latest, once), but a new failure at once; never two at a time", async () => {
    const h = harness()
    const reporter = progressReporter("/run", h.deps)
    reporter.line("== web-e2e")
    expect(h.reports).toEqual([{ at: 0, passed: 0, failed: 0, done: false }])
    await h.exit()
    h.advance(1000)
    reporter.line(pass(1))
    h.advance(500)
    reporter.line(pass(2))
    expect(h.reports).toHaveLength(1)
    h.advance(REPORT_EVERY_MS - 1500)
    expect(h.reports.at(-1)).toEqual({ at: REPORT_EVERY_MS, passed: 2, failed: 0, done: false })
    await h.exit()

    reporter.line(fail(3))
    expect(h.reports.at(-1)).toMatchObject({ failed: 1 })
    // Another failure while that report runs waits for it, then goes.
    reporter.line(fail(4))
    expect(h.reports).toHaveLength(3)
    await h.exit()
    expect(h.reports.at(-1)).toMatchObject({ failed: 2 })
  })

  it("finish: the last progress, done, written and reported", async () => {
    const h = harness()
    const reporter = progressReporter("/run", h.deps)
    reporter.line("== web-e2e")
    await h.exit()
    const finished = reporter.finish({ exit: 1, signalled: false })
    expect(h.reports.at(-1)).toMatchObject({ done: true })
    expect(JSON.parse(h.files.get("/run/progress.json")!)).toMatchObject({ done: true, outcome: "failed" })
    await h.exit()
    await finished
  })

  it("finish doesn't wait past LAST_REPORT_MS for a report that hangs", async () => {
    const h = harness()
    const reporter = progressReporter("/run", h.deps)
    const finished = reporter.finish({ exit: 0, signalled: false })
    h.advance(5000)
    await finished
    expect(reporter.progress).toMatchObject({ done: true, outcome: "passed" })
  })
})
