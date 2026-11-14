import { projectsOf } from "@cello/client/sync/selectors"
import { Navigate } from "@tanstack/react-router"
import { useBoard, useWorkspaceId } from "../lib/hooks.ts"

export function Home() {
  const board = useBoard()
  const workspaceId = useWorkspaceId()
  if (!board || !workspaceId) return <Centered>Loading your board…</Centered>
  const first = projectsOf(board, workspaceId)[0]
  if (first) return <Navigate to="/$projectKey/issues" params={{ projectKey: first.key }} replace />
  return (
    <Centered>
      <p className="text-[15px] font-medium text-ink">No projects yet</p>
      <p>Create one with “New project” in the sidebar.</p>
    </Centered>
  )
}

export function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-1 text-[13px] text-muted">{children}</div>
}
