// The thin atom layer over the pure sync and command code: one synced atom fed by `follow`,
// a list of optimistic patches, the view the screens read, and command atoms for writes.
import type { Comment, Priority, Scope } from "@cello/contract/entities"
import type { CelloEvent } from "@cello/contract/events"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Stream from "effect/Stream"
import * as Atom from "effect/reactivity/Atom"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import type * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { CelloClient, newCommandId } from "./client.ts"
import { describeError } from "./commands/describeError.ts"
import { begin, confirm, pendingOf, prune, rollback, view, type Patch, type Pending } from "./commands/optimistic.ts"
import * as patches from "./commands/patches.ts"
import { applyCommentEvents } from "./sync/comments.ts"
import { follow, followsWorkspace, sourceFromClient, type Synced } from "./sync/follow.ts"
import type { BoardState } from "./sync/applyEvents.ts"

type Client = CelloClient["Service"]

export interface CommandSpec<Args, A, E> {
  /** The change to show at once, or null for none. `commandId` doubles as a temporary row id. */
  readonly patch?: (args: Args, ctx: { readonly state: BoardState; readonly commandId: string }) => Patch | null
  readonly call: (client: Client, args: Args, commandId: string) => Effect.Effect<{ readonly result: A; readonly seq: number | null }, E>
  /** What the error toast names, like a task key. */
  readonly subject?: (args: Args, state: BoardState) => string | undefined
  /** Runs after the RPC succeeds, with the registry. */
  readonly onSuccess?: (registry: AtomRegistry.AtomRegistry) => void
  /** Errors the screen shows itself, so no toast. */
  readonly quiet?: (error: unknown) => boolean
}

export interface CelloAtomsOptions {
  /** Shown when a command fails, after its patch is rolled back. */
  readonly onError?: (message: string, error: unknown) => void
  readonly retryDelay?: number
}

export const makeCelloAtoms = (runtime: Atom.AtomRuntime<CelloClient, any>, options: CelloAtomsOptions = {}) => {
  /** The workspace to follow; null follows the server's default. */
  const workspaceIdAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive)

  const syncedAtom = runtime
    .atom((get) => {
      const workspaceId = get(workspaceIdAtom)
      const scope: Scope | undefined = workspaceId === null ? undefined : { workspaceId }
      return Stream.unwrap(
        Effect.gen(function* () {
          const client = yield* CelloClient
          return follow(sourceFromClient(client), { ...(scope ? { scope } : {}), retryDelay: options.retryDelay ?? 1000 })
        }),
      )
    })
    .pipe(Atom.keepAlive)

  const pendingAtom = Atom.make<ReadonlyArray<Pending>>([]).pipe(Atom.keepAlive)

  /**
   * The synced state of the workspace asked for. While a switch loads, the synced atom still holds
   * the old workspace's state; this waits instead, so no screen acts on the old workspace's rows.
   */
  const currentAtom = Atom.make((get): AsyncResult.AsyncResult<Synced, unknown> => {
    const synced = get(syncedAtom)
    const wanted = get(workspaceIdAtom)
    if (AsyncResult.isSuccess(synced) && !followsWorkspace(synced.value, wanted)) return AsyncResult.initial(true)
    return synced
  })

  /** What the screens show: synced state plus the live optimistic patches. */
  const boardAtom = Atom.make((get) => AsyncResult.map(get(currentAtom), (synced) => view(synced, get(pendingAtom))))

  const current = (registry: AtomRegistry.AtomRegistry) => {
    const synced = registry.get(syncedAtom)
    return AsyncResult.isSuccess(synced) ? synced.value : null
  }

  const command = <Args, A, E>(spec: CommandSpec<Args, A, E>) =>
    runtime.fn(
      (args: Args, get) =>
        Effect.gen(function* () {
          const client = yield* CelloClient
          const registry = get.registry
          const commandId = newCommandId()
          const synced = current(registry)
          const shown = synced ? view(synced, registry.get(pendingAtom)) : null
          const patch = synced && shown ? (spec.patch?.(args, { state: shown, commandId }) ?? null) : null
          if (synced && patch) {
            registry.set(pendingAtom, begin(prune(registry.get(pendingAtom), synced), pendingOf(commandId, synced.epoch, patch)))
          }
          const exit = yield* Effect.exit(spec.call(client, args, commandId))
          if (Exit.isSuccess(exit)) {
            registry.set(pendingAtom, confirm(registry.get(pendingAtom), commandId, exit.value.seq))
            spec.onSuccess?.(registry)
            return exit.value.result
          }
          registry.set(pendingAtom, rollback(registry.get(pendingAtom), commandId))
          if (!Cause.hasInterruptsOnly(exit.cause)) {
            const error = Cause.squash(exit.cause)
            if (!spec.quiet?.(error)) options.onError?.(describeError(error, { subject: shown ? spec.subject?.(args, shown) : undefined }), error)
          }
          return yield* Effect.failCause(exit.cause)
        }),
      { concurrent: true },
    )

  const taskKey = (args: { readonly id: string }, state: BoardState) => state.tasks[args.id]?.key

  const commands = {
    createWorkspace: command({
      call: (c, a: { name: string }, commandId) => c["workspace.create"]({ commandId, ...a }),
      // workspace.created goes to the new workspace's scope, so take a fresh snapshot to list it.
      onSuccess: (registry) => registry.refresh(syncedAtom),
    }),
    createProject: command({
      call: (c, a: { workspaceId: string; name: string; key: string; color?: string; repoPath?: string }, commandId) =>
        c["project.create"]({ commandId, ...a }),
      quiet: (e) => (e as { _tag?: string })._tag === "KeyTaken",
    }),
    updateProject: command({
      patch: (a: { id: string; name?: string; color?: string; description?: string }) => patches.updateProject(a.id, a),
      call: (c, a, commandId) => c["project.update"]({ commandId, ...a }),
    }),
    createTask: command({
      patch: (
        a: { projectId: string; title: string; statusId: string; position: string; before: string | null; after: string | null },
        { state, commandId },
      ) => {
        const project = state.projects[a.projectId]
        if (!project) return null
        const now = Date.now()
        return patches.addTask({
          id: `optimistic:${commandId}`,
          projectId: a.projectId,
          number: 0,
          key: `${project.key}-…`,
          title: a.title,
          description: "",
          statusId: a.statusId,
          priority: 0,
          position: a.position,
          dueDate: null,
          parentId: null,
          labelIds: [],
          assigneeActorId: null,
          assigneeSessionId: null,
          createdByActorId: "",
          createdBySessionId: null,
          version: 0,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
        })
      },
      call: (c, a, commandId) =>
        c["task.create"]({ commandId, projectId: a.projectId, title: a.title, statusId: a.statusId, before: a.before, after: a.after }),
    }),
    moveTask: command({
      patch: (a: { id: string; expectedVersion?: number; statusId: string; position: string; before: string | null; after: string | null }) =>
        patches.moveTask(a.id, a.statusId, a.position),
      call: (c, a, commandId) =>
        c["task.move"]({
          commandId,
          id: a.id,
          statusId: a.statusId,
          before: a.before,
          after: a.after,
          ...(a.expectedVersion === undefined ? {} : { expectedVersion: a.expectedVersion }),
        }),
      subject: taskKey,
    }),
    updateTask: command({
      patch: (a: {
        id: string
        expectedVersion: number
        title?: string
        description?: string
        priority?: Priority
        dueDate?: string | null
        parentId?: string | null
      }) => {
        const { id, expectedVersion: _, ...fields } = a
        return patches.updateTask(id, fields)
      },
      call: (c, a, commandId) => c["task.update"]({ commandId, ...a }),
      subject: taskKey,
    }),
    setTaskLabels: command({
      patch: (a: { id: string; add: ReadonlyArray<string>; remove: ReadonlyArray<string> }) => patches.setTaskLabels(a.id, a.add, a.remove),
      call: (c, a, commandId) => c["task.setLabels"]({ commandId, ...a }),
      subject: taskKey,
    }),
    archiveTask: command({
      patch: (a: { id: string }) => patches.archiveTask(a.id),
      call: (c, a, commandId) => c["task.archive"]({ commandId, ...a }),
      subject: taskKey,
    }),
    updateStatus: command({
      patch: (a: { id: string; name?: string; color?: string; hidden?: boolean; position?: string; before?: string | null; after?: string | null }) =>
        patches.updateStatus(a.id, {
          ...(a.name === undefined ? {} : { name: a.name }),
          ...(a.color === undefined ? {} : { color: a.color }),
          ...(a.hidden === undefined ? {} : { hidden: a.hidden }),
          ...(a.position === undefined ? {} : { position: a.position }),
        }),
      call: (c, a, commandId) => {
        const { position: _, ...rest } = a
        return c["status.update"]({ commandId, ...rest })
      },
    }),
    createLabel: command({
      patch: (a: { workspaceId: string; name: string; color: string }, { commandId }) => {
        const now = Date.now()
        return patches.addLabel({ id: `optimistic:${commandId}`, ...a, createdAt: now, updatedAt: now, archivedAt: null })
      },
      call: (c, a, commandId) => c["label.create"]({ commandId, ...a }),
    }),
    updateLabel: command({
      patch: (a: { id: string; name?: string; color?: string }) => patches.updateLabel(a.id, a),
      call: (c, a, commandId) => c["label.update"]({ commandId, ...a }),
    }),
    archiveLabel: command({
      patch: (a: { id: string }) => patches.archiveLabel(a.id),
      call: (c, a, commandId) => c["label.archive"]({ commandId, ...a }),
    }),
    addComment: command({
      call: (c, a: { taskId: string; body: string }, commandId) => c["comment.add"]({ commandId, ...a }),
    }),
    editComment: command({
      call: (c, a: { id: string; body: string }, commandId) => c["comment.edit"]({ commandId, ...a }),
    }),
    deleteComment: command({
      call: (c, a: { id: string }, commandId) => c["comment.delete"]({ commandId, ...a }),
    }),
  }

  /** A task's comments: loaded once, then kept current from the event stream. */
  const commentsFamily = Atom.family((taskId: string) =>
    runtime.atom((get) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const client = yield* CelloClient
          const first = yield* client["comment.list"]({ taskId })
          return Stream.concat(
            Stream.make(first as ReadonlyArray<Comment>),
            get.streamResult(syncedAtom, { withoutInitialValue: true }).pipe(
              Stream.mapAccum(
                () => first as ReadonlyArray<Comment>,
                (list: ReadonlyArray<Comment>, synced: Synced) => {
                  const next = applyCommentEvents(list, taskId, synced.batch)
                  return [next, next === list ? [] : [next]] as const
                },
              ),
            ),
          )
        }),
      )),
  )

  /** A task's history, fetched again whenever the task or its comments change. */
  const historyFamily = Atom.family((taskId: string) =>
    runtime.atom((get) => {
      const board = get(boardAtom)
      get(commentsFamily(taskId))
      const version = AsyncResult.isSuccess(board) ? board.value.tasks[taskId]?.version : undefined
      return Effect.gen(function* () {
        void version
        const client = yield* CelloClient
        return (yield* client["task.history"]({ id: taskId })) as ReadonlyArray<CelloEvent>
      })
    }),
  )

  return { workspaceIdAtom, syncedAtom, currentAtom, pendingAtom, boardAtom, commands, commentsFamily, historyFamily, command }
}

export type CelloAtoms = ReturnType<typeof makeCelloAtoms>
