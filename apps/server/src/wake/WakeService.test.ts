// WakeService (CEL-92) on the test clock, against a fake agent driver: Lucas's action makes a wake due
// 30 s later (each new action restarts the wait), the woken run continues the session in its folder and
// mode with the prompt, the cap counts runs per task per hour, and every reason not to wake is recorded
// on the task. No real `claude` and no process: the fake driver and the process check stand in.
import * as fs from "node:fs"
import * as os from "node:os"
import type { CelloEvent } from "@cello/contract/events"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as SqlClient from "effect/sql/SqlClient"
import * as Stream from "effect/Stream"
import * as TestClock from "effect/testing/TestClock"
import * as CommentService from "../comment/CommentService.ts"
import * as EventLog from "../events/EventLog.ts"
import * as EventStore from "../events/EventStore.ts"
import * as InboxService from "../inbox/InboxService.ts"
import * as Seed from "../persistence/Seed.ts"
import * as ReviewService from "../review/ReviewService.ts"
import * as SnapshotService from "../snapshot/SnapshotService.ts"
import { SessionService } from "../session/SessionService.ts"
import * as TaskService from "../task/TaskService.ts"
import { type FakeAgent, makeFakeAgent } from "../testing/fakeAgent.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { writePng } from "../testing/media.ts"
import { tempDataDir } from "../testing/tempDir.ts"
import { asAgent, asHuman } from "../testing/TestLayers.ts"
import { type WakeWorld, wakeServices, wakeWorld } from "../testing/wakeLayers.ts"
import { actionOf, wakePrompt, WakeService } from "./WakeService.ts"

const PID = 4242
/** The session's folder: a real one, since a folder that doesn't exist isn't woken in. */
const FOLDER = fs.realpathSync(os.tmpdir())
const agent = { session: "c14ca1fa-6f0e-4c1b", client: "Claude Code", pid: PID, cwd: FOLDER, permissionMode: "auto" }

/** Runs `body` with a fresh world: the fake driver, a process check, and every service over them. */
const run = <A, E>(body: (fake: FakeAgent, world: WakeWorld) => Effect.Effect<A, E, any>) =>
  Effect.gen(function* () {
    const fake = yield* makeFakeAgent()
    const world = wakeWorld()
    return yield* asHuman(body(fake, world)).pipe(Effect.scoped, Effect.provide(wakeServices(fake, world)))
  }) as Effect.Effect<A, E>

/**
 * CEL with waking on, CEL-1 claimed by the agent session (its process has exited), then 5 minutes
 * pass, so it's been quiet long enough. `comment` is Lucas commenting and the action reaching WakeService.
 */
const setup = (options: { readonly enable?: boolean; readonly identity?: typeof agent | Omit<typeof agent, "pid"> } = {}) =>
  Effect.gen(function* () {
    const wake = yield* WakeService
    const tasks = yield* TaskService.TaskService
    const comments = yield* CommentService.CommentService
    const { project } = yield* setupProject
    const { result: task } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "Wake me" })
    const identity = options.identity ?? agent
    const { result: claimed } = yield* asAgent(identity)(tasks.claim({ commandId: cmd(), key: task.key }))
    if (options.enable !== false) yield* wake.setSettings({ commandId: cmd(), project: { key: "CEL" }, enabled: true })
    yield* TestClock.adjust("5 minutes")
    const comment = (body = "Use the other icon") =>
      Effect.gen(function* () {
        yield* comments.add({ commandId: cmd(), taskId: task.id, body })
        yield* wake.noteAction(task.id, "comment")
      })
    return { wake, tasks, task, project, sessionId: claimed.assigneeSessionId!, comment, identity }
  })

/** The task's wake events, in order, as [type, detail]. */
const wakeEvents = (taskId: string) =>
  Effect.gen(function* () {
    const events = yield* (yield* EventStore.EventStore).history(taskId)
    return events.flatMap((e): Array<[string, unknown]> => {
      switch (e.type) {
        case "session.wake_scheduled":
          return [[e.type, e.at]]
        case "session.not_woken":
          return [[e.type, e.reason]]
        case "session.run_started":
        case "session.run_ended":
          return [[e.type, e.run.outcome]]
        default:
          return []
      }
    })
  })

/** Joins the live events now; the returned effect waits for the next one of `type`. */
const nextEvent = (type: CelloEvent["type"]) =>
  Effect.gen(function* () {
    const stream = yield* (yield* EventLog.EventLog).live
    return Stream.runHead(Stream.filter(stream, (e) => e.type === type)).pipe(Effect.map((e) => e._tag === "Some" ? e.value : null))
  })

/** Lucas comments, 30 s pass: what the task's last wake event says, and whether a run started. */
const outcome = (fake: FakeAgent, comment: (body?: string) => Effect.Effect<void, unknown, any>, taskId: string) =>
  Effect.gen(function* () {
    yield* comment()
    yield* TestClock.adjust("2 minutes")
    return { last: (yield* wakeEvents(taskId)).at(-1) ?? null, runs: yield* Queue.size(fake.turns) }
  })

describe("WakeService: a comment wakes the session", () => {
  it.effect("30 s after Lucas's comment it resumes the session in its folder and mode with the prompt, and records the run", () =>
    run((fake) =>
      Effect.gen(function* () {
        const { task, comment, sessionId } = yield* setup()
        yield* comment()
        const now = 5 * 60_000
        expect(yield* wakeEvents(task.id)).toEqual([["session.wake_scheduled", now + 30_000]])

        yield* TestClock.adjust("29 seconds")
        expect(yield* Queue.size(fake.turns)).toBe(0)
        yield* TestClock.adjust("1 second")
        const turn = yield* Queue.take(fake.turns)
        expect(turn.prompt).toBe(wakePrompt({ human: "Lucas", keys: ["CEL-1"], manual: false }))
        expect(turn.prompt).toBe(
          "Lucas acted on CEL-1, which you claimed: run `cello inbox` and act on it, then answer on the card. Cello woke this session because its process had ended.",
        )
        expect(turn.input).toMatchObject({ nativeId: agent.session, cwd: FOLDER, mode: "auto", env: { CELLO_WOKEN: "1", PATH: "/usr/bin:/bin" } })

        const ended = yield* nextEvent("session.run_ended")
        yield* turn.finish({ outcome: "completed", exitCode: 0, error: null })
        const event = yield* ended
        expect(event).toMatchObject({
          type: "session.run_ended",
          sessionId,
          projectId: task.projectId,
          run: { sessionId, taskId: task.id, why: "comment", agentKind: "claude-code", mode: "auto", celloMode: "auto", outcome: "completed", exitCode: 0, pid: turn.pid },
        })
        expect(yield* wakeEvents(task.id)).toEqual([
          ["session.wake_scheduled", now + 30_000],
          ["session.run_started", "running"],
          ["session.run_ended", "completed"],
        ])
        // A fresh board gets the task's latest wake, as the live events left it.
        const snapshot = yield* (yield* SnapshotService.SnapshotService).get()
        expect(snapshot.wakes).toEqual([{ taskId: task.id, sessionId, state: "ended", why: "comment", ts: event!.ts, at: null, reason: null, run: (event as { run: unknown }).run }])
      })))

  it.effect("three quick comments make one wake, due 30 s after the last", () =>
    run((fake) =>
      Effect.gen(function* () {
        const { task, comment } = yield* setup()
        yield* comment("one")
        yield* TestClock.adjust("10 seconds")
        yield* comment("two")
        yield* TestClock.adjust("10 seconds")
        yield* comment("three")
        yield* TestClock.adjust("29 seconds")
        expect(yield* Queue.size(fake.turns)).toBe(0)
        yield* TestClock.adjust("1 second")
        yield* Queue.take(fake.turns)
        const start = 5 * 60_000
        expect(yield* wakeEvents(task.id)).toEqual([
          ["session.wake_scheduled", start + 30_000],
          ["session.wake_scheduled", start + 40_000],
          ["session.wake_scheduled", start + 50_000],
          ["session.run_started", "running"],
        ])
        expect(yield* Queue.size(fake.turns)).toBe(0)
      })))

  it.effect("a session that checked in moments ago waits until it has been quiet for 2 minutes", () =>
    run((fake) =>
      Effect.gen(function* () {
        const { task, comment, tasks } = yield* setup()
        // It checks in at 5:00, then its process is gone; Lucas comments at once.
        yield* asAgent(agent)(tasks.byKey(task.key))
        yield* comment()
        expect(yield* wakeEvents(task.id)).toEqual([["session.wake_scheduled", 7 * 60_000]])
        yield* TestClock.adjust("119 seconds")
        expect(yield* Queue.size(fake.turns)).toBe(0)
        yield* TestClock.adjust("1 second")
        yield* Queue.take(fake.turns)
      })))

  it.effect("the cap: past 3 wakes of a task in an hour Lucas's comment waits; an hour on, it wakes again", () =>
    run((fake) =>
      Effect.gen(function* () {
        const { task, comment } = yield* setup()
        for (let i = 0; i < 3; i++) {
          yield* comment(`round ${i}`)
          yield* TestClock.adjust("30 seconds")
          const turn = yield* Queue.take(fake.turns)
          const ended = yield* nextEvent("session.run_ended")
          yield* turn.finish({ outcome: "completed", exitCode: 0, error: null })
          yield* ended
          // The woken session took the comment; minutes pass before the next one.
          yield* Effect.asVoid((yield* InboxService.InboxService).take({})).pipe(asAgent(agent))
          yield* TestClock.adjust("5 minutes")
        }
        yield* comment("round 3")
        yield* TestClock.adjust("30 seconds")
        expect(yield* Queue.size(fake.turns)).toBe(0)
        expect((yield* wakeEvents(task.id)).at(-1)).toEqual(["session.not_woken", "cap"])

        // An hour on, the earlier wakes no longer count.
        yield* TestClock.adjust("60 minutes")
        yield* comment("round 4")
        yield* TestClock.adjust("30 seconds")
        yield* Queue.take(fake.turns)
      })))

  it.effect("Don't wake calls the due wake off", () =>
    run((fake) =>
      Effect.gen(function* () {
        const { wake, task, comment } = yield* setup()
        yield* comment()
        expect((yield* wake.cancel({ commandId: cmd(), taskId: task.id })).result).toBe(true)
        yield* TestClock.adjust("1 minute")
        expect(yield* Queue.size(fake.turns)).toBe(0)
        expect((yield* wakeEvents(task.id)).at(-1)).toEqual(["session.not_woken", "cancelled"])
        expect((yield* wake.cancel({ commandId: cmd(), taskId: task.id })).result).toBe(false)
      })))

  it.effect("Stop ends a woken run: its process scope closes and the run is recorded stopped", () =>
    run((fake) =>
      Effect.gen(function* () {
        const { wake, task, comment } = yield* setup()
        yield* comment()
        yield* TestClock.adjust("30 seconds")
        yield* Queue.take(fake.turns)
        const events = yield* wakeEvents(task.id)
        expect(events.at(-1)).toEqual(["session.run_started", "running"])
        const runId = ((yield* (yield* EventStore.EventStore).history(task.id)).find((e) => e.type === "session.run_started") as { run: { id: string } }).run.id
        expect((yield* wake.stopRun({ commandId: cmd(), runId })).result).toBe(true)
        expect((yield* wakeEvents(task.id)).at(-1)).toEqual(["session.run_ended", "stopped"])
        expect((yield* wake.stopRun({ commandId: cmd(), runId })).result).toBe(false)
      })))

  it.effect("a comment on its Done task reopens the task for it, then wakes it the same way (CEL-110)", () =>
    run((fake) =>
      Effect.gen(function* () {
        const { tasks, task, comment, sessionId, identity } = yield* setup()
        const reviews = yield* ReviewService.ReviewService
        const png = writePng(yield* tempDataDir, "board.png")
        yield* asAgent(identity)(reviews.submit({ commandId: cmd(), key: task.key, summary: "Done", steps: ["Look"], files: [{ path: png }], links: [] }))
        yield* reviews.approve({ commandId: cmd(), key: task.key })
        expect((yield* tasks.byKey(task.key)).assigneeSessionId).toBeNull()
        yield* TestClock.adjust("5 minutes")

        yield* comment("Let's add the instructional video to the readme")
        expect((yield* tasks.byKey(task.key)).assigneeSessionId).toBe(sessionId)
        expect((yield* wakeEvents(task.id)).map(([type]) => type)).toEqual(["session.wake_scheduled"])
        yield* TestClock.adjust("30 seconds")
        const turn = yield* Queue.take(fake.turns)
        expect(turn.prompt).toBe(wakePrompt({ human: "Lucas", keys: ["CEL-1"], manual: false }))
      })))
})

describe("WakeService: the run's environment and the cap of a batch", () => {
  it.effect("the run never acts as another session or the human: identity and Claude Code session variables are left out", () =>
    run((fake, world) =>
      Effect.gen(function* () {
        world.env = {
          PATH: "/usr/bin:/bin",
          CLAUDE_CONFIG_DIR: "/claude",
          CELLO_SESSION: "me",
          CELLO_AGENT: "cello-builder/a1",
          CELLO_PERMISSION_MODE: "bypassPermissions",
          CLAUDE_PID: "123",
          CLAUDE_CODE_SESSION_ID: "someone-else",
          CLAUDE_CODE_ENTRYPOINT: "cli",
          CLAUDE_CODE_OAUTH_TOKEN: "secret",
        }
        const { comment } = yield* setup()
        yield* comment()
        yield* TestClock.adjust("30 seconds")
        const turn = yield* Queue.take(fake.turns)
        expect(turn.input.env).toEqual({ PATH: "/usr/bin:/bin", CLAUDE_CONFIG_DIR: "/claude", CELLO_WOKEN: "1" })
      })))

  it.effect("a wake that covers two tasks counts toward each task's cap", () =>
    run((fake) =>
      Effect.gen(function* () {
        const { wake, task, project, tasks } = yield* setup()
        yield* wake.setSettings({ commandId: cmd(), project: { key: "CEL" }, capPerHour: 1 })
        const { result: second } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "And this one" })
        yield* asAgent(agent)(tasks.claim({ commandId: cmd(), key: second.key }))
        yield* TestClock.adjust("5 minutes")
        const comments = yield* CommentService.CommentService
        yield* comments.add({ commandId: cmd(), taskId: task.id, body: "first" })
        yield* wake.noteAction(task.id, "comment")
        yield* comments.add({ commandId: cmd(), taskId: second.id, body: "second" })
        yield* wake.noteAction(second.id, "comment")
        yield* TestClock.adjust("30 seconds")
        const turn = yield* Queue.take(fake.turns)
        expect(turn.prompt).toContain("CEL-1 and CEL-2")
        const ended = yield* nextEvent("session.run_ended")
        yield* turn.finish({ outcome: "completed", exitCode: 0, error: null })
        yield* ended
        yield* Effect.asVoid((yield* InboxService.InboxService).take({})).pipe(asAgent(agent))
        yield* TestClock.adjust("5 minutes")
        // CEL-1 wasn't the run's own task, but the run was for it too.
        yield* comments.add({ commandId: cmd(), taskId: task.id, body: "again" })
        yield* wake.noteAction(task.id, "comment")
        yield* TestClock.adjust("30 seconds")
        expect(yield* Queue.size(fake.turns)).toBe(0)
        expect((yield* wakeEvents(task.id)).at(-1)).toEqual(["session.not_woken", "cap"])
      })))
})

describe("WakeService: reasons not to wake", () => {
  it.effect("a run that outlived a server crash is still running: its process is alive, so no second run", () =>
    run((fake, world) =>
      Effect.gen(function* () {
        const { task, comment, sessionId } = yield* setup()
        const sql = yield* SqlClient.SqlClient
        // Recorded stopped at the restart, but its process lives on.
        yield* sql`INSERT INTO session_runs (id, session_id, task_id, why, agent_kind, mode, cello_mode, pid, started_at, ended_at, outcome, log_path)
          VALUES ('crashed', ${sessionId}, ${task.id}, 'comment', 'claude-code', 'auto', 'auto', 5555, 1, 2, 'stopped', '/x')`
        world.alive.add(5555)
        expect(yield* outcome(fake, comment, task.id)).toEqual({ last: ["session.not_woken", "running"], runs: 0 })
      })))

  it.effect("its recorded folder isn't an absolute folder that exists", () =>
    run((fake) =>
      Effect.gen(function* () {
        const { task, comment } = yield* setup({ identity: { ...agent, cwd: "../elsewhere" } })
        expect(yield* outcome(fake, comment, task.id)).toEqual({ last: ["session.not_woken", "no_folder"], runs: 0 })
      })))

  it.effect("its recorded folder doesn't exist on this machine", () =>
    run((fake) =>
      Effect.gen(function* () {
        const { task, comment } = yield* setup({ identity: { ...agent, cwd: "/nonexistent/cello-wake-test" } })
        expect(yield* outcome(fake, comment, task.id)).toEqual({ last: ["session.not_woken", "no_folder"], runs: 0 })
      })))

  it.effect("its recorded permission mode is one the CLI doesn't have", () =>
    run((fake) =>
      Effect.gen(function* () {
        const { task, comment } = yield* setup({ identity: { ...agent, permissionMode: "constructor" } })
        expect(yield* outcome(fake, comment, task.id)).toEqual({ last: ["session.not_woken", "unknown_mode"], runs: 0 })
      })))


  it.effect("waking is off for the project (the default)", () =>
    run((fake) =>
      Effect.gen(function* () {
        const { task, comment } = yield* setup({ enable: false })
        expect(yield* outcome(fake, comment, task.id)).toEqual({ last: ["session.not_woken", "disabled"], runs: 0 })
        // Nothing was announced: the card never said it would wake.
        expect((yield* wakeEvents(task.id)).map(([type]) => type)).toEqual(["session.not_woken"])
      })))

  it.effect("its process is still open", () =>
    run((fake, world) =>
      Effect.gen(function* () {
        world.alive.add(PID)
        const { task, comment } = yield* setup()
        expect(yield* outcome(fake, comment, task.id)).toEqual({ last: ["session.not_woken", "process_alive"], runs: 0 })
      })))

  it.effect("an open session that takes the comment itself in time: nothing at all", () =>
    run((fake, world) =>
      Effect.gen(function* () {
        world.alive.add(PID)
        const { task, comment } = yield* setup()
        yield* comment()
        yield* Effect.asVoid((yield* InboxService.InboxService).take({ via: "hook" })).pipe(asAgent(agent))
        yield* TestClock.adjust("1 minute")
        expect(yield* wakeEvents(task.id)).toEqual([])
        expect(yield* Queue.size(fake.turns)).toBe(0)
      })))

  it.effect("a wake that was due, but the session took the comment itself first", () =>
    run((fake) =>
      Effect.gen(function* () {
        const { task, comment } = yield* setup()
        yield* comment()
        yield* Effect.asVoid((yield* InboxService.InboxService).take({})).pipe(asAgent(agent))
        yield* TestClock.adjust("2 minutes")
        expect(yield* Queue.size(fake.turns)).toBe(0)
        expect((yield* wakeEvents(task.id)).at(-1)).toEqual(["session.not_woken", "taken"])
      })))

  it.effect("it came back: it checked in during the wait", () =>
    run((fake) =>
      Effect.gen(function* () {
        const { task, comment, tasks } = yield* setup()
        yield* comment()
        yield* TestClock.adjust("20 seconds")
        // A call that doesn't take the comment (`cello task get`), from a process Cello can't see.
        yield* asAgent({ ...agent, pid: 999 })(tasks.byKey(task.key))
        yield* TestClock.adjust("2 minutes")
        expect(yield* Queue.size(fake.turns)).toBe(0)
        expect((yield* wakeEvents(task.id)).at(-1)).toEqual(["session.not_woken", "recent_check_in"])
      })))

  it.effect("Cello knows no process id for it", () =>
    run((fake) =>
      Effect.gen(function* () {
        const { pid: _pid, ...withoutPid } = agent
        const { task, comment } = yield* setup({ identity: withoutPid })
        expect(yield* outcome(fake, comment, task.id)).toEqual({ last: ["session.not_woken", "no_pid"], runs: 0 })
      })))

  it.effect("it ran with bypassPermissions", () =>
    run((fake) =>
      Effect.gen(function* () {
        const { task, comment } = yield* setup({ identity: { ...agent, permissionMode: "bypass" } })
        expect(yield* outcome(fake, comment, task.id)).toEqual({ last: ["session.not_woken", "bypass_mode"], runs: 0 })
      })))

  it.effect("its conversation isn't on this machine", () =>
    run((fake) =>
      Effect.gen(function* () {
        fake.conversations = new Set()
        const { task, comment } = yield* setup()
        expect(yield* outcome(fake, comment, task.id)).toEqual({ last: ["session.not_woken", "no_conversation"], runs: 0 })
      })))

  it.effect("its CLI isn't installed", () =>
    run((fake) =>
      Effect.gen(function* () {
        fake.installed = false
        const { task, comment } = yield* setup()
        expect(yield* outcome(fake, comment, task.id)).toEqual({ last: ["session.not_woken", "not_installed"], runs: 0 })
      })))

  it.effect("Cello doesn't know its folder", () =>
    run((fake) =>
      Effect.gen(function* () {
        const { cwd: _cwd, ...withoutFolder } = agent
        const { task, comment } = yield* setup({ identity: withoutFolder as typeof agent })
        expect(yield* outcome(fake, comment, task.id)).toEqual({ last: ["session.not_woken", "no_folder"], runs: 0 })
      })))

  it.effect("a woken run of it is going already (one run per session)", () =>
    run((fake) =>
      Effect.gen(function* () {
        const { task, comment } = yield* setup()
        yield* comment("first")
        yield* TestClock.adjust("30 seconds")
        yield* Queue.take(fake.turns)
        expect(yield* outcome(fake, comment, task.id)).toEqual({ last: ["session.not_woken", "running"], runs: 0 })
      })))

  it.effect("it's listening (its inbox --wait is open): no wake and nothing on the card", () =>
    run((fake) =>
      Effect.gen(function* () {
        const { task, comment } = yield* setup()
        const sessions = yield* SessionService
        // Its waiter stays open for the whole test.
        yield* Effect.forkScoped(asAgent(agent)(sessions.waitingWhile(Effect.never)))
        yield* Effect.yieldNow
        yield* comment()
        yield* TestClock.adjust("2 minutes")
        expect(yield* wakeEvents(task.id)).toEqual([])
        expect(yield* Queue.size(fake.turns)).toBe(0)
      })))
})

describe("WakeService.wakeNow (`cello sessions wake`)", () => {
  it.effect("by task key: wakes the claim holder now, with the manual prompt", () =>
    run((fake) =>
      Effect.gen(function* () {
        const { wake, task } = yield* setup()
        const { result } = yield* wake.wakeNow({ commandId: cmd(), key: "cel-1" })
        expect(result).toMatchObject({ taskId: task.id, why: "manual", outcome: "running" })
        const turn = yield* Queue.take(fake.turns)
        expect(turn.prompt).toBe(wakePrompt({ human: "Lucas", keys: ["CEL-1"], manual: true }))
      })))

  it.effect("by the start of the session id; the same checks fail with SessionNotWoken and the reason", () =>
    run((fake, world) =>
      Effect.gen(function* () {
        const { wake, task } = yield* setup()
        world.alive.add(PID)
        const failed = yield* Effect.flip(wake.wakeNow({ commandId: cmd(), session: "c14ca1fa" }))
        expect(failed).toMatchObject({ _tag: "SessionNotWoken", session: agent.session, reason: "process_alive" })
        expect((yield* wakeEvents(task.id)).at(-1)).toEqual(["session.not_woken", "process_alive"])
        expect(yield* Queue.size(fake.turns)).toBe(0)
        expect((yield* Effect.flip(wake.wakeNow({ commandId: cmd(), session: "zzzzzz" })))._tag).toBe("NotFound")
      })))

  it.effect("on a wake that's due (the board's Wake now, CEL-136): it runs that wake at once, for what Lucas did, and nothing runs again when the wait is up", () =>
    run((fake) =>
      Effect.gen(function* () {
        const { wake, task, comment } = yield* setup()
        yield* comment()
        yield* TestClock.adjust("5 seconds")
        const { result } = yield* wake.wakeNow({ commandId: cmd(), key: "CEL-1" })
        expect(result).toMatchObject({ taskId: task.id, why: "comment", outcome: "running" })
        const turn = yield* Queue.take(fake.turns)
        expect(turn.prompt).toBe(wakePrompt({ human: "Lucas", keys: ["CEL-1"], manual: false }))
        yield* TestClock.adjust("2 minutes")
        expect(yield* Queue.size(fake.turns)).toBe(0)
        expect((yield* wakeEvents(task.id)).map(([type]) => type)).toEqual(["session.wake_scheduled", "session.run_started"])
      })))

  it.effect("on a wake that's due but can't happen now: SessionNotWoken with the reason, on the card too, and the wake is off", () =>
    run((fake, world) =>
      Effect.gen(function* () {
        const { wake, task, comment } = yield* setup()
        yield* comment()
        world.alive.add(PID)
        const failed = yield* Effect.flip(wake.wakeNow({ commandId: cmd(), key: "CEL-1" }))
        expect(failed).toMatchObject({ _tag: "SessionNotWoken", reason: "process_alive" })
        expect((yield* wakeEvents(task.id)).at(-1)).toEqual(["session.not_woken", "process_alive"])
        world.alive.delete(PID)
        yield* TestClock.adjust("2 minutes")
        expect(yield* Queue.size(fake.turns)).toBe(0)
      })))

  it.effect("a retried command hands back its run and starts nothing again", () =>
    run((fake) =>
      Effect.gen(function* () {
        const { wake } = yield* setup()
        const commandId = cmd()
        const first = yield* wake.wakeNow({ commandId, key: "CEL-1" })
        const turn = yield* Queue.take(fake.turns)
        const ended = yield* nextEvent("session.run_ended")
        yield* turn.finish({ outcome: "completed", exitCode: 0, error: null })
        yield* ended
        const again = yield* wake.wakeNow({ commandId, key: "CEL-1" })
        expect(again).toEqual(first)
        expect(yield* Queue.size(fake.turns)).toBe(0)
      })))
})

describe("WakeService settings", () => {
  it.effect("off, cap 3 by default; only Lucas changes them; each change is one event; the API key is noticed", () =>
    run((_fake, world) =>
      Effect.gen(function* () {
        const { wake, sessionId, project } = yield* setup({ enable: false })
        world.env = { ...world.env, ANTHROPIC_API_KEY: "sk-test" }
        expect(yield* wake.settings({ key: "CEL" })).toEqual({
          projectId: project.id,
          enabled: false,
          capPerHour: 3,
          batchMs: 30_000,
          apiKeySet: true,
          agents: [{ kind: "claude-code", name: "Fake agent", installed: true }],
        })
        const { result, seq } = yield* wake.setSettings({ commandId: cmd(), project: { key: "CEL" }, enabled: true, capPerHour: 5 })
        expect(result).toMatchObject({ enabled: true, capPerHour: 5 })
        expect(seq).not.toBeNull()
        const changed = (yield* (yield* EventStore.EventStore).history(project.id)).filter((e) => e.type === "wake.settings_changed")
        expect(changed).toMatchObject([{ before: { enabled: false, capPerHour: 3 }, after: { enabled: true, capPerHour: 5 } }])
        expect((yield* wake.setSettings({ commandId: cmd(), project: { key: "CEL" }, capPerHour: 5 })).seq).toBeNull()
        expect((yield* Effect.flip(wake.setSettings({ commandId: cmd(), project: { key: "CEL" }, capPerHour: 0 })))._tag).toBe("Invalid")
        const human = yield* Seed.HumanActor
        expect(human.id).not.toBe(sessionId)
        const byAgent = yield* Effect.flip(asAgent(agent)(wake.setSettings({ commandId: cmd(), project: { key: "CEL" }, enabled: false })))
        expect(byAgent._tag).toBe("HumanOnly")
      })))
})

describe("actionOf", () => {
  const base = { seq: 1, ts: 1, commandId: "c", actorId: "human", sessionId: null, workspaceId: "w", projectId: "p", schemaVersion: 1 as const }
  it("Lucas's comment, answers, Send back and reaction wake; an agent's action, an approval or another change don't", () => {
    const comment = { id: "c1", taskId: "t1", body: "x", actorId: "human", sessionId: null, createdAt: 1, updatedAt: 1, deletedAt: null }
    expect(actionOf({ ...base, type: "comment.added", comment } as CelloEvent, "human")).toEqual({ taskId: "t1", why: "comment" })
    expect(actionOf({ ...base, type: "review.decided", id: "r", taskId: "t1", decision: "sent_back", note: null } as CelloEvent, "human"))
      .toEqual({ taskId: "t1", why: "send_back" })
    expect(actionOf({ ...base, type: "review.decided", id: "r", taskId: "t1", decision: "approved", note: null } as CelloEvent, "human")).toBeNull()
    expect(actionOf({ ...base, type: "reaction.added", reaction: { id: "x", commentId: "c1", taskId: "t1", emoji: "👍", actorId: "human", sessionId: null, createdAt: 1 } } as CelloEvent, "human"))
      .toEqual({ taskId: "t1", why: "reaction" })
    expect(actionOf({ ...base, sessionId: "s1", actorId: "agent", type: "comment.added", comment } as CelloEvent, "human")).toBeNull()
    expect(actionOf({ ...base, type: "task.archived", id: "t1", version: 2 } as CelloEvent, "human")).toBeNull()
  })
})
