// `cello inbox --wait`'s side of the machine (CEL-74): the lock file that tells the Stop hook a waiter
// is running for a session, and how long it keeps reconnecting to a server that went away.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import {
  acquireWaiter,
  afterDown,
  CONNECTED_MS,
  readWaiter,
  RECONNECT_GRACE_MS,
  reconnectDelay,
  reconnectGrace,
  releaseWaiter,
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

describe("afterDown: what a waiter does when it finds the server down", () => {
  const quick = (at: number) => ({ started: at, ended: at + 5 })

  it("pauses, backing off, and gives up once the server has been away for the whole grace", () => {
    const first = afterDown(null, quick(1_000), 2_000)!
    expect(first).toEqual({ outage: { since: 1_005, attempt: 1 }, pause: 250 })
    const second = afterDown(first.outage, quick(1_260), 2_000)!
    expect(second).toEqual({ outage: { since: 1_005, attempt: 2 }, pause: 500 })
    expect(afterDown(second.outage, quick(3_000), 2_000)).toBeNull()
  })

  it("a call that ran for a while had a connection: dropping it starts a new outage", () => {
    const old = { since: 0, attempt: 5 }
    expect(afterDown(old, { started: 10_000, ended: 10_000 + CONNECTED_MS }, 2_000)).toEqual({
      outage: { since: 10_000 + CONNECTED_MS, attempt: 1 },
      pause: 250,
    })
  })

  it("CELLO_WAIT_RECONNECT_MS sets the grace (tests shorten it); anything else keeps two minutes", () => {
    expect(reconnectGrace({ CELLO_WAIT_RECONNECT_MS: "300" })).toBe(300)
    expect(reconnectGrace({})).toBe(RECONNECT_GRACE_MS)
    expect(reconnectGrace({ CELLO_WAIT_RECONNECT_MS: "soon" })).toBe(RECONNECT_GRACE_MS)
    expect(RECONNECT_GRACE_MS).toBe(120_000)
  })
})

describe("reconnectDelay", () => {
  it("backs off from a quarter second to at most 5 seconds between tries", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 10].map(reconnectDelay)).toEqual([250, 500, 1000, 2000, 4000, 5000, 5000, 5000])
  })
})
