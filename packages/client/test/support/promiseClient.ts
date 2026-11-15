// The Cello client behind Promises, for code that runs outside Effect: the Playwright e2e tests seed
// data with it. It lives in this package so `effect` resolves from here.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as Socket from "effect/socket/Socket"
import { CelloClient, makeClientLayer, newCommandId } from "../../src/client.ts"

export { newCommandId }

export interface PromiseClient {
  /** Runs one call, e.g. `run((c) => c["snapshot.get"]({}))`. */
  readonly run: <A, E>(call: (client: CelloClient["Service"]) => Effect.Effect<A, E>) => Promise<A>
  readonly close: () => Promise<void>
}

/**
 * Connects over a WebSocket (`ws://127.0.0.1:4791/rpc`). Uses the runtime's global WebSocket.
 * `identity` is the CLI's identity headers (`x-cello-session`…): with them, calls come from that agent session.
 */
export const openClient = async (url: string, identity: Readonly<Record<string, string>> = {}): Promise<PromiseClient> => {
  const scope = Effect.runSync(Scope.make())
  const socket = Socket.layerWebSocket(url).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal))
  const context = await Effect.runPromise(Layer.buildWithScope(makeClientLayer(socket, identity), scope))
  const client = Context.get(context, CelloClient)
  return {
    run: (call) => Effect.runPromise(call(client)),
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  }
}
