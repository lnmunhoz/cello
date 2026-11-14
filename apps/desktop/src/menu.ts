// The macOS menu: the app menu, standard Edit, View with Reload and the panel toggle, and Window.
// View commands act on what has focus (the panel page or the board), so they take a target getter
// instead of Electron's roles, which only know a BrowserWindow's own web contents.
import { Menu, type MenuItemConstructorOptions, type WebContents } from "electron"

export interface MenuActions {
  /** The board, or the panel page when it has focus; null without a window. */
  readonly target: () => WebContents | null
  readonly togglePanel: () => void
  readonly focusAddress: () => void
  readonly toggleFullScreen: () => void
}

const ZOOM_STEP = 0.5

export const buildMenu = (appName: string, actions: MenuActions): Menu => {
  const onTarget = (run: (contents: WebContents) => void) => () => {
    const contents = actions.target()
    if (contents && !contents.isDestroyed()) run(contents)
  }
  const template: MenuItemConstructorOptions[] = [
    { label: appName, role: "appMenu" },
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
    { role: "windowMenu" },
  ]
  return Menu.buildFromTemplate(template)
}
