import { describe, expect, it } from "vitest"
import { attachmentsIn, screenshotsFrom, uploadUrl } from "./screenshots.ts"

describe("pasted and dropped screenshots", () => {
  it("takes pasted images only, up to 20 MB, and names a nameless one", () => {
    expect(screenshotsFrom([
      { name: "image.png", type: "image/png", size: 10 },
      { name: "", type: "image/jpeg", size: 10 },
      { name: "notes.pdf", type: "application/pdf", size: 10 },
      { name: "huge.webp", type: "image/webp", size: 21 * 1024 * 1024 },
    ])).toEqual({
      accepted: [{ index: 0, name: "image.png" }, { index: 1, name: "screenshot.jpg" }],
      refused: ["notes.pdf isn't a PNG, JPEG, GIF or WebP image", "huge.webp is over 20 MB"],
    })
  })

  it("go to the ask's upload route, or the task's for a comment box", () => {
    expect(uploadUrl({ askId: "01ASK" })).toBe("/asks/01ASK/uploads")
    expect(uploadUrl({ taskId: "01TASK" })).toBe("/tasks/01TASK/uploads")
    expect(uploadUrl({ taskId: "../x" })).toBe("/tasks/..%2Fx/uploads")
  })

  it("read back from a saved draft, skipping what isn't an attachment", () => {
    expect(attachmentsIn([{ id: "a1", name: "a.png" }, 3, null, { name: "no id" }])).toEqual([{ id: "a1", name: "a.png" }])
    expect(attachmentsIn("nope")).toEqual([])
  })
})
