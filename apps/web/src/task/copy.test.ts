import { describe, expect, it } from "vitest"
import { taskForAgent } from "./copy.ts"

describe("a task copied for an agent", () => {
  it("is the key and title, a blank line, the description as written, then where to read the rest", () => {
    const text = taskForAgent({ key: "CEL-51", title: "Pages open in the side panel", description: "Open a page **beside** the board.\n\n- keep the scroll\n- keep the tab" })
    expect(text).toBe(
      [
        "CEL-51: Pages open in the side panel",
        "",
        "Open a page **beside** the board.",
        "",
        "- keep the scroll",
        "- keep the tab",
        "",
        "Full card, comments and history: cello task get CEL-51",
      ].join("\n"),
    )
  })

  it("leaves out the description when there is none, or only blank space", () => {
    const expected = "CEL-7: Copy a task's key\n\nFull card, comments and history: cello task get CEL-7"
    expect(taskForAgent({ key: "CEL-7", title: "Copy a task's key", description: "" })).toBe(expected)
    expect(taskForAgent({ key: "CEL-7", title: "Copy a task's key", description: "  \n\n  " })).toBe(expected)
  })

  it("drops blank lines around the description but keeps its first line's indent", () => {
    const text = taskForAgent({ key: "THAI-3", title: "Fix it", description: "\n\n    indented code\nnext\n\n\n" })
    expect(text).toBe("THAI-3: Fix it\n\n    indented code\nnext\n\nFull card, comments and history: cello task get THAI-3")
  })
})
