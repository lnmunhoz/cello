// `cello inbox --wait` (CEL-74): an agent session runs it in the background when it ends a turn, so a
// comment from its human wakes it even while it's idle (the hooks only fire while it works). While it runs
// it holds a lock file, one per server and session, holding its pid: the Stop hook reads it to tell
// whether the session is already waiting, and a second `--wait` for the same session leaves instead
// of piling up. A lock whose pid is dead (the waiter was killed with -9) counts as absent, and so does
// one older than a waiter can live (MAX_WAIT_MS), so a reused pid can't hold it for long. A waiter also
// stops when the Claude Code that started it is gone (CLAUDE_PID), so it never outlives its session.
//
// Reading or writing the lock never throws: trouble reading it says "unknown" (the hook then lets the
// stop through), and trouble writing it means the waiter carries on without a lock.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { isAlive } from "@cello/server/process/isAlive"
import type { Env } from "./identity.ts"

/** What a waiter says on stderr once it holds the lock and starts waiting (followed by its pid). */
export const WAITING = "Waiting for new comments, Send back notes, answers and ended claims for this session"

/** Where the waiters' lock files live: a folder under the system's temp folder (TMPDIR when set). */
export const waiterLockDir = (env: Env) => path.join(env.TMPDIR || os.tmpdir(), "cello-inbox-wait")

/** The lock file for one server (its port) and agent session. */
export const waiterLockFile = (dir: string, key: { readonly port: string; readonly session: string }) =>
  path.join(dir, new Bun.CryptoHasher("sha256").update(`${key.port}\0${key.session}`).digest("hex").slice(0, 32))

/** Whether a waiter is running: `unknown` when the lock is there but can't be read. */
export type WaiterState =
  | { readonly state: "running"; readonly pid: number }
  | { readonly state: "absent" }
  | { readonly state: "unknown" }

/** Who holds a lock: the process, and an id that tells two waiters in one process apart. */
export interface Waiter {
  readonly pid: number
  readonly id: string
}

/** The longest a waiter waits: then it stops and says to start it again (CEL-74). */
export const MAX_WAIT_MS = 24 * 60 * 60 * 1000

/** How far past MAX_WAIT_MS a lock may be before it counts as stale whatever its pid says. */
export const STALE_AFTER_MAX_MS = 10 * 60 * 1000

/** The longest wait: MAX_WAIT_MS, or CELLO_WAIT_MAX_MS (tests shorten it). */
export const maxWait = (env: Env): number => {
  const value = env.CELLO_WAIT_MAX_MS ? Number(env.CELLO_WAIT_MAX_MS) : Number.NaN
  return Number.isFinite(value) && value > 0 ? value : MAX_WAIT_MS
}

/** How often a waiter checks that the Claude Code that started it is still there. */
export const OWNER_CHECK_MS = 1_000

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code

/** Removes a file if it's there; never throws (Bun's `force` still throws when a parent isn't a folder). */
const removeQuietly = (file: string) => {
  try {
    fs.rmSync(file, { force: true })
  } catch {
    // Not there, or can't be: either way nothing to do.
  }
}

/** The lock's holder, or null when it's missing; throws "unknown" trouble to the callers below. */
const holderOf = (file: string): (Waiter & { readonly startedAt: number | null }) | "absent" | "unknown" => {
  let raw: string
  try {
    raw = fs.readFileSync(file, "utf8")
  } catch (error) {
    return errorCode(error) === "ENOENT" ? "absent" : "unknown"
  }
  try {
    const value = JSON.parse(raw) as { pid?: unknown; id?: unknown; startedAt?: unknown }
    return Number.isInteger(value.pid) && (value.pid as number) > 0 && typeof value.id === "string"
      ? { pid: value.pid as number, id: value.id, startedAt: typeof value.startedAt === "number" ? value.startedAt : null }
      : "unknown"
  } catch {
    return "unknown"
  }
}

/**
 * Whether a waiter runs for this lock file. A stale lock counts as absent: its pid is dead, or it's
 * older than a waiter can live (its pid may have been reused).
 */
export const readWaiter = (file: string, now = Date.now()): WaiterState => {
  const holder = holderOf(file)
  if (typeof holder === "string") return { state: holder }
  const tooOld = holder.startedAt !== null && now - holder.startedAt >= MAX_WAIT_MS + STALE_AFTER_MAX_MS
  return !tooOld && isAlive(holder.pid) ? { state: "running", pid: holder.pid } : { state: "absent" }
}

/**
 * Takes the lock for `me`. Refused, naming the pid, while another live waiter holds it; a stale or
 * broken lock is replaced. The lock appears whole or not at all (a hard link of a finished file), so
 * two waiters starting together can't both get it. `unlocked`: the folder couldn't be written, so the
 * waiter runs without a lock.
 */
export const acquireWaiter = (
  file: string,
  me: Waiter,
  now = Date.now(),
): { readonly acquired: true; readonly unlocked?: true } | { readonly acquired: false; readonly pid: number } => {
  const draft = `${file}.${me.id}`
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    fs.writeFileSync(draft, JSON.stringify({ pid: me.pid, id: me.id, startedAt: now }), { mode: 0o600 })
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        fs.linkSync(draft, file)
        return { acquired: true }
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error
        const current = readWaiter(file, now)
        if (current.state === "running") return { acquired: false, pid: current.pid }
        // Stale (its waiter died) or broken: clear it and try again.
        fs.rmSync(file, { force: true })
      }
    }
    return { acquired: true, unlocked: true }
  } catch {
    return { acquired: true, unlocked: true }
  } finally {
    removeQuietly(draft)
  }
}

/** Gives the lock back: removes it only while it's still `id`'s, so a later waiter's lock stays. */
export const releaseWaiter = (file: string, id: string): void => {
  const holder = holderOf(file)
  // Left behind if it can't be removed: its pid dies with this process, so it then reads as stale.
  if (typeof holder !== "string" && holder.id === id) removeQuietly(file)
}

/** How long a waiter keeps reconnecting to a server that went away before it gives up (a restart takes seconds). */
export const RECONNECT_GRACE_MS = 120_000

/** The pause before reconnect try `attempt` (0 first): a quarter second, doubling, at most 5 seconds. */
export const reconnectDelay = (attempt: number): number => Math.min(250 * 2 ** attempt, 5_000)

/**
 * A call that lasted this long had a connection (a server that's down refuses at once), so when it
 * drops, a new outage starts and the grace starts over.
 */
export const CONNECTED_MS = 5_000

/** The server has been unreachable since `since`; `attempt` reconnects were made. */
export interface Outage {
  readonly since: number
  readonly attempt: number
}

/**
 * After a call that found the server down (`started` and `ended` are when it ran): how long to pause
 * before the next try, and the outage so far; null once it has been down for the whole `grace`.
 */
export const afterDown = (
  outage: Outage | null,
  call: { readonly started: number; readonly ended: number },
  grace: number,
): { readonly outage: Outage; readonly pause: number } | null => {
  // A new outage always gets one more try; a running one ends once it has lasted the grace.
  const current = outage === null || call.ended - call.started >= CONNECTED_MS ? { since: call.ended, attempt: 0 } : outage
  if (current === outage && call.ended - outage.since >= grace) return null
  return { outage: { since: current.since, attempt: current.attempt + 1 }, pause: reconnectDelay(current.attempt) }
}

/** The grace: RECONNECT_GRACE_MS, or CELLO_WAIT_RECONNECT_MS (tests shorten it). */
export const reconnectGrace = (env: Env): number => {
  const value = env.CELLO_WAIT_RECONNECT_MS ? Number(env.CELLO_WAIT_RECONNECT_MS) : Number.NaN
  return Number.isFinite(value) && value >= 0 ? value : RECONNECT_GRACE_MS
}
