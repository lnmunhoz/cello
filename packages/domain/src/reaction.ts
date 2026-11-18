// Emoji reactions on comments (CEL-77): which emoji count as one, the form they're stored in, the
// picker's curated set, and how a comment's reactions group into chips. The server checks with
// `reactionProblem` and stores `cleanReaction`; the web app and the CLI group with `groupReactions`, so
// a chip means the same thing everywhere.

/** The five quick picks next to every comment, in this order. */
export const QUICK_REACTIONS = ["👍", "✅", "👀", "❤️", "🎉"] as const

/** The fuller picker: the quick picks first, then a short curated set. `name` shows on hover; search covers it and `words`. */
export const REACTION_PICKS: ReadonlyArray<{ readonly emoji: string; readonly name: string; readonly words?: string }> = [
  { emoji: "👍", name: "thumbs up", words: "yes ok +1 agree" },
  { emoji: "✅", name: "check mark", words: "done yes ok" },
  { emoji: "👀", name: "eyes", words: "looking watching" },
  { emoji: "❤️", name: "red heart", words: "love like" },
  { emoji: "🎉", name: "party popper", words: "tada celebrate" },
  { emoji: "👎", name: "thumbs down", words: "no -1 disagree" },
  { emoji: "🙏", name: "folded hands", words: "thanks please" },
  { emoji: "🚀", name: "rocket", words: "ship it launch" },
  { emoji: "🔥", name: "fire", words: "hot great" },
  { emoji: "💯", name: "hundred points", words: "perfect" },
  { emoji: "👏", name: "clapping hands", words: "applause" },
  { emoji: "🙌", name: "raising hands", words: "hooray" },
  { emoji: "😄", name: "grinning face", words: "smile happy" },
  { emoji: "😂", name: "tears of joy", words: "laugh" },
  { emoji: "🤔", name: "thinking face", words: "hmm" },
  { emoji: "😕", name: "confused face" },
  { emoji: "😮", name: "open mouth", words: "wow surprised" },
  { emoji: "😬", name: "grimacing face", words: "yikes" },
  { emoji: "😅", name: "sweat smile", words: "phew" },
  { emoji: "🥲", name: "smiling with tear" },
  { emoji: "😍", name: "heart eyes", words: "love" },
  { emoji: "🤩", name: "star struck" },
  { emoji: "😎", name: "sunglasses", words: "cool" },
  { emoji: "🤯", name: "exploding head", words: "mind blown" },
  { emoji: "😴", name: "sleeping face", words: "sleepy" },
  { emoji: "🫡", name: "saluting face", words: "on it" },
  { emoji: "👌", name: "ok hand" },
  { emoji: "✌️", name: "victory hand", words: "peace" },
  { emoji: "🤞", name: "crossed fingers", words: "luck" },
  { emoji: "💪", name: "flexed biceps", words: "strong" },
  { emoji: "👋", name: "waving hand", words: "hello bye" },
  { emoji: "🤝", name: "handshake", words: "deal" },
  { emoji: "⭐", name: "star" },
  { emoji: "✨", name: "sparkles" },
  { emoji: "💡", name: "light bulb", words: "idea" },
  { emoji: "⚡", name: "high voltage", words: "zap lightning fast" },
  { emoji: "🐛", name: "bug" },
  { emoji: "🔧", name: "wrench", words: "fix" },
  { emoji: "🧪", name: "test tube", words: "experiment" },
  { emoji: "📌", name: "pushpin", words: "pin" },
  { emoji: "📝", name: "memo", words: "note" },
  { emoji: "⏳", name: "hourglass", words: "waiting later" },
  { emoji: "🛑", name: "stop sign" },
  { emoji: "⚠️", name: "warning" },
  { emoji: "❌", name: "cross mark", words: "no wrong" },
  { emoji: "❓", name: "question mark" },
  { emoji: "➕", name: "plus", words: "add" },
  { emoji: "🎯", name: "bullseye", words: "target" },
]

/** Whether a pick matches what was typed in the picker's search: the start of a word of its name or search words, or the emoji itself. */
export const pickMatches = (pick: (typeof REACTION_PICKS)[number], query: string): boolean => {
  const typed = query.trim().toLowerCase()
  return typed === "" || pick.emoji === typed || ` ${pick.name} ${pick.words ?? ""}`.includes(` ${typed}`)
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

const VS16 = 0xfe0f
const ZWJ = 0x200d
const KEYCAP = 0x20e3
const BLACK_FLAG = 0x1f3f4
const CANCEL_TAG = 0xe007f
/** ©, ® and ™ read as text unless they come with the emoji selector. */
const TEXT_UNLESS_SELECTED = new Set([0xa9, 0xae, 0x2122])

const isRegional = (cp: number) => cp >= 0x1f1e6 && cp <= 0x1f1ff
const isTag = (cp: number) => cp >= 0xe0020 && cp <= 0xe007f
const isSkinTone = (cp: number) => cp >= 0x1f3fb && cp <= 0x1f3ff
const isPictograph = (cp: number) => !isSkinTone(cp) && /\p{Extended_Pictographic}/u.test(String.fromCodePoint(cp))
const showsAsEmoji = (cp: number) => /\p{Emoji_Presentation}/u.test(String.fromCodePoint(cp))
const codePoints = (text: string) => [...text].map((c) => c.codePointAt(0)!)

/** One element of a joined emoji: a pictograph, then at most an emoji selector and a skin tone. */
const isElement = (cps: ReadonlyArray<number>) => {
  const [first, ...rest] = cps
  return first !== undefined && isPictograph(first) && rest.length <= 2 &&
    rest.filter((cp) => cp === VS16).length <= 1 && rest.filter(isSkinTone).length <= 1 && rest.every((cp) => cp === VS16 || isSkinTone(cp))
}

/** Whether these code points are one well-formed emoji: a flag, a keycap, a tag flag, or elements joined by ZWJ. */
const wellFormed = (cps: ReadonlyArray<number>): boolean => {
  if (cps.some(isRegional)) return cps.length === 2 && cps.every(isRegional)
  if (cps.includes(KEYCAP)) {
    const [base, ...rest] = cps
    return base !== undefined && /^[0-9#*]$/.test(String.fromCodePoint(base)) &&
      (rest.length === 1 || (rest.length === 2 && rest[0] === VS16)) && rest.at(-1) === KEYCAP
  }
  if (cps.some(isTag)) {
    const letters = cps.slice(1, -1)
    return cps[0] === BLACK_FLAG && cps.at(-1) === CANCEL_TAG && letters.length > 0 && letters.every((cp) => isTag(cp) && cp !== CANCEL_TAG)
  }
  const parts: number[][] = [[]]
  for (const cp of cps) {
    if (cp === ZWJ) parts.push([])
    else parts.at(-1)!.push(cp)
  }
  return parts.every(isElement)
}

/**
 * The form a reaction is stored in: trimmed, and a lone symbol with its emoji selector exactly once when
 * it shows as text by default (❤ and ❤️ are both ❤️), so the unique index and the chips agree. Flags,
 * keycaps and joined emoji stay as typed.
 */
export const cleanReaction = (value: string): string => {
  const emoji = value.trim()
  const cps = codePoints(emoji)
  const bare = cps.filter((cp) => cp !== VS16)
  if (bare.length !== 1 || !isPictograph(bare[0]!) || cps.length - bare.length > 2) return emoji
  const [cp] = bare as [number]
  if (TEXT_UNLESS_SELECTED.has(cp) && cps.length === 1) return emoji
  return showsAsEmoji(cp) ? String.fromCodePoint(cp) : String.fromCodePoint(cp, VS16)
}

/**
 * Why `value` can't be a reaction, or null: it must be exactly one well-formed emoji. Skin tones, flags,
 * keycaps and joined emoji count as one; a lone flag letter or keycap mark, a dangling joiner, stray tag
 * characters, and ©, ® or ™ without the emoji selector don't.
 */
export const reactionProblem = (value: string): string | null => {
  const trimmed = value.trim()
  if (trimmed === "") return "can't be empty"
  const emoji = cleanReaction(trimmed)
  const cps = codePoints(emoji)
  const one = [...segmenter.segment(emoji)].length === 1 && !(cps.length === 1 && TEXT_UNLESS_SELECTED.has(cps[0]!)) && wellFormed(cps)
  return one ? null : "must be one emoji, like 👍"
}
/** What a chip needs from a reaction. */
interface Reacted {
  readonly emoji: string
  readonly createdAt: number
}

/** One chip under a comment: an emoji, how many reacted with it, whether one of them is the viewer, and who. */
export interface ReactionChip<R extends Reacted> {
  readonly emoji: string
  readonly count: number
  readonly mine: boolean
  readonly reactions: ReadonlyArray<R>
}

/** A comment's reactions as chips: one per emoji, in the order each emoji was first used. `isMine` says which reactions are the viewer's. */
export const groupReactions = <R extends Reacted>(reactions: ReadonlyArray<R>, isMine: (reaction: R) => boolean): ReadonlyArray<ReactionChip<R>> => {
  const byEmoji = new Map<string, R[]>()
  for (const reaction of [...reactions].sort((a, b) => a.createdAt - b.createdAt)) {
    const list = byEmoji.get(reaction.emoji)
    if (list) list.push(reaction)
    else byEmoji.set(reaction.emoji, [reaction])
  }
  return [...byEmoji].map(([emoji, list]) => ({ emoji, count: list.length, mine: list.some(isMine), reactions: list }))
}
