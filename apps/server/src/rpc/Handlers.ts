// RPC handlers: each calls one service method. Inputs are decoded by the contract; errors are
// already the contract's tagged errors.
import { CelloRpcs } from "@cello/contract/rpcs"
import * as Effect from "effect/Effect"
import * as AskService from "../ask/AskService.ts"
import * as BackupService from "../backup/BackupService.ts"
import * as BuildHistory from "../build/BuildHistory.ts"
import * as BuildInfo from "../build/BuildInfo.ts"
import * as CommentService from "../comment/CommentService.ts"
import * as ContextService from "../context/ContextService.ts"
import * as DocumentService from "../document/DocumentService.ts"
import * as EventLog from "../events/EventLog.ts"
import * as InboxService from "../inbox/InboxService.ts"
import * as LabelService from "../label/LabelService.ts"
import * as ProjectService from "../project/ProjectService.ts"
import * as ReviewService from "../review/ReviewService.ts"
import * as SnapshotService from "../snapshot/SnapshotService.ts"
import * as StatusService from "../status/StatusService.ts"
import * as TaskService from "../task/TaskService.ts"
import * as WorkspaceService from "../workspace/WorkspaceService.ts"

export const layer = CelloRpcs.toLayer(Effect.gen(function* () {
  const snapshots = yield* SnapshotService.SnapshotService
  const log = yield* EventLog.EventLog
  const workspaces = yield* WorkspaceService.WorkspaceService
  const projects = yield* ProjectService.ProjectService
  const statuses = yield* StatusService.StatusService
  const labels = yield* LabelService.LabelService
  const tasks = yield* TaskService.TaskService
  const comments = yield* CommentService.CommentService
  const context = yield* ContextService.ContextService
  const reviews = yield* ReviewService.ReviewService
  const documents = yield* DocumentService.DocumentService
  const backups = yield* BackupService.BackupService
  const inbox = yield* InboxService.InboxService
  const asks = yield* AskService.AskService
  const build = yield* BuildInfo.BuildInfo
  const builds = yield* BuildHistory.BuildHistory

  return CelloRpcs.of({
    "snapshot.get": ({ scope }) => snapshots.get(scope),
    "events.subscribe": ({ scope, afterSeq }) => log.subscribe(scope, afterSeq),
    "workspace.create": (input) => workspaces.create(input),
    "workspace.update": (input) => workspaces.update(input),
    "project.create": (input) => projects.create(input),
    "project.update": (input) => projects.update(input),
    "project.archive": (input) => projects.archive(input),
    "status.update": (input) => statuses.update(input),
    "label.create": (input) => labels.create(input),
    "label.update": (input) => labels.update(input),
    "label.archive": (input) => labels.archive(input),
    "task.create": (input) => tasks.create(input),
    "task.update": (input) => tasks.update(input),
    "task.move": (input) => tasks.move(input),
    "task.setLabels": (input) => tasks.setLabels(input),
    "task.archive": (input) => tasks.archive(input),
    "task.unarchive": (input) => tasks.unarchive(input),
    "task.history": ({ id }) => tasks.history(id),
    "whoami": ({ project }) => context.whoami(project),
    "context": ({ project }) => context.context(project),
    "task.list": (query) => context.taskList(query),
    "task.get": ({ key }) => context.taskDetail(key),
    "task.claim": (input) => tasks.claim(input),
    "task.release": (input) => tasks.release(input),
    "inbox.take": (query) => inbox.take(query),
    "review.submit": (input) => reviews.submit(input),
    "review.approve": (input) => reviews.approve(input),
    "review.sendBack": (input) => reviews.sendBack(input),
    "review.list": ({ taskId }) => reviews.list(taskId),
    "ask.create": (input) => asks.create(input),
    "ask.answer": (input) => asks.answer(input),
    "ask.withdraw": (input) => asks.withdraw(input),
    "ask.get": ({ key }) => asks.latest(key),
    "ask.list": ({ taskId }) => asks.list(taskId),
    "ask.wait": ({ key }) => asks.wait(key),
    "document.publish": (input) => documents.publish(input),
    "document.get": (input) => documents.get(input),
    "document.list": (input) => documents.list(input),
    "document.history": ({ id }) => documents.history(id),
    "document.archive": (input) => documents.archive(input),
    "backup.create": () => backups.create({ kind: "manual" }),
    "backup.list": () => backups.list(),
    "server.build": () => build.get(),
    "builds.list": (page) => builds.list(page),
    "comment.list": ({ taskId }) => comments.list(taskId),
    "comment.add": (input) => comments.add(input),
    "comment.edit": (input) => comments.edit(input),
    "comment.delete": (input) => comments.remove(input),
  })
}))
