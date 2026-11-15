import { describe, expect, it } from "vitest"
import { cssString, stylesFor } from "./css.ts"

describe("cssString", () => {
  it("escapes backslashes, quotes and line breaks so an id can't end the string or the rule", () => {
    expect(cssString('a"b')).toBe('a\\"b')
    expect(cssString("a\\b")).toBe("a\\\\b")
    expect(cssString("a\nb\rc\fd")).toBe("a\\a b\\d c\\c d")
    expect(cssString('x"]{display:none}[y="')).toBe('x\\"]{display:none}[y=\\"')
  })

  it("leaves ordinary ids alone", () => {
    expect(cssString("01JD5Q8Z3X")).toBe("01JD5Q8Z3X")
    expect(cssString("optimistic:9f1c")).toBe("optimistic:9f1c")
  })
})

describe("stylesFor", () => {
  it("hides a waiting card, keeps a flying card's space, and hides a taken-over hole", () => {
    const pending = new Map([
      ["a", "queued" as const],
      ['b"\\', "flying" as const],
    ])
    expect(stylesFor(pending, [{ id: 3, hidden: true }, { id: 4, hidden: false }])).toBe(
      ['[data-card-id="a"]{display:none !important}', '[data-card-id="b\\"\\\\"]{opacity:0 !important}', '[data-agent-hole="3"]{visibility:hidden}'].join("\n"),
    )
  })

  it("is empty when nothing waits", () => {
    expect(stylesFor(new Map(), [])).toBe("")
  })
})
