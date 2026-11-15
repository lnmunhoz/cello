import { attachmentUrl, evidenceTarget, posterUrl } from "@cello/client/sync/reviews"
import type { Attachment } from "@cello/contract/entities"
import { formatBytes } from "@cello/shared/bytes"
import { shortUrl } from "@cello/shared/linkify"
import { ExternalLinkIcon, FileTextIcon, PanelRightOpenIcon } from "lucide-react"
import { useRef, type MouseEvent } from "react"
import { Button, ButtonLink } from "../components/ui/Button.tsx"
import { openInPanel } from "../lib/desktop.ts"
import { isPlainClick } from "../viewer/viewer.ts"

/** Opens a piece of evidence beside the board: the viewer, or the desktop app's panel. */
export const openEvidence = (attachment: Attachment): boolean => {
  const target = evidenceTarget(attachment)
  return target !== null && openInPanel(target.url, target.title, target.kind)
}

/** An evidence link: a plain click opens it beside the board; ⌘-click still opens a new tab. */
const openOnPlainClick = (attachment: Attachment) => (e: MouseEvent) => {
  if (isPlainClick(e) && openEvidence(attachment)) e.preventDefault()
}

/** A packet's evidence: videos to play, screenshots, text files and links, each opening in the viewer. */
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
      {images.length > 0 ? <Screenshots images={images} /> : null}
      {files.length + links.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {files.map((f) => (
            <ButtonLink key={f.id} href={attachmentUrl(f)} onClick={openOnPlainClick(f)} variant="secondary" size="md" aria-label={`Open ${f.name}`}>
              <FileTextIcon aria-hidden className="size-3.5 text-muted" />
              {f.caption || f.name}
              {f.bytes !== null ? <span className="font-normal text-faint">{formatBytes(f.bytes)}</span> : null}
            </ButtonLink>
          ))}
          {links.map((l) => (
            <ButtonLink key={l.id} href={l.url ?? "#"} onClick={openOnPlainClick(l)} variant="secondary" size="md">
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
            openEvidence(video)
          }}
        >
          <PanelRightOpenIcon aria-hidden className="size-3.5" />
          Open in viewer
        </Button>
      </figcaption>
    </figure>
  )
}

/** A grid of thumbnails; each opens in the viewer. */
function Screenshots({ images }: { images: ReadonlyArray<Attachment> }) {
  return (
    <ul aria-label="Screenshots" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {images.map((image) => (
        <li key={image.id} className="flex flex-col gap-1">
          <button
            type="button"
            aria-label={`Open ${image.caption || image.name}`}
            onClick={() => openEvidence(image)}
            className="aspect-[16/10] cursor-zoom-in overflow-hidden rounded-md border border-line bg-sunken outline-none hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring"
          >
            <img data-evidence="screenshot" src={attachmentUrl(image)} alt="" loading="lazy" className="size-full object-cover object-top" />
          </button>
          {image.caption ? <span className="truncate text-xs text-muted">{image.caption}</span> : null}
        </li>
      ))}
    </ul>
  )
}
