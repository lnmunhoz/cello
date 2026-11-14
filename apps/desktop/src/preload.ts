// The board's preload (sandboxed, context-isolated): exposes `window.celloDesktop` so the web app
// can open pages in the side panel. The main process accepts only http(s) URLs from it.
import { contextBridge, ipcRenderer } from "electron"
import type { CelloDesktop } from "../../web/src/lib/desktop.ts"
import { PANEL_CLOSE, PANEL_OPEN } from "./ipc.ts"

const bridge: CelloDesktop = {
  isDesktop: true,
  openPanel: (url, title) => {
    if (typeof url !== "string") return
    ipcRenderer.send(PANEL_OPEN, { url, ...(typeof title === "string" ? { title } : {}) })
  },
  closePanel: () => ipcRenderer.send(PANEL_CLOSE),
}

contextBridge.exposeInMainWorld("celloDesktop", bridge)
