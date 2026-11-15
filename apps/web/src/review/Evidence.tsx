import { attachmentUrl, evidenceOpen } from "@cello/client/sync/reviews"
import type { Attachment } from "@cello/contract/entities"
import { formatBytes } from "@cello/shared/bytes"
import { shortUrl } from "@cello/shared/linkify"
import { ExternalLinkIcon, FileTextIcon } from "lucide-react"
import type { MouseEvent } from "react"
import { ButtonLink } from "../components/ui/Button.tsx"
import { openInPanel } from "../lib/desktop.ts"
import { openGallery, zoomable } from "../viewer/gallery.ts"
import { openImageModal } from "../viewer/imageModal.ts"
import { isPlainClick } from "../viewer/viewer.ts"
import { Video } from "./Video.tsx"

/** A piece of evidence that opens in the image modal (any image, attached as a file too) is one of the packet's zoomable things. */
const zoomableEvidence = (attachment: Attachment) => {
  const open = evidenceOpen(attachment, [attachment])
  return open?.in === "modal" ? zoomable(open.images[0]!) : {}
}

/**
 * Opens a piece of evidence from `packet` (see `evidenceOpen`): a screenshot in the image modal, with
 * the packet's other screenshots to step through (`opener` gets the focus back when it closes);
 * anything else beside the board, in the viewer or the desktop app's panel. Clicked in the packet
 * itself (a zoomable `opener`), the modal steps through the summary's diagrams too (`openGallery`).
 */
export const openEvidence = (attachment: Attachment, packet: ReadonlyArray<Attachment>, opener: HTMLElement | null = null): boolean => {
  const open = evidenceOpen(attachment, packet)
  if (open?.in === "modal") {
    if (opener?.dataset.zoomable) openGallery(opener)
    else openImageModal(open.images, open.index, opener)
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
            <ButtonLink
              key={f.id}
              href={attachmentUrl(f)}
              onClick={openOnPlainClick(f, attachments)}
              variant="secondary"
              size="md"
              aria-label={`Open ${f.name}`}
              {...zoomableEvidence(f)}
            >
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
              {...zoomableEvidence(image)}
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
