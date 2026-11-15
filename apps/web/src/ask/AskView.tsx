import { attachmentUrl } from "@cello/client/sync/reviews"
import type { Ask, AskOption, AskQuestion, Attachment, Task } from "@cello/contract/entities"
import { useAtomSet } from "@effect/atom-react"
import { CheckIcon, ImagePlusIcon, SendIcon, SparklesIcon, XIcon } from "lucide-react"
import { useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react"
import { Button } from "../components/ui/Button.tsx"
import { Textarea } from "../components/ui/Input.tsx"
import { Markdown } from "../components/ui/Markdown.tsx"
import { toast } from "../components/ui/Toast.tsx"
import { commands } from "../lib/cello.ts"
import { SAVES_ON_BLUR } from "../lib/editing.ts"
import { relativeTime } from "../lib/format.ts"
import { readStored, writeStored } from "../lib/storage.ts"
import { Evidence, openEvidence } from "../review/Evidence.tsx"
import { openImageModal } from "../viewer/imageModal.ts"
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
  screenshotsFrom,
  setComment,
  startDraft,
  type Target,
  toAnswers,
} from "./draft.ts"

/** What the agent expects; Lucas may still pick several options on any question (Nov 15). */
const KIND_HINTS = { one: "Pick one or more", any: "Pick any", text: "Your answer" } as const
/** The "None of these" choice among a question's options. */
const NONE = "none"

/** Uploads a pasted or dropped screenshot to the ask's drafts; the server answers with its attachment. */
const upload = async (askId: string, file: Blob, name: string): Promise<Attachment> => {
  const response = await fetch(`/asks/${encodeURIComponent(askId)}/uploads?name=${encodeURIComponent(name)}`, { method: "POST", body: file })
  const body = (await response.json().catch(() => ({}))) as Attachment & { reason?: string }
  if (!response.ok) throw new Error(body.reason ? `${body.reason.charAt(0).toUpperCase()}${body.reason.slice(1)}.` : "The screenshot didn't upload.")
  return body
}

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
  const [uploading, setUploading] = useState(0)
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

  const attach = async (target: Target, files: ReadonlyArray<File>) => {
    const { accepted, refused } = screenshotsFrom(files)
    for (const reason of refused) toast.error(`${reason}.`)
    setUploading((n) => n + accepted.length)
    await Promise.all(accepted.map(async ({ index, name }) => {
      try {
        const attachment = await upload(ask.id, files[index]!, name)
        update((d) => addScreenshot(d, target, attachment))
      } catch (error) {
        toast.error((error as Error).message)
      } finally {
        setUploading((n) => n - 1)
      }
    }))
  }

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
          <CommentBox
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
  const promptId = `ask-${ask.id}-${question.id}`
  // The options and "None of these", in order: one of them in the Tab order (the first picked, else the
  // first); the arrows move between them.
  const choices = question.options.length > 0 ? [...question.options.map((o) => o.id), NONE] : []
  const tabbable = choices.find((id) => (id === NONE ? answer.none : answer.optionIds.includes(id))) ?? choices[0]
  const focusChoice = (index: number) => optionsRef.current?.querySelectorAll<HTMLElement>("[data-option]")[index]?.focus()

  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>) => {
    const target = e.target as HTMLElement
    if (e.metaKey || e.ctrlKey || e.altKey || target.tagName === "TEXTAREA") return
    const digit = Number(e.key)
    if (Number.isInteger(digit) && digit >= 1 && digit <= question.options.length) {
      e.preventDefault()
      onPick(question.options[digit - 1]!.id)
      focusChoice(digit - 1)
    }
  }
  const onChoiceKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0
    if (step === 0) return
    e.preventDefault()
    focusChoice((index + step + choices.length) % choices.length)
  }
  const needsWhy = answer.none && answer.comment.trim() === ""

  return (
    <li
      data-question={question.id}
      data-unanswered={unanswered ? "" : undefined}
      onKeyDown={onKeyDown}
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
          <button
            type="button"
            data-option={NONE}
            role="checkbox"
            aria-checked={answer.none}
            tabIndex={tabbable === NONE ? 0 : -1}
            onClick={onNone}
            onKeyDown={(e) => onChoiceKeyDown(e, question.options.length)}
            data-picked={answer.none ? "" : undefined}
            className="flex items-center gap-2.5 rounded-md border border-dashed border-line px-3 py-2 text-left text-[13px] text-muted outline-none hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring data-picked:border-accent data-picked:text-ink"
          >
            <span
              aria-hidden
              className={`flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${answer.none ? "border-accent bg-accent text-accent-ink" : "border-line-strong bg-surface"}`}
            >
              {answer.none ? <CheckIcon className="size-3" strokeWidth={3} /> : null}
            </span>
            None of these
            <span className="text-xs text-faint">· say what instead below</span>
          </button>
        </div>
      ) : null}
      <CommentBox
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
  readonly onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void
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
        <span
          aria-hidden
          className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${picked ? "border-accent bg-accent text-accent-ink" : "border-line-strong bg-surface"}`}
        >
          {picked ? <CheckIcon className="size-3" strokeWidth={3} /> : null}
        </span>
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
function CommentBox({ label, placeholder, value, screenshots, onChange, onAttach, onRemove }: CommentBoxProps) {
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
  const shots = (list: ReadonlyArray<Attachment>) =>
    list.length === 0 ? null : (
      <ul className="flex flex-wrap gap-2">
        {list.map((shot, i) => (
          <li key={shot.id}>
            <button
              type="button"
              aria-label={`Open ${shot.name}`}
              onClick={(e) => openImageModal(list.map((s) => ({ url: attachmentUrl(s), title: s.name })), i, e.currentTarget)}
              className="block h-14 w-20 cursor-zoom-in overflow-hidden rounded border border-line bg-sunken outline-none hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring"
            >
              <img src={attachmentUrl(shot)} alt="" loading="lazy" className="size-full object-cover object-top" />
            </button>
          </li>
        ))}
      </ul>
    )
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
