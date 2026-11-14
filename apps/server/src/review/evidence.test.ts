import { describe, expect, it } from "vitest"
import { classify, MAX_ATTACHMENT_BYTES, requireLink } from "./evidence.ts"
import * as Effect from "effect/Effect"

describe("classify", () => {
  it.each([
    ["shot.png", "image", "image/png"],
    ["Shot.JPG", "image", "image/jpeg"],
    ["anim.gif", "image", "image/gif"],
    ["pic.webp", "image", "image/webp"],
    ["demo.mp4", "video", "video/mp4"],
    ["demo.webm", "video", "video/webm"],
    ["demo.mov", "video", "video/quicktime"],
    ["tests.txt", "file", "text/plain; charset=utf-8"],
    ["server.log", "file", "text/plain; charset=utf-8"],
    ["notes.md", "file", "text/markdown; charset=utf-8"],
    ["session.cast", "file", "application/x-asciicast"],
    ["report.json", "file", "application/json"],
  ])("%s is %s (%s)", (name, kind, mime) => {
    expect(classify(name)).toEqual({ kind, mime })
  })

  it("refuses anything that isn't an image, a video or text", () => {
    for (const name of ["page.html", "logo.svg", "tool.exe", "archive.zip", "noextension"]) expect(classify(name)).toBeNull()
  })

  it("caps files at 50 MB", () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(50 * 1024 * 1024)
  })
})

describe("requireLink", () => {
  it("takes http and https URLs", () => {
    expect(Effect.runSync(requireLink(" https://github.com/lnmunhoz/cello/pull/12 "))).toBe("https://github.com/lnmunhoz/cello/pull/12")
    expect(Effect.runSync(requireLink("http://localhost:5199/CEL/7"))).toBe("http://localhost:5199/CEL/7")
  })

  it("refuses other schemes and things that aren't URLs", () => {
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "not a url", ""]) {
      expect(Effect.runSync(Effect.flip(requireLink(url)))).toMatchObject({ _tag: "Invalid", field: "links" })
    }
  })
})
