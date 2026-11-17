import { describe, expect, it } from "vitest"
import { descriptionExcerpt } from "./excerpt.ts"

// The first lines of a task's description, for its hover card (CEL-142): whole blocks of markdown, so
// what's shown renders as it does in the task (a list stays a list, a code block is never cut open).
describe("descriptionExcerpt", () => {
  it("an empty description has no excerpt", () => {
    expect(descriptionExcerpt("")).toEqual({ text: "", more: false })
    expect(descriptionExcerpt("  \n\n ")).toEqual({ text: "", more: false })
  })

  it("a short description is shown whole", () => {
    expect(descriptionExcerpt("Show **baht** prices on the plan page.")).toEqual({ text: "Show **baht** prices on the plan page.", more: false })
  })

  it("takes whole paragraphs up to the limit, and says more was left out", () => {
    const source = ["First paragraph.", "Second paragraph.", "Third paragraph that is long enough to go past the limit."].join("\n\n")
    expect(descriptionExcerpt(source, 40)).toEqual({ text: "First paragraph.\n\nSecond paragraph.", more: true })
  })

  it("keeps at most three blocks", () => {
    expect(descriptionExcerpt("a\n\nb\n\nc\n\nd")).toEqual({ text: "a\n\nb\n\nc", more: true })
  })

  it("a list is one block, and a code block with blank lines in it is never cut open", () => {
    const source = ["Steps:", "- one\n- two", "```ts\nconst a = 1\n\nconst b = 2\n```", "After."].join("\n\n")
    expect(descriptionExcerpt(source, 1000)).toEqual({ text: ["Steps:", "- one\n- two", "```ts\nconst a = 1\n\nconst b = 2\n```"].join("\n\n"), more: true })
  })

  it("a first paragraph past the limit is cut at a word, with an ellipsis", () => {
    const { text, more } = descriptionExcerpt("The quick brown fox jumps over the lazy dog", 20)
    expect(text).toBe("The quick brown fox…")
    expect(more).toBe(true)
  })

  it("a long first code block or table stays whole: cut, it wouldn't render (the card clips its height)", () => {
    const fence = "```\n" + "x".repeat(50) + "\n```"
    expect(descriptionExcerpt(`${fence}\n\nNext`, 20)).toEqual({ text: fence, more: true })
  })
})
