// `cello task ask` (CEL-47): questions for Lucas from a JSON or YAML file, or from inline flags, and
// how his answers read when they come back (`--wait`, `cello wait`, `cello task answers`, the hook).
// The server checks what the questions mean (a reason for each recommendation, options for a choice);
// this only turns the agent's input into the RPC's shape, with file paths made absolute.
import * as path from "node:path"
import type { Ask, AskQuestion, Attachment } from "@cello/contract/entities"
import type { AskQuestionInput, EvidenceFile, EvidenceLink } from "@cello/contract/rpcs"
import type { AnswersDelivered } from "@cello/contract/views"
import { roundLabel } from "@cello/client/sync/asks"
import { ago } from "./format.ts"

export interface AskSpec {
  readonly title: string | null
  readonly intro: string | null
  readonly questions: AskQuestionInput[]
  readonly files: EvidenceFile[]
  readonly links: EvidenceLink[]
}

type Parsed = AskSpec | { readonly error: string }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const KINDS = ["one", "any", "text"] as const

/**
 * An ask file: `title`, `intro` (markdown), `questions` (each a `prompt`, an optional `kind` and
 * `options` with `label`, `description`, `image`, `recommended`, `because`), `attach` (paths, or
 * `{ path, caption }`) and `links` (URLs, or `{ url, caption }`). Paths are relative to the file.
 */
export const askSpecFromFile = (text: string, file: string): Parsed => {
  let raw: unknown
  try {
    raw = /\.ya?ml$/i.test(file) ? Bun.YAML.parse(text) : JSON.parse(text)
  } catch (e) {
    return { error: `${path.basename(file)} isn't valid ${/\.ya?ml$/i.test(file) ? "YAML" : "JSON"}: ${(e as Error).message}` }
  }
  if (!isRecord(raw)) return { error: `${path.basename(file)} should hold an object with title and questions.` }
  const dir = path.dirname(file)
  const where = (what: string) => `${path.basename(file)}: ${what}`
  const str = (v: unknown) => (typeof v === "string" ? v : null)
  if (raw.title !== undefined && str(raw.title) === null) return { error: where("title should be text.") }
  if (!Array.isArray(raw.questions)) return { error: where("questions should be a list.") }
  const questions: AskQuestionInput[] = []
  for (const [i, q] of raw.questions.entries()) {
    const n = i + 1
    if (!isRecord(q) || str(q.prompt) === null) return { error: where(`question ${n} needs a prompt (text).`) }
    if (q.kind !== undefined && !KINDS.includes(q.kind as never)) return { error: where(`question ${n}'s kind should be one, any or text.`) }
    if (q.options !== undefined && !Array.isArray(q.options)) return { error: where(`question ${n}'s options should be a list.`) }
    const options = []
    for (const [j, o] of ((q.options as unknown[] | undefined) ?? []).entries()) {
      const option = typeof o === "string" ? { label: o } : o
      if (!isRecord(option) || str(option.label) === null) return { error: where(`option ${j + 1} of question ${n} needs a label.`) }
      if (option.image !== undefined && str(option.image) === null) return { error: where(`option "${option.label}"'s image should be a path.`) }
      options.push({
        label: option.label as string,
        ...(str(option.description) !== null ? { description: option.description as string } : {}),
        ...(option.image !== undefined ? { image: path.resolve(dir, option.image as string) } : {}),
        ...(option.recommended === true ? { recommended: true } : {}),
        ...(str(option.because) !== null ? { because: option.because as string } : {}),
      })
    }
    questions.push({
      prompt: q.prompt as string,
      ...(q.kind !== undefined ? { kind: q.kind as (typeof KINDS)[number] } : {}),
      ...(options.length ? { options } : {}),
    })
  }
  const files: EvidenceFile[] = []
  for (const a of (Array.isArray(raw.attach) ? raw.attach : raw.attach === undefined ? [] : [raw.attach]) as unknown[]) {
    const entry = typeof a === "string" ? { path: a } : a
    if (!isRecord(entry) || str(entry.path) === null) return { error: where("each attach entry is a path, or { path, caption }.") }
    files.push({ path: path.resolve(dir, entry.path as string), ...(str(entry.caption) !== null ? { caption: entry.caption as string } : {}) })
  }
  const links: EvidenceLink[] = []
  for (const l of (Array.isArray(raw.links) ? raw.links : raw.links === undefined ? [] : [raw.links]) as unknown[]) {
    const entry = typeof l === "string" ? { url: l } : l
    if (!isRecord(entry) || str(entry.url) === null) return { error: where("each links entry is a URL, or { url, caption }.") }
    links.push({ url: entry.url as string, ...(str(entry.caption) !== null ? { caption: entry.caption as string } : {}) })
  }
  return { title: str(raw.title), intro: str(raw.intro), questions, files, links }
}

/** `ask`'s flags that take a value, read in order (the flag parser forgets the order of repeated flags). */
const VALUE_FLAGS = new Set(["title", "intro", "question", "kind", "option", "recommend", "because", "attach", "caption", "link", "file"])

/**
 * Inline flags, in order: `--question` starts a question; `--kind`, `--option "Label|description"`,
 * `--recommend "Label"` and `--because "why"` apply to the question before them. `--attach`,
 * `--caption` and `--link` work as they do for `submit`.
 */
export const askSpecFromArgs = (args: ReadonlyArray<string>, cwd: string): Parsed => {
  let title: string | null = null
  let intro: string | null = null
  const questions: Array<{ prompt: string; kind?: (typeof KINDS)[number]; options: Array<{ label: string; description?: string; recommended?: boolean; because?: string }> }> = []
  const evidence: Array<{ kind: "file" | "link"; value: string; caption?: string }> = []
  let recommended: { label: string } | null = null
  for (let i = 0; i < args.length; i++) {
    const token = args[i]!
    if (!token.startsWith("--")) continue
    const eq = token.indexOf("=")
    const name = token.slice(2, eq === -1 ? undefined : eq)
    if (!VALUE_FLAGS.has(name)) continue
    const value = eq === -1 ? args[++i] : token.slice(eq + 1)
    if (value === undefined) return { error: `--${name} needs a value.` }
    const question = questions.at(-1)
    const needsQuestion = (flag: string) => ({ error: `--${flag} belongs to a question: put it after --question.` })
    switch (name) {
      case "title":
        title = value
        break
      case "intro":
        intro = value
        break
      case "question":
        questions.push({ prompt: value, options: [] })
        recommended = null
        break
      case "kind":
        if (!question) return needsQuestion(name)
        if (!KINDS.includes(value as never)) return { error: `--kind is one (pick one), any (pick any) or text (no options), not "${value}".` }
        question.kind = value as (typeof KINDS)[number]
        break
      case "option": {
        if (!question) return needsQuestion(name)
        const bar = value.indexOf("|")
        const label = (bar === -1 ? value : value.slice(0, bar)).trim()
        const description = bar === -1 ? "" : value.slice(bar + 1).trim()
        question.options.push({ label, ...(description ? { description } : {}) })
        break
      }
      case "recommend": {
        if (!question) return needsQuestion(name)
        const option = question.options.find((o) => o.label === value.trim())
        if (!option) return { error: `--recommend "${value}" names no --option of "${question.prompt}" before it; use the option's label.` }
        option.recommended = true
        recommended = option
        break
      }
      case "because":
        if (!question) return needsQuestion(name)
        if (!recommended) return { error: "--because says why you recommend an option: put it right after --recommend." }
        ;(recommended as { because?: string }).because = value
        break
      case "attach":
        evidence.push({ kind: "file", value })
        break
      case "link":
        evidence.push({ kind: "link", value })
        break
      case "caption": {
        const last = evidence.at(-1)
        if (!last) return { error: "--caption describes the --attach or --link before it; put it after one." }
        if (last.caption !== undefined) return { error: `${last.value} already has a caption; give each one --caption.` }
        last.caption = value
        break
      }
    }
  }
  const caption = (item: { caption?: string }) => (item.caption === undefined ? {} : { caption: item.caption })
  return {
    title,
    intro,
    questions: questions.map((q) => ({ prompt: q.prompt, ...(q.kind ? { kind: q.kind } : {}), ...(q.options.length ? { options: q.options } : {}) })),
    files: evidence.filter((e) => e.kind === "file").map((e) => ({ path: path.resolve(cwd, e.value), ...caption(e) })),
    links: evidence.filter((e) => e.kind === "link").map((e) => ({ url: e.value, ...caption(e) })),
  }
}

/** Every screenshot Lucas pasted into his answers, with a file name for it: "q1-1.png", "note-1.png". */
/** "Screenshot: <where it was saved>", or the path the server serves it at when it wasn't saved. */
export const screenshotLine = (a: Pick<Attachment, "id">, files: ReadonlyMap<string, string>): string =>
  `Screenshot: ${files.get(a.id) ?? `/attachments/${a.id}`}`

export const answerScreenshots = (ask: Ask): Array<{ readonly attachment: Attachment; readonly fileName: string }> => {
  if (ask.answers === null) return []
  const named = (where: string, list: ReadonlyArray<Attachment>) =>
    list.map((attachment, i) => ({ attachment, fileName: `${where}-${i + 1}${path.extname(attachment.name).toLowerCase() || ".png"}` }))
  return [...ask.answers.questions.flatMap((q) => named(q.questionId, q.attachments)), ...named("note", ask.answers.noteAttachments)]
}

const indented = (text: string, by: string) => text.split("\n").map((l) => (l === "" ? "" : `${by}${l}`))

const pickedLine = (question: AskQuestion, optionIds: ReadonlyArray<string>) => {
  const picked = question.options.filter((o) => optionIds.includes(o.id))
  return picked.map((o) => `${o.label}${o.recommended ? " (your recommendation)" : ""}`).join(", ")
}

/**
 * Lucas's answers, question by question: what he picked, his comment, and where each screenshot he
 * pasted was saved (`files`: attachment id → local path; one not saved shows its URL path instead).
 */
export const answerLines = (ask: Ask, files: ReadonlyMap<string, string>): string[] => {
  if (ask.answers === null) return []
  const shot = (a: Attachment) => screenshotLine(a, files)
  const lines: string[] = []
  for (const [i, question] of ask.questions.entries()) {
    const answer = ask.answers.questions.find((a) => a.questionId === question.id)
    lines.push(`${i + 1}. ${question.prompt}`)
    if (answer && answer.optionIds.length) lines.push(`   Picked: ${pickedLine(question, answer.optionIds)}`)
    else if (answer?.none) lines.push("   Picked: None of these")
    if (answer?.comment) lines.push(...indented(`Comment: ${answer.comment}`, "   "))
    for (const a of answer?.attachments ?? []) lines.push(`   ${shot(a)}`)
    lines.push("")
  }
  if (ask.answers.note) lines.push(...indented(`Note: ${ask.answers.note}`, ""))
  for (const a of ask.answers.noteAttachments) lines.push(shot(a))
  while (lines.at(-1) === "") lines.pop()
  return lines
}

const STATES = { open: "still open", answered: "answered", withdrawn: "withdrawn", superseded: "replaced by a newer ask" } as const

/** What `--wait`, `cello wait` and `cello task answers` print for a task's latest ask. */
export const askResultText = (ask: Ask, taskKey: string, human: string, files: ReadonlyMap<string, string>, now: number): string => {
  if (ask.state !== "answered") {
    return `${taskKey}'s questions "${ask.title}" were ${STATES[ask.state]}${ask.withdrawnAt ? ` ${ago(ask.withdrawnAt, now)}` : ""}; there are no answers.`
  }
  return [
    `${human} answered "${ask.title}" on ${taskKey}, ${ago(ask.answeredAt!, now)}:`,
    "",
    ...answerLines(ask, files),
    "",
    `${taskKey} is back in progress: carry on with these answers. Reply on the card with \`cello task comment ${taskKey} "…"\` if something is unclear.`,
  ].join("\n")
}


const THROUGH = { hook: "the hook", inbox: "`cello inbox`", wait: "an earlier wait" } as const

/**
 * What `--wait` and `cello wait` print instead of the answers when they already reached this session
 * (CEL-78): the hook or `cello inbox` took them while the wait was reconnecting, or an earlier wait did.
 */
export const alreadyDeliveredText = (ask: Ask, taskKey: string, delivered: AnswersDelivered, now: number): string =>
  `The answers to "${ask.title}" on ${taskKey} already reached this session ` +
  `(${delivered.via ? `through ${THROUGH[delivered.via]}, ` : ""}${ago(delivered.at, now)}). ` +
  `\`cello task answers ${taskKey}\` shows them again.`

/**
 * `cello task answers`: the latest answered round (and the round still open after it, if any);
 * with `all`, every round, oldest first, each with its answers or its questions.
 */
export const roundsText = (
  asks: ReadonlyArray<Ask>,
  options: { readonly all: boolean; readonly taskKey: string; readonly human: string; readonly files: ReadonlyMap<string, string>; readonly now: number },
): string => {
  const { taskKey, human, files, now } = options
  if (asks.length === 0) return `${taskKey} has no questions for ${human} yet. Ask with \`cello task ask ${taskKey}\`.`
  const latest = asks.at(-1)!
  const stillOpen = latest.state === "open"
    ? [`${roundLabel(asks, latest)}: "${latest.title}" is still open; \`cello wait ${taskKey}\` waits for the answers.`]
    : []
  if (!options.all) {
    const answered = asks.filter((a) => a.state === "answered").at(-1)
    if (!answered) return stillOpen[0] ?? askResultText(latest, taskKey, human, files, now)
    return [roundLabel(asks, answered), askResultText(answered, taskKey, human, files, now), ...(stillOpen.length ? ["", ...stillOpen] : [])].join("\n")
  }
  return asks.flatMap((ask, i) => [
    ...(i === 0 ? [] : [""]),
    `${roundLabel(asks, ask)}: "${ask.title}", asked ${ago(ask.createdAt, now)}`,
    ...(ask.answers ? answerLines(ask, files) : ask.questions.map((q, n) => `${n + 1}. ${q.prompt}`)).map((l) => (l === "" ? "" : `  ${l}`)),
  ]).join("\n")
}
