import { useRouterState } from "@tanstack/react-router"
import { ExternalLinkIcon, FileTextIcon, FilmIcon, GlobeIcon, GlobeLockIcon, ImageIcon, XIcon } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState, type SyntheticEvent } from "react"
import { Button, ButtonLink } from "../components/ui/Button.tsx"
import { ResizeHandle, useStoredWidth } from "../components/ui/ResizeHandle.tsx"
import type { OpenMessage } from "../lib/desktop.ts"
import { widthLimits } from "../lib/resize.ts"
import { closeViewer, showInViewer, useViewerItem } from "./store.ts"
import {
  FRAME_TIMEOUT_MS,
  frameSrc,
  nextFrameState,
  refusesFraming,
  toViewerItem,
  VIEWER_WIDTH,
  WIDTH_KEY,
  type FrameState,
  type ViewerItem,
  type ViewerKind,
} from "./viewer.ts"

/**
 * The viewer side panel, docked on the right of the main area while something is open in it: an
 * image, a video, a Cello page, or an external site. Opened with `openInPanel` (lib/desktop.ts).
 */
export function ViewerPanel() {
  const item = useViewerItem()
  useEffect(() => {
    // A Cello page framed in the viewer opens its links here, not inside itself.
    const onMessage = (e: MessageEvent) => {
      const data = e.data as Partial<OpenMessage> | null
      if (e.origin !== location.origin || data?.type !== "cello:open" || !data.item) return
      const { url, title, kind } = data.item
      const checked = toViewerItem({ url, title, kind: kind === "image" || kind === "video" ? kind : undefined }, location.origin)
      if (checked) showInViewer(checked)
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])
  return item ? <Viewer item={item} /> : null
}

/** Esc closes the viewer, unless you're typing or a dialog or menu is open (Esc closes that first). */
const closesOnEscape = (e: KeyboardEvent, doc: Document) => {
  if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return false
  const target = e.target as HTMLElement | null
  if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "")) return false
  return doc.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]') === null
}

const KIND_ICON = { image: ImageIcon, video: FilmIcon, page: FileTextIcon, external: GlobeIcon } satisfies Record<ViewerKind, unknown>

function Viewer({ item }: { item: ViewerItem }) {
  const [width, resize] = useStoredWidth(WIDTH_KEY, VIEWER_WIDTH)
  const ref = useRef<HTMLElement>(null)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [openedOn] = useState(pathname)
  const Icon = KIND_ICON[item.kind]

  // Opening a task, or going anywhere else, brings the page back in front.
  useEffect(() => {
    if (pathname !== openedOn) closeViewer()
  }, [pathname, openedOn])

  // Focus moves into the viewer (it may cover what you clicked), and back when it closes.
  useEffect(() => {
    const el = ref.current
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    el?.focus({ preventScroll: true })
    return () => {
      const now = document.activeElement
      if (before?.isConnected && (now === null || now === document.body || el?.contains(now))) before.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    // Capture, so Esc closes the viewer before it reaches the page under it (a list row closes its task on Esc).
    const onKeyDown = (e: KeyboardEvent) => {
      if (!closesOnEscape(e, document)) return
      e.preventDefault()
      e.stopPropagation()
      closeViewer()
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [])

  return (
    <aside
      ref={ref}
      aria-label="Viewer"
      tabIndex={-1}
      data-viewer={item.kind}
      style={{ width, ...widthLimits(VIEWER_WIDTH) }}
      className="relative flex shrink-0 flex-col border-l border-line bg-surface outline-none"
    >
      <ResizeHandle edge="left" label="Resize viewer" rule={VIEWER_WIDTH} width={width} onResize={resize} />
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-2 pl-4">
        <Icon aria-hidden className="size-3.5 shrink-0 text-muted" />
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium" title={item.url}>
          {item.title}
        </h2>
        <ButtonLink href={item.url} variant="ghost" size="iconMd" aria-label="Open in new tab" title="Open in new tab">
          <ExternalLinkIcon className="size-4" />
        </ButtonLink>
        <Button variant="ghost" size="iconMd" aria-label="Close viewer" onClick={closeViewer}>
          <XIcon className="size-4" />
        </Button>
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <Body key={item.url} item={item} />
      </div>
    </aside>
  )
}

function Body({ item }: { item: ViewerItem }) {
  switch (item.kind) {
    case "image":
      return <ImageView item={item} />
    case "video":
      return <VideoView item={item} />
    case "page":
      return <PageView item={item} />
    case "external":
      return <ExternalView item={item} />
  }
}

/** Fits the panel; a click zooms to full size around the point you clicked, another fits it again. */
function ImageView({ item }: { item: ViewerItem }) {
  const [zoom, setZoom] = useState<{ fx: number; fy: number; px: number; py: number } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = scroller.current
    const img = el?.querySelector("img")
    if (!zoom || !el || !img) return
    el.scrollLeft = zoom.fx * img.naturalWidth - zoom.px
    el.scrollTop = zoom.fy * img.naturalHeight - zoom.py
  }, [zoom])

  return (
    <div ref={scroller} className="flex min-h-0 flex-1 overflow-auto bg-sunken">
      <button
        type="button"
        aria-label={zoom ? "Fit to panel" : "Zoom to full size"}
        aria-pressed={zoom !== null}
        onClick={(e) => {
          if (zoom) return setZoom(null)
          const box = e.currentTarget.querySelector("img")!.getBoundingClientRect()
          const area = scroller.current!.getBoundingClientRect()
          // A key press has no pointer: zoom around the middle.
          const x = e.detail === 0 ? box.left + box.width / 2 : e.clientX
          const y = e.detail === 0 ? box.top + box.height / 2 : e.clientY
          setZoom({ fx: (x - box.left) / box.width, fy: (y - box.top) / box.height, px: x - area.left, py: y - area.top })
        }}
        className={
          zoom
            ? "m-auto shrink-0 cursor-zoom-out outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            : "flex size-full cursor-zoom-in items-center justify-center p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        }
      >
        <img
          data-viewer-image
          src={item.url}
          alt={item.title}
          className={zoom ? "max-w-none" : "max-h-full max-w-full rounded-md border border-line object-contain shadow-card"}
        />
      </button>
    </div>
  )
}

function VideoView({ item }: { item: ViewerItem }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-black">
      <video data-viewer-video src={item.url} aria-label={item.title} controls autoPlay playsInline className="max-h-full max-w-full" />
    </div>
  )
}

/** Esc inside a Cello page framed here closes the viewer too (same origin, so the frame can be listened to). */
const closeOnEscapeIn = (e: SyntheticEvent<HTMLIFrameElement>) => {
  try {
    const frame = e.currentTarget.contentWindow
    frame?.addEventListener("keydown", (k) => {
      if (closesOnEscape(k, frame.document)) closeViewer()
    })
  } catch {}
}

function PageView({ item }: { item: ViewerItem }) {
  // White like paper: a text file has no background of its own; Cello pages paint theirs.
  return <iframe title={item.title} src={frameSrc(item.url, location.origin)} onLoad={closeOnEscapeIn} className="min-h-0 w-full flex-1 border-0 bg-white" />
}

/**
 * An iframe attempt, with "Open in browser" always at hand. Many sites forbid framing and the page
 * can't tell (the iframe just stays blank): known ones skip straight to the fallback card, others get
 * it when the frame errors or doesn't load in time.
 */
function ExternalView({ item }: { item: ViewerItem }) {
  const [state, setState] = useState<FrameState>(() => (refusesFraming(item.url) ? "blocked" : "loading"))

  useEffect(() => {
    const timer = setTimeout(() => setState((s) => nextFrameState(s, "timeout")), FRAME_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [])

  if (state === "blocked") return <FrameFallback item={item} />
  return (
    <>
      <p className="flex shrink-0 items-center gap-3 border-b border-line bg-sunken py-1.5 pr-2 pl-4 text-xs text-muted">
        <span className="min-w-0 flex-1">Blank? Some sites can't be shown inside Cello.</span>
        <ButtonLink href={item.url} variant="secondary" size="sm">
          Open in browser
        </ButtonLink>
      </p>
      <iframe
        title={item.title}
        src={item.url}
        referrerPolicy="no-referrer"
        onLoad={() => setState((s) => nextFrameState(s, "load"))}
        onError={() => setState((s) => nextFrameState(s, "error"))}
        className="min-h-0 w-full flex-1 border-0 bg-white"
      />
    </>
  )
}

function FrameFallback({ item }: { item: ViewerItem }) {
  const host = URL.parse(item.url)?.host ?? item.url
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto bg-sunken p-6">
      <section aria-label="Can't show this site" className="flex max-w-sm flex-col items-center gap-3 rounded-lg border border-line bg-raised px-6 py-7 text-center shadow-card">
        <span className="flex size-10 items-center justify-center rounded-full bg-sunken text-muted">
          <GlobeLockIcon aria-hidden className="size-5" />
        </span>
        <div className="flex flex-col gap-1">
          <h3 className="text-[15px] font-semibold text-ink">This site can't be shown inside Cello</h3>
          <p className="text-[13px] text-muted">
            <span className="font-medium text-ink">{host}</span>{" "}
            {refusesFraming(item.url) ? "doesn't allow other apps to show its pages." : "didn't load in the viewer."}
          </p>
        </div>
        <ButtonLink href={item.url} variant="primary" size="md">
          <ExternalLinkIcon aria-hidden className="size-3.5" />
          Open in browser
        </ButtonLink>
        <p className="text-xs text-faint">The Cello desktop app shows any site in its built-in browser, claude.ai included.</p>
      </section>
    </div>
  )
}
