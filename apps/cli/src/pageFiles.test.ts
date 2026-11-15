import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { pageFiles } from "./pageFiles.ts"

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

const tree = (files: ReadonlyArray<string>) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cello-page-files-")))
  dirs.push(dir)
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), "x")
  }
  return dir
}

describe("pageFiles", () => {
  it("adds the images the markdown links that exist, relative to it or absolute, to the --asset files", () => {
    const dir = tree(["report/shots/board.png", "report/chart.webp", "notes.txt", "abs.png"])
    const markdown = [
      "![Board](shots/board.png) ![Chart](./chart.webp \"Chart\")",
      `![Absolute](${path.join(dir, "abs.png")})`,
      "![Web](https://example.com/a.png) ![Stored](/attachments/01ABC)",
      "![Board again](shots/board.png)",
    ].join("\n")
    expect(pageFiles(markdown, path.join(dir, "report"), ["notes.txt"], dir)).toEqual({
      files: [path.join(dir, "notes.txt"), path.join(dir, "report/shots/board.png"), path.join(dir, "report/chart.webp"), path.join(dir, "abs.png")],
      skipped: [],
    })
  })

  // CEL-54: a page linked its video as `[a-palette-typing.mp4](a-palette-typing.mp4)`; it stayed a
  // relative link, which led the reader to a page that doesn't exist.
  it("adds every file the server stores that the markdown links, as a plain link or an image", () => {
    const dir = tree(["report/a-palette-typing.mp4", "report/clip.webm", "report/data.csv", "report/vitest.log", "report/shot.png"])
    const markdown = [
      "Typing in the palette: [a-palette-typing.mp4](a-palette-typing.mp4).",
      "![The clip](clip.webm) and [the numbers](./data.csv?raw) and [the log](vitest.log#L2).",
      "[![thumb](shot.png)](shot.png)",
    ].join("\n")
    expect(pageFiles(markdown, path.join(dir, "report"), [], dir).files).toEqual([
      path.join(dir, "report/a-palette-typing.mp4"),
      path.join(dir, "report/clip.webm"),
      path.join(dir, "report/data.csv"),
      path.join(dir, "report/vitest.log"),
      path.join(dir, "report/shot.png"),
    ])
  })

  it("names each linked local file it can't send: missing from disk, or a type the server doesn't store", () => {
    const dir = tree(["report/design.pdf", "report/board.png"])
    const markdown = [
      "[the demo](demo.mp4) ![Gone](shots/gone.png) [the design](design.pdf) ![Board](board.png)",
      "Not files: [web](https://example.com/a.mp4), [anchor](#findings), [the board](/CEL/issues), [a folder](shots/).",
      "`[in code](code.mp4)`",
      "[the demo again](demo.mp4)",
    ].join("\n")
    expect(pageFiles(markdown, path.join(dir, "report"), [], dir)).toEqual({
      files: [path.join(dir, "report/board.png")],
      skipped: [
        { target: "demo.mp4", file: path.join(dir, "report/demo.mp4"), reason: "missing" },
        { target: "shots/gone.png", file: path.join(dir, "report/shots/gone.png"), reason: "missing" },
        { target: "design.pdf", file: path.join(dir, "report/design.pdf"), reason: "unsupported" },
      ],
    })
  })
})
