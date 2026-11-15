// CEL-74 against a real server: `cello inbox --wait` blocks until Lucas writes to the session, then
// hands it over like `cello inbox` (once, even with a hook taking at the same time), holding a lock
// file while it waits. It rides out a server restart and gives up, saying so, when the server stays
// away. The Stop hook asks a session that holds a claim to start one when none is running, once.
// Nothing here sleeps: the tests await the waiter's "Waiting…" line on stderr (printed once it holds
// its lock) or the command's end. (A file watch on the lock isn't enough: on macOS it can miss a file
// made the moment the watch starts.)
import * as fs from "node:fs"
import * as path from "node:path"
import { newCommandId } from "@cello/client/client"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Scope from "effect/Scope"
import { connect } from "../../../server/test/integration/harness.ts"
import { WAIT_HINT, WAIT_NUDGE } from "../../src/claudeHook.ts"
import { waiterLockDir, waiterLockFile, WAITING } from "../../src/inboxWait.ts"
import { cello, gitRepo } from "./cli.ts"

const X = "2fd0505c-417a-4167-acfe-2d66080fcae0"
const claude = (session: string) => ({ CLAUDE_CODE_SESSION_ID: session, CLAUDE_PID: String(process.pid) })
const BIN = path.resolve(import.meta.dirname, "../../src/bin.ts")

/** Project CEL linked to a git repo; session X created CEL-1 and claimed it. A temp TMPDIR for the locks. */
const setup = Effect.gen(function* () {
  const dataDir = yield* tempDataDir
  const running = yield* Scope.make()
  const { port } = yield* startServer(dataDir).pipe(Scope.provide(running))
  const repo = gitRepo(dataDir, "cello")
  const human = yield* connect(port).pipe(Scope.provide(running))
  const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
  yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "Cello", key: "CEL", repoPath: repo })
  const tmp = path.join(dataDir, "tmp")
  fs.mkdirSync(tmp)
  const env = { ...claude(X), TMPDIR: tmp }
  const x = cello({ port, env, cwd: repo })
  yield* x("task", "create", "Comments reach agents")
  yield* x("task", "claim", "CEL-1")
  const lock = waiterLockFile(waiterLockDir({ TMPDIR: tmp }), { port: String(port), session: X })

  /** Starts `cello inbox --wait` as X (in this process) and returns once it says it's waiting, holding its lock. */
  const startWaiter = (more: Record<string, string> = {}) =>
    Effect.gen(function* () {
      let ready = () => {}
      const waiting = new Promise<void>((resolve) => (ready = resolve))
      const onErr = (line: string) => line.startsWith(WAITING) && ready()
      const fiber = yield* Effect.forkChild(cello({ port, env: { ...env, ...more }, cwd: repo, onErr })("inbox", "--wait"))
      // A waiter that ends before it waits (it failed) ends this too, instead of hanging the test.
      yield* Effect.raceFirst(Effect.promise(() => waiting), Fiber.await(fiber))
      return fiber
    })

  return {
    dataDir,
    port,
    repo,
    tmp,
    lock,
    x,
    startWaiter,
    me: cello({ port, env: { CELLO_SESSION: "me", TMPDIR: tmp }, cwd: repo }),
    /** The Stop hook as Claude Code runs it: the session on stdin, nothing in the environment but TMPDIR. */
    stop: (input: Record<string, unknown> = {}) =>
      cello({ port, env: { TMPDIR: tmp }, cwd: repo, stdin: JSON.stringify({ session_id: X, cwd: repo, hook_event_name: "Stop", stop_hook_active: false, ...input }) })(
        "hook",
        "claude",
        "stop",
      ),
    stopServer: Scope.close(running, Exit.void),
  }
})

const delivery = (body: string) =>
  [
    "New Cello comment on a task you claimed:",
    "",
    "CEL-1  Comments reach agents",
    "  Lucas commented, just now",
    `    ${body}`,
    "",
    "Act on it now, then answer on the card: `cello task comment CEL-1 \"…\"` (or `--body-file -` for markdown), so Lucas sees your reply there.",
  ].join("\n")

/** What a waiter printed: the delivery on stdout, and on stderr only that it was waiting. */
const woken = (body: string) => ({ out: delivery(body), failure: null, err: expect.stringMatching(new RegExp(`^${WAITING} \\(pid \\d+\\)…$`)) })

describe("cello inbox --wait", () => {
  it.live("blocks while there's nothing, and returns when Lucas comments later: printed like `cello inbox`, marked read", () =>
    Effect.gen(function* () {
      const { x, me, startWaiter } = yield* setup
      const waiting = yield* startWaiter()
      yield* me("task", "comment", "CEL-1", "Please also cover the empty state")
      expect(yield* Fiber.join(waiting)).toEqual(woken("Please also cover the empty state"))
      // Handed over once: nothing new is left for `cello inbox` or the hook.
      expect(yield* x("inbox", "--new")).toEqual({ out: "", failure: null })
    }).pipe(Effect.scoped))

  it.live("returns at once when something is already waiting; --json prints the items", () =>
    Effect.gen(function* () {
      const { x, me } = yield* setup
      yield* me("task", "comment", "CEL-1", "Already here")
      expect(yield* x("inbox", "--wait")).toEqual(woken("Already here"))
      yield* me("task", "comment", "CEL-1", "Again")
      const json = JSON.parse((yield* x("inbox", "--wait", "--json")).out)
      expect(json.items.map((i: { comment: { body: string } }) => i.comment.body)).toEqual(["Again"])
      expect(json.claimed).toEqual(["CEL-1"])
    }).pipe(Effect.scoped))

  it.live("a single delivery even with the Stop hook taking at the same time: each comment reaches the session once", () =>
    Effect.gen(function* () {
      const { me, stop, startWaiter } = yield* setup
      const waiting = yield* startWaiter()
      yield* me("task", "comment", "CEL-1", "Only once")
      const hook = yield* stop()
      const hookGotIt = hook.out.includes("Only once")
      // Whoever lost keeps waiting (the waiter) or said nothing about it (the hook); a second comment releases the waiter.
      if (hookGotIt) yield* me("task", "comment", "CEL-1", "The next one")
      const waiter = yield* Fiber.join(waiting)
      expect([hook.out, waiter.out].join("\n").split("Only once").length - 1).toBe(1)
      expect(waiter).toEqual(woken(hookGotIt ? "The next one" : "Only once"))
    }).pipe(Effect.scoped))

  it.live("holds a lock file with its pid while it waits, and removes it when it's done", () =>
    Effect.gen(function* () {
      const { me, lock, startWaiter } = yield* setup
      expect(fs.existsSync(lock)).toBe(false)
      const waiting = yield* startWaiter()
      expect(JSON.parse(fs.readFileSync(lock, "utf8"))).toMatchObject({ pid: process.pid, id: expect.any(String) })
      expect(fs.statSync(lock).mode & 0o777).toBe(0o600)
      yield* me("task", "comment", "CEL-1", "Done waiting")
      yield* Fiber.join(waiting)
      expect(fs.existsSync(lock)).toBe(false)
    }).pipe(Effect.scoped))

  it.live("a real waiter stopped with SIGTERM (Claude Code stopping a background task) removes its lock on the way out", () =>
    Effect.gen(function* () {
      const { port, repo, tmp, lock, stop } = yield* setup
      const proc = Bun.spawn(["bun", BIN, "inbox", "--wait"], {
        cwd: repo,
        env: { PATH: process.env.PATH, CELLO_PORT: String(port), TMPDIR: tmp, ...claude(X) },
        stdout: "pipe",
        stderr: "pipe",
      })
      // Its first stderr line says it holds the lock.
      const first = yield* Effect.promise(async () => {
        const { value } = await proc.stderr.getReader().read()
        return new TextDecoder().decode(value)
      })
      expect(first).toBe(`${WAITING} (pid ${proc.pid})…\n`)
      expect(JSON.parse(fs.readFileSync(lock, "utf8")).pid).toBe(proc.pid)
      // Another process (the hook) sees it running.
      expect(yield* stop()).toEqual({ out: "", failure: null })
      proc.kill("SIGTERM")
      yield* Effect.promise(() => proc.exited)
      expect(fs.existsSync(lock)).toBe(false)
    }).pipe(Effect.scoped))

  it.live("a second waiter for the same session leaves at once, naming the one already running", () =>
    Effect.gen(function* () {
      const { x, me, lock, startWaiter } = yield* setup
      const waiting = yield* startWaiter()
      expect(yield* x("inbox", "--wait")).toEqual({
        out: "",
        failure: null,
        err: `Already waiting: a \`cello inbox --wait\` (pid ${process.pid}) is running for this session, and it wakes you when something new arrives.`,
      })
      expect(JSON.parse((yield* x("inbox", "--wait", "--json")).out)).toEqual({ waiting: true, pid: process.pid })
      // The first one's lock is still there, and it still gets the comment.
      expect(fs.existsSync(lock)).toBe(true)
      yield* me("task", "comment", "CEL-1", "For the first waiter")
      expect(yield* Fiber.join(waiting)).toEqual(woken("For the first waiter"))
    }).pipe(Effect.scoped))

  it.live("rides out a server restart: it reconnects to the new server and still gets the comment", () =>
    Effect.gen(function* () {
      const { lock, port, dataDir, repo, tmp, stopServer, startWaiter } = yield* setup
      const waiting = yield* startWaiter()
      yield* stopServer
      yield* startServer(dataDir, { port })
      yield* cello({ port, env: { CELLO_SESSION: "me", TMPDIR: tmp }, cwd: repo })("task", "comment", "CEL-1", "After the restart")
      expect(yield* Fiber.join(waiting)).toEqual(woken("After the restart"))
      expect(fs.existsSync(lock)).toBe(false)
    }).pipe(Effect.scoped))

  it.live("gives up with a clear message, exit non-zero, when the server stays away; the lock goes with it", () =>
    Effect.gen(function* () {
      const { lock, port, stopServer, startWaiter } = yield* setup
      const waiting = yield* startWaiter({ CELLO_WAIT_RECONNECT_MS: "300" })
      yield* stopServer
      expect(yield* Fiber.join(waiting)).toMatchObject({
        out: "",
        failure: `The Cello server on port ${port} went away and didn't come back within 300 ms, so this stopped waiting. ` +
          "Start it (`cello start`), then run `cello inbox --wait` again.",
      })
      expect(fs.existsSync(lock)).toBe(false)
    }).pipe(Effect.scoped))

  it.live("stops when the Claude Code that started it is gone (CLAUDE_PID), leaving comments for the session's next run", () =>
    Effect.gen(function* () {
      const { x, me, lock, startWaiter } = yield* setup
      // A stand-in for Claude Code: a process this test starts, and stops by its pid.
      const claudeCode = Bun.spawn(["sleep", "600"])
      const waiting = yield* startWaiter({ CLAUDE_PID: String(claudeCode.pid) })
      claudeCode.kill()
      yield* Effect.promise(() => claudeCode.exited)
      expect((yield* Fiber.join(waiting)).failure).toBe(
        `The Claude Code session that started this (pid ${claudeCode.pid}) is gone, so \`cello inbox --wait\` stopped. Nothing was taken.`,
      )
      expect(fs.existsSync(lock)).toBe(false)
      yield* me("task", "comment", "CEL-1", "Still here for the next run")
      expect((yield* x("inbox", "--new")).out).toBe(delivery("Still here for the next run"))
    }).pipe(Effect.scoped))

  it.live("lives at most a day: then it stops, says to start it again, and lets its lock go", () =>
    Effect.gen(function* () {
      const { lock, startWaiter } = yield* setup
      const waiting = yield* startWaiter({ CELLO_WAIT_MAX_MS: "300" })
      expect(yield* Fiber.join(waiting)).toMatchObject({
        out: "Nothing new for this session in 300 ms, so `cello inbox --wait` stopped. If you still hold a claim, start it again in the background.",
        failure: null,
      })
      expect(fs.existsSync(lock)).toBe(false)
    }).pipe(Effect.scoped))

  it.live("the human has no inbox to wait on", () =>
    Effect.gen(function* () {
      const { me } = yield* setup
      expect((yield* me("inbox", "--wait")).failure).toBe(
        "The human has no inbox: comments reach the agent session that claimed the task. Run this from an agent session (CLAUDE_CODE_SESSION_ID or CELLO_SESSION set).",
      )
    }).pipe(Effect.scoped))
})

describe("the Stop hook asks an idle session to wait (CEL-74)", () => {
  const nudge = (keys: ReadonlyArray<string>) => ({ out: JSON.stringify({ hookSpecificOutput: { hookEventName: "Stop", additionalContext: WAIT_NUDGE(keys, "Lucas") } }), failure: null })

  it.live("holding a claim with no waiter running, it keeps the session going once to start `cello inbox --wait`", () =>
    Effect.gen(function* () {
      const { stop } = yield* setup
      expect(yield* stop()).toEqual(nudge(["CEL-1"]))
      // Claude's next stop comes because of the hook: it goes through, so it never loops.
      expect(yield* stop({ stop_hook_active: true })).toEqual({ out: "", failure: null })
    }).pipe(Effect.scoped))

  it.live("a waiter running (its lock, or a background shell Claude Code lists) lets the stop through", () =>
    Effect.gen(function* () {
      const { stop, me, startWaiter } = yield* setup
      expect(yield* stop({ background_tasks: [{ id: "b1", type: "shell", status: "running", command: "cello inbox --wait" }] }))
        .toEqual({ out: "", failure: null })
      const waiting = yield* startWaiter()
      expect(yield* stop()).toEqual({ out: "", failure: null })
      yield* me("task", "comment", "CEL-1", "Wake up")
      yield* Fiber.join(waiting)
      // The waiter is gone: the next stop asks again.
      expect(yield* stop()).toEqual(nudge(["CEL-1"]))
    }).pipe(Effect.scoped))

  it.live("an orphaned waiter (a live lock, but Claude Code's background shells don't include it) doesn't silence the nudge", () =>
    Effect.gen(function* () {
      const { stop, me, startWaiter } = yield* setup
      const waiting = yield* startWaiter()
      expect(yield* stop({ background_tasks: [{ id: "b1", type: "shell", status: "running", command: "bun run dev" }] })).toEqual(nudge(["CEL-1"]))
      expect(yield* stop({ background_tasks: [] })).toEqual(nudge(["CEL-1"]))
      yield* me("task", "comment", "CEL-1", "Done")
      yield* Fiber.join(waiting)
    }).pipe(Effect.scoped))

  it.live("no claim, nothing to wait for: the stop goes through", () =>
    Effect.gen(function* () {
      const { stop, x } = yield* setup
      yield* x("task", "release", "CEL-1")
      expect(yield* stop()).toEqual({ out: "", failure: null })
    }).pipe(Effect.scoped))

  it.live("a comment that's waiting is handed over first, with the line to start a waiter, since the next stop won't be nudged", () =>
    Effect.gen(function* () {
      const { stop, me } = yield* setup
      yield* me("task", "comment", "CEL-1", "Read this first")
      const out = JSON.parse((yield* stop()).out)
      expect(out.hookSpecificOutput.additionalContext).toBe(`${delivery("Read this first")}\n\n${WAIT_HINT("Lucas")}`)
      // Also when Claude is already continuing because of a Stop hook.
      yield* me("task", "comment", "CEL-1", "And this")
      const again = JSON.parse((yield* stop({ stop_hook_active: true })).out)
      expect(again.hookSpecificOutput.additionalContext).toBe(`${delivery("And this")}\n\n${WAIT_HINT("Lucas")}`)
    }).pipe(Effect.scoped))

  it.live("with a waiter running, a Stop delivery is just the comment", () =>
    Effect.gen(function* () {
      const { stop, me, startWaiter } = yield* setup
      // The waiter starts first, then the comment lands; whoever takes it, it's delivered once.
      const waiting = yield* startWaiter()
      yield* me("task", "comment", "CEL-1", "One")
      const hook = yield* stop({ background_tasks: [{ id: "b1", type: "shell", status: "running", command: "cello inbox --wait" }] })
      if (hook.out !== "") {
        expect(JSON.parse(hook.out).hookSpecificOutput.additionalContext).toBe(delivery("One"))
        yield* me("task", "comment", "CEL-1", "Two")
      }
      yield* Fiber.join(waiting)
    }).pipe(Effect.scoped))
})
