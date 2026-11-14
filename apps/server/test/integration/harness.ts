// Real servers on ephemeral ports with temp data folders, and real clients over WebSockets.
import * as BunSocket from "@effect/platform-bun/BunSocket"
import { CelloClient, makeClientLayer } from "@cello/client/client"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"

export { HUMAN, startServer, tempDataDir } from "../../src/testing/servers.ts"

/** Identity headers that make a client an agent session (the default client is the human). */
export const AGENT_IDENTITY = { "x-cello-session": "agent-session-1", "x-cello-client": "Claude Code" } as const

/** A client connected to `port`; it disconnects when the scope closes. */
export const connect = (
  port: number,
  identity: Readonly<Record<string, string>> = {},
): Effect.Effect<CelloClient["Service"], never, Scope.Scope> =>
  Layer.build(makeClientLayer(BunSocket.layerWebSocket(`ws://127.0.0.1:${port}/rpc`), identity)).pipe(
    Effect.map((context) => Context.get(context, CelloClient)),
  )

/** Runs `use` with a client in its own scope, so closing it is a real disconnect. */
export const withClient = <A, E, R>(port: number, use: (client: CelloClient["Service"]) => Effect.Effect<A, E, R>) =>
  Effect.scoped(Effect.flatMap(connect(port), use))
