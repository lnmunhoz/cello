// The board's preload (sandboxed, context-isolated): exposes `window.celloDesktop` so the web app
// can open pages in the side panel. The main process accepts only http(s) URLs from it.
import { contextBridge, ipcRenderer } from "electron"
import type { CelloDesktop } from "../../web/src/lib/desktop.ts"
import type { OpenTaskMessage } from "../../web/src/viewer/viewer.ts"
import { BOARD_OPEN_TASK, PANEL_CLOSE, PANEL_OPEN } from "./ipc.ts"

const bridge: CelloDesktop = {
  isDesktop: true,
  openPanel: (url, title) => {
    if (typeof url !== "string") return
    ipcRenderer.send(PANEL_OPEN, { url, ...(typeof title === "string" ? { title } : {}) })
  },
  closePanel: () => ipcRenderer.send(PANEL_CLOSE),
}

contextBridge.exposeInMainWorld("celloDesktop", bridge)

// A task key clicked in the panel: the web app opens it as it does one clicked in its own viewer's
// iframe, from a same-origin `cello:task` message (the web app checks the key).
ipcRenderer.on(BOARD_OPEN_TASK, (_event, key: unknown) => {
  if (typeof key === "string") window.postMessage({ type: "cello:task", key } satisfies OpenTaskMessage, window.location.origin)
})
