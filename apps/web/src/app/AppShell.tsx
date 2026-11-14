import { useAtomSet } from "@effect/atom-react"
import { projectsOf } from "@cello/client/sync/selectors"
import { Link, Outlet, useNavigate } from "@tanstack/react-router"
import { ChevronDownIcon, MoonIcon, PlusIcon, SettingsIcon, SunIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "../components/ui/Button.tsx"
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../components/ui/Menu.tsx"
import { Toaster } from "../components/ui/Toast.tsx"
import { workspaceIdAtom } from "../lib/cello.ts"
import { useBoard, useConnection, useWorkspaceId } from "../lib/hooks.ts"
import { isDark, toggleTheme } from "../lib/theme.ts"
import { NewProjectDialog } from "../project/NewProjectDialog.tsx"
import { byPosition } from "@cello/client/sync/selectors"

export function AppShell() {
  const board = useBoard()
  const workspaceId = useWorkspaceId()
  const connection = useConnection()
  const [newProject, setNewProject] = useState(false)
  const [dark, setDark] = useState(isDark)
  const setWorkspace = useAtomSet(workspaceIdAtom)
  const navigate = useNavigate()

  const workspaces = board ? byPosition(Object.values(board.workspaces).filter((w) => w.archivedAt === null)) : []
  const workspace = workspaceId && board ? board.workspaces[workspaceId] : undefined
  const projects = board && workspaceId ? projectsOf(board, workspaceId) : []

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col gap-4 px-3 py-3">
        <div className="flex h-8 items-center gap-1">
          {workspaces.length >= 2 ? (
            <Menu
              onAction={(id) => {
                setWorkspace(String(id))
                void navigate({ to: "/" })
              }}
            >
              <MenuTrigger variant="row" aria-label="Switch workspace">
                <WorkspaceMark name={workspace?.name ?? ""} />
                <span className="truncate">{workspace?.name}</span>
                <ChevronDownIcon className="size-3.5 text-muted" />
              </MenuTrigger>
              <MenuContent>
                {workspaces.map((w) => (
                  <MenuItem key={w.id} value={w.id}>
                    <WorkspaceMark name={w.name} />
                    {w.name}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          ) : (
            <div className="flex h-7 items-center gap-2 px-2 text-[13px] font-semibold">
              <WorkspaceMark name={workspace?.name ?? "Cello"} />
              <span className="truncate">{workspace?.name ?? "Cello"}</span>
            </div>
          )}
        </div>

        <nav aria-label="Projects" className="flex flex-col gap-0.5">
          <div className="flex h-7 items-center justify-between px-2 text-xs font-medium text-muted">
            Projects
            <Button variant="ghost" size="icon" aria-label="New project" onClick={() => setNewProject(true)} disabled={!workspaceId}>
              <PlusIcon className="size-3.5" />
            </Button>
          </div>
          {projects.map((p) => (
            <Link
              key={p.id}
              to="/$projectKey"
              params={{ projectKey: p.key }}
              className="flex h-7 items-center gap-2 rounded-md px-2 text-[13px] font-medium text-ink outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring data-[status=active]:bg-selected"
              activeOptions={{ exact: false }}
            >
              <i className="size-2.5 rounded-[3px]" style={{ background: p.color }} />
              <span className="truncate">{p.name}</span>
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setNewProject(true)}
            disabled={!workspaceId}
            className="flex h-7 items-center gap-2 rounded-md px-2 text-[13px] text-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <PlusIcon className="size-3.5" />
            New project
          </button>
        </nav>

        <div className="mt-auto flex items-center gap-1">
          <Link
            to="/settings"
            className="flex h-7 flex-1 items-center gap-2 rounded-md px-2 text-[13px] text-muted outline-none hover:bg-hover hover:text-ink data-[status=active]:bg-selected data-[status=active]:text-ink"
          >
            <SettingsIcon className="size-3.5" />
            Settings
          </Link>
          <Button variant="ghost" size="iconMd" aria-label={dark ? "Use light theme" : "Use dark theme"} onClick={() => setDark(toggleTheme())}>
            {dark ? <SunIcon className="size-3.5" /> : <MoonIcon className="size-3.5" />}
          </Button>
        </div>
        {connection !== "live" ? (
          <p role="status" className="px-2 text-xs text-faint">
            {connection === "connecting" ? "Connecting…" : "Reconnecting to the Cello server…"}
          </p>
        ) : null}
      </aside>

      <main className="my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-card">
        <Outlet />
      </main>

      {workspaceId ? <NewProjectDialog open={newProject} onOpenChange={setNewProject} workspaceId={workspaceId} /> : null}
      <Toaster />
    </div>
  )
}

function WorkspaceMark({ name }: { name: string }) {
  return (
    <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-md bg-accent text-[11px] font-semibold text-accent-ink">
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}
