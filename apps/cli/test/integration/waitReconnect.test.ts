// CEL-78 against a real server: `cello wait` and `cello task ask --wait` ride out a server restart (every
// deploy restarts it) the way `cello inbox --wait` does (CEL-74): they say on stderr that the server went
// away, reconnect to the new one, and still print Lucas's answers once, or that the ask was withdrawn.
// When the server stays away they give up, saying what to run again. Nothing here sleeps: each test
// awaits the waiter's "went away" line (printed once a call found the server gone) before the new server
// starts, so the reconnect is always exercised.
import { newCommandId } from "@cello/client/client"
import type { Ask } from "@cello/contract/entities"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { connect } from "../../../server/test/integration/harness.ts"
import { cello, gitRepo, type Output } from "./cli.ts"

const X = "2fd0505c-417a-4167-acfe-2d66080fcae0"
const env = { CLAUDE_CODE_SESSION_ID: X, CLAUDE_PID: String(process.pid) }

const ASK = ["--title", "Search layout", "--question", "Which layout?", "--option", "Peek", "--option", "Palette"]

/** What a waiter says on stderr when it finds the server gone (the default grace is 2 minutes). */
const wentAway = (port: number, grace = "2 minutes") => `The Cello server on port ${port} went away; reconnecting for up to ${grace}…`

/** Project CEL linked to a git repo; session X created CEL-1 and claimed it. The server can be stopped and started again. */
const setup = Effect.gen(function* () {
  const dataDir = yield* tempDataDir
  const running = yield* Scope.make()
  const { port } = yield* startServer(dataDir).pipe(Scope.provide(running))
  const repo = gitRepo(dataDir, "cello")
  const human = yield* connect(port).pipe(Scope.provide(running))
  const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
  const { result: project } = yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "Cello", key: "CEL", repoPath: repo })
  const x = cello({ port, env, cwd: repo })
  yield* x("task", "create", "Search layout")
  yield* x("task", "claim", "CEL-1")

  /**
   * Runs `cello …args` as X in a fiber, and a way to await the moment it says the server went away (or
   * its end, if it ended first instead: it failed, which the test then shows).
   */
  const start = (args: ReadonlyArray<string>, more: Record<string, string> = {}) =>
    Effect.gen(function* () {
      let heard = () => {}
      const away = new Promise<void>((resolve) => (heard = resolve))
      const onErr = (line: string) => line.startsWith("The Cello server on port") && heard()
      const fiber = yield* Effect.forkChild(cello({ port, env: { ...env, ...more }, cwd: repo, onErr })(...args))
      return { fiber, wentAway: Effect.raceFirst(Effect.promise(() => away), Effect.asVoid(Fiber.await(fiber))) }
    })

  return {
    port,
    x,
    start,
    /** The next ask.created on the board: awaited, never polled for. */
    nextAsk: Effect.gen(function* () {
      const { seq } = yield* human["snapshot.get"]({ scope: { projectId: project.id } })
      return yield* Effect.forkChild(human["events.subscribe"]({ scope: { projectId: project.id }, afterSeq: seq }).pipe(
        Stream.filter((e) => e.type === "ask.created"),
        Stream.runHead,
        Effect.map((e) => (e._tag === "Some" && e.value.type === "ask.created" ? e.value.ask : null)!),
      ))
    }),
    stopServer: Scope.close(running, Exit.void),
    /** The server again, on the same port and data folder, as a deploy restarts it; and Lucas connected to it. */
    restart: Effect.gen(function* () {
      yield* startServer(dataDir, { port })
      return yield* connect(port)
    }),
  }
})

/** Lucas picks Peek. */
const answer = (ask: Ask) => ({ commandId: newCommandId(), askId: ask.id, answers: [{ questionId: "q1", optionIds: ["q1o1"] }] })

const count = (text: string, part: string) => text.split(part).length - 1

/** The answers, printed once on stdout; on stderr only that the server went away, once. */
const answeredOnce = (output: Output, port: number) => {
  expect(output.failure).toBeNull()
  expect(output.out).toContain("Lucas answered \"Search layout\" on CEL-1, just now:")
  expect(count(output.out, "Picked: Peek")).toBe(1)
  expect(output.err).toBe(wentAway(port))
}

describe("cello wait through a server restart (CEL-78)", () => {
  it.live("reconnects to the new server and prints Lucas's answers once; nothing is left for the hook", () =>
    Effect.gen(function* () {
      const { port, x, start, stopServer, restart } = yield* setup
      const { result } = JSON.parse((yield* x("task", "ask", "CEL-1", ...ASK, "--json")).out) as { result: { ask: Ask } }
      const waiter = yield* start(["wait", "CEL-1"])
      yield* stopServer
      yield* waiter.wentAway
      const human = yield* restart
      yield* human["ask.answer"](answer(result.ask))
      answeredOnce(yield* Fiber.join(waiter.fiber), port)
      // The wait handed them over: the hook and `cello inbox` have nothing left to deliver.
      expect(yield* x("inbox", "--new")).toEqual({ out: "", failure: null })
    }).pipe(Effect.scoped))

  it.live("an ask withdrawn while it was reconnecting is reported as withdrawn", () =>
    Effect.gen(function* () {
      const { port, x, start, stopServer, restart } = yield* setup
      yield* x("task", "ask", "CEL-1", ...ASK)
      const waiter = yield* start(["wait", "CEL-1"])
      yield* stopServer
      yield* waiter.wentAway
      yield* restart
      yield* x("task", "ask", "CEL-1", "--withdraw")
      const output = yield* Fiber.join(waiter.fiber)
      expect(output.failure).toBeNull()
      expect(output.out).toMatch(/^CEL-1's questions "Search layout" were withdrawn (just now|\d+m ago); there are no answers\.$/)
      expect(output.err).toBe(wentAway(port))
    }).pipe(Effect.scoped))

  it.live("gives up with a clear message, exit non-zero, when the server stays away, naming the command to run again", () =>
    Effect.gen(function* () {
      const { port, x, start, stopServer } = yield* setup
      yield* x("task", "ask", "CEL-1", ...ASK)
      const waiter = yield* start(["wait", "CEL-1"], { CELLO_WAIT_RECONNECT_MS: "300" })
      yield* stopServer
      expect(yield* Fiber.join(waiter.fiber)).toEqual({
        out: "",
        failure: `The Cello server on port ${port} went away and didn't come back within 300 ms, so this stopped waiting. ` +
          "Start it (`cello start`), then run `cello wait CEL-1` again.",
        err: wentAway(port, "300 ms"),
      })
    }).pipe(Effect.scoped))
})

describe("cello task ask --wait through a server restart (CEL-78)", () => {
  it.live("the ask stays put, and the wait reconnects and prints Lucas's answers once", () =>
    Effect.gen(function* () {
      const { port, x, start, nextAsk, stopServer, restart } = yield* setup
      const created = yield* nextAsk
      const waiter = yield* start(["task", "ask", "CEL-1", ...ASK, "--wait"])
      const ask = yield* Fiber.join(created)
      yield* stopServer
      yield* waiter.wentAway
      const human = yield* restart
      yield* human["ask.answer"](answer(ask))
      const output = yield* Fiber.join(waiter.fiber)
      answeredOnce(output, port)
      expect(output.out.split("\n").slice(0, 3)).toEqual([
        "Asked Lucas on CEL-1: \"Search layout\" (1 question)  In Progress → Needs input",
        `  Lucas answers at http://127.0.0.1:${port}/review?open=CEL-1`,
        "  Waiting for the answers…",
      ])
      // One ask: the wait didn't ask again.
      expect(JSON.parse((yield* x("task", "get", "CEL-1", "--json")).out).asks).toHaveLength(1)
      expect(yield* x("inbox", "--new")).toEqual({ out: "", failure: null })
    }).pipe(Effect.scoped))
})
