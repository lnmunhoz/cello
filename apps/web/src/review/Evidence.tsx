import { attachmentUrl, posterUrl } from "@cello/client/sync/reviews"
import type { Attachment } from "@cello/contract/entities"
import { ExternalLinkIcon, FileTextIcon } from "lucide-react"
import { useState } from "react"
import { ButtonLink } from "../components/ui/Button.tsx"
import { Dialog, DialogClose, DialogContent, DialogTitle } from "../components/ui/Dialog.tsx"
import { formatBytes } from "../lib/format.ts"

/** A packet's evidence: videos to play, screenshots that open large, text files and links to open. */
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
            <ButtonLink key={f.id} href={attachmentUrl(f)} variant="secondary" size="md" aria-label={`Open ${f.name}`}>
              <FileTextIcon aria-hidden className="size-3.5 text-muted" />
              {f.caption || f.name}
              {f.bytes !== null ? <span className="font-normal text-faint">{formatBytes(f.bytes)}</span> : null}
            </ButtonLink>
          ))}
          {links.map((l) => (
            <ButtonLink key={l.id} href={l.url ?? "#"} variant="secondary" size="md">
              <ExternalLinkIcon aria-hidden className="size-3.5 text-muted" />
              {l.caption || shortUrl(l.url ?? l.name)}
            </ButtonLink>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** "github.com/lnmunhoz/cello/pull/12" */
const shortUrl = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "")

/** Inline, with its poster, muted until you press play. */
function Video({ video }: { video: Attachment }) {
  return (
    <figure className="flex flex-col gap-1.5">
      <video
        data-evidence="video"
        aria-label={video.caption || video.name}
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
      <figcaption className="flex items-baseline gap-2 text-xs text-muted">
        {video.caption ? <span className="font-medium text-ink">{video.caption}</span> : null}
        <span className="text-faint">{video.name}</span>
      </figcaption>
    </figure>
  )
}

/** A grid of thumbnails; one opens at full size. */
function Screenshots({ images }: { images: ReadonlyArray<Attachment> }) {
  const [open, setOpen] = useState<Attachment | null>(null)
  return (
    <>
      <ul aria-label="Screenshots" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {images.map((image) => (
          <li key={image.id} className="flex flex-col gap-1">
            <button
              type="button"
              aria-label={`Open ${image.caption || image.name}`}
              onClick={() => setOpen(image)}
              className="aspect-[16/10] overflow-hidden rounded-md border border-line bg-sunken outline-none hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring"
            >
              <img data-evidence="screenshot" src={attachmentUrl(image)} alt="" loading="lazy" className="size-full object-cover object-top" />
            </button>
            {image.caption ? <span className="truncate text-xs text-muted">{image.caption}</span> : null}
          </li>
        ))}
      </ul>
      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent size="lg">
          {open ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <DialogTitle>{open.caption || open.name}</DialogTitle>
                <DialogClose>Close</DialogClose>
              </div>
              <img src={attachmentUrl(open)} alt={open.caption || open.name} className="max-h-[72vh] w-full rounded-md border border-line object-contain" />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
