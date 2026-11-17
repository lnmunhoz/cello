// The Peek layout's right side (CEL-43): the highlighted result, readable without opening it. A task
// shows its status, priority, labels, description and latest comment; a comment or packet its whole
// text in its card; a document its summary and linked tasks; a project or label its tasks by status;
// an action its shortcut.
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { SearchHit } from "@cello/contract/search"
import type { Range } from "@cello/shared/search"
import { segments } from "@cello/shared/search"
import { useAtomValue } from "@effect/atom-react"
import { formatShortcut } from "@ui-sdk/react/shortcuts"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { ClipboardCheckIcon, MessageSquareIcon } from "lucide-react"
import { Chip } from "../components/ui/Chip.tsx"
import { Kbd } from "../components/ui/Command.tsx"
import { PRIORITY_LABELS, PriorityIcon } from "../components/ui/PriorityIcon.tsx"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { KIND_LABELS, KindIcon } from "../docs/kinds.tsx"
import { commentsFamily } from "../lib/cello.ts"
import { relativeTime } from "../lib/format.ts"
import type { ActionSpec } from "./actions.ts"

/** Text with the matched ranges marked. */
export function Marked({ text, ranges }: { text: string; ranges: ReadonlyArray<Range> | undefined }) {
  if (!ranges || ranges.length === 0) return <>{text}</>
  return (
    <>
      {segments(text, ranges).map((s, i) =>
        s.match ? (
          <mark key={i} className="rounded-[3px] bg-accent/18 px-px text-ink">
            {s.text}
          </mark>
        ) : (
          s.text
        ),
      )}
    </>
  )
}

export const DECISION_LABELS = { approved: "Approved", sent_back: "Sent back", superseded: "Replaced", withdrawn: "Withdrawn" } as const

/** What Enter does with the previewed result; `board`: ⌘Enter goes to its task's board (CEL-144). */
function OpenHint({ label, board }: { label: string; board?: boolean }) {
  return (
    <p className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-xs text-faint">
      <span className="flex items-center gap-1.5">
        <Kbd>↵</Kbd> {label}
      </span>
      {board ? (
        <span className="flex items-center gap-1.5">
          <Kbd>{formatShortcut("mod+enter")}</Kbd> Open in board
        </span>
      ) : null}
    </p>
  )
}

/** The task's key, status, priority and labels, from the board (live). */
function TaskHeader({ board, taskId }: { board: BoardState; taskId: string | null }) {
  const task = taskId ? board.tasks[taskId] : undefined
  if (!task) return null
  const status = board.statuses[task.statusId]
  const labels = task.labelIds.map((id) => board.labels[id]).filter((l) => l !== undefined)
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <span className="font-mono tabular-nums">{task.key}</span>
      {status ? (
        <span className="flex items-center gap-1.5">
          <StatusIcon category={status.category} color={status.color} size={12} />
          {status.name}
        </span>
      ) : null}
      <span className="flex items-center gap-1.5">
        <PriorityIcon priority={task.priority} />
        {PRIORITY_LABELS[task.priority]}
      </span>
      {labels.map((l) => (
        <Chip key={l.id} size="sm" color={l.color}>
          {l.name}
        </Chip>
      ))}
    </div>
  )
}

/** The newest comment on a task, loaded when its preview shows. */
function LatestComment({ board, taskId }: { board: BoardState; taskId: string }) {
  const result = useAtomValue(commentsFamily(taskId))
  const latest = AsyncResult.isSuccess(result) ? result.value.filter((c) => c.deletedAt === null).at(-1) : undefined
  if (!latest) return null
  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-3">
      <span className="text-[11px] font-medium tracking-wide text-faint uppercase">Latest comment</span>
      <p className="line-clamp-4 text-[13px] leading-relaxed whitespace-pre-wrap text-muted">
        <span className="font-medium text-ink">{board.actors[latest.actorId]?.name ?? "Someone"}</span> · {relativeTime(latest.createdAt)} · {latest.body}
      </p>
    </div>
  )
}

export function Preview({ hit, board }: { hit: SearchHit; board: BoardState }) {
  if (hit.kind === "comment" || hit.kind === "packet") {
    const task = hit.taskId ? board.tasks[hit.taskId] : undefined
    const open = hit.kind === "packet" && hit.decision === null
    return (
      <div className="flex min-h-full flex-col gap-4 p-5" data-preview={hit.kind}>
        <TaskHeader board={board} taskId={hit.taskId} />
        <h3 className="text-[15px] leading-snug font-semibold">{task?.title ?? hit.title}</h3>
        <div className="rounded-lg border border-line bg-surface p-3.5 shadow-card">
          <div className="mb-2 flex items-center gap-2 text-xs text-muted">
            {hit.kind === "comment" ? <MessageSquareIcon aria-hidden className="size-3.5" /> : <ClipboardCheckIcon aria-hidden className="size-3.5" />}
            <span className="font-medium text-ink">{hit.author ?? "Someone"}</span>
            <span>{relativeTime(hit.at)}</span>
            {hit.kind === "packet" ? (
              <span className="ml-auto">
                <Chip size="sm">{hit.decision ? DECISION_LABELS[hit.decision] : "Waiting for review"}</Chip>
              </span>
            ) : null}
          </div>
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap">
            <Marked text={hit.text} ranges={hit.textRanges} />
          </p>
        </div>
        <OpenHint label={open ? "Open on the Review page" : hit.kind === "comment" ? "Open the task at this comment" : "Open the task"} board />
      </div>
    )
  }

  if (hit.kind === "task") {
    const task = hit.taskId ? board.tasks[hit.taskId] : undefined
    // The description from the search, marked; from the board when the search had no match in it.
    const description = hit.textRanges.length > 0 ? hit.text : (task?.description ?? hit.text).trim()
    return (
      <div className="flex min-h-full flex-col gap-4 p-5" data-preview="task">
        <TaskHeader board={board} taskId={hit.taskId} />
        <h3 className="text-[17px] leading-snug font-semibold">
          <Marked text={task?.title ?? hit.title} ranges={task && task.title !== hit.title ? [] : hit.titleRanges} />
        </h3>
        {description ? (
          <p className="line-clamp-[12] text-[13px] leading-relaxed whitespace-pre-wrap text-ink/90">
            <Marked text={description} ranges={hit.textRanges.length > 0 ? hit.textRanges : []} />
          </p>
        ) : (
          <p className="text-[13px] text-faint">No description.</p>
        )}
        {hit.taskId ? <LatestComment board={board} taskId={hit.taskId} /> : null}
        <OpenHint label="Open the task" board />
      </div>
    )
  }

  if (hit.kind === "document") {
    const doc = board.documents[hit.id]
    return (
      <div className="flex min-h-full flex-col gap-4 p-5" data-preview="document">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          {hit.docKind ? <KindIcon kind={hit.docKind} /> : null}
          {hit.docKind ? KIND_LABELS[hit.docKind] : null} · {hit.projectKey}
          {doc ? ` · version ${doc.version}` : ""}
          {hit.author ? ` · ${hit.author}, ${relativeTime(hit.at)}` : ""}
        </div>
        <h3 className="text-[17px] leading-snug font-semibold">
          <Marked text={hit.title} ranges={hit.titleRanges} />
        </h3>
        {doc?.summary ? <p className="text-[13px] leading-relaxed text-ink/90">{doc.summary}</p> : null}
        {hit.snippetRanges.length > 0 ? (
          <p className="rounded-lg border border-line bg-surface p-3 text-[13px] leading-relaxed text-muted">
            <Marked text={hit.snippet} ranges={hit.snippetRanges} />
          </p>
        ) : null}
        {doc && doc.tasks.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {doc.tasks.map((t) => (
              <Chip key={t.id} size="sm">
                {t.key}
              </Chip>
            ))}
          </div>
        ) : null}
        <OpenHint label="Open the page" />
      </div>
    )
  }

  // A project or a label: its tasks by status.
  const tasks = Object.values(board.tasks).filter(
    (t) => t.archivedAt === null && (hit.kind === "label" ? t.labelIds.includes(hit.id) : t.projectId === hit.id),
  )
  const byStatus = new Map<string, number>()
  for (const t of tasks) byStatus.set(t.statusId, (byStatus.get(t.statusId) ?? 0) + 1)
  return (
    <div className="flex min-h-full flex-col gap-4 p-5" data-preview={hit.kind}>
      <div className="flex items-center gap-2 text-xs text-muted">
        <i className={`size-3 ${hit.kind === "label" ? "rounded-full" : "rounded-[3px]"}`} style={{ background: hit.color ?? undefined }} />
        {hit.kind === "label" ? `Label · ${hit.projectKey}` : `Project · ${hit.projectKey}`} · {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
      </div>
      <h3 className="text-[17px] font-semibold">
        <Marked text={hit.title} ranges={hit.titleRanges} />
      </h3>
      <div className="flex flex-col gap-1.5">
        {[...byStatus.entries()].map(([statusId, n]) => {
          const s = board.statuses[statusId]
          return s ? (
            <div key={statusId} className="flex items-center gap-2 text-[13px]">
              <StatusIcon category={s.category} color={s.color} />
              {s.name}
              <span className="ml-auto text-muted tabular-nums">{n}</span>
            </div>
          ) : null
        })}
      </div>
      <OpenHint label={hit.kind === "label" ? "Open labels in Settings" : "Open the project"} />
    </div>
  )
}

export function ActionPreview({ action }: { action: ActionSpec }) {
  return (
    <div className="flex min-h-full flex-col gap-3 p-5" data-preview="action">
      <span className="flex size-9 items-center justify-center rounded-lg border border-line bg-surface text-muted">
        <action.icon aria-hidden className="size-4" />
      </span>
      <h3 className="text-[15px] font-semibold">{action.label}</h3>
      {action.meta ? <p className="text-[13px] text-muted">{action.meta}</p> : null}
      {action.shortcut ? (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          Anywhere: <Kbd>{formatShortcut(action.shortcut)}</Kbd>
        </p>
      ) : null}
      <OpenHint label={action.opensList ? "Pick one" : "Run it"} />
    </div>
  )
}
