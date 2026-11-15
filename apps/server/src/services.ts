// All domain services over one SqlClient, plus the event log they publish to and agent sessions.
// Review and page files need an AssetStore from outside (the data folder, or a temp one in tests).
import * as Layer from "effect/Layer"
import * as AskService from "./ask/AskService.ts"
import * as CommentService from "./comment/CommentService.ts"
import * as ContextService from "./context/ContextService.ts"
import * as Commands from "./commands/Commands.ts"
import * as DocumentService from "./document/DocumentService.ts"
import * as EventLog from "./events/EventLog.ts"
import * as EventStore from "./events/EventStore.ts"
import * as InboxService from "./inbox/InboxService.ts"
import * as LabelService from "./label/LabelService.ts"
import * as ProjectService from "./project/ProjectService.ts"
import * as RepoPaths from "./project/repoPath.ts"
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
  // Comments and reviews deliver into agents' inboxes, which read sessions.
  Layer.provideMerge(InboxService.layer),
  Layer.provideMerge(SessionService.layer),
  Layer.provideMerge(Commands.layer),
  Layer.provideMerge(EventLog.layer),
  Layer.provideMerge(EventStore.layer),
)

/** Reviews and asks move tasks and deliver to inboxes; documents link tasks. They sit on the domain services. */
const reviews = Layer.mergeAll(ReviewService.layer, AskService.layer, DocumentService.layer).pipe(Layer.provideMerge(domain))

/** The CLI's read models sit on top of the domain services. Tests can swap how project folders are normalized. */
export const layerWith = (repoPaths: Layer.Layer<RepoPaths.RepoPaths>) =>
  ContextService.layer.pipe(Layer.provideMerge(reviews), Layer.provideMerge(repoPaths))

export const layer = layerWith(RepoPaths.layer)
