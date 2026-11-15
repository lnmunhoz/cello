import { Outlet, useSearch } from "@tanstack/react-router"
import { useShortcut } from "@ui-sdk/react/shortcuts"
import { useState } from "react"
import { useStoredWidth } from "../components/ui/ResizeHandle.tsx"
import { Toaster } from "../components/ui/Toast.tsx"
import { isEmbed } from "../lib/embed.ts"
import { useMediaQuery, useWorkspaceId } from "../lib/hooks.ts"
import { readStored, writeStored } from "../lib/storage.ts"
import { NewProjectDialog } from "../project/NewProjectDialog.tsx"
import { CommandBar } from "../search/CommandBar.tsx"
import { COMMAND_BAR_SHORTCUT } from "../search/layout.ts"
import { ImageModal } from "../viewer/ImageModal.tsx"
import { ViewerPanel } from "../viewer/ViewerPanel.tsx"
import { ConnectionStatus } from "./ConnectionStatus.tsx"
import { ReloadBar } from "./ReloadBar.tsx"
import { ShowSidebarButton, Sidebar, SidebarContext } from "./Sidebar.tsx"
import {
  NARROW_WIDTH,
  readSidebar,
  setSidebarMode,
  shownSidebar,
  SIDEBAR_KEY,
  SIDEBAR_SHORTCUT,
  SIDEBAR_WIDTH,
  SIDEBAR_WIDTH_KEY,
  toggleSidebar,
  writeSidebar,
  type SidebarState,
} from "./sidebarState.ts"

export function AppShell() {
  const workspaceId = useWorkspaceId()
  const [newProject, setNewProject] = useState(false)
  const [saved, setSaved] = useState(() => readSidebar(readStored(SIDEBAR_KEY)))
  const [width, resize] = useStoredWidth(SIDEBAR_WIDTH_KEY, SIDEBAR_WIDTH)
  // In a narrow window the sidebar starts as the rail, without saving that, until expanded on purpose.
  const narrow = useMediaQuery(`(max-width: ${NARROW_WIDTH - 1}px)`)
  const [expandedHere, setExpandedHere] = useState(false)
  const sidebar = shownSidebar(saved, { narrow, expandedHere })
  const embed = isEmbed(useSearch({ strict: false }))
  const change = (next: SidebarState) => {
    if (narrow && next.mode === "expanded") setExpandedHere(true)
    setSaved(next)
    writeStored(SIDEBAR_KEY, writeSidebar(next))
  }
  const setMode = (mode: SidebarState["mode"]) => change(setSidebarMode(sidebar, mode))
  useShortcut(embed ? null : SIDEBAR_SHORTCUT, () => change(toggleSidebar(sidebar)), { description: "Collapse or expand the sidebar" })
  // The ⌘K bar (CEL-43), from any page, even while typing in a field (a ⌘ shortcut always runs there).
  const [searching, setSearching] = useState(false)
  useShortcut(embed ? null : COMMAND_BAR_SHORTCUT, () => setSearching(true), { description: "Search Cello" })

  // In a panel (`?embed=1`): just the page, no sidebar.
  if (embed) {
    return (
      <div className="relative flex h-dvh flex-col overflow-clip bg-surface">
        <Outlet />
        <ImageModal />
        <TopReloadBar />
        <Toaster />
      </div>
    )
  }

  // Exactly the window: the shell is the containing block for anything positioned without one of its
  // own (screen-reader-only text in rows below the fold), and clips it, so the page never grows past
  // the window and never scrolls.
  return (
    <SidebarContext value={sidebar.mode}>
      <div className="relative flex h-dvh overflow-clip">
        {sidebar.mode !== "hidden" ? (
          <Sidebar mode={sidebar.mode} width={width} onResize={resize} onMode={setMode} onNewProject={() => setNewProject(true)} onSearch={() => setSearching(true)} />
        ) : null}

        <main
          data-sidebar-mode={sidebar.mode}
          className="relative my-2 mr-2 flex min-w-0 flex-1 overflow-clip rounded-lg border border-line bg-surface shadow-card data-[sidebar-mode=hidden]:ml-2"
        >
          {/* Hidden, the sidebar leaves a way back on every page, and the connection status. */}
          {sidebar.mode === "hidden" ? (
            <>
              <ShowSidebarButton onShow={() => setMode("expanded")} />
              <ConnectionStatus look="pill" />
            </>
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col">
            <Outlet />
          </div>
          <ViewerPanel />
        </main>

        <CommandBar open={searching} onOpenChange={setSearching} onToggleSidebar={() => change(toggleSidebar(sidebar))} />
        {workspaceId ? <NewProjectDialog open={newProject} onOpenChange={setNewProject} workspaceId={workspaceId} /> : null}
        <ImageModal />
        <ReloadBar />
        <Toaster />
      </div>
    </SidebarContext>
  )
}

/**
 * A Cello page inside a panel (the viewer's iframe, the desktop app's native panel): the page alone,
 * without the sidebar. Its links open in the board's viewer (lib/desktop.ts posts them up).
 */
export function EmbeddedShell() {
  return (
    <div className="relative flex h-dvh overflow-clip bg-surface">
      <div className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
      <ViewerPanel />
      <ImageModal />
      <TopReloadBar />
      <Toaster />
    </div>
  )
}

/**
 * The reload bar for a page in a panel: shown when the page is the window's own (the desktop app's
 * native panel), not inside the board's viewer iframe, where the board's bar already asks.
 */
function TopReloadBar() {
  return window === window.top ? <ReloadBar /> : null
}
