import { describe, expect, it } from "vitest"
import { cleanReaction, groupReactions, pickMatches, QUICK_REACTIONS, REACTION_PICKS, reactionProblem } from "./reaction.ts"

const ONE = "must be one emoji, like 👍"

describe("reaction emoji", () => {
  it.each([
    ["👍", "a plain emoji"],
    ["✅", "an emoji shown as emoji by default"],
    ["❤️", "a symbol with its emoji selector"],
    ["❤", "the same symbol without it"],
    ["👍🏽", "a skin tone"],
    ["🇧🇷", "a flag: two regional indicators"],
    ["1️⃣", "a keycap"],
    ["#⃣", "a keycap without the selector"],
    ["👨‍👩‍👧", "a joined family"],
    ["🏳️‍🌈", "a joined flag"],
    ["🏴󠁧󠁢󠁳󠁣󠁴󠁿", "a subdivision flag: black flag, tag letters, cancel tag"],
    ["©️", "© with the emoji selector"],
    ["™️", "™ with the emoji selector"],
  ])("%s is an emoji (%s)", (emoji) => {
    expect(reactionProblem(emoji)).toBeNull()
  })

  it.each([
    ["", "can't be empty"],
    ["ok", ONE],
    ["+1", ONE],
    ["👍 ok", ONE],
    ["👍👍", ONE],
    ["1", ONE],
    ["🇧", ONE], // a lone regional indicator
    ["🇧🇷🇺", ONE], // a flag and a stray indicator
    ["⃣", ONE], // a lone keycap combiner
    ["a⃣", ONE], // a keycap on something that isn't 0-9, # or *
    ["👍‍", ONE], // a trailing joiner
    ["‍👍", ONE], // a leading joiner
    ["👍\u{e0041}", ONE], // a stray tag character
    ["🏴\u{e0067}\u{e0062}", ONE], // tag letters without the cancel tag
    ["️", ONE], // a lone selector
    ["🏽", ONE], // a lone skin tone
    ["©", ONE], // © reads as text without its selector
    ["®", ONE],
    ["™", ONE],
  ])("%j is refused: %s", (value, reason) => {
    expect(reactionProblem(value)).toBe(reason)
  })

  it("stores one form: trimmed, and a symbol that shows as text by default gets its emoji selector, so ❤ and ❤️ are one", () => {
    expect(cleanReaction(" 👍 ")).toBe("👍")
    expect(cleanReaction("❤")).toBe("❤️")
    expect(cleanReaction("❤️")).toBe("❤️")
    expect(cleanReaction("❤️️")).toBe("❤️")
    expect(cleanReaction("✌")).toBe("✌️")
    expect(cleanReaction("©️")).toBe("©️")
    expect(cleanReaction("✅")).toBe("✅")
    expect(cleanReaction("👍🏽")).toBe("👍🏽")
    expect(cleanReaction("🏳️‍🌈")).toBe("🏳️‍🌈")
  })

  it("the quick picks lead the picker; every pick is a valid emoji in its stored form, with a name and search words", () => {
    expect(QUICK_REACTIONS).toEqual(["👍", "✅", "👀", "❤️", "🎉"])
    expect(REACTION_PICKS.slice(0, 5).map((p) => p.emoji)).toEqual(QUICK_REACTIONS)
    for (const pick of REACTION_PICKS) {
      expect(reactionProblem(pick.emoji), pick.emoji).toBeNull()
      expect(cleanReaction(pick.emoji), pick.emoji).toBe(pick.emoji)
      expect(pick.name.length).toBeGreaterThan(0)
    }
    expect(new Set(REACTION_PICKS.map((p) => p.emoji)).size).toBe(REACTION_PICKS.length)
  })
})

describe("pickMatches", () => {
  const found = (query: string) => REACTION_PICKS.filter((p) => pickMatches(p, query)).map((p) => p.emoji)

  it("finds picks by name, by search word or by the emoji itself, the quick picks included", () => {
    expect(found("thumbs")).toEqual(["👍", "👎"])
    expect(found("yes")).toEqual(["👍", "✅"])
    expect(found("Heart")).toEqual(["❤️", "😍"])
    expect(found(" 🎉 ")).toEqual(["🎉"])
    expect(found("")).toHaveLength(REACTION_PICKS.length)
    expect(found("zebra")).toEqual([])
  })
})

describe("groupReactions", () => {
  const r = (emoji: string, actorId: string, sessionId: string | null, createdAt: number) => ({ emoji, actorId, sessionId, createdAt })

  it("one chip per emoji, in the order each was first used, with who reacted and whether one is mine", () => {
    const chips = groupReactions(
      [r("🎉", "agent", "s1", 3), r("👍", "human", null, 1), r("👍", "agent", "s1", 2)],
      (x) => x.sessionId === null,
    )
    expect(chips).toEqual([
      { emoji: "👍", count: 2, mine: true, reactions: [r("👍", "human", null, 1), r("👍", "agent", "s1", 2)] },
      { emoji: "🎉", count: 1, mine: false, reactions: [r("🎉", "agent", "s1", 3)] },
    ])
  })

  it("no reactions, no chips", () => {
    expect(groupReactions([], () => true)).toEqual([])
  })
})
