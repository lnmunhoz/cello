// The macOS menu: the app menu (with the server's status), standard Edit, View with Reload and the panel toggle, History with
// Back and Forward, and Window. View and History commands act on what has focus (the panel page or the board), so they take a target getter
// instead of Electron's roles, which only know a BrowserWindow's own web contents.
import { Menu, type MenuItemConstructorOptions, type WebContents } from "electron"
import type { HistoryDirection } from "./window/history.ts"

export interface MenuActions {
  /** The board, or the panel page when it has focus; null without a window. */
  readonly target: () => WebContents | null
  readonly togglePanel: () => void
  readonly focusAddress: () => void
  readonly toggleFullScreen: () => void
  /** Back or forward in the board, or in the panel page when it has focus. */
  readonly go: (direction: HistoryDirection) => void
}

const ZOOM_STEP = 0.5

/** The app menu's status line (quit.ts's serverStatusLabel), found by this id to read or update. */
export const SERVER_STATUS_ID = "server-status"

/** The app menu's line saying why the background service didn't start, when it didn't. */
export const SERVICE_PROBLEM_ID = "service-problem"

/**
 * `serverStatus` is the app menu's line saying who runs the server (CEL-81), and `serviceProblem` why
 * the background service didn't start, if it didn't; main.ts rebuilds the menu when they change.
 */
export const buildMenu = (appName: string, actions: MenuActions, serverStatus: string, serviceProblem: string | null = null): Menu => {
  const onTarget = (run: (contents: WebContents) => void) => () => {
    const contents = actions.target()
    if (contents && !contents.isDestroyed()) run(contents)
  }
  const template: MenuItemConstructorOptions[] = [
    {
      // macOS's standard app menu, with the server's status under About.
      label: appName,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { id: SERVER_STATUS_ID, label: serverStatus, enabled: false },
        ...(serviceProblem ? [{ id: SERVICE_PROBLEM_ID, label: serviceProblem, enabled: false }] : []),
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: onTarget((c) => c.reload()) },
        { label: "Force Reload", accelerator: "Shift+CmdOrCtrl+R", click: onTarget((c) => c.reloadIgnoringCache()) },
        { label: "Toggle Developer Tools", accelerator: "Alt+CmdOrCtrl+I", click: onTarget((c) => c.toggleDevTools()) },
        { type: "separator" },
        { label: "Actual Size", accelerator: "CmdOrCtrl+0", click: onTarget((c) => c.setZoomLevel(0)) },
        { label: "Zoom In", accelerator: "CmdOrCtrl+Plus", click: onTarget((c) => c.setZoomLevel(c.getZoomLevel() + ZOOM_STEP)) },
        { label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: onTarget((c) => c.setZoomLevel(c.getZoomLevel() - ZOOM_STEP)) },
        { type: "separator" },
        // ⌘\ also works while a page has focus: MainWindow catches it before the page does.
        { id: "toggle-panel", label: "Toggle Browser Panel", accelerator: "CmdOrCtrl+\\", click: () => actions.togglePanel() },
        { label: "Open Location…", accelerator: "CmdOrCtrl+L", click: () => actions.focusAddress() },
        { type: "separator" },
        { label: "Toggle Full Screen", accelerator: "Ctrl+Cmd+F", click: () => actions.toggleFullScreen() },
      ],
    },
    {
      // ⌘[ and ⌘] also work while a page has focus: MainWindow catches them before the page does.
      label: "History",
      submenu: [
        { id: "history-back", label: "Back", accelerator: "CmdOrCtrl+[", click: () => actions.go("back") },
        { id: "history-forward", label: "Forward", accelerator: "CmdOrCtrl+]", click: () => actions.go("forward") },
      ],
    },
    { role: "windowMenu" },
  ]
  return Menu.buildFromTemplate(template)
}
