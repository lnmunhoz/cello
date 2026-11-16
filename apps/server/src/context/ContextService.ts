// What the CLI prints: who is calling, a project's context, task lists and one task in full. Each
// method returns everything one command needs, so a CLI command is one RPC call.
import type { Actor, AgentSession, Project, ProjectRef, Task } from "@cello/contract/entities"
import { Invalid, NotFound } from "@cello/contract/errors"
import type { CelloEvent } from "@cello/contract/events"
import { Caller } from "@cello/contract/rpcs"
import type { Activity, LabelList, ProjectContext, TaskDetail, TaskList, Whoami } from "@cello/contract/views"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import * as CommentService from "../comment/CommentService.ts"
import * as DocumentService from "../document/DocumentService.ts"
import * as EventStore from "../events/EventStore.ts"
import * as InboxService from "../inbox/InboxService.ts"
import { selectActors, selectAsks, selectLabels, selectProjects, selectReviews, selectStatuses, selectTasks } from "../persistence/rows.ts"
import * as ProjectService from "../project/ProjectService.ts"
import { type AgentRef, AgentService } from "../session/AgentService.ts"
import { SessionService } from "../session/SessionService.ts"
import * as TaskService from "../task/TaskService.ts"

export interface TaskListQuery {
  readonly project: ProjectRef
  readonly status?: string
  readonly label?: string
  readonly mine?: boolean
}

export class ContextService extends Context.Service<ContextService, {
  readonly whoami: (ref: ProjectRef) => Effect.Effect<Whoami, never, Caller>
  readonly context: (ref: ProjectRef) => Effect.Effect<ProjectContext, NotFound | Invalid, Caller>
  readonly taskList: (query: TaskListQuery) => Effect.Effect<TaskList, NotFound | Invalid, Caller>
  readonly taskDetail: (key: string) => Effect.Effect<TaskDetail, NotFound>
  readonly labelList: (ref: ProjectRef) => Effect.Effect<LabelList, NotFound | Invalid>
}>()("cello/ContextService") {}

/** How many recent events `context` shows. */
const RECENT = 15
/** What `task list` shows by default: tasks to do, in progress or waiting on Lucas. Backlog shows with --status Backlog. */
const OPEN_CATEGORIES = new Set(["unstarted", "started", "waiting"])

/** The task an event is about, by id; comment edits and deletes only know the comment. */
const taskIdOf = (e: CelloEvent): { readonly taskId: string } | { readonly commentId: string } | null => {
  switch (e.type) {
    case "task.created":
      return { taskId: e.task.id }
    case "comment.added":
      return { taskId: e.comment.taskId }
    case "comment.delivered":
      return { taskId: e.taskId }
    case "review.submitted":
      return { taskId: e.review.taskId }
    case "review.decided":
    case "review.withdrawn":
    case "ask.withdrawn":
      return { taskId: e.taskId }
    case "ask.created":
    case "ask.answered":
      return { taskId: e.ask.taskId }
    case "comment.edited":
    case "comment.deleted":
      return { commentId: e.id }
    default:
      return e.type.startsWith("task.") ? { taskId: (e as { id: string }).id } : null
  }
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const projects = yield* ProjectService.ProjectService
  const tasks = yield* TaskService.TaskService
  const comments = yield* CommentService.CommentService
  const sessions = yield* SessionService
  const agents = yield* AgentService
  const store = yield* EventStore.EventStore
  const documents = yield* DocumentService.DocumentService
  const inbox = yield* InboxService.InboxService

  const actorById = (id: string) =>
    Effect.map(selectActors(sql), (actors) => actors.find((a) => a.id === id)!)

  /** The names a project's ids point at, plus the sessions in `sessionIds` and the subagents in `agentRefs` (with theirs). */
  const projectNames = (project: Project, sessionIds: ReadonlyArray<string | null>, agentRefs: ReadonlyArray<AgentRef> = []) =>
    Effect.gen(function* () {
      const named = yield* agents.byRefs(agentRefs)
      return {
        project,
        statuses: yield* selectStatuses(sql, sql`s.workspace_id = ${project.workspaceId}`),
        labels: yield* selectLabels(sql, sql`l.workspace_id = ${project.workspaceId} AND l.archived_at IS NULL`),
        actors: yield* selectActors(sql),
        sessions: yield* sessions.byIds([...sessionIds.filter((id): id is string => id !== null), ...named.map((a) => a.sessionId)]),
        agents: named,
      }
    })

  /** Sessions a set of tasks and events mention: assignees, creators, last changes and event authors. */
  const sessionIdsOf = (taskRows: ReadonlyArray<Task>, events: ReadonlyArray<CelloEvent> = []) => [
    ...taskRows.flatMap((t) => [t.assigneeSessionId, t.createdBySessionId, t.updatedBySessionId]),
    ...events.map((e) => e.sessionId),
  ]

  /** Subagents (CEL-55) the rows name: whoever made a change or wrote a comment, under its session. */
  const agentRefsOf = (rows: ReadonlyArray<{ readonly sessionId: string | null; readonly agentId?: string | null | undefined }>): AgentRef[] =>
    rows.flatMap((r) => (r.sessionId !== null && r.agentId ? [{ sessionId: r.sessionId, agentId: r.agentId }] : []))

  /** A task's last change, as an agent ref source. */
  const lastChange = (t: Task) => ({ sessionId: t.updatedBySessionId, agentId: t.updatedByAgentId })

  const withKeys = (events: ReadonlyArray<CelloEvent>) =>
    Effect.gen(function* () {
      const refs = events.map(taskIdOf)
      const commentIds = refs.flatMap((r) => (r && "commentId" in r ? [r.commentId] : []))
      const commentTasks = commentIds.length === 0
        ? []
        : yield* sql<{ id: string; task_id: string }>`SELECT id, task_id FROM comments WHERE ${sql.in("id", commentIds)}`
      const taskIds = [
        ...refs.flatMap((r) => (r && "taskId" in r ? [r.taskId] : [])),
        ...commentTasks.map((c) => c.task_id),
      ]
      const keys = new Map(
        taskIds.length === 0 ? [] : (yield* selectTasks(sql, sql`${sql.in("t.id", [...new Set(taskIds)])}`)).map((t) => [t.id, t.key]),
      )
      return events.map((event, i): Activity => {
        const ref = refs[i]
        const taskId = ref === null || ref === undefined
          ? undefined
          : "taskId" in ref
          ? ref.taskId
          : commentTasks.find((c) => c.id === ref.commentId)?.task_id
        return { event, taskKey: (taskId && keys.get(taskId)) ?? null }
      })
    })

  /** Tasks the caller holds: its session's claims, or for the human, tasks assigned to it with no session. */
  const heldBy = (caller: Caller["Service"]) =>
    caller.sessionId === null
      ? sql`t.assignee_actor_id = ${caller.actorId} AND t.assignee_session_id IS NULL`
      : sql`t.assignee_session_id = ${caller.sessionId}`

  const whoami = Effect.fn("ContextService.whoami")(function* (ref: ProjectRef) {
    const caller = yield* Caller
    const [session] = caller.sessionId === null ? [] : yield* sessions.byIds([caller.sessionId])
    const [agent] = caller.sessionId === null || !caller.agentId ? [] : yield* agents.byRefs([{ sessionId: caller.sessionId, agentId: caller.agentId }])
    const project = yield* projects.resolve(ref).pipe(Effect.catch(() => Effect.succeed(null)))
    return { actor: yield* actorById(caller.actorId), session: session ?? null, agent: agent ?? null, project }
  }, Effect.catchTag("SqlError", Effect.die))

  const context = Effect.fn("ContextService.context")(function* (ref: ProjectRef) {
    const caller = yield* Caller
    const project = yield* projects.resolve(ref)
    const claimed = yield* selectTasks(sql, sql`t.project_id = ${project.id} AND t.archived_at IS NULL AND ${heldBy(caller)}`)
    const recent = yield* store.recent(project.id, RECENT)
    const lost = caller.sessionId === null ? [] : yield* store.claimsLostBy(caller.sessionId, project.id, RECENT)
    const names = yield* projectNames(
      project,
      [caller.sessionId, ...sessionIdsOf(claimed, [...recent, ...lost])],
      agentRefsOf([...claimed.map(lastChange), ...recent, ...lost]),
    )
    return {
      ...names,
      actor: names.actors.find((a: Actor) => a.id === caller.actorId)!,
      session: names.sessions.find((s: AgentSession) => s.id === caller.sessionId) ?? null,
      claimed,
      recent: yield* withKeys(recent),
      lostClaims: yield* withKeys(lost),
      inbox: yield* inbox.unread,
    }
  }, Effect.catchTag("SqlError", Effect.die))

  const taskList = Effect.fn("ContextService.taskList")(function* (query: TaskListQuery) {
    const caller = yield* Caller
    const project = yield* projects.resolve(query.project)
    const statuses = yield* selectStatuses(sql, sql`s.workspace_id = ${project.workspaceId}`)
    const labels = yield* selectLabels(sql, sql`l.workspace_id = ${project.workspaceId} AND l.archived_at IS NULL`)
    const status = query.status === undefined ? undefined : statuses.find((s) => sameName(s.name, query.status!))
    if (query.status !== undefined && !status) {
      return yield* new Invalid({
        field: "status",
        reason: `no status named "${query.status}". Statuses: ${statuses.map((s) => s.name).join(", ")}`,
      })
    }
    const label = query.label === undefined ? undefined : labels.find((l) => sameName(l.name, query.label!))
    if (query.label !== undefined && !label) {
      return yield* new Invalid({
        field: "label",
        reason: `no label named "${query.label}". Labels: ${labels.map((l) => l.name).join(", ") || "none yet"}`,
      })
    }
    const open = new Set(statuses.filter((s) => OPEN_CATEGORIES.has(s.category)).map((s) => s.id))
    const order = new Map(statuses.map((s, i) => [s.id, i]))
    const rows = (yield* selectTasks(
      sql,
      query.mine ? sql`t.project_id = ${project.id} AND t.archived_at IS NULL AND ${heldBy(caller)}` : sql`t.project_id = ${project.id} AND t.archived_at IS NULL`,
    )).filter((t) =>
      (status ? t.statusId === status.id : open.has(t.statusId)) && (label === undefined || t.labelIds.includes(label.id))
    )
    const sorted = [...rows].sort((a, b) => order.get(a.statusId)! - order.get(b.statusId)! || (a.position < b.position ? -1 : 1))
    return { ...(yield* projectNames(project, sessionIdsOf(sorted), agentRefsOf(sorted.map(lastChange)))), tasks: sorted }
  }, Effect.catchTag("SqlError", Effect.die))

  const taskDetail = Effect.fn("ContextService.taskDetail")(function* (key: string) {
    const task = yield* tasks.byKey(key)
    const [project] = yield* selectProjects(sql, sql`p.id = ${task.projectId}`)
    const history = yield* tasks.history(task.id)
    const list = yield* comments.list(task.id)
    const reviews = yield* selectReviews(sql, sql`r.task_id = ${task.id}`)
    const asks = yield* selectAsks(sql, sql`a.task_id = ${task.id}`)
    const reactions = list.flatMap((c) => c.reactions ?? [])
    const names = yield* projectNames(project!, [
      ...sessionIdsOf([task], history),
      ...list.map((c) => c.sessionId),
      ...reactions.map((r) => r.sessionId),
      ...reviews.map((r) => r.sessionId),
      ...asks.map((a) => a.sessionId),
    ], [
      ...agentRefsOf([lastChange(task), ...history, ...list, ...reactions]),
      // The agents on it (CEL-55), working or done: the panel and `cello task get` name them.
      ...(yield* agents.onTask(task.id)),
    ])
    return { ...names, task, comments: list, reviews, asks, documents: yield* documents.ofTask(task.id), history }
  }, Effect.catchTag("SqlError", Effect.die))

  const labelList = Effect.fn("ContextService.labelList")(function* (ref: ProjectRef) {
    const project = yield* projects.resolve(ref)
    const labels = yield* selectLabels(sql, sql`l.workspace_id = ${project.workspaceId}`)
    const counts = yield* sql<{ label_id: string; here: number; elsewhere: number }>`
      SELECT tl.label_id,
        SUM(CASE WHEN t.project_id = ${project.id} THEN 1 ELSE 0 END) AS here,
        SUM(CASE WHEN t.project_id = ${project.id} THEN 0 ELSE 1 END) AS elsewhere
      FROM task_labels tl
      JOIN tasks t ON t.id = tl.task_id
      JOIN projects p ON p.id = t.project_id
      WHERE p.workspace_id = ${project.workspaceId} AND t.archived_at IS NULL
      GROUP BY tl.label_id`
    const byLabel = new Map(counts.map((c) => [c.label_id, c]))
    return {
      project,
      labels: labels.map((label) => ({
        label,
        tasks: Number(byLabel.get(label.id)?.here ?? 0),
        otherProjects: Number(byLabel.get(label.id)?.elsewhere ?? 0),
      })),
    }
  }, Effect.catchTag("SqlError", Effect.die))

  return ContextService.of({ whoami, context, taskList, taskDetail, labelList })
})

export const layer = Layer.effect(ContextService, make)
