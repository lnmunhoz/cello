// Spike (d): `cello task create <title>`. Parse args, one RPC, format output.
import * as BunRuntime from "@effect/platform-bun/BunRuntime"
import * as BunServices from "@effect/platform-bun/BunServices"
import * as BunSocket from "@effect/platform-bun/BunSocket"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Argument from "effect/cli/Argument"
import * as Command from "effect/cli/Command"
import { IDENTITY_HEADERS } from "./contract.ts"
import { CelloClient, makeClientLayer } from "./client.ts"

const URL = `ws://127.0.0.1:${process.env.CELLO_PORT ?? 4747}/rpc`

const identity: Record<string, string> = {}
const session = process.env.CELLO_SESSION ?? process.env.CLAUDE_CODE_SESSION_ID
if (session && session !== "me") {
  identity[IDENTITY_HEADERS.session] = session
  identity[IDENTITY_HEADERS.client] = process.env.CLAUDE_CODE_SESSION_ID ? "Claude Code" : "agent"
  if (process.env.CLAUDE_PID) identity[IDENTITY_HEADERS.pid] = process.env.CLAUDE_PID
}

const create = Command.make("create", { title: Argument.String("title") }).pipe(
  Command.withDescription("Create a task in the current project."),
  Command.withHandler(({ title }) =>
    Effect.gen(function* () {
      const client = yield* CelloClient
      const started = performance.now()
      const { task, seq } = yield* client["task.create"]({ title, commandId: crypto.randomUUID() }).pipe(
        Effect.catchTag("EmptyTitle", () => Effect.fail(new Error("A task needs a title. Try: cello task create \"Fix login\""))),
      )
      const ms = (performance.now() - started).toFixed(1)
      yield* Console.log(`Created ${task.key} "${task.title}" by ${task.actor} (event ${seq}, ${ms} ms)`)
    }).pipe(Effect.provide(makeClientLayer(BunSocket.layerWebSocket(URL), identity)))),
)

const task = Command.make("task").pipe(Command.withSubcommands([create]))
const cello = Command.make("cello").pipe(Command.withSubcommands([task]))

Command.run(cello, { version: "0.0.0-spike" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
)
