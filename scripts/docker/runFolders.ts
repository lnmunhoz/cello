// One results folder per Docker test run, test-results/docker/<time>-<label>-<pid>/, so two runs at
// once (two agents, two worktrees' worth of habits) never empty or overwrite each other's videos.
// test-results/docker/latest points at the newest run; the newest few finished runs of each label
// (the mode, or CELLO_TEST_LABEL) are kept, so quick reruns of one spec never push out a full run's
// evidence, and a running one is never removed. Follows focus-extension's scripts/run-folders.mjs.
import { mkdir, readdir, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises"
import * as path from "node:path"
import { isAlive } from "../../apps/server/src/process/isAlive.ts"

export const KEEP_RUNS = 5
/** `<time>-<label>-<pid>`: the label is everything between the time and the pid. */
const RUN_NAME = /^\d{4}-\d{2}-\d{2}_\d{6}-(.+)-\d+$/
/** A run that started this long ago is finished even if its pid is alive again (reused). */
const LONGEST_RUN_MS = 3 * 60 * 60 * 1000
const RUNNING = ".running"

/** The run's folder name: local time first, so names sort by start, then a label (the mode) and the pid. */
export const runName = (label: string, date = new Date(), pid = process.pid): string => {
  const pad = (value: number) => String(value).padStart(2, "0")
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  const safe = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "run"
  return `${stamp}-${safe}-${pid}`
}

/** The runs to delete: all but the newest `keep` run folders of each label, never one still running. */
export const runsToPrune = (names: ReadonlyArray<string>, running: ReadonlySet<string>, keep = KEEP_RUNS): string[] => {
  const seen = new Map<string, number>()
  return names
    .filter((name) => RUN_NAME.test(name))
    .sort()
    .reverse()
    .filter((name) => {
      const label = name.match(RUN_NAME)![1]!
      seen.set(label, (seen.get(label) ?? 0) + 1)
      return seen.get(label)! > keep && !running.has(name)
    })
}

const isRunning = async (folder: string) => {
  const marker = path.join(folder, RUNNING)
  const [text, info] = await Promise.all([readFile(marker, "utf8").catch(() => ""), stat(marker).catch(() => null)])
  const pid = Number.parseInt(text, 10)
  return Boolean(pid && info && Date.now() - info.mtimeMs < LONGEST_RUN_MS && isAlive(pid))
}

/** Makes this run's folder under `base`, points `latest` at it and removes old finished runs. Returns the folder. */
export const startRun = async (base: string, label: string): Promise<string> => {
  await mkdir(base, { recursive: true })
  const name = runName(label)
  const folder = path.join(base, name)
  await mkdir(folder)
  await writeFile(path.join(folder, RUNNING), `${process.pid}\n`)
  // A new link renamed over the old one, so `latest` is never missing for a reader.
  const link = path.join(base, `.latest-${process.pid}`)
  await rm(link, { force: true })
  await symlink(name, link)
  await rename(link, path.join(base, "latest"))
  const names = await readdir(base)
  const running = new Set([name])
  for (const other of names.filter((entry) => RUN_NAME.test(entry) && entry !== name)) {
    if (await isRunning(path.join(base, other))) running.add(other)
  }
  await Promise.all(runsToPrune(names, running).map((old) => rm(path.join(base, old), { recursive: true, force: true })))
  return folder
}

/** Marks the run finished, so a later run may remove its folder once it's no longer among the newest. */
export const finishRun = (folder: string): Promise<void> => rm(path.join(folder, RUNNING), { force: true })
