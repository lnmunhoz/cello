// Feeds the router's history to panelHistory.ts's rules (CEL-117): records each hop's way back (kept in
// sessionStorage, so a reload keeps it, as the browser keeps the entries), drives the viewer through
// the URL (search.ts), and keeps the side panel's scroll position per history entry, so Back lands
// where you were reading.
import { useRouter, useRouterState, type AnyRouter } from "@tanstack/react-router"
import { useLayoutEffect, useSyncExternalStore, type RefObject } from "react"
import { backOf, closeMove, recordMove, type Hops, type Move, type Spot } from "./panelHistory.ts"
import { viewerItemOf, viewerSearchOf, withoutViewer, type ViewerSearch } from "./search.ts"
import type { ViewerDriver } from "./store.ts"

const HOPS_KEY = "cello:panel-hops"

const load = (): Hops => {
  try {
    const stored = JSON.parse(sessionStorage.getItem(HOPS_KEY) ?? "{}") as unknown
    return stored && typeof stored === "object" ? (stored as Hops) : {}
  } catch {
    return {}
  }
}

const save = (hops: Hops) => {
  try {
    sessionStorage.setItem(HOPS_KEY, JSON.stringify(hops))
  } catch {}
}

let hops: Hops = {}
const listeners = new Set<() => void>()
const setHops = (next: Hops) => {
  if (next === hops) return
  hops = next
  save(hops)
  for (const listener of listeners) listener()
}

/** A history entry's own key (TanStack gives each entry one, kept in its state across a reload). */
const keyOf = (state: { readonly __TSR_key?: string; readonly key?: string } | undefined): string | undefined => state?.__TSR_key ?? state?.key

/** The side panel's scroll element: the viewer's when it's open, else the docked task's. */
const sideScroller = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-side-panel="viewer"] [data-side-scroll]') ??
  document.querySelector<HTMLElement>('[data-side-panel="task"][data-placement="side"] [data-side-scroll]')

/** Per history entry, how far its side panel was scrolled when it was left. */
const scrolls = new Map<string, number>()
let restore: { readonly key: string; readonly top: number } | null = null

/** The last click or key press was inside the side panel or the open task (`data-side-panel`); set by a click there. */
let fromPanel = false

/** A link in a Cello page framed in the viewer was clicked (its message reached the board): that's from the panel too. */
export const markPanelClick = (): void => {
  fromPanel = true
}

/**
 * Starts recording the router's history moves; returns the stop. Called once by the app shell. The
 * side panel's scroll is saved as it scrolls (by the time the history notifies, the router may have
 * rendered the new location already).
 */
export const installPanelHistory = (router: AnyRouter): (() => void) => {
  hops = load()
  const spotOf = (location: AnyRouter["history"]["location"]): Spot => ({ pathname: location.pathname, search: router.options.parseSearch(location.search) })
  let last = { key: keyOf(router.history.location.state), spot: spotOf(router.history.location) }
  const onClick = (e: MouseEvent) => {
    fromPanel = e.target instanceof Element && e.target.closest("[data-side-panel]") !== null
  }
  const onKeyDown = () => {
    fromPanel = false
  }
  const onScroll = (e: Event) => {
    if (last.key !== undefined && e.target instanceof HTMLElement && e.target === sideScroller()) scrolls.set(last.key, e.target.scrollTop)
  }
  document.addEventListener("click", onClick, true)
  document.addEventListener("keydown", onKeyDown, true)
  document.addEventListener("scroll", onScroll, { capture: true, passive: true })
  const stop = router.history.subscribe(({ location, action }: { location: AnyRouter["history"]["location"]; action: { type: Move["type"] } }) => {
    const to = { key: keyOf(location.state), spot: spotOf(location) }
    if (last.key !== undefined && to.key !== undefined) setHops(recordMove(hops, { type: action.type, from: { key: last.key, spot: last.spot }, to: { key: to.key, spot: to.spot }, fromPanel }))
    const top = to.key === undefined || action.type === "PUSH" ? undefined : scrolls.get(to.key)
    restore = top === undefined || to.key === undefined ? null : { key: to.key, top }
    last = to
    fromPanel = false
  })
  return () => {
    stop()
    document.removeEventListener("click", onClick, true)
    document.removeEventListener("keydown", onKeyDown, true)
    document.removeEventListener("scroll", onScroll, { capture: true })
  }
}

/** Where the side panel's Back goes from here, or undefined when this entry wasn't reached by a hop. */
export const useBackTarget = (): Spot | undefined => {
  const key = useRouterState({ select: (s) => keyOf(s.location.state) })
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => hops,
  )
  return backOf(current, key)
}

/**
 * Puts a side panel scroll element back where it was when this history entry was left (Back, Forward),
 * once it mounts with its content. `ref` is the element marked `data-side-scroll`.
 */
export const useRestoredSideScroll = (ref: RefObject<HTMLElement | null>): void => {
  // Absent only outside the app (tests): nothing to restore then.
  const history = useRouter({ warn: false })?.history
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !restore || !history || restore.key !== keyOf(history.location.state) || sideScroller() !== el) return
    el.scrollTop = restore.top
    restore = null
  }, [ref, history])
}

/** The viewer, through the URL: opening pushes `?viewer=…` beside the page; closing goes back or replaces (panelHistory's `closeMove`). */
export const routerViewerDriver = (router: AnyRouter): ViewerDriver => ({
  current: () => viewerItemOf(router.state.location.search as ViewerSearch, location.origin),
  show: (item, replace) => {
    void router.navigate({ to: ".", search: (prev: Record<string, unknown>) => ({ ...withoutViewer(prev), ...viewerSearchOf(item, location.origin) }), replace })
  },
  close: () => {
    const { state, pathname, search } = router.state.location
    if (closeMove(hops, keyOf(state), { pathname, search }) === "back") return router.history.back()
    void router.navigate({ to: ".", search: (prev: Record<string, unknown>) => withoutViewer(prev), replace: true })
  },
})
