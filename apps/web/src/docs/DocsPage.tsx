import type { BoardState } from "@cello/client/sync/applyEvents"
import { documentsOf } from "@cello/client/sync/documents"
import { projectByKey } from "@cello/client/sync/selectors"
import type { DocumentKind, DocumentSummary, Project } from "@cello/contract/entities"
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { FileTextIcon } from "lucide-react"
import { Centered } from "../app/Home.tsx"
import { SegmentedControl, SegmentedControlItem } from "../components/ui/SegmentedControl.tsx"
import { useBoard } from "../lib/hooks.ts"
import { relativeTime } from "../lib/format.ts"
import { KIND_LABELS, KindIcon } from "./kinds.tsx"

const FILTERS: ReadonlyArray<{ value: DocumentKind | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "doc", label: "Docs" },
  { value: "spec", label: "Specs" },
  { value: "page", label: "Pages" },
]

/** The project's docs, specs and pages in one list, newest first, with a kind filter kept in the URL. */
export function DocsPage() {
  const { projectKey } = useParams({ from: "/$projectKey/docs" })
  const { kind } = useSearch({ from: "/$projectKey/docs" })
  const navigate = useNavigate({ from: "/$projectKey/docs" })
  const board = useBoard()
  const project = board ? projectByKey(board, projectKey) : undefined
  if (!board || !project) return null
  const documents = documentsOf(board, project.id, kind)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[880px] flex-col gap-4 px-6 pt-4 pb-10">
        <div className="flex items-center justify-between gap-4">
          <p className="text-[13px] text-muted">
            Reports, plans and specs. Agents publish them with <code className="rounded bg-sunken px-1 py-0.5 text-[12px] text-ink">cello doc publish</code>.
          </p>
          <SegmentedControl
            aria-label="Kind"
            value={kind ?? "all"}
            onValueChange={(value) => {
              if (value) void navigate({ search: (s) => ({ ...s, kind: value === "all" ? undefined : (value as DocumentKind) }) })
            }}
          >
            {FILTERS.map((f) => (
              <SegmentedControlItem key={f.value} value={f.value}>
                {f.label}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </div>
        {documents.length === 0 ? (
          <Empty kind={kind} />
        ) : (
          <ul aria-label="Documents" className="flex flex-col overflow-hidden rounded-lg border border-line bg-raised shadow-card">
            {documents.map((d) => (
              <DocumentRow key={d.id} board={board} project={project} document={d} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function DocumentRow({ board, project, document }: { board: BoardState; project: Project; document: DocumentSummary }) {
  return (
    <li className="border-b border-line last:border-b-0">
      <Link
        to="/$projectKey/pages/$slug"
        params={{ projectKey: project.key, slug: document.slug }}
        data-document={document.slug}
        className="flex gap-3 px-4 py-3.5 outline-none hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <KindIcon kind={document.kind} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-[14px] font-medium text-ink">{document.title}</span>
            <span className="shrink-0 text-xs text-faint">{KIND_LABELS[document.kind]}</span>
          </span>
          {document.summary ? <span className="line-clamp-2 text-[13px] leading-relaxed text-muted">{document.summary}</span> : null}
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
            <span>
              {document.updatedBy.name} · {relativeTime(document.updatedAt)} · version {document.version}
            </span>
            {document.tasks.map((t) => (
              <span key={t.id} className="rounded-full border border-line px-1.5 text-[11px] text-muted">
                {t.key}
                {board.tasks[t.id] ? <span className="sr-only"> {board.tasks[t.id]!.title}</span> : null}
              </span>
            ))}
          </span>
        </span>
      </Link>
    </li>
  )
}

function Empty({ kind }: { kind: DocumentKind | undefined }) {
  const what = kind ? `${KIND_LABELS[kind].toLowerCase()}s` : "documents"
  return (
    <Centered>
      <FileTextIcon aria-hidden className="mb-2 size-6 text-faint" />
      <p className="text-[15px] font-medium text-ink">No {what} yet</p>
      <p>
        When an agent finishes a piece of work, it publishes its report here with{" "}
        <code className="rounded bg-sunken px-1 py-0.5 text-[12px] text-ink">cello doc publish report.md{kind && kind !== "page" ? ` --kind ${kind}` : ""}</code>.
      </p>
    </Centered>
  )
}
