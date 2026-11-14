import type { Snapshot, Status, Task, Workspace } from "@cello/contract/entities"
import { VersionConflict } from "@cello/contract/errors"
import { describe, expect, it } from "vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { makeCelloAtoms } from "./atoms.ts"
import { CelloClient } from "./client.ts"

const workspace: Workspace = { id: "w1", name: "Personal", slug: "personal", position: "a0", createdAt: 1, updatedAt: 1, archivedAt: null }
const status = (id: string, position: string): Status => ({
  id, workspaceId: "w1", name: id, category: "unstarted", position, color: "#999", hidden: false, createdAt: 1, updatedAt: 1,
})
const task: Task = {
  id: "t1", projectId: "p1", number: 1, key: "CEL-1", title: "First", description: "", statusId: "todo", priority: 0,
  position: "a0", dueDate: null, parentId: null, labelIds: [], assigneeActorId: null, assigneeSessionId: null,
  createdByActorId: "me", createdBySessionId: null, version: 2, createdAt: 1, updatedAt: 1, archivedAt: null,
}
const snapshot: Snapshot = {
  seq: 5,
  actors: [],
  workspaces: [workspace],
  projects: [],
  statuses: [status("todo", "a0"), status("done", "a1")],
  labels: [],
  tasks: [task],
  reviews: [],
}

describe("command atoms", () => {
  it("show a move at once and roll it back when the server refuses it", async () => {
    const answer = Effect.runSync(Deferred.make<void>())
    const fake = {
      "snapshot.get": () => Effect.succeed(snapshot),
      "events.subscribe": () => Stream.never,
      "task.move": () =>
        Deferred.await(answer).pipe(
          Effect.andThen(Effect.fail(new VersionConflict({ entity: "task", id: "t1", currentVersion: 3, changedBy: "Claude" }))),
        ),
    } as unknown as CelloClient["Service"]
    const runtime = Atom.runtime(Layer.succeed(CelloClient, fake))
    const errors: string[] = []
    const atoms = makeCelloAtoms(runtime, { onError: (message) => errors.push(message) })
    const registry = AtomRegistry.make()
    registry.mount(atoms.boardAtom)

    const before = await Effect.runPromise(AtomRegistry.getResult(registry, atoms.boardAtom))
    expect(before.tasks["t1"]?.statusId).toBe("todo")

    registry.mount(atoms.commands.moveTask)
    registry.set(atoms.commands.moveTask, { id: "t1", expectedVersion: 1, statusId: "done", position: "a1", before: null, after: null })
    const during = await Effect.runPromise(AtomRegistry.getResult(registry, atoms.boardAtom))
    expect(during.tasks["t1"]?.statusId).toBe("done")

    Effect.runSync(Deferred.succeed(answer, undefined))
    const exit = await Effect.runPromise(Effect.exit(AtomRegistry.getResult(registry, atoms.commands.moveTask, { suspendOnWaiting: true })))
    expect(exit._tag).toBe("Failure")

    const after = await Effect.runPromise(AtomRegistry.getResult(registry, atoms.boardAtom))
    expect(after.tasks["t1"]?.statusId).toBe("todo")
    expect(errors).toEqual(["CEL-1 was changed by Claude since you opened it"])
  })
})
