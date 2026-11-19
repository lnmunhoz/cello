import { describe, expect, it } from "vitest"
import { commentGist } from "./comment.ts"

describe("commentGist", () => {
  it("is the comment's words; a comment that is only screenshots says so (CEL-73)", () => {
    expect(commentGist({ body: "  Looks right  ", attachments: [{}] })).toBe("Looks right")
    expect(commentGist({ body: "", attachments: [{}] })).toBe("(screenshot)")
    expect(commentGist({ body: " ", attachments: [{}, {}] })).toBe("(2 screenshots)")
    expect(commentGist({ body: "" })).toBe("")
  })
})
