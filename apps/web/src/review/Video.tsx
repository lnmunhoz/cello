import { attachmentUrl, posterUrl } from "@cello/client/sync/reviews"
import { PanelRightOpenIcon } from "lucide-react"
import { useRef } from "react"
import { Button } from "../components/ui/Button.tsx"
import { openInPanel } from "../lib/desktop.ts"

/** A stored video: a packet's evidence, or a file a page links. */
export interface VideoFile {
  readonly id: string
  /** The file name. */
  readonly name: string
  /** What the packet or the page calls it; empty when it says nothing more than the name. */
  readonly caption: string
  readonly hasPoster: boolean
}

/**
 * Inline, with its poster, muted until you press play; "Open in viewer" plays it large beside the
 * board. The same player in review packets and in pages.
 */
export function Video({ video }: { video: VideoFile }) {
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
            openInPanel(attachmentUrl(video), name, "video")
          }}
        >
          <PanelRightOpenIcon aria-hidden className="size-3.5" />
          Open in viewer
        </Button>
      </figcaption>
    </figure>
  )
}
