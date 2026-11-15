import { describe, expect, it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as SqlClient from "effect/sql/SqlClient"
import { cmd } from "../testing/fixtures.ts"
import { asHuman, services } from "../testing/TestLayers.ts"
import * as Commands from "./Commands.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) => asHuman(effect).pipe(Effect.provide(services())) as Effect.Effect<A, E>

const receipts = (commandId: string) =>
  Effect.flatMap(Effect.service(SqlClient.SqlClient), (sql) =>
    sql<{ result: string }>`SELECT result FROM command_receipts WHERE command_id = ${commandId}`)

describe("Commands", () => {
  // Shutting down interrupts the requests in flight (CEL-17). A write that has started commits.
  it.effect("a write that has started still commits when its request is interrupted", () =>
    run(Effect.gen(function* () {
      const commands = yield* Commands.Commands
      const entered = yield* Deferred.make<void>()
      const gate = yield* Deferred.make<void>()
      const commandId = cmd()
      const write = yield* Effect.forkChild(
        commands.write({ commandId, rpc: "test.write" }, () =>
          Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(gate)), Effect.as("written"))),
      )
      yield* Deferred.await(entered)
      // Interrupted mid-transaction, as a closing connection or a stopping server does.
      write.interruptUnsafe()
      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.await(write)
      expect(yield* receipts(commandId)).toEqual([{ result: JSON.stringify("written") }])
    })))

  it.effect("a write still waiting for its turn is cancelled by an interrupt and writes nothing", () =>
    run(Effect.gen(function* () {
      const commands = yield* Commands.Commands
      const entered = yield* Deferred.make<void>()
      const gate = yield* Deferred.make<void>()
      const first = yield* Effect.forkChild(
        commands.write({ commandId: cmd(), rpc: "test.write" }, () =>
          Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(gate)), Effect.as("first"))),
      )
      yield* Deferred.await(entered)
      const queuedId = cmd()
      const calling = yield* Deferred.make<void>()
      let ran = false
      const queued = yield* Effect.forkChild(Deferred.succeed(calling, undefined).pipe(
        Effect.andThen(commands.write({ commandId: queuedId, rpc: "test.write" }, () => Effect.sync(() => (ran = true)))),
      ))
      // `calling` wakes this fiber only once the queued one has suspended, and the only place it can
      // suspend before its change runs is the wait for the first write's permit.
      yield* Deferred.await(calling)
      expect(ran).toBe(false)
      yield* Fiber.interrupt(queued)
      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.join(first)
      expect(Exit.hasInterrupts(yield* Fiber.await(queued))).toBe(true)
      expect(ran).toBe(false)
      expect(yield* receipts(queuedId)).toEqual([])
    })))
})
