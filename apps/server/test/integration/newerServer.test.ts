// CEL-131: this build's client following a NEWER server, one whose contract has an event type this
// build lacks. Real WebSocket, real RPC serialization, real client: the stream must skip the unknown
// event and stay live, where it used to fail to decode it and reconnect from the same seq forever.
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer"
import * as BunSocket from "@effect/platform-bun/BunSocket"
import { Scope, Snapshot, type Workspace } from "@cello/contract/entities"
import { NotFound, SnapshotRequired } from "@cello/contract/errors"
import { CelloEvent } from "@cello/contract/events"
import { describe, expect, it } from "@effect/vitest"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServer from "effect/http/HttpServer"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as RpcServer from "effect/rpc/RpcServer"
import { CelloClient, makeClientLayer } from "@cello/client/client"
import { follow, sourceFromClient, type Synced } from "@cello/client/sync/follow"

const envelope = { ts: 1, commandId: "c", actorId: "me", sessionId: null, workspaceId: "w1", projectId: null, schemaVersion: 1 as const }
const workspace = (id: string, position: string): Workspace => ({ id, name: id, slug: id, position, createdAt: 1, updatedAt: 1, archivedAt: null })

/** An event type a later build added: this build's `CelloEvent` doesn't have it. */
const FutureEvent = Schema.Struct({
  seq: Schema.Number,
  ts: Schema.Number,
  commandId: Schema.String,
  actorId: Schema.String,
  sessionId: Schema.NullOr(Schema.String),
  workspaceId: Schema.String,
  projectId: Schema.NullOr(Schema.String),
  schemaVersion: Schema.Literal(1),
  type: Schema.Literal("session.orchestrating"),
  session: Schema.String,
  on: Schema.Boolean,
})

/** The two RPCs sync uses, as the newer server defines them: its event union has one more type. */
const NewerRpcs = RpcGroup.make(
  Rpc.make("snapshot.get", { payload: { scope: Schema.optionalKey(Scope) }, success: Snapshot, error: NotFound }),
  Rpc.make("events.subscribe", {
    payload: { scope: Scope, afterSeq: Schema.Number },
    success: Schema.Union([CelloEvent, FutureEvent]),
    error: SnapshotRequired,
    stream: true,
  }),
)

const snapshot: Snapshot = {
  seq: 10, actors: [], workspaces: [workspace("w1", "a0")], projects: [], statuses: [], labels: [], tasks: [],
  sessions: [], agents: [], reviews: [], asks: [], documents: [],
}

/** Serves the snapshot, then a known event, the new type, and another known event; then stays open. */
const newerServer = RpcServer.layer(NewerRpcs).pipe(
  Layer.provide(NewerRpcs.toLayer({
    "snapshot.get": () => Effect.succeed(snapshot),
    "events.subscribe": () =>
      Stream.concat(
        Stream.make(
          { ...envelope, seq: 11, type: "workspace.created" as const, workspace: workspace("w2", "a1") },
          { ...envelope, seq: 12, type: "session.orchestrating" as const, session: "s1", on: true },
          { ...envelope, seq: 13, type: "workspace.created" as const, workspace: workspace("w3", "a2") },
        ),
        Stream.never,
      ),
  })),
  Layer.provideMerge(RpcServer.layerProtocolWebsocket({ path: "/rpc" })),
  Layer.provide(RpcSerialization.layerJson),
)

describe("a client following a newer server (CEL-131)", () => {
  it.live("skips the event type it doesn't know, applies the next one, and stays live", () =>
    Effect.gen(function* () {
      const server = yield* Layer.build(
        HttpRouter.serve(newerServer, { disableLogger: true }).pipe(Layer.provideMerge(BunHttpServer.layer({ hostname: "127.0.0.1", port: 0 }))),
      )
      const address = Context.get(server, HttpServer.HttpServer).address
      const port = "port" in address ? address.port : 0
      const client = Context.get(
        yield* Layer.build(makeClientLayer(BunSocket.layerWebSocket(`ws://127.0.0.1:${port}/rpc`))),
        CelloClient,
      )

      const states: Synced[] = []
      yield* follow(sourceFromClient(client)).pipe(
        Stream.takeUntil((s) => s.state.seq >= 13),
        Stream.runForEach((s) => Effect.sync(() => states.push(s))),
      )

      const last = states.at(-1)!
      expect(Object.keys(last.state.workspaces).sort()).toEqual(["w1", "w2", "w3"])
      expect(last.unreadable).toBe(1)
      expect(states.map((s) => s.connection)).not.toContain("reconnecting")
    }).pipe(Effect.scoped))
})
