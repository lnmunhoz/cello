// A fake agent driver (CEL-92) for the session host's and WakeService's unit tests: it starts no
// process. Each `resume` is recorded, writes one line to the run's output, and returns a turn the test
// ends with `finish`; closing the session's scope (Stop, a shutdown) ends it interrupted. That the host
// and WakeService work against it is also the proof they don't depend on Claude.
import type { CelloMode } from "@cello/contract/entities"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Queue from "effect/Queue"
import type { AgentDriver, OpenInput, TurnEnded } from "../wake/agents/AgentDriver.ts"

export interface FakeTurn {
  readonly input: OpenInput
  readonly prompt: string
  readonly pid: number
  /** Ends the turn as the CLI would. */
  readonly finish: (ended: TurnEnded) => Effect.Effect<void>
}

export interface FakeAgent {
  readonly driver: AgentDriver
  /** Every turn started, in order. */
  readonly turns: Queue.Queue<FakeTurn>
  /** Sessions it says it has a conversation for (by native id); every one when null. */
  conversations: ReadonlySet<string> | null
  installed: boolean
}

const MODES: ReadonlyMap<string, CelloMode> = new Map([["ask", "ask"], ["edits", "edits"], ["auto", "auto"], ["plan", "plan"], ["bypass", "bypass"]])

let nextPid = 70_000

/** A fake driver of kind `kind` (the sessions under test must have that agent kind). */
export const makeFakeAgent = (kind = "claude-code") =>
  Effect.gen(function* () {
    const turns = yield* Queue.unbounded<FakeTurn>()
    const fake: FakeAgent = {
      turns,
      conversations: null,
      installed: true,
      driver: {
        kind,
        name: "Fake agent",
        capabilities: { resume: true, streamingInput: false, permissionRequests: false, modes: ["ask", "edits", "auto", "plan"] },
        installed: () => Effect.sync(() => fake.installed),
        conversationFolder: ({ nativeId, cwd }) => Effect.sync(() => (fake.conversations === null || fake.conversations.has(nativeId) ? cwd : null)),
        // The fake's modes are Cello's own words; none recorded asks, any other word is unknown.
        modeFor: (recorded) => {
          if (recorded === null) return { native: "ask", cello: "ask" }
          const cello = MODES.get(recorded)
          return cello === undefined ? null : { native: recorded, cello }
        },
        open: (input) =>
          Effect.gen(function* () {
            let current: Deferred.Deferred<TurnEnded> | null = null
            yield* Effect.addFinalizer(() =>
              current === null ? Effect.void : Deferred.succeed(current, { outcome: "interrupted", exitCode: null, error: null }))
            return {
              resume: (prompt: string) =>
                Effect.gen(function* () {
                  const ended = yield* Deferred.make<TurnEnded>()
                  current = ended
                  const pid = nextPid++
                  input.onOutput({ stream: "stdout", line: JSON.stringify({ type: "system", subtype: "init", prompt }) })
                  input.onEvent({ type: "run.started", pid })
                  yield* Queue.offer(turns, {
                    input,
                    prompt,
                    pid,
                    finish: (turn) => Effect.asVoid(Deferred.done(ended, Exit.succeed(turn))),
                  })
                  return { pid, ended: Deferred.await(ended) }
                }),
            }
          }),
      },
    }
    return fake
  })
