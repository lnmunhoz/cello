// The thin atom layer over the pure sync and command code: one synced atom fed by `follow`,
// a list of optimistic patches, the view the screens read, and command atoms for writes.
import type { Ask, Comment, Document, DocumentVersion, LabelGroup, Priority, Review, Scope, TestingProfile, WakeSettings } from "@cello/contract/entities"
import type { AnswerInput } from "@cello/contract/rpcs"
import type { CelloEvent } from "@cello/contract/events"
import type { SearchResults } from "@cello/contract/search"
import type { TaskTimeline } from "@cello/contract/views"
import type { LogUpdate } from "@cello/contract/agentLog"
import * as Cause from "effect/Cause"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
import * as Exit from "effect/Exit"
import * as Stream from "effect/Stream"
import * as Atom from "effect/reactivity/Atom"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import type * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { CelloClient, newCommandId } from "./client.ts"
import { describeError } from "./commands/describeError.ts"
import { begin, confirm, pendingOf, prune, rollback, view, type Patch, type Pending } from "./commands/optimistic.ts"
import * as patches from "./commands/patches.ts"
import { applyLogUpdate, EMPTY_LOG, parseLogKey } from "./sync/agentLog.ts"
import { applyCommentEvents } from "./sync/comments.ts"
import { documentBySlug } from "./sync/documents.ts"
import { projectByKey } from "./sync/selectors.ts"
import { applyAskEvents } from "./sync/asks.ts"
import { applyProfileEvents } from "./sync/profile.ts"
import { applyWakeSettingsEvents } from "./sync/wakeSettings.ts"
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

  /** How many events the stream skipped because this build can't read them (CEL-131). */
  const unreadableAtom = Atom.make((get) => {
    const synced = get(syncedAtom)
    return AsyncResult.isSuccess(synced) ? synced.value.unreadable : 0
  })

  /**
   * The server's build (CEL-37), asked for each time the connection goes live: a server restarted on a
   * new build is noticed as soon as the tab reconnects to it. Asked again each time the stream skips an
   * event this build can't read (CEL-131): the server runs a newer build, and the reload bar should
   * hear of it. While reconnecting it waits, keeping the last answer.
   */
  const serverBuildAtom = runtime
    .atom((get) => {
      get(unreadableAtom)
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
      patch: (a: { id: string; name?: string; color?: string; description?: string; mergeAfterApproval?: boolean }) => patches.updateProject(a.id, a),
      call: (c, a, commandId) => c["project.update"]({ commandId, ...a }),
    }),
    createTask: command({
      patch: (
        // `milestoneId` (CEL-132): made already in that open milestone (a milestone's Add a task, a swimlane's +).
        a: { projectId: string; title: string; statusId: string; position: string; before: string | null; after: string | null; milestoneId?: string | null },
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
          milestoneId: a.milestoneId ?? null,
          assigneeActorId: null,
          assigneeSessionId: null,
          createdByActorId: "",
          createdBySessionId: null,
          updatedByActorId: null,
          updatedBySessionId: null,
          stage: null,
          commentCount: 0,
          lastCommentAt: null,
          version: 0,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
        })
      },
      call: (c, a, commandId) =>
        c["task.create"]({
          commandId,
          projectId: a.projectId,
          title: a.title,
          statusId: a.statusId,
          before: a.before,
          after: a.after,
          ...(a.milestoneId ? { milestoneId: a.milestoneId } : {}),
        }),
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
    // A task's milestone (CEL-113): at most one; null takes it out.
    setTaskMilestone: command({
      patch: (a: { id: string; milestoneId: string | null }) => patches.setTaskMilestone(a.id, a.milestoneId),
      call: (c, a, commandId) => c["task.setMilestone"]({ commandId, ...a }),
      subject: taskKey,
    }),
    // A new milestone, last in its project (CEL-113); with `taskId`, that task goes in it right after
    // (the task panel's "New milestone…"), shown at once.
    createMilestone: command({
      patch: (a: { projectId: string; name: string; goal?: string; targetDate?: string | null; taskId?: string }, { state, commandId }) => {
        const id = `optimistic:${commandId}`
        const last = Object.values(state.milestones).filter((m) => m.projectId === a.projectId).reduce((max, m) => (m.position > max ? m.position : max), "")
        const now = Date.now()
        const add = patches.addMilestone({
          id,
          projectId: a.projectId,
          name: a.name.trim(),
          goal: a.goal?.trim() ?? "",
          targetDate: a.targetDate ?? null,
          // Sorts after every position the project has.
          position: `${last}~`,
          state: "open",
          closedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        return a.taskId === undefined ? add : (s) => patches.setTaskMilestone(a.taskId!, id)(add(s))
      },
      call: (c, a, commandId) =>
        Effect.gen(function* () {
          const { taskId, ...fields } = a
          const created = yield* c["milestone.create"]({ commandId, ...fields })
          if (taskId === undefined) return created
          const assigned = yield* c["task.setMilestone"]({ commandId: `${commandId}:assign`, id: taskId, milestoneId: created.result.id })
          return { result: created.result, seq: assigned.seq ?? created.seq }
        }),
    }),
    // A milestone's name, goal or date, or a move in the order between two neighbors (CEL-132): `position`
    // is shown meanwhile, `before`/`after` are what the server places it by.
    updateMilestone: command({
      patch: (a: { id: string; name?: string; goal?: string; targetDate?: string | null; position?: string; before?: string | null; after?: string | null }) =>
        patches.updateMilestone(a.id, {
          ...(a.name === undefined ? {} : { name: a.name.trim() }),
          ...(a.goal === undefined ? {} : { goal: a.goal.trim() }),
          ...(a.targetDate === undefined ? {} : { targetDate: a.targetDate }),
          ...(a.position === undefined ? {} : { position: a.position }),
        }),
      call: (c, a, commandId) => {
        const { position: _, ...rest } = a
        return c["milestone.update"]({ commandId, ...rest })
      },
    }),
    // Closing and reopening are the human's (CEL-132); the server refuses an agent.
    closeMilestone: command({
      patch: (a: { id: string }) => patches.setMilestoneState(a.id, "closed"),
      call: (c, a, commandId) => c["milestone.close"]({ commandId, id: a.id }),
    }),
    reopenMilestone: command({
      patch: (a: { id: string }) => patches.setMilestoneState(a.id, "open"),
      call: (c, a, commandId) => c["milestone.reopen"]({ commandId, id: a.id }),
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
      patch: (a: { projectId: string; name: string; color: string; group?: LabelGroup }, { commandId }) => {
        const now = Date.now()
        return patches.addLabel({ id: `optimistic:${commandId}`, ...a, group: a.group ?? "none", createdAt: now, updatedAt: now, archivedAt: null })
      },
      call: (c, a, commandId) => c["label.create"]({ commandId, ...a }),
    }),
    updateLabel: command({
      patch: (a: { id: string; name?: string; color?: string; group?: LabelGroup }) => patches.updateLabel(a.id, a),
      call: (c, a, commandId) => c["label.update"]({ commandId, ...a }),
    }),
    archiveLabel: command({
      patch: (a: { id: string }) => patches.archiveLabel(a.id),
      call: (c, a, commandId) => c["label.archive"]({ commandId, ...a }),
    }),
    // Testing profile fields (CEL-89): set or unset by the human; the row follows when the event arrives.
    setProfile: command({
      call: (c, a: { projectKey: string; set: ReadonlyArray<{ field: string; value: string }>; unset?: ReadonlyArray<string> }, commandId) =>
        c["profile.set"]({ commandId, project: { key: a.projectKey }, set: a.set, ...(a.unset ? { unset: a.unset } : {}) }),
    }),
    // Waking sessions (CEL-92): the project's settings, "Don't wake" on a due wake, and Stop on a woken
    // run. The card follows when the events arrive.
    setWakeSettings: command({
      call: (c, a: { projectKey: string; enabled?: boolean; capPerHour?: number }, commandId) =>
        c["wake.setSettings"]({
          commandId,
          project: { key: a.projectKey },
          ...(a.enabled === undefined ? {} : { enabled: a.enabled }),
          ...(a.capPerHour === undefined ? {} : { capPerHour: a.capPerHour }),
        }),
    }),
    cancelWake: command({
      call: (c, a: { taskId: string }, commandId) => c["session.cancelWake"]({ commandId, ...a }),
    }),
    stopRun: command({
      call: (c, a: { runId: string }, commandId) => c["session.stopRun"]({ commandId, ...a }),
    }),
    // Wake now (CEL-136): the due wake of the task's holder runs at once, through `cello sessions wake`'s
    // path. When it can't, the card says why (`session.not_woken`), so there's no toast for that.
    wakeNow: command({
      call: (c, a: { key: string }, commandId) => c["session.wake"]({ commandId, key: a.key }),
      quiet: (e) => (e as { _tag?: string })._tag === "SessionNotWoken",
    }),
    addComment: command({
      call: (c, a: { taskId: string; body: string; attachmentIds?: ReadonlyArray<string> }, commandId) => c["comment.add"]({ commandId, ...a }),
    }),
    editComment: command({
      call: (c, a: { id: string; body: string }, commandId) => c["comment.edit"]({ commandId, ...a }),
    }),
    deleteComment: command({
      call: (c, a: { id: string }, commandId) => c["comment.delete"]({ commandId, ...a }),
    }),
    // An emoji reaction on a comment (CEL-77); the chip follows when the event arrives.
    reactToComment: command({
      call: (c, a: { commentId: string; emoji: string; on: boolean }, commandId) => c["comment.react"]({ commandId, ...a }),
    }),
    // No optimistic patch: the review closes and the task moves in one batch of events, a moment later.
    approveReview: command({
      call: (c, a: { key: string; note?: string; attachmentIds?: ReadonlyArray<string> }, commandId) => c["review.approve"]({ commandId, ...a }),
      subject: (a) => a.key,
    }),
    sendBackReview: command({
      call: (c, a: { key: string; note: string; attachmentIds?: ReadonlyArray<string> }, commandId) => c["review.sendBack"]({ commandId, ...a }),
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

  /** A value loaded once with `load`, then kept current by `apply` over each batch of events (the same value: no change). */
  const followed = <V>(
    load: (client: Client) => Effect.Effect<V, unknown>,
    apply: (value: V, events: ReadonlyArray<CelloEvent>) => V,
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
                (value: V, synced: Synced) => {
                  const next = apply(value, synced.batch)
                  return [next, next === value ? [] : [next]] as const
                },
              ),
            ),
          )
        }),
      ))

  /** A task's comments. */
  const commentsFamily = Atom.family((taskId: string) =>
    followed<ReadonlyArray<Comment>>((c) => c["comment.list"]({ taskId }), (list, events) => applyCommentEvents(list, taskId, events)))

  /** A task's reviews, open and decided, oldest first. */
  const reviewsFamily = Atom.family((taskId: string) =>
    followed<ReadonlyArray<Review>>((c) => c["review.list"]({ taskId }), (list, events) => applyReviewEvents(list, taskId, events)))

  /** A task's asks (questions for Lucas, CEL-47), open and closed, oldest first. */
  const asksFamily = Atom.family((taskId: string) =>
    followed<ReadonlyArray<Ask>>((c) => c["ask.list"]({ taskId }), (list, events) => applyAskEvents(list, taskId, events)))

  /** A project's testing profile (CEL-89), by project key, kept current by `profile.changed`. */
  const profileFamily = Atom.family((projectKey: string) =>
    followed<TestingProfile>((c) => c["profile.get"]({ project: { key: projectKey } }), applyProfileEvents))

  /** A project's wake settings (CEL-92), by project key, kept current by `wake.settings_changed`. */
  const wakeSettingsFamily = Atom.family((projectKey: string) =>
    followed<WakeSettings>((c) => c["wake.settings"]({ project: { key: projectKey } }), applyWakeSettingsEvents))

  /**
   * The server's version of one task. It changes only when that task does, and an optimistic edit
   * (which bumps the shown version early) doesn't touch it.
   */
  const syncedVersionFamily = Atom.family((taskId: string) =>
    Atom.make((get) => {
      const synced = get(syncedAtom)
      return AsyncResult.isSuccess(synced) ? synced.value.state.tasks[taskId]?.version : undefined
    }))

  /** When the task's latest wake event happened (CEL-92); wakes aren't task changes, so its version stays. */
  const syncedWakeFamily = Atom.family((taskId: string) =>
    Atom.make((get) => {
      const synced = get(syncedAtom)
      return AsyncResult.isSuccess(synced) ? synced.value.state.wakes[taskId]?.ts : undefined
    }))

  /** A task's history, fetched again whenever the server changes the task, its comments or its wake. */
  const historyFamily = Atom.family((taskId: string) =>
    runtime.atom((get) => {
      const version = get(syncedVersionFamily(taskId))
      const wake = get(syncedWakeFamily(taskId))
      get(commentsFamily(taskId))
      return Effect.gen(function* () {
        void version
        void wake
        const client = yield* CelloClient
        return yield* client["task.history"]({ id: taskId })
      })
    }),
  )

  /**
   * What of a task's subagents a timeline depends on (CEL-160): each one's id, when it finished and its
   * verdict. A check-in that only moves `lastSeenAt` leaves it alone, so the timeline isn't fetched on every
   * tool call of a working agent.
   */
  const syncedAgentsOnTaskFamily = Atom.family((taskId: string) =>
    Atom.make((get) => {
      const synced = get(syncedAtom)
      if (!AsyncResult.isSuccess(synced)) return ""
      return Object.values(synced.value.state.agents)
        .filter((a) => a.taskId === taskId)
        .map((a) => `${a.sessionId}/${a.agentId}:${a.endedAt}:${a.verdict ?? ""}`)
        .sort()
        .join(",")
    }))

  /**
   * Which build the server runs (CEL-160): its commit and web build time, "" until known. A release is a
   * build the server records when it starts, so a new answer here means a thread may have a new release.
   * Asked again on each reconnect, but the same build gives the same text.
   */
  const servedBuildFamily = Atom.make((get) => {
    const build = get(serverBuildAtom)
    return AsyncResult.isSuccess(build) ? `${build.value.commit ?? ""}@${build.value.web?.builtAt ?? ""}` : ""
  })

  /**
   * A task's subagent runs and the builds that name it (CEL-160), fetched again when an agent on the task
   * starts, finishes or leaves a verdict, and when the server comes up on a new build (a release). A server without `task.timeline` (older than this build) has
   * none: the thread then shows comments and history lines only.
   */
  const timelineFamily = Atom.family((taskId: string) =>
    runtime.atom((get) => {
      const agents = get(syncedAgentsOnTaskFamily(taskId))
      const build = get(servedBuildFamily)
      return Effect.gen(function* () {
        void agents
        void build
        const client = yield* CelloClient
        return yield* client["task.timeline"]({ id: taskId }).pipe(
          Effect.catchCause(() => Effect.succeed({ runs: [], releases: [] } satisfies TaskTimeline)),
        )
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

  /**
   * A task the board doesn't hold (another workspace's), by key, as `cello task get` reads it: for the
   * hover card on a link to it (CEL-142). Read once while the card shows; a task the board holds never asks.
   */
  const taskDetailFamily = Atom.family((key: string) =>
    runtime.atom(Effect.gen(function* () {
      return yield* (yield* CelloClient)["task.get"]({ key })
    })))

  /**
   * An agent's live log (CEL-106), by `logKey` (agentLog.ts): the steps so far, kept current while the
   * screen reads it. A dropped connection opens the stream again, whose first batch replaces the steps.
   */
  const agentLogFamily = Atom.family((key: string) =>
    runtime.atom(() => {
      const source = parseLogKey(key)
      const updates: Stream.Stream<LogUpdate, unknown, CelloClient> = Stream.unwrap(
        Effect.gen(function* () {
          const client = yield* CelloClient
          return client["agent.log"]({
            sessionId: source.sessionId,
            ...(source.agentId === undefined ? {} : { agentId: source.agentId }),
            ...(source.runId === undefined ? {} : { runId: source.runId }),
            ...(source.reveal ? { reveal: true } : {}),
          }).pipe(Stream.catchTag("NotFound", () => Stream.succeed<LogUpdate>({ _tag: "unavailable", reason: "none" })))
        }),
      )
      return updates.pipe(
        Stream.retry(Schedule.spaced(Duration.millis(options.retryDelay ?? 1000))),
        Stream.scan(() => EMPTY_LOG, applyLogUpdate),
      )
    }))

  return {
    agentLogFamily,
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
    profileFamily,
    wakeSettingsFamily,
    historyFamily,
    timelineFamily,
    pageFamily,
    documentHistoryFamily,
    searchFamily,
    taskDetailFamily,
    command,
  }
}

export type CelloAtoms = ReturnType<typeof makeCelloAtoms>
