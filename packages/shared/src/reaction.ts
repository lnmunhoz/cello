// Emoji reactions on comments (CEL-77): which emoji count as one, the picker's curated set, and how a
// comment's reactions group into chips. The server checks with `reactionProblem`; the web app and the
// CLI group with `groupReactions`, so a chip means the same thing everywhere.

/** The five quick picks next to every comment, in this order. */
export const QUICK_REACTIONS = ["👍", "✅", "👀", "❤️", "🎉"] as const

/** The fuller picker: the quick picks first, then a short curated set, each with a name to search by. */
export const REACTION_PICKS: ReadonlyArray<{ readonly emoji: string; readonly name: string }> = [
  { emoji: "👍", name: "thumbs up yes ok" },
  { emoji: "✅", name: "check done" },
  { emoji: "👀", name: "eyes looking" },
  { emoji: "❤️", name: "heart love" },
  { emoji: "🎉", name: "party tada celebrate" },
  { emoji: "👎", name: "thumbs down no" },
  { emoji: "🙏", name: "thanks please" },
  { emoji: "🚀", name: "rocket ship it" },
  { emoji: "🔥", name: "fire" },
  { emoji: "💯", name: "hundred perfect" },
  { emoji: "👏", name: "clap applause" },
  { emoji: "🙌", name: "raised hands hooray" },
  { emoji: "😄", name: "smile happy" },
  { emoji: "😂", name: "laugh joy" },
  { emoji: "🤔", name: "thinking hmm" },
  { emoji: "😕", name: "confused" },
  { emoji: "😮", name: "wow surprised" },
  { emoji: "😬", name: "grimace yikes" },
  { emoji: "😅", name: "sweat phew" },
  { emoji: "🥲", name: "smile tear" },
  { emoji: "😍", name: "heart eyes" },
  { emoji: "🤩", name: "star struck" },
  { emoji: "😎", name: "cool sunglasses" },
  { emoji: "🤯", name: "mind blown" },
  { emoji: "😴", name: "sleepy" },
  { emoji: "🫡", name: "salute on it" },
  { emoji: "👌", name: "ok hand" },
  { emoji: "✌️", name: "victory peace" },
  { emoji: "🤞", name: "fingers crossed" },
  { emoji: "💪", name: "strong muscle" },
  { emoji: "👋", name: "wave hello" },
  { emoji: "🤝", name: "handshake deal" },
  { emoji: "⭐", name: "star" },
  { emoji: "✨", name: "sparkles" },
  { emoji: "💡", name: "idea bulb" },
  { emoji: "⚡", name: "zap lightning fast" },
  { emoji: "🐛", name: "bug" },
  { emoji: "🔧", name: "wrench fix" },
  { emoji: "🧪", name: "test tube experiment" },
  { emoji: "📌", name: "pin" },
  { emoji: "📝", name: "memo note" },
  { emoji: "⏳", name: "hourglass waiting later" },
  { emoji: "🛑", name: "stop" },
  { emoji: "⚠️", name: "warning" },
  { emoji: "❌", name: "cross no wrong" },
  { emoji: "❓", name: "question" },
  { emoji: "➕", name: "plus add" },
  { emoji: "🎯", name: "target bullseye" },
]

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })
const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u

/** The emoji without the space around it. */
export const cleanReaction = (value: string): string => value.trim()

/** Why `value` can't be a reaction, or null: it must be exactly one emoji (skin tones, flags and joined emoji count as one). */
export const reactionProblem = (value: string): string | null => {
  const emoji = cleanReaction(value)
  if (emoji === "") return "can't be empty"
  const graphemes = [...segmenter.segment(emoji)]
  return graphemes.length === 1 && PICTOGRAPH.test(emoji) ? null : "must be one emoji, like 👍"
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
