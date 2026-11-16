// Orchestrate mode (CEL-124): an agent session goes into it with `cello sessions orchestrate on` (which
// /cello:orchestrate runs) and out with `off`. The Claude Code hook reads it from the session (whoami)
// and turns AskUserQuestion away while it's on. Each change is one `session.orchestrating` event in the
// same command, in the project's board; running it again changes nothing; the human has no session.
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as ContextService from "../context/ContextService.ts"
import * as EventStore from "../events/EventStore.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { asAgent, asHuman, services } from "../testing/TestLayers.ts"
import * as OrchestrateService from "./OrchestrateService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) => asHuman(effect).pipe(Effect.provide(services())) as Effect.Effect<A, E>

const agent = asAgent({ session: "session-orchestrator", client: "Claude Code", pid: process.pid })
const other = asAgent({ session: "session-chat", client: "Claude Code", pid: process.pid })

const setup = Effect.gen(function* () {
  const orchestrate = yield* OrchestrateService.OrchestrateService
  const context = yield* ContextService.ContextService
  const { project, workspace } = yield* setupProject
  const ref = { key: project.key }
  const set = (on: boolean, commandId = cmd()) => orchestrate.set({ commandId, project: ref, on })
  const events = Effect.flatMap(EventStore.EventStore, (store) => store.readAfter({ workspaceId: workspace.id, projectId: null }, 0)).pipe(
    Effect.map((all) => all.filter((e) => e.type === "session.orchestrating")),
  )
  const mode = (who: typeof agent) => Effect.map(who(context.whoami(ref)), (w) => w.session?.orchestrating)
  return { set, events, mode, project }
})

describe("OrchestrateService.set", () => {
  it.effect("puts the calling session in orchestrate mode and takes it out, one event each, in the project's board", () =>
    run(Effect.gen(function* () {
      const { set, events, mode, project } = yield* setup
      // A session starts out of it.
      expect(yield* mode(agent)).toBe(false)

      const on = yield* agent(set(true))
      expect(on.result).toMatchObject({ externalId: "session-orchestrator", orchestrating: true })
      expect(yield* mode(agent)).toBe(true)
      // Only that session: another one chatting in the same repo isn't.
      expect(yield* mode(other)).toBe(false)

      const off = yield* agent(set(false))
      expect(off.result.orchestrating).toBe(false)
      expect(yield* mode(agent)).toBe(false)

      const written = yield* events
      expect(written.map((e) => e.type === "session.orchestrating" && [e.session, e.orchestrating, e.projectId])).toEqual([
        [on.result.id, true, project.id],
        [on.result.id, false, project.id],
      ])
      expect(written.every((e) => e.sessionId === on.result.id)).toBe(true)
    })))

  it.effect("running it again changes nothing: no second event; a retry with the same command id gets the first result", () =>
    run(Effect.gen(function* () {
      const { set, events } = yield* setup
      const commandId = cmd()
      const first = yield* agent(set(true, commandId))
      expect((yield* agent(set(true, commandId))).result).toEqual(first.result)
      expect((yield* agent(set(true))).result.orchestrating).toBe(true)
      expect(yield* events).toHaveLength(1)
      yield* agent(set(false))
      yield* agent(set(false))
      expect(yield* events).toHaveLength(2)
    })))

  it.effect("the human has no session to put in it; an unknown project is NotFound", () =>
    run(Effect.gen(function* () {
      const { set, events } = yield* setup
      expect(yield* Effect.flip(set(true))).toMatchObject({ _tag: "Invalid", field: "session" })
      const orchestrate = yield* OrchestrateService.OrchestrateService
      expect(yield* Effect.flip(agent(orchestrate.set({ commandId: cmd(), project: { key: "NOPE" }, on: true })))).toMatchObject({ _tag: "NotFound" })
      expect(yield* events).toEqual([])
    })))
})
