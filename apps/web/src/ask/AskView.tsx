import { attachmentUrl } from "@cello/client/sync/reviews"
import type { Ask, AskOption, AskQuestion, Attachment, Task } from "@cello/contract/entities"
import { useAtomSet } from "@effect/atom-react"
import { CheckIcon, Maximize2Icon, SendIcon } from "lucide-react"
import { useRef, useState, type KeyboardEvent } from "react"
import { Button } from "../components/ui/Button.tsx"
import { Markdown } from "../components/ui/Markdown.tsx"
import { commands } from "../lib/cello.ts"
import { relativeTime } from "../lib/format.ts"
import { readStored, writeStored } from "../lib/storage.ts"
import { Evidence, openEvidence } from "../review/Evidence.tsx"
import { ScreenshotBox, ScreenshotThumbs } from "../screenshots/Screenshots.tsx"
import { uploadUrl } from "../screenshots/screenshots.ts"
import { useScreenshotUpload } from "../screenshots/useScreenshotUpload.ts"
import { openImageModal } from "../viewer/imageModal.ts"
import { CompareQuestion } from "./Compare.tsx"
import {
  addScreenshot,
  answerOf,
  type AskDraft,
  draftKey,
  missing,
  pick,
  pickNone,
  readDraft,
  removeScreenshot,
  setComment,
  startDraft,
  type Target,
  toAnswers,
} from "./draft.ts"
import { choicesOf, KIND_HINTS, NONE, NoneChoice, OptionText, PickMark } from "./parts.tsx"

/** The draft for an ask, kept in this device's storage on every change. */
const useDraft = (ask: Ask) => {
  const askId = ask.id
  const [draft, setDraft] = useState<AskDraft>(() => readDraft(readStored(draftKey(askId))) ?? startDraft(ask.questions))
  const update = (change: (d: AskDraft) => AskDraft) =>
    setDraft((current) => {
      const next = change(current)
      writeStored(draftKey(askId), JSON.stringify(next))
      return next
    })
  return [draft, update] as const
}

/**
 * An open ask, answered here (CEL-47). The two-column packet layout (CEL-38): the intro, one card per
 * question and the overall note on the left; the evidence on the right, sticky while the left
 * scrolls; one column when narrow. Options are checkboxes (1-9 toggles one in the focused question):
 * the recommended ones come picked, tagged with the agent's reason, and Lucas can pick several, or
 * "None of these" with a comment (Nov 15). Each comment box and the note take pasted (⌘V) or dropped
 * screenshots. Send answers (⌘Enter) waits until every question has a pick, None of these with a
 * comment, or words; the draft stays on this device until then.
 */
export function AskForm({ task, ask, onAnswered }: { task: Task; ask: Ask; onAnswered?: (() => void) | undefined }) {
  const answer = useAtomSet(commands.answerAsk, { mode: "promiseExit" })
  const [draft, update] = useDraft(ask)
  const [busy, setBusy] = useState(false)
  const { uploading, attach: upload } = useScreenshotUpload(uploadUrl({ askId: ask.id }))
  const left = missing(ask.questions, draft)
  const ready = left.length === 0 && uploading === 0 && !busy

  const send = async () => {
    if (!ready) return
    setBusy(true)
    const exit = await answer({ askId: ask.id, key: task.key, ...toAnswers(ask.questions, draft) })
    setBusy(false)
    if (exit._tag === "Success") {
      writeStored(draftKey(ask.id), "")
      onAnswered?.()
    }
  }

  const attach = (target: Target, files: ReadonlyArray<File>) => upload(files, (attachment) => update((d) => addScreenshot(d, target, attachment)))

  return (
    <div
      data-ask={ask.id}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.defaultPrevented) {
          e.preventDefault()
          void send()
        }
      }}
      className="flex flex-col gap-5 packet-wide:grid packet-wide:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] packet-wide:grid-rows-[auto_1fr] packet-wide:gap-x-8"
    >
      <div className="flex min-w-0 flex-col gap-4 packet-wide:col-start-1 packet-wide:row-start-1">
        <h4 className="text-[15px] font-semibold text-ink">{ask.title}</h4>
        {ask.intro ? <Markdown source={ask.intro} gallery={false} /> : null}
        <ol aria-label="Questions" className="flex flex-col gap-3">
          {ask.questions.map((question, i) => (
            <QuestionCard
              key={question.id}
              number={i + 1}
              question={question}
              ask={ask}
              draft={draft}
              unanswered={left.includes(question.id)}
              onPick={(optionId) => update((d) => pick(d, question.id, optionId))}
              onNone={() => update((d) => pickNone(d, question.id))}
              onComment={(text) => update((d) => setComment(d, question.id, text))}
              onAttach={(files) => void attach({ questionId: question.id }, files)}
              onRemove={(id) => update((d) => removeScreenshot(d, { questionId: question.id }, id))}
            />
          ))}
        </ol>
        <section aria-label="Note" className="flex flex-col gap-1.5">
          <h5 className="text-xs font-medium text-muted">Anything else? <span className="font-normal text-faint">(optional)</span></h5>
          <ScreenshotBox
            label="Note"
            placeholder="A note for the agent. Paste or drop screenshots to show what you mean."
            value={draft.note}
            screenshots={draft.noteAttachments}
            onChange={(note) => update((d) => ({ ...d, note }))}
            onAttach={(files) => void attach("note", files)}
            onRemove={(id) => update((d) => removeScreenshot(d, "note", id))}
          />
        </section>
      </div>
      {ask.attachments.length > 0 ? (
        <section
          aria-label="Evidence"
          className="flex flex-col gap-2 packet-wide:sticky packet-wide:top-0 packet-wide:col-start-2 packet-wide:row-span-2 packet-wide:row-start-1 packet-wide:-m-1 packet-wide:max-h-[calc(100dvh-7.5rem)] packet-wide:self-start packet-wide:overflow-y-auto packet-wide:p-1"
        >
          <h4 className="text-xs font-medium text-muted">Evidence</h4>
          <Evidence attachments={ask.attachments} />
        </section>
      ) : null}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 packet-wide:col-start-1 packet-wide:row-start-2 packet-wide:self-start">
        <span className="text-xs text-muted">
          Asked by <span className="font-medium text-ink">{ask.author.name}</span>
          {ask.author.session ? <span className="tabular-nums"> · session {ask.author.session.slice(0, 8)}</span> : null}
          {" · "}
          {relativeTime(ask.createdAt)}
        </span>
        <span className="flex items-center gap-3">
          <span data-ask-progress className="text-xs text-muted tabular-nums">
            {uploading > 0 ? "Uploading…" : left.length === 0 ? "All answered" : `${ask.questions.length - left.length} of ${ask.questions.length} answered`}
          </span>
          <Button variant="primary" size="md" disabled={!ready} onClick={() => void send()} aria-keyshortcuts="Meta+Enter">
            <SendIcon aria-hidden className="size-3.5" />
            Send answers
          </Button>
        </span>
      </footer>
    </div>
  )
}

interface QuestionCardProps {
  readonly number: number
  readonly question: AskQuestion
  readonly ask: Ask
  readonly draft: AskDraft
  readonly unanswered: boolean
  readonly onPick: (optionId: string) => void
  readonly onNone: () => void
  readonly onComment: (text: string) => void
  readonly onAttach: (files: ReadonlyArray<File>) => void
  readonly onRemove: (attachmentId: string) => void
}

function QuestionCard({ number, question, ask, draft, unanswered, onPick, onNone, onComment, onAttach, onRemove }: QuestionCardProps) {
  const answer = answerOf(draft, question.id)
  const optionsRef = useRef<HTMLDivElement>(null)
  const expandRef = useRef<HTMLButtonElement>(null)
  const [comparing, setComparing] = useState(false)
  const promptId = `ask-${ask.id}-${question.id}`
  const { tabbable, onDigit, onChoiceKeyDown } = choicesOf(question, answer, () => optionsRef.current, onPick)
  const needsWhy = answer.none && answer.comment.trim() === ""
  // The comment box, inline and in the compare view: one draft, typed in either.
  const comment = (
    <>
      <ScreenshotBox
        label={`Comment on question ${number}`}
        placeholder={
          question.options.length === 0
            ? "Your answer. Paste or drop screenshots to show what you mean."
            : answer.none
            ? "None of these fits: say what you want instead (needed)."
            : "Why, or what you'd change (optional). Paste or drop screenshots."
        }
        value={answer.comment}
        screenshots={answer.attachments}
        onChange={onComment}
        onAttach={onAttach}
        onRemove={onRemove}
      />
      {needsWhy ? <p className="-mt-1 text-xs text-danger">“None of these” needs a comment that says what instead.</p> : null}
    </>
  )

  return (
    <li
      data-question={question.id}
      data-unanswered={unanswered ? "" : undefined}
      onKeyDown={(e: KeyboardEvent) => {
        // The compare view renders inside this card (dialogs render in place) and takes its own keys.
        if (!(e.target as HTMLElement).closest("[data-compare]")) onDigit(e)
      }}
      className="flex flex-col gap-3 rounded-lg border border-line bg-raised p-4 shadow-card"
    >
      <div className="flex items-baseline gap-2.5">
        <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-full bg-sunken text-[11px] font-semibold tabular-nums text-muted">
          {number}
        </span>
        <h5 id={promptId} className="min-w-0 flex-1 text-[13px] leading-snug font-semibold text-ink [overflow-wrap:anywhere]">
          {question.prompt}
        </h5>
        <span className="shrink-0 text-xs text-faint">{KIND_HINTS[question.kind]}</span>
        {question.options.length > 0 ? (
          <span className="-my-1 self-center">
            <Button
              ref={expandRef}
              variant="ghost"
              size="icon"
              aria-label={`Compare question ${number}'s options full screen`}
              title="Compare the options full screen"
              onClick={() => setComparing(true)}
            >
              <Maximize2Icon aria-hidden className="size-3.5" />
            </Button>
          </span>
        ) : null}
      </div>
      {question.options.length > 0 ? (
        <div ref={optionsRef} role="group" aria-labelledby={promptId} className="flex flex-col gap-1.5">
          {question.options.map((option, i) => (
            <OptionButton
              key={option.id}
              index={i}
              option={option}
              ask={ask}
              picked={answer.optionIds.includes(option.id)}
              tabbable={option.id === tabbable}
              onPick={() => onPick(option.id)}
              onKeyDown={(e) => onChoiceKeyDown(e, i)}
            />
          ))}
          <NoneChoice picked={answer.none} tabbable={tabbable === NONE} onPick={onNone} onKeyDown={(e) => onChoiceKeyDown(e, question.options.length)} />
        </div>
      ) : null}
      {comment}
      {question.options.length > 0 ? (
        <CompareQuestion
          open={comparing}
          onOpenChange={setComparing}
          opener={() => expandRef.current}
          number={number}
          question={question}
          ask={ask}
          answer={answer}
          onPick={onPick}
          onNone={onNone}
          comment={comment}
        />
      ) : null}
    </li>
  )
}

interface OptionButtonProps {
  readonly index: number
  readonly option: AskOption
  readonly ask: Ask
  readonly picked: boolean
  readonly tabbable: boolean
  readonly onPick: () => void
  readonly onKeyDown: (e: KeyboardEvent) => void
}

function OptionButton({ index, option, ask, picked, tabbable, onPick, onKeyDown }: OptionButtonProps) {
  const image = option.imageId ? ask.attachments.find((a) => a.id === option.imageId) : undefined
  return (
    <div
      data-picked={picked ? "" : undefined}
      className="group flex items-stretch gap-2 rounded-md border border-line bg-surface transition-colors hover:border-line-strong data-picked:border-accent data-picked:bg-accent/8"
    >
      <button
        type="button"
        data-option={option.id}
        role="checkbox"
        aria-checked={picked}
        tabIndex={tabbable ? 0 : -1}
        onClick={onPick}
        onKeyDown={onKeyDown}
        className="flex min-w-0 flex-1 items-start gap-2.5 rounded-md px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="mt-0.5">
          <PickMark picked={picked} />
        </span>
        <OptionText option={option} />
        <kbd aria-hidden className="mt-0.5 hidden shrink-0 rounded border border-line px-1 text-[10px] text-faint tabular-nums sm:inline">
          {index + 1}
        </kbd>
      </button>
      {image ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Open the image for ${option.label}`}
          onClick={(e) => openEvidence(image, ask.attachments, e.currentTarget)}
          className="m-1.5 ml-0 h-14 w-22 shrink-0 cursor-zoom-in overflow-hidden rounded border border-line bg-sunken outline-none hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring"
        >
          <img src={attachmentUrl(image)} alt="" loading="lazy" className="size-full object-cover object-top" />
        </button>
      ) : null}
    </div>
  )
}

const CLOSED = {
  answered: "Answered",
  withdrawn: "Withdrawn",
  superseded: "Replaced by newer questions",
  open: "Open",
} as const

/**
 * A closed ask, read-only, in the task's history: the questions with what Lucas picked (the others
 * faded), his comments and screenshots, the note; or, withdrawn or replaced, just the questions.
 */
export function AskRecord({ ask }: { ask: Ask }) {
  const shots = (list: ReadonlyArray<Attachment>) => <ScreenshotThumbs shots={list} size="sm" label="Screenshots" />
  return (
    <div data-ask-record={ask.id} className="flex flex-col gap-3">
      {ask.intro ? <Markdown source={ask.intro} gallery={false} /> : null}
      <ol className="flex flex-col gap-3">
        {ask.questions.map((q, i) => {
          const answer = ask.answers?.questions.find((a) => a.questionId === q.id)
          return (
            <li key={q.id} className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink">
                {i + 1}. {q.prompt}
              </span>
              {q.options.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {q.options.map((o) => {
                    const picked = answer?.optionIds.includes(o.id) ?? false
                    return (
                      <li key={o.id} data-picked={picked ? "" : undefined} className={`flex items-center gap-2 text-xs ${picked ? "font-medium text-ink" : answer ? "text-faint" : "text-muted"}`}>
                        <span aria-hidden className={`flex size-3.5 items-center justify-center border ${q.kind === "one" ? "rounded-full" : "rounded-[3px]"} ${picked ? "border-accent bg-accent text-accent-ink" : "border-line-strong"}`}>
                          {picked ? <CheckIcon className="size-2.5" strokeWidth={3} /> : null}
                        </span>
                        {o.label}
                        {picked ? <span className="sr-only"> (picked)</span> : null}
                        {o.recommended ? <span className="text-[11px] font-normal text-faint">· recommended</span> : null}
                      </li>
                    )
                  })}
                </ul>
              ) : null}
              {answer?.none ? <p data-none-of-these className="text-xs font-medium text-ink">None of these</p> : null}
              {answer?.comment ? <p className="rounded-md bg-sunken px-2.5 py-1.5 text-xs whitespace-pre-wrap text-ink">{answer.comment}</p> : null}
              {shots(answer?.attachments ?? [])}
            </li>
          )
        })}
      </ol>
      {ask.answers?.note ? (
        <p className="rounded-md bg-sunken px-2.5 py-1.5 text-xs whitespace-pre-wrap text-ink">
          <span className="font-medium">Note: </span>
          {ask.answers.note}
        </p>
      ) : null}
      {shots(ask.answers?.noteAttachments ?? [])}
      {ask.attachments.length > 0 ? (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer select-none">Evidence ({ask.attachments.length})</summary>
          <div className="pt-2">
            <Evidence attachments={ask.attachments} />
          </div>
        </details>
      ) : null}
    </div>
  )
}

/** "Answered 2 min ago", "Withdrawn just now". */
export const closedLabel = (ask: Ask): string =>
  `${CLOSED[ask.state]} ${relativeTime(ask.state === "answered" ? ask.answeredAt ?? ask.createdAt : ask.withdrawnAt ?? ask.createdAt)}`
