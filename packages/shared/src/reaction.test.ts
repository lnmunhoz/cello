import { describe, expect, it } from "vitest"
import { cleanReaction, groupReactions, QUICK_REACTIONS, REACTION_PICKS, reactionProblem } from "./reaction.ts"

describe("reaction emoji", () => {
  it.each(["👍", "✅", "👀", "❤️", "🎉", "🚀", "👍🏽", "🇧🇷", "1️⃣", "👨‍👩‍👧", "🏳️‍🌈", "❤"])("%s is an emoji", (emoji) => {
    expect(reactionProblem(emoji)).toBeNull()
  })

  it.each([
    ["", "can't be empty"],
    ["ok", "must be one emoji, like 👍"],
    ["+1", "must be one emoji, like 👍"],
    ["👍 ok", "must be one emoji, like 👍"],
    ["👍👍", "must be one emoji, like 👍"],
    ["1", "must be one emoji, like 👍"],
  ])("%j is refused: %s", (value, reason) => {
    expect(reactionProblem(value)).toBe(reason)
  })

  it("trims around the emoji", () => {
    expect(cleanReaction(" 👍 ")).toBe("👍")
  })

  it("the quick picks lead the picker, and every pick is a valid emoji with a name", () => {
    expect(QUICK_REACTIONS).toEqual(["👍", "✅", "👀", "❤️", "🎉"])
    expect(REACTION_PICKS.slice(0, 5).map((p) => p.emoji)).toEqual(QUICK_REACTIONS)
    for (const pick of REACTION_PICKS) {
      expect(reactionProblem(pick.emoji), pick.emoji).toBeNull()
      expect(pick.name.length).toBeGreaterThan(0)
    }
    expect(new Set(REACTION_PICKS.map((p) => p.emoji)).size).toBe(REACTION_PICKS.length)
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
