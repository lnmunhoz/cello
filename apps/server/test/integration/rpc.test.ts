// The RPC surface over a real socket: tagged errors arrive intact, retries are safe, and only local
// pages may connect.
import { newCommandId } from "@cello/client/client"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { connect, startServer, tempDataDir } from "./harness.ts"

describe("rpc", () => {
  it.live("tagged errors and command receipts work over the wire", () =>
    Effect.gen(function* () {
      const { port } = yield* startServer(yield* tempDataDir)
      const client = yield* connect(port)
      const workspaceId = (yield* client["snapshot.get"]({})).workspaces[0]!.id
      const create = { commandId: newCommandId(), workspaceId, name: "ThaiLookup", key: "THAI" }
      const first = yield* client["project.create"](create)
      expect(yield* client["project.create"](create)).toEqual(first)

      const taken = yield* Effect.flip(client["project.create"]({ ...create, commandId: newCommandId(), name: "Other" }))
      expect(taken).toMatchObject({ _tag: "KeyTaken", key: "THAI", projectName: "ThaiLookup" })

      const { result: task } = yield* client["task.create"]({ commandId: newCommandId(), projectId: first.result.id, title: "T" })
      yield* client["task.update"]({ commandId: newCommandId(), id: task.id, expectedVersion: 1, title: "T2" })
      const conflict = yield* Effect.flip(
        client["task.update"]({ commandId: newCommandId(), id: task.id, expectedVersion: 1, title: "T3" }),
      )
      expect(conflict).toMatchObject({ _tag: "VersionConflict", currentVersion: 2, changedBy: "Lucas" })
    }).pipe(Effect.scoped))

  it.live("refuses requests from other origins or hosts", () =>
    Effect.gen(function* () {
      const { port } = yield* startServer(yield* tempDataDir)
      const status = (headers: Record<string, string>) =>
        Effect.promise(() => fetch(`http://127.0.0.1:${port}/rpc`, { headers }).then((r) => r.status))
      expect(yield* status({ origin: "http://evil.example" })).toBe(403)
      expect(yield* status({ origin: `http://localhost:${port}`, upgrade: "websocket" })).not.toBe(403)
      expect(yield* status({ origin: "http://localhost:5199" })).not.toBe(403)
    }).pipe(Effect.scoped))
})
