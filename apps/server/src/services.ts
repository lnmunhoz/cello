// All domain services over one SqlClient, plus the event log they publish to and agent sessions.
// Review files need an AssetStore from outside (the data folder, or a temp one in tests).
import * as Layer from "effect/Layer"
import * as CommentService from "./comment/CommentService.ts"
import * as ContextService from "./context/ContextService.ts"
import * as Commands from "./commands/Commands.ts"
import * as EventLog from "./events/EventLog.ts"
import * as EventStore from "./events/EventStore.ts"
import * as LabelService from "./label/LabelService.ts"
import * as ProjectService from "./project/ProjectService.ts"
import * as ReviewService from "./review/ReviewService.ts"
import * as SessionService from "./session/SessionService.ts"
import * as SnapshotService from "./snapshot/SnapshotService.ts"
import * as StatusService from "./status/StatusService.ts"
import * as TaskService from "./task/TaskService.ts"
import * as WorkspaceService from "./workspace/WorkspaceService.ts"

const domain = Layer.mergeAll(
  WorkspaceService.layer,
  ProjectService.layer,
  StatusService.layer,
  LabelService.layer,
  TaskService.layer,
  CommentService.layer,
  SnapshotService.layer,
).pipe(
  Layer.provideMerge(SessionService.layer),
  Layer.provideMerge(Commands.layer),
  Layer.provideMerge(EventLog.layer),
  Layer.provideMerge(EventStore.layer),
)

/** Reviews move tasks and add comments, so they sit on the task and comment services. */
const reviews = ReviewService.layer.pipe(Layer.provideMerge(domain))

/** The CLI's read models sit on top of the domain services. */
export const layer = ContextService.layer.pipe(Layer.provideMerge(reviews))
