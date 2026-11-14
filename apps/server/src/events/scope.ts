// Which events a subscription gets. A workspace scope gets every event in that workspace; a project
// scope gets that project's events plus workspace-level ones (no projectId). The SQL in EventStore
// and `inScope` below state the same rule, one for replay and one for live events.
import type { CelloEvent } from "@cello/contract/events"

/** A scope with the project's workspace looked up. `projectId` null means the whole workspace. */
export interface ResolvedScope {
  readonly workspaceId: string
  readonly projectId: string | null
}

export const inScope = (event: CelloEvent, scope: ResolvedScope): boolean =>
  event.workspaceId === scope.workspaceId &&
  (scope.projectId === null || event.projectId === null || event.projectId === scope.projectId)
