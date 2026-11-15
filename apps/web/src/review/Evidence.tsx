import { attachmentUrl, evidenceOpen, posterUrl } from "@cello/client/sync/reviews"
import type { Attachment } from "@cello/contract/entities"
import { formatBytes } from "@cello/shared/bytes"
import { shortUrl } from "@cello/shared/linkify"
import { ExternalLinkIcon, FileTextIcon, PanelRightOpenIcon } from "lucide-react"
import { useRef, type MouseEvent } from "react"
import { Button, ButtonLink } from "../components/ui/Button.tsx"
import { openInPanel } from "../lib/desktop.ts"
import { openImageModal } from "../viewer/imageModal.ts"
import { isPlainClick } from "../viewer/viewer.ts"

/**
 * Opens a piece of evidence from `packet` (see `evidenceOpen`): a screenshot in the image modal, with
 * the packet's other screenshots to step through (`opener` gets the focus back when it closes);
 * anything else beside the board, in the viewer or the desktop app's panel.
 */
export const openEvidence = (attachment: Attachment, packet: ReadonlyArray<Attachment>, opener: HTMLElement | null = null): boolean => {
  const open = evidenceOpen(attachment, packet)
  if (open?.in === "modal") {
    openImageModal(open.images, open.index, opener)
    return true
  }
  return open !== null && openInPanel(open.target.url, open.target.title, open.target.kind)
}

/** An evidence link: a plain click opens it (see `openEvidence`); ⌘-click still opens a new tab. */
const openOnPlainClick = (attachment: Attachment, packet: ReadonlyArray<Attachment>) => (e: MouseEvent<HTMLElement>) => {
  if (isPlainClick(e) && openEvidence(attachment, packet, e.currentTarget)) e.preventDefault()
}

/** A packet's evidence: videos to play, screenshots to open large, text files and links to open in the viewer. */
export function Evidence({ attachments }: { attachments: ReadonlyArray<Attachment> }) {
  const videos = attachments.filter((a) => a.kind === "video")
  const images = attachments.filter((a) => a.kind === "image")
  const files = attachments.filter((a) => a.kind === "file")
  const links = attachments.filter((a) => a.kind === "link")
  if (attachments.length === 0) return <p className="text-[13px] text-faint">No evidence attached.</p>
  return (
    <div className="flex flex-col gap-4">
      {videos.map((v) => (
        <Video key={v.id} video={v} />
      ))}
      {images.length > 0 ? <Screenshots images={images} packet={attachments} /> : null}
      {files.length + links.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {files.map((f) => (
            <ButtonLink key={f.id} href={attachmentUrl(f)} onClick={openOnPlainClick(f, attachments)} variant="secondary" size="md" aria-label={`Open ${f.name}`}>
              <FileTextIcon aria-hidden className="size-3.5 text-muted" />
              {f.caption || f.name}
              {f.bytes !== null ? <span className="font-normal text-faint">{formatBytes(f.bytes)}</span> : null}
            </ButtonLink>
          ))}
          {links.map((l) => (
            <ButtonLink key={l.id} href={l.url ?? "#"} onClick={openOnPlainClick(l, attachments)} variant="secondary" size="md">
              <ExternalLinkIcon aria-hidden className="size-3.5 text-muted" />
              {l.caption || shortUrl(l.url ?? l.name)}
            </ButtonLink>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Inline, with its poster, muted until you press play; "Open in viewer" plays it large beside the board. */
function Video({ video }: { video: Attachment }) {
  const ref = useRef<HTMLVideoElement>(null)
  const name = video.caption || video.name
  return (
    <figure className="flex flex-col gap-1.5">
      <video
        ref={ref}
        data-evidence="video"
        aria-label={name}
        className="aspect-video w-full rounded-lg border border-line bg-black object-contain"
        src={attachmentUrl(video)}
        poster={posterUrl(video)}
        controls
        muted
        playsInline
        preload="metadata"
        onPlay={(e) => {
          e.currentTarget.muted = false
        }}
      />
      <figcaption className="flex min-w-0 items-center gap-2 text-xs text-muted">
        {video.caption ? <span className="shrink-0 font-medium text-ink">{video.caption}</span> : null}
        <span className="min-w-0 flex-1 truncate text-faint">{video.name}</span>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Open ${name} in the viewer`}
          onClick={() => {
            ref.current?.pause()
            openEvidence(video, [])
          }}
        >
          <PanelRightOpenIcon aria-hidden className="size-3.5" />
          Open in viewer
        </Button>
      </figcaption>
    </figure>
  )
}

/**
 * The packet's screenshots, one per row at the evidence column's full width, so they read without
 * opening; a small or tall one sits at its own size (never blown up, at most 70% of the window tall)
 * in a frame as wide. A click opens one in the image modal, with the others a ← or → away.
 */
function Screenshots({ images, packet }: { images: ReadonlyArray<Attachment>; packet: ReadonlyArray<Attachment> }) {
  return (
    <ul aria-label="Screenshots" className="flex flex-col gap-3">
      {images.map((image) => (
        <li key={image.id}>
          <figure className="flex flex-col gap-1.5">
            <button
              type="button"
              aria-label={`Open ${image.caption || image.name}`}
              onClick={(e) => openEvidence(image, packet, e.currentTarget)}
              className="flex w-full cursor-zoom-in justify-center overflow-hidden rounded-lg border border-line bg-sunken outline-none hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring"
            >
              <img data-evidence="screenshot" src={attachmentUrl(image)} alt="" loading="lazy" className="block h-auto max-h-[70vh] w-auto max-w-full" />
            </button>
            {image.caption ? <figcaption className="truncate text-xs text-muted">{image.caption}</figcaption> : null}
          </figure>
        </li>
      ))}
    </ul>
  )
}
