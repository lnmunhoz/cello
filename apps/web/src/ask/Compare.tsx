import { attachmentUrl } from "@cello/client/sync/reviews"
import type { Ask, AskOption, AskQuestion, Attachment } from "@cello/contract/entities"
import { Columns3Icon, Rows3Icon, XIcon } from "lucide-react"
import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from "react"
import { Button } from "../components/ui/Button.tsx"
import { Dialog, DialogContent, DialogTitle } from "../components/ui/Dialog.tsx"
import { SegmentedControl, SegmentedControlItem } from "../components/ui/SegmentedControl.tsx"
import { useStored, writeStored } from "../lib/storage.ts"
import { openEvidence } from "../review/Evidence.tsx"
import { COMPARE_LAYOUT_KEY, columnsFor, readCompareLayout } from "./compare.ts"
import type { DraftAnswer } from "./draft.ts"
import { choicesOf, KIND_HINTS, NONE, NoneChoice, OptionText, PickMark } from "./parts.tsx"

interface CompareProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** Gets the focus back on close: the expand button. */
  readonly opener: () => HTMLElement | null
  readonly number: number
  readonly question: AskQuestion
  readonly ask: Ask
  readonly answer: DraftAnswer
  readonly onPick: (optionId: string) => void
  readonly onNone: () => void
  /** The question's comment box, the same one as inline. */
  readonly comment: ReactNode
}

/**
 * A question full screen, to compare its options (CEL-47; Lucas, Nov 15: "I have to open one by one and
 * I can't really see the difference"). Columns put the options side by side, each image large on top
 * of its words; rows stack them, each image full width. The choice is kept on this device; narrower
 * than md, columns fall back to rows and the toggle goes. He picks here as inline (the same draft;
 * 1-9, the arrows), comments, and opens an image in the image modal for a closer look. Esc or Close
 * goes back to the question.
 */
export function CompareQuestion({ open, onOpenChange, opener, number, question, ask, answer, onPick, onNone, comment }: CompareProps) {
  const layout = readCompareLayout(useStored(COMPARE_LAYOUT_KEY))
  const groupRef = useRef<HTMLDivElement>(null)
  const { tabbable, onDigit, onChoiceKeyDown } = choicesOf(question, answer, () => groupRef.current, onPick)
  const promptId = `compare-${ask.id}-${question.id}`
  const grid =
    layout === "columns"
      ? "grid grid-cols-1 items-start gap-4 md:grid-cols-(--compare-columns)"
      : "mx-auto grid w-full max-w-6xl grid-cols-1 gap-5"
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="page"
        data-compare=""
        data-layout={layout}
        initialFocus={() => groupRef.current?.querySelector<HTMLElement>('[tabindex="0"]') ?? null}
        finalFocus={opener}
        onKeyDown={(e: KeyboardEvent) => onDigit(e)}
      >
        <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2.5">
          <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-sunken text-xs font-semibold tabular-nums text-muted">
            {number}
          </span>
          <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
            <DialogTitle id={promptId}>{question.prompt}</DialogTitle>
            <span className="shrink-0 text-xs text-faint">{KIND_HINTS[question.kind]}</span>
          </div>
          <div className="hidden md:block">
            <SegmentedControl
              aria-label="Layout"
              value={layout}
              onValueChange={(value) => {
                if (value) writeStored(COMPARE_LAYOUT_KEY, readCompareLayout(value))
              }}
            >
              <SegmentedControlItem value="columns">
                <Columns3Icon aria-hidden className="size-3.5" />
                Columns
              </SegmentedControlItem>
              <SegmentedControlItem value="rows">
                <Rows3Icon aria-hidden className="size-3.5" />
                Rows
              </SegmentedControlItem>
            </SegmentedControl>
          </div>
          <Button variant="ghost" size="iconMd" aria-label="Close" title="Close (Esc)" onClick={() => onOpenChange(false)}>
            <XIcon aria-hidden className="size-4" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-5 p-4 md:p-6">
            <div
              ref={groupRef}
              role="group"
              aria-labelledby={promptId}
              style={{ "--compare-columns": `repeat(${columnsFor(question.options.length)}, minmax(0, 1fr))` } as CSSProperties}
              className={grid}
            >
              {question.options.map((option, i) => (
                <CompareOption
                  key={option.id}
                  index={i}
                  option={option}
                  attachments={ask.attachments}
                  wordsFirst={layout === "rows"}
                  picked={answer.optionIds.includes(option.id)}
                  tabbable={option.id === tabbable}
                  onPick={() => onPick(option.id)}
                  onKeyDown={(e) => onChoiceKeyDown(e, i)}
                />
              ))}
            </div>
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
              <NoneChoice picked={answer.none} tabbable={tabbable === NONE} onPick={onNone} onKeyDown={(e) => onChoiceKeyDown(e, question.options.length)} />
              {comment}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface CompareOptionProps {
  readonly index: number
  readonly option: AskOption
  readonly attachments: ReadonlyArray<Attachment>
  /** Rows: the words above the image, so a tall image still says which option it is. */
  readonly wordsFirst: boolean
  readonly picked: boolean
  readonly tabbable: boolean
  readonly onPick: () => void
  readonly onKeyDown: (e: KeyboardEvent) => void
}

/** One option: its image large (a click opens it in the image modal), and its checkbox and words. */
function CompareOption({ index, option, attachments, wordsFirst, picked, tabbable, onPick, onKeyDown }: CompareOptionProps) {
  const image = option.imageId ? attachments.find((a) => a.id === option.imageId) : undefined
  const picture = image ? (
    <button
      type="button"
      tabIndex={-1}
      aria-label={`Open the image for ${option.label}`}
      onClick={(e) => openEvidence(image, attachments, e.currentTarget)}
      className="flex cursor-zoom-in justify-center bg-sunken outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <img src={attachmentUrl(image)} alt="" className="block h-auto max-h-[80vh] w-full object-contain" />
    </button>
  ) : null
  const words = (
    <button
      type="button"
      data-option={option.id}
      role="checkbox"
      aria-checked={picked}
      tabIndex={tabbable ? 0 : -1}
      onClick={onPick}
      onKeyDown={onKeyDown}
      className="flex items-start gap-2.5 px-3.5 py-3 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <span className="mt-0.5">
        <PickMark picked={picked} />
      </span>
      <OptionText option={option} />
      <kbd aria-hidden className="mt-0.5 shrink-0 rounded border border-line px-1 text-[10px] text-faint tabular-nums">
        {index + 1}
      </kbd>
    </button>
  )
  return (
    <div
      data-compare-option={option.id}
      data-picked={picked ? "" : undefined}
      className="flex min-w-0 flex-col divide-y divide-line overflow-hidden rounded-lg border border-line bg-raised shadow-card transition-colors data-picked:border-accent data-picked:ring-1 data-picked:ring-accent"
    >
      {wordsFirst ? words : picture}
      {wordsFirst ? picture : words}
    </div>
  )
}
