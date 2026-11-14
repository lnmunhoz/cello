import type { BoardState } from "@cello/client/sync/applyEvents"
import { documentsOfTask } from "@cello/client/sync/documents"
import type { Task } from "@cello/contract/entities"
import { Link } from "@tanstack/react-router"
import { KIND_LABELS, KindIcon } from "../docs/kinds.tsx"
import { relativeTime } from "../lib/format.ts"

/** Pages, docs and specs linked to the task (`cello doc publish --task`), newest first. */
export function TaskPages({ board, task }: { board: BoardState; task: Task }) {
  const documents = documentsOfTask(board, task.id)
  if (documents.length === 0) return null
  return (
    <section aria-labelledby="pages-heading" className="flex flex-col gap-2">
      <h3 id="pages-heading" className="text-[13px] font-semibold">
        Pages
      </h3>
      <ul className="flex flex-col gap-1.5">
        {documents.map((d) => {
          const project = board.projects[d.projectId]
          return project ? (
            <li key={d.id}>
              <Link
                to="/$projectKey/pages/$slug"
                params={{ projectKey: project.key, slug: d.slug }}
                className="flex items-center gap-2.5 rounded-lg border border-line bg-raised px-3 py-2 shadow-card outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
              >
                <KindIcon kind={d.kind} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] font-medium text-ink">{d.title}</span>
                  <span className="truncate text-xs text-faint">
                    {KIND_LABELS[d.kind]} · version {d.version} · {d.updatedBy.name} · {relativeTime(d.updatedAt)}
                  </span>
                </span>
              </Link>
            </li>
          ) : null
        })}
      </ul>
    </section>
  )
}
