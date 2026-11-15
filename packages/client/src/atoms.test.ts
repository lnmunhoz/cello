import type { Snapshot, Status, Task, Workspace } from "@cello/contract/entities"
import { VersionConflict } from "@cello/contract/errors"
import type { CelloEvent } from "@cello/contract/events"
import { describe, expect, it } from "vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import * as Atom from "effect/reactivity/Atom"
import * as AsyncResult from "effect/reactivity/AsyncResult"
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
  createdByActorId: "me", createdBySessionId: null, updatedByActorId: null, updatedBySessionId: null, stage: null, version: 2, createdAt: 1, updatedAt: 1, archivedAt: null,
}
const snapshot: Snapshot = {
  seq: 5,
  actors: [],
  workspaces: [workspace],
  projects: [],
  statuses: [status("todo", "a0"), status("done", "a1")],
  labels: [],
  tasks: [task],
  sessions: [],
  reviews: [],
  asks: [],
  documents: [],
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

  it("let a second quick edit expect the version the first one will make, instead of conflicting with it", async () => {
    const answer = Effect.runSync(Deferred.make<void>())
    const expected: number[] = []
    const fake = {
      "snapshot.get": () => Effect.succeed(snapshot),
      "events.subscribe": () => Stream.never,
      "task.update": (payload: { expectedVersion: number }) => {
        expected.push(payload.expectedVersion)
        return Deferred.await(answer).pipe(Effect.as({ result: task, seq: null }))
      },
    } as unknown as CelloClient["Service"]
    const atoms = makeCelloAtoms(Atom.runtime(Layer.succeed(CelloClient, fake)))
    const registry = AtomRegistry.make()
    registry.mount(atoms.boardAtom)
    registry.mount(atoms.commands.updateTask)
    const edit = async (fields: { priority?: 2; dueDate?: string }) => {
      const board = await Effect.runPromise(AtomRegistry.getResult(registry, atoms.boardAtom))
      registry.set(atoms.commands.updateTask, { id: "t1", expectedVersion: board.tasks["t1"]!.version, ...fields })
    }

    await edit({ priority: 2 })
    await edit({ dueDate: "2026-12-01" })
    expect(expected).toEqual([2, 3])
    Effect.runSync(Deferred.succeed(answer, undefined))
  })

  it("fetch a task's history again when the server's version changes, not on this tab's optimistic edit", async () => {
    const events = Effect.runSync(Queue.unbounded<CelloEvent>())
    let fetches = 0
    const fake = {
      "snapshot.get": () => Effect.succeed(snapshot),
      "events.subscribe": () => Stream.fromQueue(events),
      "comment.list": () => Effect.succeed([]),
      "task.history": () => Effect.sync(() => (fetches++, [])),
      "task.update": () => Effect.never,
    } as unknown as CelloClient["Service"]
    const atoms = makeCelloAtoms(Atom.runtime(Layer.succeed(CelloClient, fake)))
    const registry = AtomRegistry.make()
    registry.mount(atoms.boardAtom)
    registry.mount(atoms.commands.updateTask)
    await Effect.runPromise(AtomRegistry.getResult(registry, atoms.boardAtom))
    registry.mount(atoms.historyFamily("t1"))
    await Effect.runPromise(AtomRegistry.getResult(registry, atoms.historyFamily("t1")))
    expect(fetches).toBe(1)

    registry.set(atoms.commands.updateTask, { id: "t1", expectedVersion: 2, priority: 2 })
    expect((await Effect.runPromise(AtomRegistry.getResult(registry, atoms.boardAtom))).tasks["t1"]?.priority).toBe(2)
    await Effect.runPromise(AtomRegistry.getResult(registry, atoms.historyFamily("t1")))
    expect(fetches).toBe(1) // the server hasn't written it yet

    const envelope = { ts: 6, actorId: "me", sessionId: null, workspaceId: "w1", projectId: "p1", schemaVersion: 1 }
    const applied = (seq: number) =>
      Effect.runPromise(AtomRegistry.toStreamResult(registry, atoms.syncedAtom).pipe(Stream.filter((s) => s.state.seq >= seq), Stream.runHead))

    // A change to another task leaves this history alone.
    const other = { ...envelope, seq: 6, commandId: "c6", type: "task.created", task: { ...task, id: "t2", number: 2, key: "CEL-2" }, labelIds: [] }
    Effect.runSync(Queue.offer(events, other as CelloEvent))
    await applied(6)
    await Effect.runPromise(AtomRegistry.getResult(registry, atoms.historyFamily("t1")))
    expect(fetches).toBe(1)

    // The server's write of this task fetches it again.
    const update = { ...envelope, seq: 7, commandId: "c7", type: "task.updated", id: "t1", before: { priority: 0 }, after: { priority: 2 }, version: 3 }
    Effect.runSync(Queue.offer(events, update as CelloEvent))
    await applied(7)
    await Effect.runPromise(AtomRegistry.getResult(registry, atoms.historyFamily("t1")))
    expect(fetches).toBe(2)
  })

  it("fetch a page's body again when it gets a new version, not when another document changes", async () => {
    const events = Effect.runSync(Queue.unbounded<CelloEvent>())
    const project = { id: "p1", workspaceId: "w1", name: "Cello", key: "CEL", color: "#000", description: "", repoPath: null, createdAt: 1, updatedAt: 1, archivedAt: null }
    const doc = (id: string, version: number) => ({
      id, workspaceId: "w1", projectId: "p1", kind: "page" as const, slug: id, title: id, summary: "", version, tasks: [],
      createdByActorId: "a1", createdBySessionId: null, updatedByActorId: "a1", updatedBySessionId: null,
      updatedBy: { name: "Claude Code", color: "#7C3AED", session: null }, createdAt: 1, updatedAt: version, archivedAt: null,
    })
    const fetched: string[] = []
    const fake = {
      "snapshot.get": () => Effect.succeed({ ...snapshot, projects: [project], documents: [doc("report", 1), doc("other", 1)] }),
      "events.subscribe": () => Stream.fromQueue(events),
      "document.get": (payload: { project: { key: string }; slug: string; version?: number }) =>
        Effect.sync(() => {
          fetched.push(`${payload.project.key}/${payload.slug}${payload.version ? `@${payload.version}` : ""}`)
          return { ...doc(payload.slug, payload.version ?? fetched.length), body: `# ${payload.slug}` }
        }),
    } as unknown as CelloClient["Service"]
    const atoms = makeCelloAtoms(Atom.runtime(Layer.succeed(CelloClient, fake)))
    const registry = AtomRegistry.make()
    registry.mount(atoms.boardAtom)
    await Effect.runPromise(AtomRegistry.getResult(registry, atoms.boardAtom))
    const page = atoms.pageFamily("CEL/report")
    registry.mount(page)
    expect((await Effect.runPromise(AtomRegistry.getResult(registry, page))).body).toBe("# report")
    expect(fetched).toEqual(["CEL/report"])

    const envelope = { ts: 6, actorId: "a1", sessionId: null, workspaceId: "w1", projectId: "p1", schemaVersion: 1 }
    const applied = (seq: number) =>
      Effect.runPromise(AtomRegistry.toStreamResult(registry, atoms.syncedAtom).pipe(Stream.filter((s) => s.state.seq >= seq), Stream.runHead))
    Effect.runSync(Queue.offer(events, { ...envelope, seq: 6, commandId: "c6", type: "document.updated", id: "other", version: 2, document: doc("other", 2) } as CelloEvent))
    await applied(6)
    await Effect.runPromise(AtomRegistry.getResult(registry, page))
    expect(fetched).toEqual(["CEL/report"])

    Effect.runSync(Queue.offer(events, { ...envelope, seq: 7, commandId: "c7", type: "document.updated", id: "report", version: 2, document: doc("report", 2) } as CelloEvent))
    await applied(7)
    await Effect.runPromise(AtomRegistry.getResult(registry, page, { suspendOnWaiting: true }))
    expect(fetched).toEqual(["CEL/report", "CEL/report"])

    // An older version is fetched once, by number.
    const old = atoms.pageFamily("CEL/report@1")
    registry.mount(old)
    expect((await Effect.runPromise(AtomRegistry.getResult(registry, old))).version).toBe(1)
    expect(fetched.at(-1)).toBe("CEL/report@1")
  })

  it("show no board while a workspace switch loads, so no screen acts on the old workspace's rows", async () => {
    const side: Workspace = { ...workspace, id: "w2", name: "Side", slug: "side", position: "a1" }
    const sideReady = Effect.runSync(Deferred.make<void>())
    const fake = {
      "snapshot.get": ({ scope }: { scope?: { workspaceId: string } }) =>
        scope?.workspaceId === "w2"
          ? Deferred.await(sideReady).pipe(Effect.as({ ...snapshot, seq: 6, workspaces: [workspace, side], statuses: [], tasks: [] }))
          : Effect.succeed({ ...snapshot, workspaces: [workspace, side] }),
      "events.subscribe": () => Stream.never,
    } as unknown as CelloClient["Service"]
    const atoms = makeCelloAtoms(Atom.runtime(Layer.succeed(CelloClient, fake)))
    const registry = AtomRegistry.make()
    registry.mount(atoms.boardAtom)
    registry.mount(atoms.currentAtom)
    const before = await Effect.runPromise(AtomRegistry.getResult(registry, atoms.boardAtom))
    expect(before.tasks["t1"]).toBeDefined()

    registry.set(atoms.workspaceIdAtom, "w2")
    expect(AsyncResult.isSuccess(registry.get(atoms.boardAtom))).toBe(false)
    expect(AsyncResult.isSuccess(registry.get(atoms.currentAtom))).toBe(false)

    Effect.runSync(Deferred.succeed(sideReady, undefined))
    const after = await Effect.runPromise(AtomRegistry.getResult(registry, atoms.boardAtom))
    expect(after.tasks).toEqual({})
    const current = await Effect.runPromise(AtomRegistry.getResult(registry, atoms.currentAtom))
    expect(current.scope).toEqual({ workspaceId: "w2" })
  })

  it("ask for the server's build when the connection goes live, and again each time it comes back (CEL-37)", async () => {
    const build = (commit: string) => ({ version: "0.2.0", commit, startedAt: 1, web: { version: "0.2.0", commit, builtAt: 1, changes: [] } })
    const drop = Effect.runSync(Deferred.make<void>())
    let subscribes = 0
    const answers = [build("aaaaaaa"), build("bbbbbbb")]
    let asked = 0
    const fake = {
      "snapshot.get": () => Effect.succeed(snapshot),
      // The first stream drops when told to (the server restarting); the next one stays up.
      "events.subscribe": () =>
        ++subscribes === 1 ? Stream.fromEffect(Deferred.await(drop)).pipe(Stream.flatMap(() => Stream.fail("dropped"))) : Stream.never,
      "server.build": () => Effect.sync(() => answers[Math.min(asked++, answers.length - 1)]),
    } as unknown as CelloClient["Service"]
    const atoms = makeCelloAtoms(Atom.runtime(Layer.succeed(CelloClient, fake)), { retryDelay: 0 })
    const registry = AtomRegistry.make()
    registry.mount(atoms.serverBuildAtom)
    expect((await Effect.runPromise(AtomRegistry.getResult(registry, atoms.serverBuildAtom))).commit).toBe("aaaaaaa")
    expect(asked).toBe(1)

    Effect.runSync(Deferred.succeed(drop, undefined))
    const next = await Effect.runPromise(
      AtomRegistry.toStreamResult(registry, atoms.serverBuildAtom).pipe(Stream.filter((b) => b.commit === "bbbbbbb"), Stream.runHead),
    )
    expect(next._tag).toBe("Some")
    expect(asked).toBe(2)
    expect(subscribes).toBe(2)
  })

  it("ask for the build history once the server's build is known, and again when a new build comes up (CEL-50)", async () => {
    const build = (commit: string) => ({ version: "0.2.0", commit, startedAt: 1, web: { version: "0.2.0", commit, builtAt: 1, changes: [] } })
    const drop = Effect.runSync(Deferred.make<void>())
    let subscribes = 0
    let builds = 0
    const asked: Array<{ limit?: number }> = []
    const running = () => (builds === 1 ? "0.2.0+aaaaaaa.1" : "0.2.0+bbbbbbb.1")
    const fake = {
      "snapshot.get": () => Effect.succeed(snapshot),
      "events.subscribe": () =>
        ++subscribes === 1 ? Stream.fromEffect(Deferred.await(drop)).pipe(Stream.flatMap(() => Stream.fail("dropped"))) : Stream.never,
      "server.build": () => Effect.sync(() => build(++builds === 1 ? "aaaaaaa" : "bbbbbbb")),
      "builds.list": (page: { limit?: number }) =>
        Effect.sync(() => {
          asked.push(page)
          return { builds: [], running: running(), next: null }
        }),
    } as unknown as CelloClient["Service"]
    const atoms = makeCelloAtoms(Atom.runtime(Layer.succeed(CelloClient, fake)), { retryDelay: 0 })
    const registry = AtomRegistry.make()
    const history = atoms.buildsFamily(50)
    registry.mount(history)
    expect((await Effect.runPromise(AtomRegistry.getResult(registry, history))).running).toBe("0.2.0+aaaaaaa.1")
    expect(asked).toEqual([{ limit: 50 }])

    Effect.runSync(Deferred.succeed(drop, undefined))
    const next = await Effect.runPromise(
      AtomRegistry.toStreamResult(registry, history).pipe(Stream.filter((page) => page.running === "0.2.0+bbbbbbb.1"), Stream.runHead),
    )
    expect(next._tag).toBe("Some")
  })
})
