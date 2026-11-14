// Spike (d): measure CLI → live subscriber latency and check command-id retries.
import * as BunRuntime from "@effect/platform-bun/BunRuntime"
import * as BunSocket from "@effect/platform-bun/BunSocket"
import * as Console from "effect/Console"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import { CelloClient, makeClientLayer } from "./client.ts"
import type { CelloEvent } from "./contract.ts"

const URL = "ws://127.0.0.1:4747/rpc"
const RUNS = 10

const program = Effect.gen(function* () {
  const client = yield* CelloClient

  // 1. Retry safety: the same command id twice gives one task.
  const commandId = crypto.randomUUID()
  const first = yield* client["task.create"]({ title: "Retry check", commandId })
  const second = yield* client["task.create"]({ title: "Retry check", commandId })
  yield* Console.log(`retry: first ${first.task.key}/seq ${first.seq}, second ${second.task.key}/seq ${second.seq}, same=${first.task.id === second.task.id}`)

  // 2. Latency: spawn the real CLI and time until the subscriber sees its event.
  const { seq } = yield* client["snapshot.get"]()
  const results: Array<{ total: number; serverToClient: number }> = []
  for (let i = 0; i < RUNS; i++) {
    const seen = yield* Deferred.make<CelloEvent>()
    const title = `Latency run ${i + 1}`
    const watcher = yield* client["events.subscribe"]({ afterSeq: seq + 10_000 * 0 }).pipe(
      Stream.filter((event) => event.task.title === title),
      Stream.take(1),
      Stream.runForEach((event) => Deferred.succeed(seen, event)),
      Effect.forkChild,
    )
    yield* Effect.sleep("50 millis") // let the subscription join the live channel
    const spawnedAt = Date.now()
    const proc = Bun.spawn(["bun", "src/cli.ts", "task", "create", title], { stdout: "ignore", stderr: "inherit" })
    const event = yield* Deferred.await(seen)
    const receivedAt = Date.now()
    yield* Effect.promise(() => proc.exited)
    yield* Fiber.interrupt(watcher)
    results.push({ total: receivedAt - spawnedAt, serverToClient: receivedAt - event.task.createdAt })
  }
  const avg = (xs: number[]) => (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1)
  const max = (xs: number[]) => Math.max(...xs)
  yield* Console.log(`CLI spawn → subscriber, ${RUNS} runs: avg ${avg(results.map((r) => r.total))} ms, max ${max(results.map((r) => r.total))} ms`)
  yield* Console.log(`server commit → subscriber: avg ${avg(results.map((r) => r.serverToClient))} ms, max ${max(results.map((r) => r.serverToClient))} ms`)
})

program.pipe(Effect.provide(makeClientLayer(BunSocket.layerWebSocket(URL), {})), BunRuntime.runMain)
