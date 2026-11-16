// `cello inbox --wait`'s side of the machine (CEL-74): the lock file that tells the Stop hook a waiter
// is running for a session. Reconnecting to a server that went away is tested in reconnect.test.ts.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import {
  acquireWaiter,
  MAX_WAIT_MS,
  maxWait,
  readWaiter,
  releaseWaiter,
  STALE_AFTER_MAX_MS,
  waiterLockDir,
  waiterLockFile,
} from "./inboxWait.ts"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-inbox-wait-test-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

/** A pid nobody has: a process that already exited. */
const deadPid = () => {
  const done = Bun.spawnSync(["true"])
  return done.pid
}

let n = 0
const fresh = () => waiterLockFile(dir, { port: "4747", session: `session-${++n}` })

describe("waiterLockFile", () => {
  it("lives under $TMPDIR/cello-inbox-wait, one file per server and session", () => {
    expect(waiterLockDir({ TMPDIR: "/tmp/t" })).toBe(path.join("/tmp/t", "cello-inbox-wait"))
    expect(waiterLockDir({})).toBe(path.join(os.tmpdir(), "cello-inbox-wait"))
    const a = waiterLockFile("/d", { port: "4747", session: "s1" })
    expect(path.dirname(a)).toBe("/d")
    expect(path.basename(a)).toMatch(/^[0-9a-f]{32}$/)
    expect(waiterLockFile("/d", { port: "4747", session: "s1" })).toBe(a)
    expect(waiterLockFile("/d", { port: "4748", session: "s1" })).not.toBe(a)
    expect(waiterLockFile("/d", { port: "4747", session: "s2" })).not.toBe(a)
  })
})

describe("the waiter lock", () => {
  it("acquired, it says a waiter runs with this pid; released, it's gone", () => {
    const file = fresh()
    expect(readWaiter(file)).toEqual({ state: "absent" })
    expect(acquireWaiter(file, { pid: process.pid, id: "w1" })).toEqual({ acquired: true })
    expect(readWaiter(file)).toEqual({ state: "running", pid: process.pid })
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({ pid: process.pid, id: "w1" })
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    releaseWaiter(file, "w1")
    expect(fs.existsSync(file)).toBe(false)
    expect(readWaiter(file)).toEqual({ state: "absent" })
  })

  it("a second waiter for the same session isn't let in while the first runs: it's told the first one's pid", () => {
    const file = fresh()
    acquireWaiter(file, { pid: process.pid, id: "first" })
    expect(acquireWaiter(file, { pid: process.pid, id: "second" })).toEqual({ acquired: false, pid: process.pid })
    // The second one's release leaves the first one's lock alone.
    releaseWaiter(file, "second")
    expect(readWaiter(file)).toEqual({ state: "running", pid: process.pid })
    releaseWaiter(file, "first")
  })

  it("a stale lock (its pid is dead, say after a kill -9) counts as absent, and the next waiter takes it over", () => {
    const file = fresh()
    const dead = deadPid()
    acquireWaiter(file, { pid: dead, id: "gone" })
    expect(readWaiter(file)).toEqual({ state: "absent" })
    expect(acquireWaiter(file, { pid: process.pid, id: "next" })).toEqual({ acquired: true })
    expect(readWaiter(file)).toEqual({ state: "running", pid: process.pid })
    releaseWaiter(file, "next")
  })

  it("a lock older than a waiter can live (MAX_WAIT_MS) is stale even when its pid is alive: a reused pid can't hold it", () => {
    const file = fresh()
    const startedAt = 1_000_000
    acquireWaiter(file, { pid: process.pid, id: "old" }, startedAt)
    expect(readWaiter(file, startedAt + MAX_WAIT_MS)).toEqual({ state: "running", pid: process.pid })
    expect(readWaiter(file, startedAt + MAX_WAIT_MS + STALE_AFTER_MAX_MS)).toEqual({ state: "absent" })
    // And the next waiter takes it over.
    expect(acquireWaiter(file, { pid: process.pid, id: "new" }, startedAt + MAX_WAIT_MS + STALE_AFTER_MAX_MS)).toEqual({ acquired: true })
    releaseWaiter(file, "new")
  })

  it("a lock it can't read says unknown (the hook then lets the stop through); a waiter replaces a broken one", () => {
    const file = fresh()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, "garbage")
    expect(readWaiter(file)).toEqual({ state: "unknown" })
    fs.writeFileSync(file, JSON.stringify({ pid: "not a pid" }))
    expect(readWaiter(file)).toEqual({ state: "unknown" })
    expect(acquireWaiter(file, { pid: process.pid, id: "w" })).toEqual({ acquired: true })
    releaseWaiter(file, "w")

    // A path below a file can't be a lock folder: unknown, never a throw.
    const blocker = path.join(dir, "a-file")
    fs.writeFileSync(blocker, "")
    expect(readWaiter(path.join(blocker, "lock"))).toEqual({ state: "unknown" })
  })

  it("never throws: a folder it can't write means no lock, and the waiter carries on without one", () => {
    const blocker = path.join(dir, "another-file")
    fs.writeFileSync(blocker, "")
    const file = path.join(blocker, "below", "lock")
    expect(acquireWaiter(file, { pid: process.pid, id: "w" })).toEqual({ acquired: true, unlocked: true })
    expect(() => releaseWaiter(file, "w")).not.toThrow()
  })
})

describe("maxWait", () => {
  it("a waiter lives at most 24 hours (CELLO_WAIT_MAX_MS shortens it in tests)", () => {
    expect(MAX_WAIT_MS).toBe(24 * 60 * 60 * 1000)
    expect(maxWait({})).toBe(MAX_WAIT_MS)
    expect(maxWait({ CELLO_WAIT_MAX_MS: "300" })).toBe(300)
    expect(maxWait({ CELLO_WAIT_MAX_MS: "later" })).toBe(MAX_WAIT_MS)
  })
})
