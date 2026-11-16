import type { BoardState } from "@cello/client/sync/applyEvents"
import { boardColumns, placement, statusesOf, taskByKey } from "@cello/client/sync/selectors"
import type { Priority, Project, Task } from "@cello/contract/entities"
import { useAtomSet } from "@effect/atom-react"
import { openAskOf } from "@cello/client/sync/asks"
import { openReviewOf } from "@cello/client/sync/reviews"
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { useShortcut, useShortcutHint } from "@ui-sdk/react/shortcuts"
import { ChevronRightIcon, Maximize2Icon, Minimize2Icon, MoreHorizontalIcon, XIcon } from "lucide-react"
import { useRef, useState } from "react"
import { NotFound } from "../app/NotFound.tsx"
import { NARROW_WIDTH } from "../app/sidebarState.ts"
import { Button } from "../components/ui/Button.tsx"
import { Input, Textarea } from "../components/ui/Input.tsx"
import { Markdown } from "../components/ui/Markdown.tsx"
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../components/ui/Menu.tsx"
import { PRIORITY_LABELS, PriorityIcon } from "../components/ui/PriorityIcon.tsx"
import { ResizeHandle } from "../components/ui/ResizeHandle.tsx"
import { Select } from "../components/ui/Select.tsx"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { Tabs, TabsList, TabsPanel, TabsTab } from "../components/ui/Tabs.tsx"
import { commands } from "../lib/cello.ts"
import { copyText } from "../lib/clipboard.ts"
import { SAVES_ON_BLUR } from "../lib/editing.ts"
import { useMediaQuery } from "../lib/hooks.ts"
import { EarlierReviews, PinnedReview } from "../review/TaskReviews.tsx"
import { AskThread, PinnedAsk } from "../ask/TaskAsks.tsx"
import { useRestoredSideScroll } from "../viewer/panelBack.ts"
import { withoutViewer } from "../viewer/search.ts"
import { useViewerItem } from "../viewer/store.ts"
import { PanelBack } from "../viewer/ViewerPanel.tsx"
import { PanelWork, ProvenanceRows } from "../presence/Presence.tsx"
import { WakeRow } from "./WakeRow.tsx"
import { Comments } from "./Comments.tsx"
import { COPY_KEY_SHORTCUT, taskForAgent } from "./copy.ts"
import { History } from "./History.tsx"
import { MilestonePicker } from "./MilestonePicker.tsx"
import { TaskPages } from "./TaskPages.tsx"
import { searchForView, TASK_PANEL_WIDTH, TASK_VIEW_SHORTCUT, taskPlacement, taskViewOf, viewToggle, type TaskPlacement, type TaskSearch, type TaskView } from "./view.ts"

/** How the open task shows (`?view=full`, view.ts); the board and the list hide behind a full page. */
export const useTaskView = (): TaskView => taskViewOf(useSearch({ strict: false }) as TaskSearch)

/** Where the open task sits (view.ts's `taskPlacement`): it follows the view, whether the viewer is open and whether the window is narrow. */
export const useTaskPlacement = (taskOpen: boolean): TaskPlacement =>
  taskPlacement(taskOpen, useTaskView(), useViewerItem() !== null, useMediaQuery(`(max-width: ${NARROW_WIDTH - 1}px)`))

/**
 * The open task: a side panel docked on the right of the main area at full height, `width` wide and
 * resized by its left edge, or, expanded, a full page under the tabs, where the open packet has room
 * for its two columns. While the viewer is open (a page opened from the task) it's a full page too,
 * the viewer beside it (CEL-117). project/ProjectLayout.tsx places it in its grid. Expand and collapse
 * sit left of the ••• menu; F toggles, and Esc on the full page goes back to the panel. Docked, its
 * header has Back when it was opened from the side panel (a task from a page or a comment). A click on the key in
 * the header copies it, as does ⌘. while the task is open; the menu also copies it for an agent.
 */
export function TaskPanel({
  board,
  project,
  number,
  width,
  onResize,
}: {
  board: BoardState
  project: Project
  number: number
  width: number
  onResize: (width: number, persist: boolean) => void
}) {
  const task = taskByKey(board, project.key, number)
  const parent = task?.parentId ? board.tasks[task.parentId] : undefined
  const navigate = useNavigate()
  const view = useTaskView()
  // With the viewer open the task moves to the main area, the viewer beside it; closing the viewer
  // docks it again. In a narrow window the viewer covers it instead. It's one element either way, so
  // scroll and drafts stay.
  const viewerOpen = useViewerItem() !== null
  const placement = useTaskPlacement(true)
  const full = placement === "page"
  // Below 768 px the panel takes the board's place, so there's no edge to drag.
  const narrow = useMediaQuery(`(max-width: ${NARROW_WIDTH - 1}px)`)
  // Opened from a milestone's page (CEL-132), closing goes back to it; otherwise to the Issues tab.
  const { milestoneId } = useParams({ strict: false }) as { milestoneId?: string }
  const close = () => {
    if (milestoneId === undefined) void navigate({ to: "/$projectKey/issues", params: { projectKey: project.key } })
    else void navigate({ to: "/$projectKey/milestones/$milestoneId", params: { projectKey: project.key, milestoneId } })
  }
  // Expand from the panel; collapse from the main area, closing the viewer beside it. It stays on the
  // page it was opened from (the Issues tab, a milestone's page).
  const toggle = () => {
    const next = viewToggle(full ? "page" : "side")
    void navigate({ to: ".", search: (prev) => ({ ...(next.closeViewer ? withoutViewer(prev) : prev), ...searchForView(next.view) }) })
  }
  const toggleHint = useShortcutHint(TASK_VIEW_SHORTCUT)
  useShortcut(task ? TASK_VIEW_SHORTCUT : null, toggle, { description: "Expand the task to a full page, or back to the panel" })
  useShortcut(full ? "escape" : null, toggle, { when: () => !viewerOpen, description: "Back to the board with the side panel" })
  const copyHint = useShortcutHint(COPY_KEY_SHORTCUT)
  useShortcut(task ? COPY_KEY_SHORTCUT : null, () => task && copyKey(task), { description: "Copy the open task's key" })
  return (
    <aside
      hidden={placement === "covered"}
      aria-label={task ? `${task.key} details` : "Task details"}
      data-view={view}
      data-side-panel="task"
      data-placement={placement}
      className={`relative col-start-1 row-start-3 flex min-h-0 min-w-0 flex-col bg-surface ${full ? "" : "border-line md:col-start-2 md:row-span-full md:border-l"}`}
      onKeyDown={(e) => {
        if (e.key === "Escape" && e.target === e.currentTarget && !full) close()
      }}
    >
      {placement === "side" && !narrow ? <ResizeHandle edge="left" label="Resize task panel" rule={TASK_PANEL_WIDTH} width={width} onResize={onResize} /> : null}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
        {placement === "side" ? <PanelBack /> : null}
        <span className="flex min-w-0 items-center gap-1 text-[13px] font-medium text-muted">
          {parent ? (
            <>
              <Link
                to="/$projectKey/$number"
                params={{ projectKey: project.key, number: String(parent.number) }}
                aria-label={`Parent: ${parent.key} ${parent.title}`}
                className="min-w-0 truncate rounded-sm outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring"
              >
                {parent.key} {parent.title}
              </Link>
              <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-faint" />
            </>
          ) : null}
          {task ? (
            <button
              type="button"
              aria-label={`Copy key ${task.key}`}
              aria-keyshortcuts={copyHint.ariaKeyshortcuts}
              title={`Copy key (${copyHint.text})`}
              onClick={() => copyKey(task)}
              className="-mx-1 shrink-0 cursor-pointer rounded-sm px-1 outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ring"
            >
              {task.key}
            </button>
          ) : (
            <span className="shrink-0">{`${project.key}-${number}`}</span>
          )}
        </span>
        {task ? <PanelWork task={task} board={board} /> : null}
        <span className="ml-auto flex items-center gap-1">
          {task ? (
            <Button
              variant="ghost"
              size="iconMd"
              aria-label={full ? "Collapse to side panel" : "Expand to full page"}
              aria-keyshortcuts={toggleHint.ariaKeyshortcuts}
              title={`${full ? "Collapse to side panel" : "Expand to full page"} (${toggleHint.text})`}
              onClick={toggle}
            >
              {full ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}
            </Button>
          ) : null}
          {task ? <TaskMenu task={task} onArchived={close} /> : null}
          <Button variant="ghost" size="iconMd" aria-label="Close task" onClick={close}>
            <XIcon className="size-4" />
          </Button>
        </span>
      </div>
      {task ? <TaskDetails key={task.id} board={board} project={project} task={task} full={full} /> : <NotFound title={`No task ${project.key}-${number}`} projectKey={project.key} />}
    </aside>
  )
}

/** Puts the task's key on the clipboard, for a commit message or a chat. */
const copyKey = (task: Task) => copyText(task.key, `Copied ${task.key}`)

function TaskMenu({ task, onArchived }: { task: Task; onArchived: () => void }) {
  const archive = useAtomSet(commands.archiveTask)
  return (
    <Menu
      onAction={(value) => {
        if (value === "copy-key") copyKey(task)
        if (value === "copy-for-agent") copyText(taskForAgent(task), `Copied ${task.key} for an agent`)
        if (value === "archive") {
          archive({ id: task.id })
          onArchived()
        }
      }}
    >
      <MenuTrigger aria-label="Task actions">
        <MoreHorizontalIcon className="size-4" />
      </MenuTrigger>
      <MenuContent>
        <MenuItem value="copy-key" shortcut={COPY_KEY_SHORTCUT}>
          Copy key
        </MenuItem>
        <MenuItem value="copy-for-agent">Copy for an agent</MenuItem>
        <MenuSeparator />
        <MenuItem value="archive" variant="danger">
          Archive task
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}

/**
 * The task's fields, packet, pages, comments and history. As a full page the scroll area is a packet
 * container (index.css): the column is centred, and widens for an open packet so it can split in two,
 * while the rest keeps a readable width, aligned with the packet's left edge.
 */
function TaskDetails({ board, project, task, full }: { board: BoardState; project: Project; task: Task; full: boolean }) {
  // An open packet or ask splits in two on a wide page, so the column widens for it.
  const reviewing = openReviewOf(board, task.id) !== undefined || openAskOf(board, task.id) !== undefined
  const update = useAtomSet(commands.updateTask)
  const [title, setTitle] = useState<string | null>(null)
  const [description, setDescription] = useState<string | null>(null)
  const [tab, setTab] = useState<string>(task.description ? "preview" : "write")
  // Docked, Back from a page or another task returns to where it was read (CEL-117).
  const scroller = useRef<HTMLDivElement>(null)
  useRestoredSideScroll(scroller)

  const saveTitle = () => {
    if (title !== null && title.trim() !== "" && title.trim() !== task.title) {
      update({ id: task.id, expectedVersion: task.version, title: title.trim() })
    }
    setTitle(null)
  }
  const saveDescription = () => {
    if (description !== null && description !== task.description) {
      update({ id: task.id, expectedVersion: task.version, description })
    }
    setDescription(null)
  }

  return (
    // A full page is a block, so the centred column below fills it up to its max width.
    <div ref={scroller} data-side-scroll="" className={`min-h-0 flex-1 overflow-y-auto ${full ? "@container/packet block" : "flex flex-col"}`}>
      <div className={full ? `mx-auto box-content max-w-3xl px-8 ${reviewing ? "packet-wide:max-w-[1536px]" : ""}` : "contents"}>
      <div className={`flex flex-col gap-4 pt-5 pb-6 ${full ? "" : "px-6"}`}>
        <PinnedAsk board={board} task={task} />
        <PinnedReview board={board} task={task} />
        <div className={full ? "flex max-w-3xl flex-col gap-4" : "contents"}>
        <Input
          variant="title"
          aria-label="Title"
          {...SAVES_ON_BLUR}
          value={title ?? task.title}
          onFocus={() => setTitle(task.title)}
          onChange={(e) => setTitle(e.currentTarget.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur()
            if (e.key === "Escape") {
              setTitle(null)
              e.currentTarget.blur()
            }
          }}
        />
        <Properties board={board} project={project} task={task} />
        <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium text-muted">Description</h3>
            <TabsList aria-label="Description mode">
              <TabsTab value="write">Write</TabsTab>
              <TabsTab value="preview">Preview</TabsTab>
            </TabsList>
          </div>
          <TabsPanel value="write">
            <div className="pt-2">
              <Textarea
                aria-label="Description"
                {...SAVES_ON_BLUR}
                placeholder="Add a description… Markdown works."
                value={description ?? task.description}
                onFocus={() => setDescription(task.description)}
                onChange={(e) => setDescription(e.currentTarget.value)}
                onBlur={saveDescription}
              />
            </div>
          </TabsPanel>
          <TabsPanel value="preview">
            <div className="min-h-10 pt-2" data-testid="description-preview">
              <Markdown source={description ?? task.description} empty="No description." />
            </div>
          </TabsPanel>
        </Tabs>
        </div>
      </div>
      <div className={`flex flex-col gap-6 border-t border-line py-5 ${full ? "max-w-3xl" : "px-6"}`}>
        <TaskPages board={board} task={task} />
        <AskThread task={task} />
        <EarlierReviews task={task} />
        <Comments board={board} task={task} />
        <History board={board} task={task} />
      </div>
      </div>
    </div>
  )
}

const PRIORITIES: Priority[] = [0, 1, 2, 3, 4]

function Properties({ board, project, task }: { board: BoardState; project: Project; task: Task }) {
  const update = useAtomSet(commands.updateTask)
  const move = useAtomSet(commands.moveTask)
  const setLabels = useAtomSet(commands.setTaskLabels)
  const statuses = statusesOf(board, project.workspaceId)
  // The task's project's labels only (CEL-80), and any archived one it still carries.
  const labels = Object.values(board.labels).filter((l) => l.projectId === task.projectId && (l.archivedAt === null || task.labelIds.includes(l.id)))
  const parents = Object.values(board.tasks)
    .filter((t) => t.projectId === project.id && t.id !== task.id && t.archivedAt === null && t.number > 0)
    .sort((a, b) => a.number - b.number)

  return (
    <dl className="grid grid-cols-[96px_1fr] items-center gap-x-2 gap-y-0.5 text-[13px]">
      <dt className="text-muted">Status</dt>
      <dd>
        <Select
          label="Status"
          value={task.statusId}
          options={statuses.map((s) => ({ value: s.id, label: s.name, icon: <StatusIcon category={s.category} color={s.color} /> }))}
          onValueChange={(statusId) => {
            if (!statusId || statusId === task.statusId) return
            const column = (boardColumns(board, project.workspaceId, project.id).tasks[statusId] ?? []).filter((t) => t.id !== task.id)
            move({ id: task.id, statusId, ...placement(column, 0) })
          }}
        />
      </dd>
      <dt className="text-muted">Priority</dt>
      <dd>
        <Select
          label="Priority"
          value={String(task.priority)}
          options={PRIORITIES.map((p) => ({ value: String(p), label: PRIORITY_LABELS[p], icon: <PriorityIcon priority={p} /> }))}
          onValueChange={(value) => {
            const priority = Number(value) as Priority
            if (value !== null && priority !== task.priority) update({ id: task.id, expectedVersion: task.version, priority })
          }}
        />
      </dd>
      <dt className="text-muted">Labels</dt>
      <dd>
        <Select
          label="Labels"
          multiple
          searchable
          placeholder="Add label"
          value={task.labelIds}
          options={labels.map((l) => ({ value: l.id, label: l.name, icon: <i className="size-2 rounded-full" style={{ background: l.color }} /> }))}
          display={
            task.labelIds.length === 0 ? (
              <span className="text-muted">Add label</span>
            ) : (
              <span className="flex flex-wrap gap-1">
                {task.labelIds.map((id) => {
                  const l = board.labels[id]
                  return l ? (
                    <span key={id} className="flex items-center gap-1.5">
                      <i className="size-2 rounded-full" style={{ background: l.color }} />
                      {l.name}
                    </span>
                  ) : null
                })}
              </span>
            )
          }
          onValueChange={(next) => {
            const add = next.filter((id) => !task.labelIds.includes(id))
            const remove = task.labelIds.filter((id) => !next.includes(id))
            if (add.length || remove.length) setLabels({ id: task.id, add, remove })
          }}
        />
      </dd>
      <dt className="text-muted">Milestone</dt>
      <dd>
        <MilestonePicker board={board} task={task} />
      </dd>
      <dt className="text-muted">Due date</dt>
      <dd className="px-2">
        <Input
          type="date"
          size="sm"
          variant="bare"
          aria-label="Due date"
          {...SAVES_ON_BLUR}
          value={task.dueDate ?? ""}
          onChange={(e) => {
            const dueDate = e.currentTarget.value === "" ? null : e.currentTarget.value
            if (dueDate !== task.dueDate) update({ id: task.id, expectedVersion: task.version, dueDate })
          }}
        />
      </dd>
      <dt className="text-muted">Parent</dt>
      <dd>
        <Select
          label="Parent"
          searchable
          placeholder="No parent"
          value={task.parentId ?? "none"}
          options={[{ value: "none", label: "No parent" }, ...parents.map((t) => ({ value: t.id, label: `${t.key} ${t.title}` }))]}
          onValueChange={(value) => {
            const parentId = value === null || value === "none" ? null : value
            if (parentId !== task.parentId) update({ id: task.id, expectedVersion: task.version, parentId })
          }}
        />
      </dd>
      <ProvenanceRows task={task} board={board} />
      <WakeRow task={task} board={board} />
    </dl>
  )
}
