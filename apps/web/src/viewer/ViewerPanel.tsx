import { embedUrl } from "@cello/shared/embed"
import { parseTaskPath } from "@cello/shared/taskKey"
import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router"
import {
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileCodeIcon,
  FileTextIcon,
  FilmIcon,
  GlobeIcon,
  GlobeLockIcon,
  ImageIcon,
  Maximize2Icon,
  XIcon,
} from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type SyntheticEvent } from "react"
import { Button, ButtonLink } from "../components/ui/Button.tsx"
import { ResizeHandle, useStoredWidth } from "../components/ui/ResizeHandle.tsx"
import { toast } from "../components/ui/Toast.tsx"
import { PageBody } from "../docs/PageBody.tsx"
import { DocumentReader } from "../docs/PageReader.tsx"
import { openInPanel, type OpenMessage } from "../lib/desktop.ts"
import { useProjectKeys } from "../lib/hooks.ts"
import { widthLimits } from "../lib/resize.ts"
import { closeViewer, showInViewer, useViewerItem } from "./store.ts"
import { downloadName, shownText, textFormat } from "./text.ts"
import {
  FRAME_TIMEOUT_MS,
  fullPageHref,
  nextFrameState,
  openTaskFrom,
  pageRef,
  refusesFraming,
  VIEWER_WIDTH,
  WIDTH_KEY,
  withVersion,
  type FrameState,
  type ViewerItem,
  type ViewerKind,
} from "./viewer.ts"

/**
 * The side panel (the viewer), docked on the right of the main area at full height while something is
 * open in it: an image, a video, a text file, a Cello page (in the page reader), or an external site.
 * Opened with `openInPanel` (lib/desktop.ts), whose rule (`openRoute`) sends Cello's own pages and
 * files here in the desktop app too; while it's open it takes the task panel's place.
 */
export function ViewerPanel() {
  const item = useViewerItem()
  const navigate = useNavigate()
  useEffect(() => {
    const openTaskHere = (task: { projectKey: string; number: number }) => {
      void navigate({ to: "/$projectKey/$number", params: { projectKey: task.projectKey, number: String(task.number) } })
      closeViewer()
    }
    // A Cello page framed in the viewer opens its links here, not inside itself, and its task keys
    // open the task here, in the main window, closing the viewer (even when the task is the one
    // already open under it). The desktop app's preload sends the same messages: a task key clicked in
    // its native panel, and a `cello://open` link or a ⌘-click to a page on the board (CEL-60).
    const onMessage = (e: MessageEvent) => {
      const task = openTaskFrom(e, location.origin)
      if (task) return openTaskHere(task)
      const data = e.data as Partial<OpenMessage> | null
      if (e.origin !== location.origin || data?.type !== "cello:open" || typeof data.item?.url !== "string") return
      const { url, title, kind, name, place } = data.item
      const target = URL.parse(url, location.origin)
      const linked = target?.origin === location.origin ? parseTaskPath(target.pathname) : null
      if (linked) return openTaskHere(linked)
      openInPanel({
        url,
        title: typeof title === "string" ? title : undefined,
        kind: kind === "image" || kind === "video" || kind === "text" ? kind : undefined,
        name: typeof name === "string" ? name : undefined,
        place: place === "viewer" ? place : undefined,
      })
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [navigate])
  return item ? <Viewer item={item} /> : null
}

/** Esc closes the viewer, unless you're typing or a dialog or menu is open (Esc closes that first). */
const closesOnEscape = (e: KeyboardEvent, doc: Document) => {
  if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return false
  const target = e.target as HTMLElement | null
  if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "")) return false
  return doc.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]') === null
}

const KIND_ICON = { image: ImageIcon, video: FilmIcon, text: FileCodeIcon, page: FileTextIcon, external: GlobeIcon } satisfies Record<ViewerKind, unknown>

/** A plain click on a task link inside the viewer opened that task: the viewer gives it the place, even when it's the task under it. */
const closeOnTaskLink = (e: ReactMouseEvent) => {
  if (!e.defaultPrevented || !(e.target instanceof Element)) return
  const href = e.target.closest("a[href]")?.getAttribute("href")
  const target = href ? URL.parse(href, location.origin) : null
  if (target?.origin === location.origin && parseTaskPath(target.pathname)) closeViewer()
}

function Viewer({ item }: { item: ViewerItem }) {
  const [width, resize] = useStoredWidth(WIDTH_KEY, VIEWER_WIDTH)
  const ref = useRef<HTMLElement>(null)
  const router = useRouter()
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
      onClick={closeOnTaskLink}
    >
      <ResizeHandle edge="left" label="Resize viewer" rule={VIEWER_WIDTH} width={width} onResize={resize} />
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-2 pl-4">
        <Icon aria-hidden className="size-3.5 shrink-0 text-muted" />
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium" title={item.url}>
          {item.title}
        </h2>
        {item.kind === "page" ? (
          // The page in the main area, in the board's place; going there closes the viewer.
          <Button
            variant="ghost"
            size="iconMd"
            aria-label="Expand to full page"
            title="Expand to full page"
            onClick={() => {
              router.history.push(fullPageHref(item.url))
              closeViewer()
            }}
          >
            <Maximize2Icon className="size-4" />
          </Button>
        ) : (
          <ButtonLink href={item.url} variant="ghost" size="iconMd" aria-label="Open in new tab" title="Open in new tab">
            <ExternalLinkIcon className="size-4" />
          </ButtonLink>
        )}
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
    case "text":
      return <TextView item={item} />
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

/**
 * A Cello page: a document renders natively in the page reader (CEL-60), its version picker and task
 * links working here; any other route of the board (the Review page…) in an iframe, without the sidebar.
 */
function PageView({ item }: { item: ViewerItem }) {
  const page = pageRef(item.url, location.origin)
  if (page) {
    return (
      <DocumentReader
        projectKey={page.projectKey}
        slug={page.slug}
        pinned={page.version}
        hash={page.hash}
        onVersion={(version) => showInViewer({ ...item, url: withVersion(item.url, version) })}
      />
    )
  }
  return <iframe title={item.title} src={embedUrl(item.url, location.origin)} onLoad={closeOnEscapeIn} className="min-h-0 w-full flex-1 border-0 bg-surface" />
}

type TextFile = { readonly state: "loading" } | { readonly state: "failed" } | { readonly state: "shown"; readonly text: string; readonly mime: string | null }

/**
 * A text file on the board (a terminal transcript, a test log, markdown, JSON, CSV), fetched and shown
 * natively (CEL-60): markdown in the page's prose, anything else in monospace, wrapped, without ANSI
 * codes. Copy and Download sit above it. A stored file that turns out to be an image or a video
 * (a link nothing described) shows as one instead.
 */
function TextView({ item }: { item: ViewerItem }) {
  const [file, setFile] = useState<TextFile>({ state: "loading" })
  const projectKeys = useProjectKeys()

  useEffect(() => {
    const request = new AbortController()
    fetch(item.url, { signal: request.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const mime = response.headers.get("content-type")
        const media = mime?.startsWith("image/") ? "image" : mime?.startsWith("video/") ? "video" : null
        if (media) return showInViewer({ ...item, kind: media })
        setFile({ state: "shown", text: await response.text(), mime })
      })
      .catch(() => {
        if (!request.signal.aborted) setFile({ state: "failed" })
      })
    return () => request.abort()
  }, [item])

  const format = file.state === "shown" ? textFormat(file.mime, item.name ?? URL.parse(item.url)?.pathname) : "plain"
  const shown = file.state !== "shown" ? "" : format === "markdown" ? file.text : shownText(file.text, format)
  return (
    <>
      <p className="flex shrink-0 items-center gap-2 border-b border-line bg-sunken py-1.5 pr-2 pl-4 text-xs text-muted">
        <span className="min-w-0 flex-1 truncate">{downloadName(item.url, item.name)}</span>
        <Button
          variant="secondary"
          size="sm"
          disabled={file.state !== "shown"}
          onClick={() => void navigator.clipboard?.writeText(shown).then(() => toast("Copied"))}
        >
          <CopyIcon aria-hidden className="size-3.5" />
          Copy
        </Button>
        <ButtonLink href={item.url} download={downloadName(item.url, item.name)} target="_self" variant="secondary" size="sm">
          <DownloadIcon aria-hidden className="size-3.5" />
          Download
        </ButtonLink>
      </p>
      {file.state === "loading" ? (
        <p className="flex flex-1 items-center justify-center text-[13px] text-muted">Loading…</p>
      ) : file.state === "failed" ? (
        <p role="alert" className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-muted">
          This file couldn’t be loaded.
        </p>
      ) : format === "markdown" ? (
        <div data-text-view="markdown" className="min-h-0 flex-1 overflow-y-auto bg-surface">
          <article className="mx-auto max-w-[760px] px-6 pt-6 pb-16">
            <PageBody content={shown} flash={null} onFlashEnd={() => {}} projectKeys={projectKeys} />
          </article>
        </div>
      ) : (
        <pre
          data-text-view={format}
          tabIndex={0}
          aria-label={item.title}
          className="min-h-0 flex-1 overflow-auto bg-surface px-4 py-3 font-mono text-[12.5px] leading-relaxed break-words whitespace-pre-wrap text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          {shown}
        </pre>
      )}
    </>
  )
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
