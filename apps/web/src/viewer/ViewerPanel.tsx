import { documentBySlug } from "@cello/client/sync/documents"
import { projectByKey } from "@cello/client/sync/selectors"
import { embedUrl } from "@cello/shared/embed"
import { formatTaskKey } from "@cello/shared/taskKey"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { useShortcut, useShortcutHint } from "@ui-sdk/react/shortcuts"
import {
  ArrowLeftIcon,
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
  SquareArrowOutUpRightIcon,
  XIcon,
} from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState, type SyntheticEvent } from "react"
import { Button, ButtonLink } from "../components/ui/Button.tsx"
import { ResizeHandle, useStoredWidth } from "../components/ui/ResizeHandle.tsx"
import { copyText } from "../lib/clipboard.ts"
import { PageBody } from "../docs/PageBody.tsx"
import { DocumentReader } from "../docs/PageReader.tsx"
import { openInPanel, type OpenMessage } from "../lib/desktop.ts"
import { useBoard, useKeyedTask, useProjectKeys } from "../lib/hooks.ts"
import { widthLimits } from "../lib/resize.ts"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { openTaskHere } from "../task/openTaskHere.ts"
import { TaskInViewer } from "../task/TaskPanel.tsx"
import { markPanelClick, routerViewerDriver, useBackTarget } from "./panelBack.ts"
import { sideOf, type Spot } from "./panelHistory.ts"
import { viewerItemOf, type ViewerSearch } from "./search.ts"
import { closeViewer, setViewerDriver, showInViewer, useViewerItem } from "./store.ts"
import { downloadName, MAX_SHOWN_LABEL, readShown, shownText, textFormat } from "./text.ts"
import {
  FRAME_TIMEOUT_MS,
  fullPageHref,
  nextFrameState,
  openTaskFrom,
  pageRef,
  refusesFraming,
  taskOfHref,
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
 * files here in the desktop app too. What it shows is in the URL (`?viewer=…`, search.ts); an open
 * task moves to the main area beside it (task/view.ts's `taskPlacement`, CEL-117).
 */
export function ViewerPanel() {
  const item = useViewerItem()
  const navigate = useNavigate()
  const router = useRouter()
  useEffect(() => setViewerDriver(routerViewerDriver(router)), [router])
  useEffect(() => {
    // The task on its board: its address has no `?viewer`, so opening it closes the viewer.
    const openOnBoard = (task: { projectKey: string; number: number }) =>
      void navigate({ to: "/$projectKey/$number", params: { projectKey: task.projectKey, number: String(task.number) } })
    // A Cello page framed in the viewer opens its links here, not inside itself, and its task keys
    // open the task here, in the main window, as a key clicked here would (openTaskHere.ts: beside its
    // board, or in this side panel, CEL-141). The desktop app's preload sends the same messages: a task
    // key clicked in its native panel, and a `cello://open` link or a ⌘-click to a page on the board
    // (CEL-60), which opens a task on its board.
    const onMessage = (e: MessageEvent) => {
      // From the frame in the viewer (not the desktop app's preload): a click in the side panel, which Back can return from.
      const frames = document.querySelectorAll<HTMLIFrameElement>('[data-side-panel="viewer"] iframe')
      if (e.source !== null && [...frames].some((frame) => frame.contentWindow === e.source)) markPanelClick()
      const task = openTaskFrom(e, location.origin)
      if (task) return openTaskHere(router, task)
      const data = e.data as Partial<OpenMessage> | null
      if (e.origin !== location.origin || data?.type !== "cello:open" || typeof data.item?.url !== "string") return
      const { url, title, kind, name, place } = data.item
      const linked = taskOfHref(url, location.origin)
      if (linked) return openOnBoard(linked)
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
  }, [navigate, router])
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

/** A document's own title, live from the board, for the header (a `cello://open` link names only its address). */
const useDocumentTitle = (item: ViewerItem | null): string | undefined => {
  const board = useBoard()
  const page = item?.kind === "page" ? pageRef(item.url, location.origin) : null
  const project = board && page ? projectByKey(board, page.projectKey) : undefined
  return board && page && project ? documentBySlug(board, project.id, page.slug)?.title : undefined
}

/** The task the viewer shows (`?viewer=/THAI/96`, a task opened off its board, CEL-141), or null. */
const viewerTaskOf = (item: ViewerItem): { projectKey: string; number: number } | null => (item.kind === "page" ? taskOfHref(item.url, location.origin) : null)

/** What the side panel showed at `spot`, in a few words: the task's key, or the item's title. */
const useSideLabel = (spot: Spot | undefined): string | undefined => {
  const side = spot ? sideOf(spot) : null
  const item = spot && side?.type === "viewer" ? viewerItemOf(spot.search as ViewerSearch, location.origin) : null
  const title = useDocumentTitle(item)
  return side?.type === "task" ? side.key : (title ?? item?.title)
}

/** The side panel's Back, shared with the docked task panel. */
export const PANEL_BACK_SHORTCUT = "mod+["

/**
 * Back to what the side panel showed before (CEL-117), when what it shows was opened from there: a page
 * from a task, a task from a page's TASKS chip, a linked task from a comment. It's the browser's own
 * Back, so the entry before comes back exactly, the layout included. Nothing when there's no way back.
 */
export function PanelBack() {
  const router = useRouter()
  const target = useBackTarget()
  const label = useSideLabel(target)
  const hint = useShortcutHint(PANEL_BACK_SHORTCUT)
  if (!target) return null
  const name = label ? `Back to ${label}` : "Back"
  return (
    <Button variant="ghost" size="iconMd" aria-label={name} aria-keyshortcuts={hint.ariaKeyshortcuts} title={`${name} (${hint.text})`} onClick={() => router.history.back()}>
      <ArrowLeftIcon className="size-4" />
    </Button>
  )
}

/** The side panel's Back from the keyboard, while it has a way back; the app shell registers it once. */
export function usePanelBackShortcut(enabled: boolean) {
  const router = useRouter()
  const target = useBackTarget()
  useShortcut(enabled && target ? PANEL_BACK_SHORTCUT : null, () => router.history.back(), { description: "Back to what the side panel showed before" })
}

function Viewer({ item }: { item: ViewerItem }) {
  const [width, resize] = useStoredWidth(WIDTH_KEY, VIEWER_WIDTH)
  const ref = useRef<HTMLElement>(null)
  const router = useRouter()
  const Icon = KIND_ICON[item.kind]
  const title = useDocumentTitle(item) ?? item.title
  const task = viewerTaskOf(item)

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
      data-side-panel="viewer"
      style={{ width, ...widthLimits(VIEWER_WIDTH) }}
      className="relative flex shrink-0 flex-col border-l border-line bg-surface outline-none"
    >
      <ResizeHandle edge="left" label="Resize viewer" rule={VIEWER_WIDTH} width={width} onResize={resize} />
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-2 pl-4">
        <PanelBack />
        {task ? (
          <TaskViewerHeading taskKey={formatTaskKey(task.projectKey, task.number)} />
        ) : (
          <>
            <Icon aria-hidden className="size-3.5 shrink-0 text-muted" />
            <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium" title={item.url}>
              {title}
            </h2>
          </>
        )}
        {task ? (
          // The task on its own project's board, docked there; ⌘-click on its key does the same in a new tab.
          <Button variant="ghost" size="iconMd" aria-label="Open in board" title="Open in board" onClick={() => router.history.push(fullPageHref(item.url))}>
            <SquareArrowOutUpRightIcon className="size-4" />
          </Button>
        ) : item.kind === "page" ? (
          // The page in the main area, in the board's place; its address has no `?viewer`, so the viewer closes.
          <Button variant="ghost" size="iconMd" aria-label="Expand to full page" title="Expand to full page" onClick={() => router.history.push(fullPageHref(item.url))}>
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

/** A task's header in the viewer: its status, its key and its title, live from the board. */
function TaskViewerHeading({ taskKey }: { taskKey: string }) {
  const found = useKeyedTask(taskKey)
  return (
    <h2 className="flex min-w-0 flex-1 items-center gap-2 text-[13px] font-medium" title={found ? `${taskKey} · ${found.task.title}` : taskKey}>
      {found?.status ? <StatusIcon category={found.status.category} color={found.status.color} /> : null}
      <span className="shrink-0 text-muted">{taskKey}</span>{" "}
      {found ? <span className="truncate">{found.task.title}</span> : null}
    </h2>
  )
}

function Body({ item }: { item: ViewerItem }) {
  const task = viewerTaskOf(item)
  if (task) return <TaskInViewer projectKey={task.projectKey} number={task.number} />
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
        onVersion={(version) => showInViewer({ ...item, url: withVersion(item.url, version) }, { replace: true })}
      />
    )
  }
  return <iframe title={item.title} src={embedUrl(item.url, location.origin)} onLoad={closeOnEscapeIn} className="min-h-0 w-full flex-1 border-0 bg-surface" />
}

type TextFile =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "shown"; readonly text: string; readonly mime: string | null; readonly clipped: boolean }

/**
 * A text file on the board (a terminal transcript, a test log, markdown, JSON, CSV), fetched and shown
 * natively (CEL-60): markdown in the page's prose, anything else in monospace, wrapped, without ANSI
 * codes. Copy and Download sit above it. Only the first MAX_SHOWN_BYTES are read and shown (a note
 * says so, and Copy copies just that); Download has all of it. A stored file that turns out to be an
 * image or a video (a link nothing described) shows as one instead.
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
        if (media) return showInViewer({ ...item, kind: media }, { replace: true })
        const read = response.body ? await readShown(response.body) : { text: await response.text(), clipped: false }
        setFile({ state: "shown", ...read, mime })
      })
      .catch(() => {
        if (!request.signal.aborted) setFile({ state: "failed" })
      })
    return () => request.abort()
    // The item is read from the URL on each render; it's the same file while these are.
  }, [item.url, item.kind, item.name, item.title])

  const format = file.state === "shown" ? textFormat(file.mime, item.name ?? URL.parse(item.url)?.pathname) : "plain"
  const shown = file.state !== "shown" ? "" : format === "markdown" ? file.text : shownText(file.text, format)
  const clipped = file.state === "shown" && file.clipped
  return (
    <>
      <p className="flex shrink-0 items-center gap-2 border-b border-line bg-sunken py-1.5 pr-2 pl-4 text-xs text-muted">
        <span className="min-w-0 flex-1 truncate">{downloadName(item.url, item.name)}</span>
        <Button
          variant="secondary"
          size="sm"
          disabled={file.state !== "shown"}
          title={clipped ? `Copies the first ${MAX_SHOWN_LABEL}, as shown` : undefined}
          onClick={() => copyText(shown, clipped ? `Copied the first ${MAX_SHOWN_LABEL}` : "Copied")}
        >
          <CopyIcon aria-hidden className="size-3.5" />
          Copy
        </Button>
        <ButtonLink href={item.url} download={downloadName(item.url, item.name)} target="_self" variant="secondary" size="sm">
          <DownloadIcon aria-hidden className="size-3.5" />
          Download
        </ButtonLink>
      </p>
      {clipped ? (
        <p role="note" data-text-clipped="" className="shrink-0 border-b border-line bg-sunken px-4 py-1.5 text-xs text-muted">
          Showing the first {MAX_SHOWN_LABEL}. Download for all of it.
        </p>
      ) : null}
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
