// The panel toolbar's preload (sandboxed, context-isolated): its buttons, address field and resize
// edge talk to the main process through `window.celloPanel`.
import { contextBridge, ipcRenderer } from "electron"
import { CHROME_COMMAND, CHROME_RESIZE, FOCUS_ADDRESS, PANEL_STATE, type CelloPanelBridge, type PanelState } from "../ipc.ts"

const bridge: CelloPanelBridge = {
  command: (command) => ipcRenderer.send(CHROME_COMMAND, command),
  resize: (message) => ipcRenderer.send(CHROME_RESIZE, message),
  onState: (listener) => {
    ipcRenderer.on(PANEL_STATE, (_event, state: PanelState) => listener(state))
  },
  onFocusAddress: (listener) => {
    ipcRenderer.on(FOCUS_ADDRESS, () => listener())
  },
}

contextBridge.exposeInMainWorld("celloPanel", bridge)
