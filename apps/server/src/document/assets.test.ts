import { mapLinkTargets } from "@cello/shared/document"
import { describe, expect, it } from "vitest"
import { assetResolver } from "./assets.ts"

const assets = [
  { path: "/work/report/shots/board.png", url: "/attachments/A1" },
  { path: "/work/report/vitest.log", url: "/attachments/A2" },
  { path: "/elsewhere/img/chart.png", url: "/attachments/A3" },
  { path: "/other/board.png", url: "/attachments/A4" },
]

describe("assetResolver", () => {
  const resolve = (target: string, sourceDir: string | null = "/work/report") => assetResolver(sourceDir, assets)({ target, image: true })

  it("matches a path relative to the markdown file first", () => {
    expect(resolve("shots/board.png")).toBe("/attachments/A1")
    expect(resolve("./vitest.log")).toBe("/attachments/A2")
    expect(resolve("../report/shots/board.png")).toBe("/attachments/A1")
  })

  it("then a file whose path ends with the target, then one with the same name", () => {
    expect(resolve("img/chart.png")).toBe("/attachments/A3")
    expect(resolve("pictures/chart.png")).toBe("/attachments/A3")
    expect(resolve("board.png", null)).toBe("/attachments/A1")
    expect(resolve("other/board.png", null)).toBe("/attachments/A4")
  })

  it("matches an absolute path only exactly, and leaves URLs, anchors and unknown files alone", () => {
    expect(resolve("/other/board.png")).toBe("/attachments/A4")
    expect(resolve("/attachments/A1")).toBeNull()
    expect(resolve("https://example.com/board.png")).toBeNull()
    expect(resolve("//cdn.example.com/board.png")).toBeNull()
    expect(resolve("#findings")).toBeNull()
    expect(resolve("missing.png")).toBeNull()
  })

  it("rewrites a document's image links to the stored files", () => {
    const md = "![Board](shots/board.png)\n\nSee [the log](vitest.log?raw#L2) and ![web](https://x.dev/a.png)."
    expect(mapLinkTargets(md, assetResolver("/work/report", assets))).toBe(
      "![Board](/attachments/A1)\n\nSee [the log](/attachments/A2) and ![web](https://x.dev/a.png).",
    )
  })
})
