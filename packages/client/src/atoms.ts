// The thin atom layer over the pure sync and command code: one synced atom fed by `follow`,
// a list of optimistic patches, the view the screens read, and command atoms for writes.
import type { Ask, Comment, Document, DocumentVersion, Priority, Review, Scope } from "@cello/contract/entities"
import type { AnswerInput } from "@cello/contract/rpcs"
import type { CelloEvent } from "@cello/contract/events"
import type { SearchResults } from "@cello/contract/search"
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
import { documentBySlug } from "./sync/documents.ts"
import { projectByKey } from "./sync/selectors.ts"
import { applyAskEvents } from "./sync/asks.ts"
import { applyReviewEvents } from "./sync/reviews.ts"
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

  /** The connection's state as one value, so what depends on it reruns only when it changes. */
  const connectionAtom = Atom.make((get) => {
    const synced = get(syncedAtom)
    return AsyncResult.isSuccess(synced) ? synced.value.connection : null
  })

  /**
   * The server's build (CEL-37), asked for each time the connection goes live: a server restarted on a
   * new build is noticed as soon as the tab reconnects to it. While reconnecting it waits, keeping the
   * last answer.
   */
  const serverBuildAtom = runtime
    .atom((get) => {
      const live = get(connectionAtom) === "live"
      return Effect.gen(function* () {
        if (!live) return yield* Effect.never
        return yield* (yield* CelloClient)["server.build"]({})
      })
    })
    .pipe(Atom.keepAlive)

  /**
   * The newest `limit` builds the server has run (CEL-50), asked for once the server's build is known
   * and again whenever it changes: a server records a new build when it starts on it.
   */
  const buildsFamily = Atom.family((limit: number) =>
    runtime.atom((get) =>
      Effect.gen(function* () {
        yield* get.result(serverBuildAtom)
        return yield* (yield* CelloClient)["builds.list"]({ limit })
      })))

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
          updatedByActorId: null,
          updatedBySessionId: null,
          stage: null,
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
    // No optimistic patch: the review closes and the task moves in one batch of events, a moment later.
    approveReview: command({
      call: (c, a: { key: string; note?: string }, commandId) => c["review.approve"]({ commandId, ...a }),
      subject: (a) => a.key,
    }),
    sendBackReview: command({
      call: (c, a: { key: string; note: string }, commandId) => c["review.sendBack"]({ commandId, ...a }),
      subject: (a) => a.key,
    }),
    // No optimistic patch either: the ask closes and the task moves back to In Progress in one batch.
    answerAsk: command({
      call: (
        c,
        a: { askId: string; key: string; answers: ReadonlyArray<AnswerInput>; note: string; noteAttachmentIds: ReadonlyArray<string> },
        commandId,
      ) => c["ask.answer"]({ commandId, askId: a.askId, answers: a.answers, note: a.note, noteAttachmentIds: a.noteAttachmentIds }),
      subject: (a) => a.key,
    }),
  }

  /** A list loaded once with `load`, then kept current by `apply` over each batch of events. */
  const followedList = <T>(
    load: (client: Client) => Effect.Effect<ReadonlyArray<T>, unknown>,
    apply: (list: ReadonlyArray<T>, events: ReadonlyArray<CelloEvent>) => ReadonlyArray<T>,
  ) =>
    runtime.atom((get) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const first = yield* load(yield* CelloClient)
          return Stream.concat(
            Stream.make(first),
            get.streamResult(syncedAtom, { withoutInitialValue: true }).pipe(
              Stream.mapAccum(
                () => first,
                (list: ReadonlyArray<T>, synced: Synced) => {
                  const next = apply(list, synced.batch)
                  return [next, next === list ? [] : [next]] as const
                },
              ),
            ),
          )
        }),
      ))

  /** A task's comments. */
  const commentsFamily = Atom.family((taskId: string) =>
    followedList<Comment>((c) => c["comment.list"]({ taskId }), (list, events) => applyCommentEvents(list, taskId, events)))

  /** A task's reviews, open and decided, oldest first. */
  const reviewsFamily = Atom.family((taskId: string) =>
    followedList<Review>((c) => c["review.list"]({ taskId }), (list, events) => applyReviewEvents(list, taskId, events)))

  /** A task's asks (questions for Lucas, CEL-47), open and closed, oldest first. */
  const asksFamily = Atom.family((taskId: string) =>
    followedList<Ask>((c) => c["ask.list"]({ taskId }), (list, events) => applyAskEvents(list, taskId, events)))

  /**
   * The server's version of one task. It changes only when that task does, and an optimistic edit
   * (which bumps the shown version early) doesn't touch it.
   */
  const syncedVersionFamily = Atom.family((taskId: string) =>
    Atom.make((get) => {
      const synced = get(syncedAtom)
      return AsyncResult.isSuccess(synced) ? synced.value.state.tasks[taskId]?.version : undefined
    }))

  /** A task's history, fetched again whenever the server changes the task or its comments. */
  const historyFamily = Atom.family((taskId: string) =>
    runtime.atom((get) => {
      const version = get(syncedVersionFamily(taskId))
      get(commentsFamily(taskId))
      return Effect.gen(function* () {
        void version
        const client = yield* CelloClient
        return (yield* client["task.history"]({ id: taskId })) as ReadonlyArray<CelloEvent>
      })
    }),
  )

  /** The version of a document the server has, by id or by `KEY/slug`; changes when it's republished. */
  const documentVersionFamily = Atom.family((ref: string) =>
    Atom.make((get) => {
      const synced = get(syncedAtom)
      if (!AsyncResult.isSuccess(synced)) return undefined
      const state = synced.value.state
      const slash = ref.indexOf("/")
      if (slash === -1) return state.documents[ref]?.version
      const project = projectByKey(state, ref.slice(0, slash))
      return project ? documentBySlug(state, project.id, ref.slice(slash + 1))?.version : undefined
    }))

  /**
   * A page with its body, by `KEY/slug` (the latest version, fetched again whenever it's republished)
   * or `KEY/slug@3` (that version, fetched once).
   */
  const pageFamily = Atom.family((ref: string) =>
    runtime.atom((get) => {
      const at = ref.lastIndexOf("@")
      const pinned = at === -1 ? undefined : Number(ref.slice(at + 1))
      const page = at === -1 ? ref : ref.slice(0, at)
      const version = pinned === undefined ? get(documentVersionFamily(page)) : pinned
      const slash = page.indexOf("/")
      return Effect.gen(function* () {
        void version
        const client = yield* CelloClient
        return (yield* client["document.get"]({
          project: { key: page.slice(0, slash) },
          slug: page.slice(slash + 1),
          ...(pinned === undefined ? {} : { version: pinned }),
        })) as Document
      })
    }))

  /** A document's versions, newest first, fetched again when it gets a new one. */
  const documentHistoryFamily = Atom.family((documentId: string) =>
    runtime.atom((get) => {
      const version = get(documentVersionFamily(documentId))
      return Effect.gen(function* () {
        void version
        const client = yield* CelloClient
        return (yield* client["document.history"]({ id: documentId })) as ReadonlyArray<DocumentVersion>
      })
    }))

  /**
   * Search results (CEL-43) for a JSON key `{ query, workspaceId, limit }`: one request per query, so
   * the ⌘K bar asks again as you type and keeps showing the last answer while the next one loads. An
   * empty query, or no workspace yet, answers nothing without asking the server.
   */
  const searchFamily = Atom.family((key: string) =>
    runtime.atom(Effect.gen(function* () {
      const { query, workspaceId, limit } = JSON.parse(key) as { query: string; workspaceId: string | null; limit: number }
      if (query.trim() === "" || workspaceId === null) return { query, terms: [], key: null, jump: null, groups: [] } satisfies SearchResults
      return yield* (yield* CelloClient)["search.query"]({ query, workspaceId, limit })
    })))

  return {
    workspaceIdAtom,
    syncedAtom,
    currentAtom,
    pendingAtom,
    boardAtom,
    serverBuildAtom,
    buildsFamily,
    commands,
    commentsFamily,
    reviewsFamily,
    asksFamily,
    historyFamily,
    pageFamily,
    documentHistoryFamily,
    searchFamily,
    command,
  }
}

export type CelloAtoms = ReturnType<typeof makeCelloAtoms>
