// Runs the actions in actions.ts (CEL-43): the ⌘K bar today, key chords later, by the same ids.
import type { BoardState } from "@cello/client/sync/applyEvents"
import { reviewQueue } from "@cello/client/sync/reviews"
import { placementAtEnd, projectsOf, statusesOf } from "@cello/client/sync/selectors"
import type { Project } from "@cello/contract/entities"
import { useAtomSet } from "@effect/atom-react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { commands } from "../lib/cello.ts"
import { writeStored } from "../lib/storage.ts"
import { toggleTheme, useDark } from "../lib/theme.ts"
import { actionSpecs, type ActionId, type ActionSpec } from "./actions.ts"
import { BAR_LAYOUT_KEY, type BarLayout } from "./layout.ts"

export interface UseActions {
  readonly board: BoardState | null
  readonly workspaceId: string | null
  /** The layout chosen for the bar (what the layout action switches away from). */
  readonly layout: BarLayout
  /** What's typed, offered as a new task's title. */
  readonly typed: string
  readonly onToggleSidebar: () => void
}

/** What running an action did: done (close the bar), stay (keep it open), or it needs a list in the bar first. */
export type ActionOutcome = "done" | "stay" | "projects" | "workspaces" | "new-task"

/** The project an action is about: the one on screen, else the workspace's first. */
export const useCurrentProject = (board: BoardState | null, workspaceId: string | null): Project | null => {
  const params = useParams({ strict: false }) as { projectKey?: string }
  const projects = board && workspaceId ? projectsOf(board, workspaceId) : []
  return projects.find((p) => p.key === params.projectKey?.toUpperCase()) ?? projects[0] ?? null
}

export function useActions({ board, workspaceId, layout, typed, onToggleSidebar }: UseActions) {
  const navigate = useNavigate()
  const dark = useDark()
  const create = useAtomSet(commands.createTask, { mode: "promiseExit" })
  const project = useCurrentProject(board, workspaceId)
  const waiting = board && workspaceId ? reviewQueue(board, workspaceId).length : 0
  const workspaces = board ? Object.values(board.workspaces).filter((w) => w.archivedAt === null).length : 0
  const specs: ActionSpec[] = actionSpecs({ project, waiting, workspaces, dark, layout, typed })

  /** Creates a task titled `title` in the current project's first open status, and opens it. */
  const createTask = async (title: string) => {
    if (!board || !workspaceId || !project || title.trim() === "") return
    const statuses = statusesOf(board, workspaceId)
    const status = statuses.find((s) => s.category === "unstarted") ?? statuses.find((s) => !s.hidden)
    if (!status) return
    const column = Object.values(board.tasks).filter((t) => t.projectId === project.id && t.statusId === status.id && t.archivedAt === null)
    const exit = await create({ projectId: project.id, title: title.trim(), statusId: status.id, ...placementAtEnd(column) })
    if (exit._tag === "Success") {
      const [, number] = exit.value.key.split("-")
      void navigate({ to: "/$projectKey/$number", params: { projectKey: project.key, number: number! } })
    }
  }

  const run = (id: ActionId): ActionOutcome => {
    switch (id) {
      case "new-task":
        if (typed.trim() === "") return "new-task"
        void createTask(typed)
        return "done"
      case "review":
        void navigate({ to: "/review" })
        return "done"
      case "issues":
        if (project) void navigate({ to: "/$projectKey/issues", params: { projectKey: project.key } })
        return "done"
      case "docs":
        if (project) void navigate({ to: "/$projectKey/docs", params: { projectKey: project.key } })
        return "done"
      case "switch-project":
        return "projects"
      case "switch-workspace":
        return "workspaces"
      case "sidebar":
        onToggleSidebar()
        return "done"
      case "theme":
        toggleTheme()
        return "done"
      case "layout":
        writeStored(BAR_LAYOUT_KEY, layout === "peek" ? "palette" : "peek")
        return "stay"
      case "settings":
        void navigate({ to: "/settings" })
        return "done"
    }
  }

  return { specs, run, createTask, project }
}
