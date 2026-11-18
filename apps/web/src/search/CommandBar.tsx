// The ⌘K bar (CEL-43): search everything in Cello, and run actions, from anywhere. Two layouts:
// Peek (the default: results on the left, the highlighted one previewed on the right, scope tabs on
// top) and Palette (centred, one line per result). Results come from the server's search (the same
// one `cello search` uses); the key jump and the actions answer at once, from the board.
import type { BoardState } from "@cello/client/sync/applyEvents"
import { byPosition, projectsOf, taskOfKey } from "@cello/client/sync/selectors"
import type { SearchHit, SearchResults } from "@cello/contract/search"
import { matchesAll, searchTerms, wordPrefixRanges } from "@cello/shared/search"
import { formatTaskKey, parseTaskQuery } from "@cello/shared/taskKey"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { formatShortcut } from "@ui-sdk/react/shortcuts"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { ArrowRightIcon, ClipboardCheckIcon, FolderIcon, HistoryIcon, MessageSquareIcon, PlusIcon, SearchIcon, type LucideIcon } from "lucide-react"
import { useState, type ReactNode } from "react"
import { Chip } from "../components/ui/Chip.tsx"
import { Command, CommandEmpty, CommandGroup, CommandGroupLabel, CommandInput, CommandItem, CommandList, CommandShortcut, Kbd } from "../components/ui/Command.tsx"
import { Dialog, DialogContent, DialogTitle } from "../components/ui/Dialog.tsx"
import { SegmentedControl, SegmentedControlItem } from "../components/ui/SegmentedControl.tsx"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { Tabs, TabsList, TabsTab } from "../components/ui/Tabs.tsx"
import { KIND_LABELS, KindIcon } from "../docs/kinds.tsx"
import { searchFamily, workspaceIdAtom } from "../lib/cello.ts"
import { openTaskHere } from "../task/openTaskHere.ts"
import { relativeTime } from "../lib/format.ts"
import { useBoard, useMediaQuery, useWorkspaceId } from "../lib/hooks.ts"
import { readStored, writeStored } from "../lib/storage.ts"
import { isActionsOnly, matchActions } from "./actions.ts"
import { jumpKeys, withoutTasks } from "./jumps.ts"
import { BAR_LAYOUT_KEY, LAYOUT_NAMES, PEEK_MIN_WIDTH, shownLayout, useBarLayout, type BarLayout } from "./layout.ts"
import { readRecent, RECENT_KEY, recentOf, targetOf, withRecent, type RecentItem, type Target } from "./open.ts"
import { ActionPreview, DECISION_LABELS, Marked, Preview } from "./Preview.tsx"
import { hitValue, SCOPES, scopeCounts, scopeOf, sectionsOf, type Scope, type Section } from "./sections.ts"
import { useActions, type ActionOutcome } from "./useActions.ts"

/** Hits per kind asked of the server: Peek lists them all, Palette the first few. */
const LIMIT = 12

export function CommandBar({ open, onOpenChange, onToggleSidebar }: { open: boolean; onOpenChange: (open: boolean) => void; onToggleSidebar: () => void }) {
  const chosen = useBarLayout()
  const narrow = useMediaQuery(`(max-width: ${PEEK_MIN_WIDTH - 1}px)`)
  const layout = shownLayout(chosen, narrow)
  // A fresh bar for every opening: empty, on the first page, whatever the last one left.
  const [openings, setOpenings] = useState(0)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setOpenings(openings + 1)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size={layout} aria-describedby={undefined} data-layout={layout}>
        <DialogTitle size="hidden">Search Cello</DialogTitle>
        <Bar key={openings} chosen={chosen} layout={layout} onClose={() => onOpenChange(false)} onToggleSidebar={onToggleSidebar} />
      </DialogContent>
    </Dialog>
  )
}

type Page = "projects" | "workspaces" | "new-task"

/** A result row: a hit from the search, the key's task, or a recent place. */
interface Row {
  readonly value: string
  readonly hit: SearchHit
  /** "jump" draws the Go to row. */
  readonly look?: "jump"
}

function Bar({ chosen, layout, onClose, onToggleSidebar }: { chosen: BarLayout; layout: BarLayout; onClose: () => void; onToggleSidebar: () => void }) {
  const board = useBoard()
  const workspaceId = useWorkspaceId()
  const navigate = useNavigate()
  const router = useRouter()
  const setWorkspace = useAtomSet(workspaceIdAtom)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState<Page | null>(null)
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [scope, setScope] = useState<Scope>("all")
  const peek = layout === "peek"

  const actionsOnly = isActionsOnly(query)
  const typed = page === null && !actionsOnly ? query.trim() : ""
  const actions = useActions({ board, workspaceId, layout: chosen, typed: page === "new-task" ? query.trim() : typed, onToggleSidebar })

  // A task's key in any form (CEL-147, cel 147) is asked as the key, so the server's key mode answers;
  // a bare number (147, #147) is asked as typed, and its Go to rows come from the board (CEL-162).
  const projects = board && workspaceId ? projectsOf(board, workspaceId) : []
  const parsed = parseTaskQuery(typed, projects.map((p) => p.key))
  const key = parsed?.projectKey ? formatTaskKey(parsed.projectKey, parsed.number) : null
  const asked = key ?? typed

  // The server's answer for what's typed (nothing is asked while it's empty); the last one stays on
  // screen while the next loads.
  const result = useAtomValue(searchFamily(JSON.stringify({ query: workspaceId ? asked : "", workspaceId, limit: LIMIT })))
  const fresh = AsyncResult.isSuccess(result) ? result.value : null
  const [last, setLast] = useState<SearchResults | null>(null)
  if (fresh !== null && fresh !== last) setLast(fresh)
  // Only an answer of the same kind as what's typed: words for words, this key for a key.
  const answer = typed === "" ? null : (fresh ?? last)
  const results = answer && answer.key === key ? answer : null

  // A key jumps at once from the board, before the server answers; a bare number jumps to each
  // project's task with it, the current project's first.
  const fromBoard = board ? jumpKeys(parsed, projects.map((p) => p.key), actions.project?.key ?? null).flatMap((k) => jumpHit(board, k) ?? []) : []
  const jumps = fromBoard.length > 0 ? fromBoard : results?.jump ? [results.jump] : []
  // A task with a Go to row isn't listed again under Tasks.
  const listed = withoutTasks(results, new Set(jumps.map((j) => j.id)))
  const sections: Section[] = page === null ? sectionsOf(listed, layout, scope) : []
  const recent = page === null && query.trim() === "" && board && workspaceId ? recentHits(board, workspaceId) : []
  const matched = page === null ? matchActions(actions.specs, query) : []
  const shownActions = page !== null ? [] : actionsOnly ? matched : typed !== "" ? (peek && scope !== "all" ? [] : matched.slice(0, 4)) : matched.slice(0, 6)
  const counts = scopeCounts(listed)

  const rows: Row[] = [
    ...jumps.map((jump) => ({ value: `jump:${jump.id}`, hit: jump, look: "jump" as const })),
    ...recent.map((hit) => ({ value: `recent:${hitValue(hit)}`, hit })),
    ...sections.flatMap((s) => s.hits.map((hit) => ({ value: hitValue(hit), hit }))),
  ]
  const rowByValue = new Map(rows.map((r) => [r.value, r]))
  const actionByValue = new Map(shownActions.map((a) => [`action:${a.id}`, a]))

  const workspaces = board ? byPosition(Object.values(board.workspaces).filter((w) => w.archivedAt === null)) : []
  const terms = searchTerms(query)

  const go = (target: Target) => {
    const item = recentOf(target)
    if (item) writeStored(RECENT_KEY, JSON.stringify(withRecent(readRecent(readStored(RECENT_KEY)), item)))
    onClose()
    switch (target.to) {
      case "task":
        // Enter: where its links open, so the page you're on stays (CEL-144); ⌘Enter: its board.
        if (!target.board) return openTaskHere(router, target, { comment: target.comment })
        return void navigate({
          to: "/$projectKey/$number",
          params: { projectKey: target.projectKey, number: String(target.number) },
          search: target.comment ? { comment: target.comment } : {},
        })
      case "review":
        return void navigate({ to: "/review", search: { open: target.key } })
      case "page":
        return void navigate({ to: "/$projectKey/pages/$slug", params: { projectKey: target.projectKey, slug: target.slug } })
      case "issues":
        return void navigate({ to: "/$projectKey/issues", params: { projectKey: target.projectKey } })
      case "settings":
        return void navigate({ to: "/settings", search: target.projectKey ? { project: target.projectKey } : {} })
    }
  }

  const after = (outcome: ActionOutcome) => {
    if (outcome === "done") return onClose()
    if (outcome === "stay") return
    setPage(outcome)
    setQuery("")
  }

  const run = (value: string, event: Event | undefined) => {
    // ⌘Enter, or ⌘-click on a row: the task's board, as ⌘-click on a task link.
    const toBoard = event instanceof KeyboardEvent || event instanceof MouseEvent ? event.metaKey || event.ctrlKey : false
    const row = rowByValue.get(value)
    if (row) {
      const target = targetOf(row.hit, toBoard)
      return target ? go(target) : undefined
    }
    const action = actionByValue.get(value)
    if (action) return after(actions.run(action.id))
    if (value.startsWith("project:")) return go({ to: "issues", projectKey: value.slice("project:".length) })
    if (value.startsWith("workspace:")) {
      onClose()
      setWorkspace(value.slice("workspace:".length))
      return void navigate({ to: "/" })
    }
    if (value === "create") {
      void actions.createTask(query)
      return onClose()
    }
  }

  // Before the first arrow key the list highlights its first row without saying so: preview that one.
  const first = rows[0]?.value ?? (shownActions[0] ? `action:${shownActions[0].id}` : null)
  const previewing = highlighted !== null && (rowByValue.has(highlighted) || actionByValue.has(highlighted)) ? highlighted : first
  const previewRow = previewing ? rowByValue.get(previewing) : undefined
  const previewAction = previewing ? actionByValue.get(previewing) : undefined
  const openable = previewRow !== undefined && previewRow.hit.taskKey !== null

  const list = (
    <CommandList size={peek ? "peek" : "palette"}>
      {page === "projects" ? (
        <CommandGroup>
          <CommandGroupLabel>Projects</CommandGroupLabel>
          {projects.filter((p) => matchesAll([p.name, p.key], terms)).map((p) => (
            <CommandItem key={p.id} value={`project:${p.key}`}>
              <i className="size-3 shrink-0 rounded-[3px]" style={{ background: p.color }} />
              <Marked text={p.name} ranges={wordPrefixRanges(p.name, terms)} />
              <span className="ml-auto text-xs text-faint">{p.key}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      ) : page === "workspaces" ? (
        <CommandGroup>
          <CommandGroupLabel>Workspaces</CommandGroupLabel>
          {workspaces.filter((w) => matchesAll([w.name], terms)).map((w) => (
            <CommandItem key={w.id} value={`workspace:${w.id}`}>
              <FolderIcon aria-hidden className="size-3.5 text-muted" />
              <Marked text={w.name} ranges={wordPrefixRanges(w.name, terms)} />
              {w.id === workspaceId ? <span className="ml-auto text-xs text-faint">Current</span> : null}
            </CommandItem>
          ))}
        </CommandGroup>
      ) : page === "new-task" ? (
        <CommandGroup>
          <CommandGroupLabel>New task{actions.project ? ` in ${actions.project.name}` : ""}</CommandGroupLabel>
          {query.trim() ? (
            <CommandItem value="create">
              <ActionIcon icon={PlusIcon} />
              <span className="min-w-0 truncate">Create “{query.trim()}”</span>
            </CommandItem>
          ) : null}
        </CommandGroup>
      ) : (
        <>
          {jumps.length > 0 ? (
            <CommandGroup data-section="jump">
              <CommandGroupLabel>Go to</CommandGroupLabel>
              {jumps.map((jump) => (
                <CommandItem key={jump.id} value={`jump:${jump.id}`}>
                  <HitRow hit={jump} board={board} compact={peek} jump />
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {recent.length > 0 ? (
            <CommandGroup>
              <CommandGroupLabel>
                <span className="flex items-center gap-1.5">
                  <HistoryIcon aria-hidden className="size-3" />
                  Recent
                </span>
              </CommandGroupLabel>
              {recent.map((hit) => (
                <CommandItem key={hitValue(hit)} value={`recent:${hitValue(hit)}`}>
                  <HitRow hit={hit} board={board} compact />
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {sections.map((s) => (
            <CommandGroup key={s.id} data-section={s.id}>
              <CommandGroupLabel>
                <span>{s.label}</span>
                {s.total > s.hits.length ? <span className="tracking-normal normal-case">{s.hits.length} of {s.total}</span> : null}
              </CommandGroupLabel>
              {s.hits.map((hit) => (
                <CommandItem key={hitValue(hit)} value={hitValue(hit)} size={!peek && hit.snippet && hit.kind !== "project" && hit.kind !== "label" ? "tall" : "row"}>
                  <HitRow hit={hit} board={board} compact={peek} />
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          {shownActions.length > 0 ? (
            <CommandGroup>
              <CommandGroupLabel>Actions</CommandGroupLabel>
              {shownActions.map((a) => (
                <CommandItem key={a.id} value={`action:${a.id}`}>
                  <ActionIcon icon={a.icon} />
                  <span className="min-w-0 truncate">
                    <Marked text={a.label} ranges={a.titleRanges} />
                  </span>
                  {a.meta ? <span className="shrink-0 text-xs text-accent">{a.meta}</span> : null}
                  {a.shortcut ? <CommandShortcut shortcut={a.shortcut} /> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </>
      )}
    </CommandList>
  )

  const placeholder =
    page === "projects" ? "Pick a project…" : page === "workspaces" ? "Pick a workspace…" : page === "new-task" ? "The new task's title, then Enter" : "Search tasks, comments, packets, docs… or > for actions"

  return (
    <Command filter={false} query={query} onQueryChange={(next) => setQuery(next)} onValueChange={(value) => setHighlighted(value)} onAction={(value, details) => run(value, details.event)} loop>
      <div className="flex items-center gap-2.5 border-b border-line px-4">
        <SearchIcon aria-hidden className="size-4 shrink-0 text-faint" />
        {page ? (
          <button type="button" onClick={() => setPage(null)} className="shrink-0" aria-label="Back to search">
            <Chip size="sm">{page === "projects" ? "Switch project" : page === "workspaces" ? "Switch workspace" : "Create task"}</Chip>
          </button>
        ) : null}
        <CommandInput
          aria-label="Search Cello"
          placeholder={placeholder}
          onKeyDown={(e) => {
            // Esc closes the bar at once, whatever is typed (the field would clear itself first).
            if (e.key === "Escape") {
              e.preventDefault()
              onClose()
            }
            if (e.key === "Backspace" && query === "" && page) setPage(null)
            if (e.key === "Tab" && peek && typed !== "" && page === null) {
              e.preventDefault()
              const available = SCOPES.filter((s) => s.id === "all" || counts[s.id] > 0)
              const at = Math.max(0, available.findIndex((s) => s.id === scope))
              setScope(available[(at + (e.shiftKey ? available.length - 1 : 1)) % available.length]!.id)
            }
          }}
        />
        <Kbd>esc</Kbd>
      </div>
      {peek && typed !== "" && page === null && results && results.key === null && counts.all > 0 ? (
        <div className="flex items-center gap-1 border-b border-line px-3 py-1.5">
          <Tabs value={scope} onValueChange={(value) => value && setScope(value as Scope)}>
            <TabsList aria-label="Search in">
              {SCOPES.map((s) =>
                s.id !== "all" && counts[s.id] === 0 ? null : (
                  <TabsTab key={s.id} value={s.id}>
                    {s.label}
                    <span className="ml-1.5 text-faint tabular-nums">{counts[s.id]}</span>
                  </TabsTab>
                ),
              )}
            </TabsList>
          </Tabs>
          <span className="ml-auto flex items-center gap-1 text-[11px] text-faint">
            <Kbd>tab</Kbd> next
          </span>
        </div>
      ) : null}
      {/* Nothing to list: no split, just the list's empty message. */}
      {peek && (rows.length > 0 || shownActions.length > 0 || page !== null || query.trim() === "") ? (
        <div className="flex min-h-0">
          <div className="w-[min(420px,45%)] shrink-0 border-r border-line">{list}</div>
          <div className="h-[min(480px,62vh)] min-w-0 flex-1 overflow-y-auto bg-sunken/60" data-search-preview>
            {previewRow && board ? <Preview hit={previewRow.hit} board={board} /> : previewAction ? <ActionPreview action={previewAction} /> : null}
          </div>
        </div>
      ) : (
        list
      )}
      <CommandEmpty>
        {(state) =>
          state.query.trim() && page === null ? (
            <span>
              Nothing matches “{state.query.trim()}”.
              <span className="mt-1 block text-xs text-faint">Search looks at task keys, titles and descriptions, comments, review packets, docs, projects and labels.</span>
            </span>
          ) : null
        }
      </CommandEmpty>
      <Footer chosen={chosen} openable={openable} />
    </Command>
  )
}

function ActionIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-muted">
      <Icon aria-hidden className="size-3.5" />
    </span>
  )
}

/** The task a key names, from the board, as a hit to jump to. */
const jumpHit = (board: BoardState, key: string): SearchHit | null => {
  const task = taskOfKey(board, key)
  if (!task || task.archivedAt !== null) return null
  return taskHit(board, task.id)
}

const taskHit = (board: BoardState, taskId: string): SearchHit | null => {
  const task = board.tasks[taskId]
  const project = task ? board.projects[task.projectId] : undefined
  if (!task || !project) return null
  return {
    kind: "task",
    id: task.id,
    projectKey: project.key,
    taskId: task.id,
    taskKey: task.key,
    title: task.title,
    titleRanges: [],
    snippet: task.description.replace(/\s+/g, " ").trim().slice(0, 160),
    snippetRanges: [],
    text: task.description,
    textRanges: [],
    author: null,
    at: task.updatedAt,
    status: board.statuses[task.statusId]?.name ?? null,
    decision: null,
    docKind: null,
    slug: null,
    color: null,
  }
}

/**
 * Recent places opened from the bar that are still there, newest first; until there are any, the
 * workspace's most recently changed tasks.
 */
const recentHits = (board: BoardState, workspaceId: string): SearchHit[] => {
  const live = new Map(projectsOf(board, workspaceId).map((p) => [p.key, p]))
  const hitOf = (item: RecentItem): SearchHit | null => {
    if (item.kind === "task") {
      const task = taskOfKey(board, item.key)
      return task && task.archivedAt === null && live.has(item.key.split("-")[0]!) ? taskHit(board, task.id) : null
    }
    const project = live.get(item.projectKey)
    if (!project) return null
    if (item.kind === "project") return { ...emptyHit, kind: "project", id: project.id, projectKey: project.key, title: project.name, color: project.color }
    const doc = Object.values(board.documents).find((d) => d.projectId === project.id && d.slug === item.slug && d.archivedAt === null)
    return doc ? { ...emptyHit, kind: "document", id: doc.id, projectKey: project.key, title: doc.title, docKind: doc.kind, slug: doc.slug, at: doc.updatedAt } : null
  }
  const saved = readRecent(readStored(RECENT_KEY)).map(hitOf).filter((h) => h !== null)
  if (saved.length > 0) return saved.slice(0, 5)
  const projectIds = new Set([...live.values()].map((p) => p.id))
  return Object.values(board.tasks)
    .filter((t) => t.archivedAt === null && projectIds.has(t.projectId))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5)
    .map((t) => taskHit(board, t.id))
    .filter((h) => h !== null)
}

const emptyHit: Omit<SearchHit, "kind" | "id" | "projectKey" | "title"> = {
  taskId: null,
  taskKey: null,
  titleRanges: [],
  snippet: "",
  snippetRanges: [],
  text: "",
  textRanges: [],
  author: null,
  at: 0,
  status: null,
  decision: null,
  docKind: null,
  slug: null,
  color: null,
}

const KIND_ICON: Partial<Record<SearchHit["kind"], LucideIcon>> = { comment: MessageSquareIcon, packet: ClipboardCheckIcon }

/** One result: icon, key and title with its matches, and its snippet under it (Palette) or in the preview (Peek). */
function HitRow({ hit, board, compact, jump }: { hit: SearchHit; board: BoardState | null; compact: boolean; jump?: boolean }) {
  const task = hit.taskId && board ? board.tasks[hit.taskId] : undefined
  const status = task && board ? board.statuses[task.statusId] : undefined
  const Icon = KIND_ICON[hit.kind]
  let icon: ReactNode = null
  if (hit.kind === "task") icon = status ? <StatusIcon category={status.category} color={status.color} /> : null
  else if (hit.kind === "document" && hit.docKind) icon = <KindIcon kind={hit.docKind} />
  else if (hit.kind === "project" || hit.kind === "label") icon = <i className={`size-3 shrink-0 ${hit.kind === "label" ? "rounded-full" : "rounded-[3px]"}`} style={{ background: hit.color ?? undefined }} />
  else if (Icon) icon = <Icon aria-hidden className="size-3.5 text-muted" />

  const key = hit.taskKey ? <span className="shrink-0 font-mono text-xs text-muted tabular-nums">{hit.taskKey}</span> : null
  const meta =
    hit.kind === "comment"
      ? `${hit.author ?? "Someone"} · ${relativeTime(hit.at)}`
      : hit.kind === "packet"
        ? `${hit.decision ? DECISION_LABELS[hit.decision] : "Waiting"} · ${hit.author ?? "Someone"}`
        : hit.kind === "document" && hit.docKind
          ? `${hit.projectKey} · ${KIND_LABELS[hit.docKind]}`
          : hit.kind === "task"
            ? (status?.name ?? hit.status ?? "")
            : hit.kind === "project"
              ? hit.projectKey
              : `Label · ${hit.projectKey}`

  // A comment or packet is its words: the snippet is the line, the task it's on goes under it.
  if (hit.kind === "comment" || hit.kind === "packet") {
    return (
      <>
        <span className="flex w-6 shrink-0 justify-center self-start pt-0.5">{icon}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={compact ? "line-clamp-2 text-[13px]" : "truncate"}>
            <Marked text={hit.snippet} ranges={hit.snippetRanges} />
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
            {key}
            <span className="truncate">{compact ? meta : `${task?.title ?? hit.title} · ${meta}`}</span>
          </span>
        </span>
      </>
    )
  }

  const snippet = !compact && hit.snippetRanges.length > 0 ? hit.snippet : ""
  return (
    <>
      <span className={`flex w-6 shrink-0 justify-center ${snippet ? "self-start pt-0.5" : ""}`}>{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          {key}
          <span className="min-w-0 truncate">
            <Marked text={task?.title ?? hit.title} ranges={task && task.title !== hit.title ? [] : hit.titleRanges} />
          </span>
          {jump ? (
            <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-accent">
              Jump <ArrowRightIcon aria-hidden className="size-3" />
            </span>
          ) : null}
        </span>
        {snippet ? (
          <span className="truncate text-xs text-muted">
            <Marked text={snippet} ranges={hit.snippetRanges} />
          </span>
        ) : null}
      </span>
      {!jump && meta ? <span className={`ml-2 shrink-0 text-xs text-faint ${snippet ? "self-start pt-0.5" : ""}`}>{meta}</span> : null}
    </>
  )
}

function Footer({ chosen, openable }: { chosen: BarLayout; openable: boolean }) {
  return (
    <div className="flex h-10 items-center gap-4 border-t border-line bg-sunken px-3 text-[11px] text-muted">
      <SegmentedControl size="sm" aria-label="Search layout" value={chosen} onValueChange={(value) => value && writeStored(BAR_LAYOUT_KEY, String(value))}>
        {(["peek", "palette"] as const).map((l) => (
          <SegmentedControlItem key={l} value={l}>
            {LAYOUT_NAMES[l]}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
      <span className="ml-auto flex items-center gap-1.5">
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd> move
      </span>
      <span className="flex items-center gap-1.5">
        <Kbd>↵</Kbd> open
      </span>
      {openable ? (
        <span className="flex items-center gap-1.5 max-sm:hidden">
          <Kbd>{formatShortcut("mod+enter")}</Kbd> open in board
        </span>
      ) : null}
      <span className="flex items-center gap-1.5 max-sm:hidden">
        <Kbd>&gt;</Kbd> actions
      </span>
    </div>
  )
}
