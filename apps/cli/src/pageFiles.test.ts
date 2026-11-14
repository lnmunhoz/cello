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
    const dir = tree(["report/shots/board.png", "report/chart.webp", "report/data.csv", "notes.txt", "abs.png"])
    const markdown = [
      "![Board](shots/board.png) ![Chart](./chart.webp \"Chart\")",
      `![Absolute](${path.join(dir, "abs.png")})`,
      "![Missing](missing.png) ![Web](https://example.com/a.png) ![Stored](/attachments/01ABC)",
      "[Data](data.csv) ![Not an image](data.csv)",
      "![Board again](shots/board.png)",
    ].join("\n")
    expect(pageFiles(markdown, path.join(dir, "report"), ["notes.txt", "report/data.csv"], dir)).toEqual([
      path.join(dir, "notes.txt"),
      path.join(dir, "report/data.csv"),
      path.join(dir, "report/shots/board.png"),
      path.join(dir, "report/chart.webp"),
      path.join(dir, "abs.png"),
    ])
  })
})
