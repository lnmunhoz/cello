import type { StatusCategory } from "@cello/contract/entities"
import { projectByKey, statusesOf } from "@cello/client/sync/selectors"
import { useParams } from "@tanstack/react-router"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { useBoard } from "../lib/hooks.ts"

export function Overview() {
  const { projectKey } = useParams({ from: "/$projectKey" })
  const board = useBoard()
  const project = board ? projectByKey(board, projectKey) : undefined
  if (!board || !project) return null
  const tasks = Object.values(board.tasks).filter((t) => t.projectId === project.id && t.archivedAt === null)
  const statuses = statusesOf(board, project.workspaceId)
  const counts = statuses.map((s) => ({ status: s, count: tasks.filter((t) => t.statusId === s.id).length }))
  const byCategory = (c: StatusCategory) => tasks.filter((t) => board.statuses[t.statusId]?.category === c).length

  return (
    <div className="flex-1 overflow-y-auto px-8 py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-tight">{project.name}</h1>
          <p className="text-[13px] text-muted">{project.description || "No description yet."}</p>
        </div>
        <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-[13px]">
          <dt className="text-muted">Key</dt>
          <dd className="font-medium">{project.key}</dd>
          <dt className="text-muted">Repository</dt>
          <dd className="font-mono text-[12px]">{project.repoPath ?? "None"}</dd>
          <dt className="text-muted">Tasks</dt>
          <dd>
            {tasks.length} open · {byCategory("started")} in progress · {byCategory("completed")} done
          </dd>
        </dl>
        <ul aria-label="Tasks by status" className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {counts.map(({ status, count }) => (
            <li key={status.id} className="flex h-9 items-center gap-2 px-3 text-[13px]">
              <StatusIcon category={status.category} color={status.color} />
              <span className="flex-1">{status.name}</span>
              <span className="tabular-nums text-muted">{count}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
