import type { BoardState } from "@cello/client/sync/applyEvents"
import { boardColumns, placement, statusesOf, taskByKey } from "@cello/client/sync/selectors"
import type { Priority, Project, Task } from "@cello/contract/entities"
import { useAtomSet } from "@effect/atom-react"
import { Link, useNavigate } from "@tanstack/react-router"
import { ChevronRightIcon, MoreHorizontalIcon, XIcon } from "lucide-react"
import { useState } from "react"
import { Centered } from "../app/Home.tsx"
import { Button } from "../components/ui/Button.tsx"
import { Input, Textarea } from "../components/ui/Input.tsx"
import { Markdown } from "../components/ui/Markdown.tsx"
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../components/ui/Menu.tsx"
import { PRIORITY_LABELS, PriorityIcon } from "../components/ui/PriorityIcon.tsx"
import { Select } from "../components/ui/Select.tsx"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { Tabs, TabsList, TabsPanel, TabsTab } from "../components/ui/Tabs.tsx"
import { commands } from "../lib/cello.ts"
import { Comments } from "./Comments.tsx"
import { History } from "./History.tsx"

export function TaskPanel({ board, project, number }: { board: BoardState; project: Project; number: number }) {
  const task = taskByKey(board, project.key, number)
  const parent = task?.parentId ? board.tasks[task.parentId] : undefined
  const navigate = useNavigate()
  const close = () => void navigate({ to: "/$projectKey/issues", params: { projectKey: project.key } })
  return (
    <aside
      aria-label={task ? `${task.key} details` : "Task details"}
      className="flex w-[560px] shrink-0 flex-col border-l border-line bg-surface"
      onKeyDown={(e) => {
        if (e.key === "Escape" && e.target === e.currentTarget) close()
      }}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
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
          <span className="shrink-0">{task?.key ?? `${project.key}-${number}`}</span>
        </span>
        <span className="ml-auto flex items-center gap-1">
          {task ? <TaskMenu task={task} onArchived={close} /> : null}
          <Button variant="ghost" size="iconMd" aria-label="Close task" onClick={close}>
            <XIcon className="size-4" />
          </Button>
        </span>
      </div>
      {task ? <TaskDetails key={task.id} board={board} project={project} task={task} /> : <Centered>No task {project.key}-{number}.</Centered>}
    </aside>
  )
}

function TaskMenu({ task, onArchived }: { task: Task; onArchived: () => void }) {
  const archive = useAtomSet(commands.archiveTask)
  return (
    <Menu
      onAction={(value) => {
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
        <MenuItem value="archive" variant="danger">
          Archive task
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}

function TaskDetails({ board, project, task }: { board: BoardState; project: Project; task: Task }) {
  const update = useAtomSet(commands.updateTask)
  const [title, setTitle] = useState<string | null>(null)
  const [description, setDescription] = useState<string | null>(null)
  const [tab, setTab] = useState<string>(task.description ? "preview" : "write")

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
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-col gap-4 px-6 pt-5 pb-6">
        <Input
          variant="title"
          aria-label="Title"
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
      <div className="flex flex-col gap-6 border-t border-line px-6 py-5">
        <Comments board={board} task={task} />
        <History board={board} task={task} />
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
  const labels = Object.values(board.labels).filter((l) => l.workspaceId === project.workspaceId && (l.archivedAt === null || task.labelIds.includes(l.id)))
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
      <dt className="text-muted">Due date</dt>
      <dd className="px-2">
        <Input
          type="date"
          size="sm"
          variant="bare"
          aria-label="Due date"
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
    </dl>
  )
}
