import { documentBySlug } from "@cello/client/sync/documents"
import { projectByKey, taskByKey } from "@cello/client/sync/selectors"
import { Outlet, useMatch, useParams, useSearch } from "@tanstack/react-router"
import type { CSSProperties, ReactNode } from "react"
import { Breadcrumb, type Crumb } from "../app/Breadcrumb.tsx"
import { Centered } from "../app/Home.tsx"
import { NotFound } from "../app/NotFound.tsx"
import { useStoredWidth } from "../components/ui/ResizeHandle.tsx"
import { TabLink } from "../components/ui/TabLink.tsx"
import { FilterButton } from "../issues/CollapseScope.tsx"
import { DisplayOptions } from "../issues/DisplayOptions.tsx"
import { isEmbed } from "../lib/embed.ts"
import { useBoard, useWorkspaceId } from "../lib/hooks.ts"
import { widthTrack } from "../lib/resize.ts"
import { TaskPanel, useTaskView } from "../task/TaskPanel.tsx"
import { TASK_PANEL_WIDTH, TASK_PANEL_WIDTH_KEY, taskPlacement } from "../task/view.ts"
import { useViewerItem } from "../viewer/store.ts"

/**
 * A project's pages under its breadcrumb and tabs. An open task docks on the right at full height, from
 * the main area's top edge down like a browser's side panel, so the breadcrumb and the tabs row span
 * only the board or list beside it. Its width is this grid's second column, dragged by the panel's left
 * edge. As a full page, or below 768 px, the task takes the board's place under the tabs instead. It's
 * one grid either way, so the panel stays mounted (drafts, scroll) when it moves.
 */
export function ProjectLayout() {
  const params = useParams({ strict: false }) as { projectKey: string; number?: string; slug?: string }
  const { projectKey, slug } = params
  // Only a number is a task; anything else there (`/CEL/demo.mp4`) is the router's Not found.
  const number = params.number !== undefined && /^\d+$/.test(params.number) ? params.number : undefined
  const board = useBoard()
  const workspaceId = useWorkspaceId()
  const embed = isEmbed(useSearch({ strict: false }))
  const onIssues = useMatch({ from: "/$projectKey/issues", shouldThrow: false }) !== undefined || number !== undefined
  const placement = taskPlacement(number !== undefined, useTaskView(), useViewerItem() !== null)
  const [width, resize] = useStoredWidth(TASK_PANEL_WIDTH_KEY, TASK_PANEL_WIDTH)
  if (!board) return <Centered>Loading…</Centered>
  const project = projectByKey(board, projectKey)
  if (!project) return <NotFound title={`No project with the key ${projectKey.toUpperCase()}`} />

  const docked = placement === "side"
  // The breadcrumb and the tabs fill the first two rows of the first column; the page is the third.
  const grid = (header: ReactNode) => (
    <div
      className={`grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)] ${docked ? "md:grid-cols-[minmax(0,1fr)_var(--task-panel-width)]" : ""}`}
      style={docked ? ({ "--task-panel-width": widthTrack(width, TASK_PANEL_WIDTH) } as CSSProperties) : undefined}
    >
      {header}
      <div className="col-start-1 row-start-3 flex min-h-0 min-w-0 flex-col">
        <Outlet />
      </div>
      {number !== undefined ? <TaskPanel board={board} project={project} number={Number(number)} width={width} onResize={resize} /> : null}
    </div>
  )
  // In a panel the route shows on its own, without the breadcrumb and the tabs.
  if (embed) return grid(null)

  const task = number ? taskByKey(board, project.key, Number(number)) : undefined
  const document = slug ? documentBySlug(board, project.id, slug) : undefined
  const workspace = workspaceId ? board.workspaces[workspaceId] : undefined

  const last: Crumb[] = task
    ? [{ label: <span><span className="text-muted">{task.key}</span> {task.title}</span> }]
    : slug
    ? [{ label: "Docs", link: { to: "/$projectKey/docs", params: { projectKey: project.key } } }, { label: document?.title ?? slug }]
    : []

  return grid(
    <>
      <Breadcrumb
        crumbs={[
          { label: workspace?.name ?? "Workspace" },
          {
            label: (
              <span className="flex items-center gap-2">
                <i className="size-2.5 rounded-[3px]" style={{ background: project.color }} />
                {project.name}
              </span>
            ),
            link: { to: "/$projectKey/issues", params: { projectKey: project.key } },
          },
          ...last,
        ]}
      />
      {/* In a narrow window the tabs scroll sideways here instead of overflowing the main panel; Display stays whole. */}
      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        <TabLink to="/$projectKey/overview" params={{ projectKey: project.key }}>
          Overview
        </TabLink>
        <TabLink to="/$projectKey/issues" params={{ projectKey: project.key }} forceActive={number !== undefined}>
          Issues
        </TabLink>
        <TabLink to="/$projectKey/docs" params={{ projectKey: project.key }} forceActive={slug !== undefined}>
          Docs
        </TabLink>
        <TabLink to="/$projectKey/activity" params={{ projectKey: project.key }}>
          Activity
        </TabLink>
        </div>
        {onIssues ? (
          <span className="flex shrink-0 items-center gap-2">
            <FilterButton />
            <DisplayOptions />
          </span>
        ) : null}
      </div>
    </>,
  )
}
