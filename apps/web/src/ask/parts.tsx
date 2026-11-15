// Pieces of a question shared by the inline question card and its full-screen compare view (CEL-47):
// the check mark, an option's words, "None of these", the comment box, and the keys between choices.
import { attachmentUrl } from "@cello/client/sync/reviews"
import type { AskOption, AskQuestion, Attachment } from "@cello/contract/entities"
import { CheckIcon, ImagePlusIcon, SparklesIcon, XIcon } from "lucide-react"
import { useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react"
import { Button } from "../components/ui/Button.tsx"
import { Textarea } from "../components/ui/Input.tsx"
import { SAVES_ON_BLUR } from "../lib/editing.ts"
import { openImageModal } from "../viewer/imageModal.ts"
import type { DraftAnswer } from "./draft.ts"

/** What the agent expects; Lucas may still pick several options on any question (Nov 15). */
export const KIND_HINTS = { one: "Pick one or more", any: "Pick any", text: "Your answer" } as const
/** The "None of these" choice among a question's options. */
export const NONE = "none"

/**
 * A question's options and "None of these" as one set of choices, each a `[data-option]` under
 * `root()`: which one is in the Tab order (the first picked, else the first), the arrows between
 * them, and 1-9 to toggle an option and focus it.
 */
export const choicesOf = (question: AskQuestion, answer: DraftAnswer, root: () => HTMLElement | null, onPick: (optionId: string) => void) => {
  const choices = question.options.length > 0 ? [...question.options.map((o) => o.id), NONE] : []
  const focusChoice = (index: number) => root()?.querySelectorAll<HTMLElement>("[data-option]")[index]?.focus()
  return {
    tabbable: choices.find((id) => (id === NONE ? answer.none : answer.optionIds.includes(id))) ?? choices[0],
    /** 1-9, unless typing in a comment or with a modifier. */
    onDigit: (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || target.tagName === "TEXTAREA") return
      const digit = Number(e.key)
      if (!Number.isInteger(digit) || digit < 1 || digit > question.options.length) return
      e.preventDefault()
      onPick(question.options[digit - 1]!.id)
      focusChoice(digit - 1)
    },
    onChoiceKeyDown: (e: KeyboardEvent, index: number) => {
      const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0
      if (step === 0) return
      e.preventDefault()
      focusChoice((index + step + choices.length) % choices.length)
    },
  }
}

/** The checkbox's box, ticked when picked. */
export function PickMark({ picked }: { picked: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${picked ? "border-accent bg-accent text-accent-ink" : "border-line-strong bg-surface"}`}
    >
      {picked ? <CheckIcon className="size-3" strokeWidth={3} /> : null}
    </span>
  )
}

/** An option's label, the Recommended tag, its description and, when recommended, the agent's reason. */
export function OptionText({ option }: { option: AskOption }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="text-[13px] font-medium text-ink [overflow-wrap:anywhere]">{option.label}</span>
        {option.recommended ? (
          <span data-recommended className="inline-flex items-center gap-1 rounded-full bg-accent/12 px-1.5 py-px text-[11px] font-medium text-accent">
            <SparklesIcon aria-hidden className="size-3" />
            Recommended
          </span>
        ) : null}
      </span>
      {option.description ? <span className="text-xs text-muted [overflow-wrap:anywhere]">{option.description}</span> : null}
      {option.recommended && option.because ? <span className="text-xs text-muted italic [overflow-wrap:anywhere]">{option.because}</span> : null}
    </span>
  )
}

/** "None of these", the last of a question's choices: it needs a comment that says what instead. */
export function NoneChoice({ picked, tabbable, onPick, onKeyDown }: { picked: boolean; tabbable: boolean; onPick: () => void; onKeyDown: (e: KeyboardEvent) => void }) {
  return (
    <button
      type="button"
      data-option={NONE}
      role="checkbox"
      aria-checked={picked}
      tabIndex={tabbable ? 0 : -1}
      onClick={onPick}
      onKeyDown={onKeyDown}
      data-picked={picked ? "" : undefined}
      className="flex items-center gap-2.5 rounded-md border border-dashed border-line px-3 py-2 text-left text-[13px] text-muted outline-none hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring data-picked:border-accent data-picked:text-ink"
    >
      <PickMark picked={picked} />
      None of these
      <span className="text-xs text-faint">· say what instead below</span>
    </button>
  )
}

interface CommentBoxProps {
  readonly label: string
  readonly placeholder: string
  readonly value: string
  readonly screenshots: ReadonlyArray<Attachment>
  readonly onChange: (text: string) => void
  readonly onAttach: (files: ReadonlyArray<File>) => void
  readonly onRemove: (attachmentId: string) => void
}

const imagesIn = (list: DataTransferItemList | null | undefined): File[] =>
  [...(list ?? [])].flatMap((item) => {
    if (item.kind !== "file") return []
    const file = item.getAsFile()
    return file ? [file] : []
  })

/** A comment box that takes pasted (⌘V) and dropped screenshots, shown as thumbnails under it. */
export function CommentBox({ label, placeholder, value, screenshots, onChange, onAttach, onRemove }: CommentBoxProps) {
  const [dropping, setDropping] = useState(false)
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = imagesIn(e.clipboardData?.items)
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
      />
      {screenshots.length > 0 ? (
        <ul aria-label="Pasted screenshots" className="flex flex-wrap gap-2">
          {screenshots.map((shot, i) => (
            <li key={shot.id} className="relative">
              <button
                type="button"
                aria-label={`Open ${shot.name}`}
                onClick={(e) => openImageModal(screenshots.map((s) => ({ url: attachmentUrl(s), title: s.name })), i, e.currentTarget)}
                className="block h-16 w-24 cursor-zoom-in overflow-hidden rounded border border-line bg-sunken outline-none hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring"
              >
                <img data-pasted-screenshot src={attachmentUrl(shot)} alt="" className="size-full object-cover object-top" />
              </button>
              <span className="absolute -top-1.5 -right-1.5">
                <Button variant="secondary" size="icon" aria-label={`Remove ${shot.name}`} onClick={() => onRemove(shot.id)}>
                  <XIcon aria-hidden className="size-3" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="flex items-center gap-1.5 text-[11px] text-faint">
          <ImagePlusIcon aria-hidden className="size-3" />
          Paste or drop screenshots here
        </span>
      )}
    </div>
  )
}
