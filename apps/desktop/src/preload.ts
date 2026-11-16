// The board's preload (sandboxed, context-isolated): exposes `window.celloDesktop` so the web app
// can open pages in the side panel. The main process accepts only http(s) URLs from it.
import { contextBridge, ipcRenderer } from "electron"
import type { CelloDesktop, DesktopAppNotice, OpenMessage } from "../../web/src/lib/desktop.ts"
import type { OpenTaskMessage } from "../../web/src/viewer/viewer.ts"
import { APP_NOTICE, APP_RESTART, BOARD_OPEN, BOARD_OPEN_TASK, PANEL_CLOSE, PANEL_OPEN } from "./ipc.ts"
import { mouseButtonDirection } from "./window/history.ts"

// The app's restart notice (CEL-75). Main sends it after each board load, maybe before the web app
// listens, so the last one is kept and handed to each new listener.
let notice: DesktopAppNotice | null = null
const noticeListeners: Array<(notice: DesktopAppNotice | null) => void> = []
ipcRenderer.on(APP_NOTICE, (_event, next: DesktopAppNotice | null) => {
  notice = next
  for (const listener of noticeListeners) listener(notice)
})

const bridge: CelloDesktop = {
  isDesktop: true,
  openPanel: (url, title) => {
    if (typeof url !== "string") return
    ipcRenderer.send(PANEL_OPEN, { url, ...(typeof title === "string" ? { title } : {}) })
  },
  closePanel: () => ipcRenderer.send(PANEL_CLOSE),
  onAppNotice: (listener) => {
    if (typeof listener !== "function") return () => {}
    noticeListeners.push(listener)
    listener(notice)
    return () => {
      const index = noticeListeners.indexOf(listener)
      if (index >= 0) noticeListeners.splice(index, 1)
    }
  },
  restartApp: () => ipcRenderer.send(APP_RESTART),
}

contextBridge.exposeInMainWorld("celloDesktop", bridge)

// A mouse's back and forward buttons go back and forward in the board. macOS reports them only to the
// page; on Windows and Linux they arrive as app commands, which MainWindow takes, so
// `mouseButtonDirection` is null there and the board moves once.
window.addEventListener("mouseup", (event) => {
  const direction = mouseButtonDirection(event.button, process.platform)
  if (direction === null) return
  event.preventDefault()
  if (direction === "back") history.back()
  else history.forward()
})

// A task key clicked in the panel: the web app opens it as it does one clicked in its own viewer's
// iframe, from a same-origin `cello:task` message (the web app checks the key).
ipcRenderer.on(BOARD_OPEN_TASK, (_event, key: unknown) => {
  if (typeof key === "string") window.postMessage({ type: "cello:task", key } satisfies OpenTaskMessage, window.location.origin)
})

// A page on the board (a `cello://open` link, a ⌘-click): the web app opens it in its side panel, as it
// does a link a page framed in its viewer asks it to open (CEL-60).
ipcRenderer.on(BOARD_OPEN, (_event, url: unknown) => {
  if (typeof url === "string") window.postMessage({ type: "cello:open", item: { url } } satisfies OpenMessage, window.location.origin)
})
