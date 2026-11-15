import { documentBySlug } from "@cello/client/sync/documents"
import { projectByKey, taskByKey } from "@cello/client/sync/selectors"
import { Outlet, useMatch, useParams, useSearch } from "@tanstack/react-router"
import { Breadcrumb, type Crumb } from "../app/Breadcrumb.tsx"
import { Centered } from "../app/Home.tsx"
import { TabLink } from "../components/ui/TabLink.tsx"
import { DisplayOptions } from "../issues/DisplayOptions.tsx"
import { isEmbed } from "../lib/embed.ts"
import { useBoard, useWorkspaceId } from "../lib/hooks.ts"

export function ProjectLayout() {
  const { projectKey, number, slug } = useParams({ strict: false }) as { projectKey: string; number?: string; slug?: string }
  const board = useBoard()
  const workspaceId = useWorkspaceId()
  const embed = isEmbed(useSearch({ strict: false }))
  const onIssues = useMatch({ from: "/$projectKey/issues", shouldThrow: false }) !== undefined || number !== undefined
  if (!board) return <Centered>Loading…</Centered>
  const project = projectByKey(board, projectKey)
  if (!project) return <Centered>No project with the key {projectKey.toUpperCase()}.</Centered>
  // In a panel the route shows on its own.
  if (embed) return <Outlet />
  const task = number ? taskByKey(board, project.key, Number(number)) : undefined
  const document = slug ? documentBySlug(board, project.id, slug) : undefined
  const workspace = workspaceId ? board.workspaces[workspaceId] : undefined

  const last: Crumb[] = task
    ? [{ label: <span><span className="text-muted">{task.key}</span> {task.title}</span> }]
    : slug
    ? [{ label: "Docs", link: { to: "/$projectKey/docs", params: { projectKey: project.key } } }, { label: document?.title ?? slug }]
    : []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
      {/* In a narrow window the tabs scroll sideways here instead of overflowing the main panel. */}
      <div className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto px-3 [scrollbar-width:none]">
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
        {onIssues ? (
          <span className="ml-auto">
            <DisplayOptions />
          </span>
        ) : null}
      </div>
      <Outlet />
    </div>
  )
}
