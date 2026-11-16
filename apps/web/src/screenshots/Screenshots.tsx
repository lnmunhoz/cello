// The box Lucas writes in when he can show what he means: a comment on a task (CEL-73) or an answer to
// an ask (CEL-47). It takes pasted (⌘V) and dropped screenshots and shows them as thumbnails under it,
// each opening in the image modal and with an × to take it out before sending. The thumbnails alone
// show a sent comment's or answer's screenshots.
import { attachmentUrl } from "@cello/client/sync/reviews"
import type { Attachment } from "@cello/contract/entities"
import { ImagePlusIcon, XIcon } from "lucide-react"
import { useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react"
import { Button } from "../components/ui/Button.tsx"
import { Textarea } from "../components/ui/Input.tsx"
import { SAVES_ON_BLUR } from "../lib/editing.ts"
import { openImageModal } from "../viewer/imageModal.ts"

interface ThumbsProps {
  readonly shots: ReadonlyArray<Attachment>
  /** `md` in a box being written, `sm` in a sent comment or answer. */
  readonly size: "sm" | "md"
  /** Names the list for screen readers. */
  readonly label: string
  /** Shows an × on each, to take it out before sending. */
  readonly onRemove?: ((attachmentId: string) => void) | undefined
}

const THUMB = { sm: "h-14 w-20", md: "h-16 w-24" } as const

/** Screenshots as thumbnails that open full size, in order, in the image modal. */
export function ScreenshotThumbs({ shots, size, label, onRemove }: ThumbsProps) {
  if (shots.length === 0) return null
  return (
    <ul aria-label={label} className="flex flex-wrap gap-2">
      {shots.map((shot, i) => (
        <li key={shot.id} className="relative">
          <button
            type="button"
            aria-label={`Open ${shot.name}`}
            onClick={(e) => openImageModal(shots.map((s) => ({ url: attachmentUrl(s), title: s.name })), i, e.currentTarget)}
            className={`block ${THUMB[size]} cursor-zoom-in overflow-hidden rounded border border-line bg-sunken outline-none hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring`}
          >
            <img
              data-screenshot=""
              data-pasted-screenshot={onRemove ? "" : undefined}
              src={attachmentUrl(shot)}
              alt=""
              loading="lazy"
              className="size-full object-cover object-top"
            />
          </button>
          {onRemove ? (
            <span className="absolute -top-1.5 -right-1.5">
              <Button variant="secondary" size="icon" aria-label={`Remove ${shot.name}`} onClick={() => onRemove(shot.id)}>
                <XIcon aria-hidden className="size-3" />
              </Button>
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

interface BoxProps {
  readonly label: string
  readonly placeholder: string
  readonly value: string
  readonly screenshots: ReadonlyArray<Attachment>
  readonly onChange: (text: string) => void
  readonly onAttach: (files: ReadonlyArray<File>) => void
  readonly onRemove: (attachmentId: string) => void
  readonly onKeyDown?: ((e: KeyboardEvent<HTMLTextAreaElement>) => void) | undefined
}

const filesIn = (list: DataTransferItemList | null | undefined): File[] =>
  [...(list ?? [])].flatMap((item) => {
    if (item.kind !== "file") return []
    const file = item.getAsFile()
    return file ? [file] : []
  })

/**
 * A text box that takes pasted and dropped screenshots, shown as thumbnails under it. Its text and
 * screenshots are kept on this device until sent, so a reload loses nothing (the draft check counts it saved).
 */
export function ScreenshotBox({ label, placeholder, value, screenshots, onChange, onAttach, onRemove, onKeyDown }: BoxProps) {
  const [dropping, setDropping] = useState(false)
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = filesIn(e.clipboardData?.items)
    if (files.length === 0) return
    e.preventDefault()
    onAttach(files)
  }
  const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes("Files")
  return (
    <div
      data-comment-box=""
      data-dropping={dropping ? "" : undefined}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = "copy"
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setDropping(false)
        onAttach([...e.dataTransfer.files])
      }}
      className="flex flex-col gap-2 rounded-md data-dropping:ring-2 data-dropping:ring-accent"
    >
      <Textarea
        variant="comment"
        aria-label={label}
        {...SAVES_ON_BLUR}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
      />
      {screenshots.length > 0 ? (
        <ScreenshotThumbs shots={screenshots} size="md" label="Pasted screenshots" onRemove={onRemove} />
      ) : (
        <span className="flex items-center gap-1.5 text-[11px] text-faint">
          <ImagePlusIcon aria-hidden className="size-3" />
          Paste or drop screenshots here
        </span>
      )}
    </div>
  )
}
