// Test 14: an optimistic move the server refuses (VersionConflict) rolls back in the client's state.
import type { BoardState } from "@cello/client/sync/applyEvents"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as Option from "effect/Option"
import * as Atom from "effect/reactivity/Atom"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import * as Socket from "effect/socket/Socket"
import { AGENT_IDENTITY, connect, startServer, tempDataDir } from "../../../../apps/server/test/integration/harness.ts"
import { makeCelloAtoms } from "../../src/atoms.ts"
import { makeClientLayer, newCommandId } from "../../src/client.ts"

/** The first board state that satisfies `ready`, as the sync delivers it. */
const boardWhere = (
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<BoardState, unknown>>,
  ready: (board: BoardState) => boolean,
) =>
  AtomRegistry.toStreamResult(registry, atom).pipe(
    Stream.filter(ready),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  )

describe("optimistic commands against the real server", () => {
  it.live("a move the server refuses with VersionConflict rolls back", () =>
    Effect.gen(function* () {
      const { port } = yield* startServer(yield* tempDataDir)
      const other = yield* connect(port, AGENT_IDENTITY)

      const errors: string[] = []
      const runtime = Atom.runtime(makeClientLayer(
        Socket.layerWebSocket(`ws://127.0.0.1:${port}/rpc`).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal)),
      ))
      const atoms = makeCelloAtoms(runtime, { onError: (message) => errors.push(message) })
      const registry = AtomRegistry.make()
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
      registry.mount(atoms.boardAtom)
      registry.mount(atoms.commands.moveTask)

      // An agent creates a task, then edits it: version 2 on the server.
      const snapshot = yield* other["snapshot.get"]({})
      const done = snapshot.statuses.find((s) => s.name === "Done")!
      const { result: project } = yield* other["project.create"]({ commandId: newCommandId(), workspaceId: snapshot.workspaces[0]!.id, name: "Cello", key: "CEL" })
      const { result: task } = yield* other["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Wire the store" })
      const { seq: editSeq } = yield* other["task.update"]({ commandId: newCommandId(), id: task.id, expectedVersion: 1, title: "Wire the SQLite store" })
      const before = yield* boardWhere(registry, atoms.boardAtom, (b) => b.seq >= editSeq!)
      expect(before.tasks[task.id]).toMatchObject({ statusId: task.statusId, version: 2 })

      // This client still thinks it's version 1 and moves it to Done.
      const seen: BoardState[] = []
      const unsubscribe = registry.subscribe(atoms.boardAtom, (result) => {
        if (AsyncResult.isSuccess(result)) seen.push(result.value)
      })
      registry.set(atoms.commands.moveTask, { id: task.id, expectedVersion: 1, statusId: done.id, position: "zz", before: null, after: null })
      const exit = yield* Effect.exit(AtomRegistry.getResult(registry, atoms.commands.moveTask, { suspendOnWaiting: true }))
      unsubscribe()

      expect(Exit.isFailure(exit)).toBe(true)
      expect(seen.some((b) => b.tasks[task.id]?.statusId === done.id)).toBe(true) // shown at once
      const after = Option.getOrThrow(AsyncResult.value(registry.get(atoms.boardAtom)))
      expect(after.tasks[task.id]).toMatchObject({ statusId: task.statusId, version: 2 }) // rolled back
      expect(registry.get(atoms.pendingAtom)).toEqual([])
      expect(errors).toEqual(["CEL-1 was changed by Claude Code since you opened it"])
    }).pipe(Effect.scoped))
})
