import type { BoardState } from "@cello/client/sync/applyEvents"
import { documentsOfTask } from "@cello/client/sync/documents"
import type { Task } from "@cello/contract/entities"
import { pagePath } from "@cello/text/document"
import { KIND_LABELS, KindIcon } from "../docs/kinds.tsx"
import { openInPanel } from "../lib/desktop.ts"
import { relativeTime } from "../lib/format.ts"
import { isPlainClick } from "../viewer/viewer.ts"

/** Pages, docs and specs linked to the task (`cello doc publish --task`), newest first; each opens in the side panel. */
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
              <a
                href={pagePath(project.key, d.slug)}
                onClick={(e) => {
                  // In the side panel, the task moving to the main area beside it (CEL-60, CEL-117); ⌘-click still opens a tab.
                  if (isPlainClick(e) && openInPanel({ url: pagePath(project.key, d.slug), title: d.title })) e.preventDefault()
                }}
                className="flex items-center gap-2.5 rounded-lg border border-line bg-raised px-3 py-2 shadow-card outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
              >
                <KindIcon kind={d.kind} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] font-medium text-ink">{d.title}</span>
                  <span className="truncate text-xs text-faint">
                    {KIND_LABELS[d.kind]} · version {d.version} · {d.updatedBy.name} · {relativeTime(d.updatedAt)}
                  </span>
                </span>
              </a>
            </li>
          ) : null
        })}
      </ul>
    </section>
  )
}
