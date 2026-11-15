import { projectsOf, byPosition } from "@cello/client/sync/selectors"
import { reviewQueue } from "@cello/client/sync/reviews"
import { useAtomSet } from "@effect/atom-react"
import { Link, useNavigate } from "@tanstack/react-router"
import {
  ChevronDownIcon,
  ClipboardCheckIcon,
  MoonIcon,
  PanelLeftCloseIcon,
  PanelLeftDashedIcon,
  PanelLeftOpenIcon,
  PlusIcon,
  SettingsIcon,
  SunIcon,
} from "lucide-react"
import { createContext, useContext, useState, type ReactElement, type ReactNode } from "react"
import { Button } from "../components/ui/Button.tsx"
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../components/ui/Menu.tsx"
import { ResizeHandle } from "../components/ui/ResizeHandle.tsx"
import { Tooltip, TooltipContent, TooltipShortcut, TooltipTrigger } from "../components/ui/Tooltip.tsx"
import { workspaceIdAtom } from "../lib/cello.ts"
import { useBoard, useConnection, useWorkspaceId } from "../lib/hooks.ts"
import { widthLimits } from "../lib/resize.ts"
import { isDark, toggleTheme } from "../lib/theme.ts"
import { SIDEBAR_SHORTCUT, SIDEBAR_WIDTH, type SidebarMode } from "./sidebarState.ts"

/** The sidebar's mode and how to change it, for the pieces outside it (the "Show sidebar" button). Null outside the app shell. */
export const SidebarContext = createContext<{ readonly mode: SidebarMode; readonly setMode: (mode: SidebarMode) => void } | null>(null)

const row =
  "flex h-7 items-center gap-2 rounded-md px-2 text-[13px] font-medium text-ink outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring data-[status=active]:bg-selected"
/** A rail item: an icon the size of an icon button, with its tooltip on the right. */
const railItem =
  "relative flex size-7 shrink-0 items-center justify-center rounded-md text-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ring data-[status=active]:bg-selected data-[status=active]:text-ink"

/**
 * The left sidebar, expanded (resizable by its right edge) or as a rail of icons with tooltips. Hidden,
 * it isn't rendered; the breadcrumb shows a button to bring it back (`ShowSidebarButton`), and ⌘B works.
 */
export function Sidebar({
  mode,
  width,
  onResize,
  onMode,
  onNewProject,
}: {
  mode: "expanded" | "rail"
  width: number
  onResize: (width: number, persist: boolean) => void
  onMode: (mode: SidebarMode) => void
  onNewProject: () => void
}) {
  const board = useBoard()
  const workspaceId = useWorkspaceId()
  const connection = useConnection()
  const [dark, setDark] = useState(isDark)
  const setWorkspace = useAtomSet(workspaceIdAtom)
  const navigate = useNavigate()

  const workspaces = board ? byPosition(Object.values(board.workspaces).filter((w) => w.archivedAt === null)) : []
  const workspace = workspaceId && board ? board.workspaces[workspaceId] : undefined
  const projects = board && workspaceId ? projectsOf(board, workspaceId) : []
  const waiting = board && workspaceId ? reviewQueue(board, workspaceId).length : 0
  const switchTo = (id: string | number) => {
    setWorkspace(String(id))
    void navigate({ to: "/" })
  }
  const workspaceItems = workspaces.map((w) => (
    <MenuItem key={w.id} value={w.id}>
      <WorkspaceMark name={w.name} />
      {w.name}
    </MenuItem>
  ))
  const theme = (
    <Button variant="ghost" size="iconMd" aria-label={dark ? "Use light theme" : "Use dark theme"} onClick={() => setDark(toggleTheme())}>
      {dark ? <SunIcon className="size-3.5" /> : <MoonIcon className="size-3.5" />}
    </Button>
  )
  const status =
    connection !== "live" ? (
      <p role="status" className={mode === "rail" ? "sr-only" : "px-2 text-xs text-faint"}>
        {connection === "connecting" ? "Connecting…" : "Reconnecting to the Cello server…"}
      </p>
    ) : null
  const reviewBadge =
    waiting > 0 ? (
      <span
        data-review-count
        className={
          mode === "rail"
            ? "absolute -top-1 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold tabular-nums text-accent-ink ring-2 ring-canvas"
            : "ml-auto flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold tabular-nums text-accent-ink"
        }
      >
        {waiting}
        <span className="sr-only"> waiting</span>
      </span>
    ) : null

  if (mode === "rail") {
    return (
      <aside aria-label="Sidebar" data-sidebar="rail" className="flex min-h-0 w-12 shrink-0 flex-col items-center gap-3 py-3">
        <RailTip label="Expand sidebar" shortcut={SIDEBAR_SHORTCUT}>
          <Button variant="ghost" size="iconMd" aria-label="Expand sidebar" onClick={() => onMode("expanded")}>
            <PanelLeftOpenIcon className="size-4" />
          </Button>
        </RailTip>
        {workspaces.length >= 2 ? (
          <Menu onAction={switchTo}>
            <MenuTrigger variant="rail" aria-label="Switch workspace" title={workspace?.name}>
              <WorkspaceMark name={workspace?.name ?? ""} />
            </MenuTrigger>
            <MenuContent>{workspaceItems}</MenuContent>
          </Menu>
        ) : (
          <span className="flex size-7 items-center justify-center" title={workspace?.name ?? "Cello"}>
            <WorkspaceMark name={workspace?.name ?? "Cello"} />
          </span>
        )}

        <nav aria-label="Inbox" className="flex flex-col items-center">
          <RailTip label={waiting > 0 ? `Review · ${waiting} waiting` : "Review"}>
            <Link to="/review" className={railItem}>
              <ClipboardCheckIcon aria-hidden className="size-4" />
              <span className="sr-only">Review</span>
              {reviewBadge}
            </Link>
          </RailTip>
        </nav>

        <nav aria-label="Projects" className="flex min-h-0 flex-col items-center gap-1 overflow-y-auto py-0.5">
          {projects.map((p) => (
            <RailTip key={p.id} label={p.name}>
              <Link to="/$projectKey" params={{ projectKey: p.key }} activeOptions={{ exact: false }} aria-label={p.name} className={railItem}>
                <span aria-hidden className="flex size-5 items-center justify-center rounded-md text-[11px] font-semibold text-white" style={{ background: p.color }}>
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
              </Link>
            </RailTip>
          ))}
          <RailTip label="New project">
            <Button variant="ghost" size="iconMd" aria-label="New project" onClick={onNewProject} disabled={!workspaceId}>
              <PlusIcon className="size-3.5" />
            </Button>
          </RailTip>
        </nav>

        <div className="mt-auto flex flex-col items-center gap-1">
          <RailTip label="Settings">
            <Link to="/settings" aria-label="Settings" className={railItem}>
              <SettingsIcon className="size-3.5" />
            </Link>
          </RailTip>
          <RailTip label={dark ? "Use light theme" : "Use dark theme"}>{theme}</RailTip>
          <RailTip label="Hide sidebar">
            <Button variant="ghost" size="iconMd" aria-label="Hide sidebar" onClick={() => onMode("hidden")}>
              <PanelLeftDashedIcon className="size-4" />
            </Button>
          </RailTip>
        </div>
        {status}
      </aside>
    )
  }

  return (
    <aside
      aria-label="Sidebar"
      data-sidebar="expanded"
      style={{ width, ...widthLimits(SIDEBAR_WIDTH) }}
      className="relative flex min-h-0 shrink-0 flex-col gap-4 px-3 py-3"
    >
      <ResizeHandle edge="right" label="Resize sidebar" rule={SIDEBAR_WIDTH} width={width} onResize={onResize} />
      <div className="flex h-8 items-center gap-1">
        <div className="flex min-w-0 flex-1">
          {workspaces.length >= 2 ? (
            <Menu onAction={switchTo}>
              <MenuTrigger variant="row" aria-label="Switch workspace">
                <WorkspaceMark name={workspace?.name ?? ""} />
                <span className="truncate">{workspace?.name}</span>
                <ChevronDownIcon className="size-3.5 text-muted" />
              </MenuTrigger>
              <MenuContent>{workspaceItems}</MenuContent>
            </Menu>
          ) : (
            <div className="flex h-7 min-w-0 items-center gap-2 px-2 text-[13px] font-semibold">
              <WorkspaceMark name={workspace?.name ?? "Cello"} />
              <span className="truncate">{workspace?.name ?? "Cello"}</span>
            </div>
          )}
        </div>
        <Tooltip shortcut={SIDEBAR_SHORTCUT}>
          <TooltipTrigger render={<Button variant="ghost" size="iconMd" aria-label="Collapse sidebar" onClick={() => onMode("rail")} />}>
            <PanelLeftCloseIcon className="size-4" />
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Collapse sidebar
            <TooltipShortcut />
          </TooltipContent>
        </Tooltip>
      </div>

      <nav aria-label="Inbox" className="flex flex-col gap-0.5">
        <Link to="/review" className={row}>
          <ClipboardCheckIcon aria-hidden className="size-3.5 text-muted" />
          Review
          {reviewBadge}
        </Link>
      </nav>

      {/* A long project list scrolls here; Settings stays at the bottom. */}
      <nav aria-label="Projects" className="-mx-3 flex min-h-0 flex-col gap-0.5 overflow-y-auto px-3">
        <div className="flex h-7 shrink-0 items-center justify-between px-2 text-xs font-medium text-muted">
          Projects
          <Button variant="ghost" size="icon" aria-label="New project" onClick={onNewProject} disabled={!workspaceId}>
            <PlusIcon className="size-3.5" />
          </Button>
        </div>
        {projects.map((p) => (
          <Link key={p.id} to="/$projectKey" params={{ projectKey: p.key }} className={`${row} shrink-0`} activeOptions={{ exact: false }}>
            <i className="size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} />
            <span className="truncate">{p.name}</span>
          </Link>
        ))}
        <button
          type="button"
          onClick={onNewProject}
          disabled={!workspaceId}
          className="flex h-7 shrink-0 items-center gap-2 rounded-md px-2 text-[13px] text-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
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
        {theme}
      </div>
      {status}
    </aside>
  )
}

/** A rail item with its name in a tooltip on the right (and `shortcut`'s keys, when it has one). */
function RailTip({ label, shortcut, children }: { label: string; shortcut?: string; children: ReactElement<Record<string, unknown>> }) {
  return (
    <Tooltip shortcut={shortcut}>
      <TooltipTrigger render={children} />
      <TooltipContent>
        {label}
        {shortcut ? <TooltipShortcut /> : null}
      </TooltipContent>
    </Tooltip>
  )
}

/** Brings the hidden sidebar back; shown at the start of the breadcrumb only while it's hidden. */
export function ShowSidebarButton(): ReactNode {
  const sidebar = useContext(SidebarContext)
  if (sidebar?.mode !== "hidden") return null
  return (
    <Tooltip shortcut={SIDEBAR_SHORTCUT}>
      <TooltipTrigger render={<Button variant="ghost" size="iconMd" aria-label="Show sidebar" onClick={() => sidebar.setMode("expanded")} />}>
        <PanelLeftOpenIcon className="size-4" />
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Show sidebar
        <TooltipShortcut />
      </TooltipContent>
    </Tooltip>
  )
}

function WorkspaceMark({ name }: { name: string }) {
  return (
    <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-md bg-accent text-[11px] font-semibold text-accent-ink">
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}
