// All domain services over one SqlClient, plus the event log they publish to.
import * as Layer from "effect/Layer"
import * as CommentService from "./comment/CommentService.ts"
import * as Commands from "./commands/Commands.ts"
import * as EventLog from "./events/EventLog.ts"
import * as EventStore from "./events/EventStore.ts"
import * as LabelService from "./label/LabelService.ts"
import * as ProjectService from "./project/ProjectService.ts"
import * as SnapshotService from "./snapshot/SnapshotService.ts"
import * as StatusService from "./status/StatusService.ts"
import * as TaskService from "./task/TaskService.ts"
import * as WorkspaceService from "./workspace/WorkspaceService.ts"

export const layer = Layer.mergeAll(
  WorkspaceService.layer,
  ProjectService.layer,
  StatusService.layer,
  LabelService.layer,
  TaskService.layer,
  CommentService.layer,
  SnapshotService.layer,
).pipe(
  Layer.provideMerge(Commands.layer),
  Layer.provideMerge(EventLog.layer),
  Layer.provideMerge(EventStore.layer),
)
