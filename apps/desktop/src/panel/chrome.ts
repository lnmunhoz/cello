// The panel toolbar: back, forward, reload, the title (the URL while editing), open in browser,
// close, and the left edge that resizes the panel. Everything it does goes through window.celloPanel.
import type { CelloPanelBridge, PanelState } from "../ipc.ts"

declare global {
  interface Window {
    celloPanel: CelloPanelBridge
  }
}

const panel = window.celloPanel
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const back = element<HTMLButtonElement>("back")
const forward = element<HTMLButtonElement>("forward")
const reload = element<HTMLButtonElement>("reload")
const external = element<HTMLButtonElement>("external")
const close = element<HTMLButtonElement>("close")
const address = element<HTMLInputElement>("address")
const host = element<HTMLSpanElement>("host")
const progress = element<HTMLDivElement>("progress")
const edge = element<HTMLDivElement>("edge")

let state: PanelState = { open: false, url: "", title: "", canGoBack: false, canGoForward: false, loading: false }

const hostOf = (url: string) => URL.parse(url)?.host ?? ""

const render = () => {
  document.documentElement.dataset.panel = state.open ? "open" : "closed"
  back.disabled = !state.canGoBack
  forward.disabled = !state.canGoForward
  external.disabled = state.url === ""
  reload.classList.toggle("loading", state.loading)
  reload.setAttribute("aria-label", state.loading ? "Stop" : "Reload")
  reload.title = state.loading ? "Stop" : "Reload"
  progress.classList.toggle("on", state.loading)
  if (document.activeElement !== address) address.value = state.title
  address.title = state.url
  host.textContent = state.title === state.url ? "" : hostOf(state.url)
}

panel.onState((next) => {
  state = next
  render()
})
panel.onFocusAddress(() => {
  address.focus()
  address.select()
})

back.addEventListener("click", () => panel.command({ kind: "back" }))
forward.addEventListener("click", () => panel.command({ kind: "forward" }))
reload.addEventListener("click", () => panel.command({ kind: state.loading ? "stop" : "reload" }))
external.addEventListener("click", () => panel.command({ kind: "external" }))
close.addEventListener("click", () => panel.command({ kind: "close" }))

address.addEventListener("focus", () => {
  address.value = state.url
  address.select()
})
address.addEventListener("blur", render)
// Leaving the toolbar (clicking the page or the board) ends editing, as in a browser.
window.addEventListener("blur", () => address.blur())
address.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    panel.command({ kind: "navigate", address: address.value })
    address.blur()
  } else if (event.key === "Escape") {
    address.blur()
  }
})

// Resizing: the edge keeps the pointer while dragging, and reports its screen x once per frame.
let pending: number | null = null
edge.addEventListener("pointerdown", (event) => {
  edge.setPointerCapture(event.pointerId)
  edge.classList.add("dragging")
  panel.resize({ phase: "start", screenX: event.screenX })
})
edge.addEventListener("pointermove", (event) => {
  if (!edge.hasPointerCapture(event.pointerId)) return
  if (pending === null) requestAnimationFrame(() => {
    if (pending !== null) panel.resize({ phase: "move", screenX: pending })
    pending = null
  })
  pending = event.screenX
})
const endResize = (event: PointerEvent) => {
  if (!edge.classList.contains("dragging")) return
  edge.classList.remove("dragging")
  if (pending !== null) panel.resize({ phase: "move", screenX: pending })
  pending = null
  panel.resize({ phase: "end", screenX: event.screenX })
}
edge.addEventListener("pointerup", endResize)
edge.addEventListener("pointercancel", endResize)

render()
