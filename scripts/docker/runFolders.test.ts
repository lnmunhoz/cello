import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { finishRun, KEEP_RUNS, runName, runsToPrune, startRun } from "./runFolders.ts"

describe("runName", () => {
  it("starts with the local time so names sort by start, then a safe label and the pid", () => {
    expect(runName("desktop", new Date(2026, 10, 15, 9, 5, 7), 4242)).toBe("2026-11-15_090507-desktop-4242")
    expect(runName("CEL-29: Docker e2e!", new Date(2026, 0, 2, 13, 0, 0), 7)).toBe("2026-01-02_130000-cel-29-docker-e2e-7")
    expect(runName("", new Date(2026, 0, 2, 13, 0, 0), 7)).toBe("2026-01-02_130000-run-7")
  })
})

describe("runsToPrune", () => {
  const names = Array.from({ length: 8 }, (_, i) => `2026-11-15_0${i}0000-all-${100 + i}`)

  it("keeps the newest runs and removes the rest", () => {
    expect(runsToPrune(names, new Set(), 3)).toEqual(names.slice(0, 5).reverse())
  })

  it("never removes a run that's still going, or anything that isn't a run folder", () => {
    const running = new Set([names[0]!])
    expect(runsToPrune([...names, "latest", "notes.txt"], running, 3)).toEqual(names.slice(1, 5).reverse())
  })

  it("keeps a few runs by default", () => {
    expect(KEEP_RUNS).toBeGreaterThanOrEqual(3)
    expect(runsToPrune(names.slice(0, KEEP_RUNS), new Set())).toEqual([])
  })
})

describe("startRun and finishRun", () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })
  const base = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-run-folders-"))
    dirs.push(dir)
    return path.join(dir, "docker")
  }

  it("makes a fresh folder for the run, marked running, with latest pointing at it", async () => {
    const root = base()
    const folder = await startRun(root, "desktop")
    expect(path.dirname(folder)).toBe(root)
    expect(path.basename(folder)).toMatch(new RegExp(`^\\d{4}-\\d{2}-\\d{2}_\\d{6}-desktop-${process.pid}$`))
    expect(fs.readFileSync(path.join(folder, ".running"), "utf8").trim()).toBe(String(process.pid))
    expect(fs.readlinkSync(path.join(root, "latest"))).toBe(path.basename(folder))
    await finishRun(folder)
    expect(fs.existsSync(path.join(folder, ".running"))).toBe(false)
  })

  it("prunes old finished runs but keeps one another process is still running", async () => {
    const root = base()
    fs.mkdirSync(root, { recursive: true })
    const old = Array.from({ length: KEEP_RUNS + 2 }, (_, i) => `2020-01-01_00000${i}-all-${i + 1}`)
    for (const name of old) fs.mkdirSync(path.join(root, name))
    // The oldest is still running in this process (alive pid, fresh marker).
    fs.writeFileSync(path.join(root, old[0]!, ".running"), `${process.pid}\n`)
    const folder = await startRun(root, "e2e")
    const left = fs.readdirSync(root).filter((name) => name !== "latest").sort()
    expect(left).toContain(old[0])
    expect(left).toContain(path.basename(folder))
    expect(left).toHaveLength(KEEP_RUNS + 1)
    expect(left).not.toContain(old[1])
  })
})
