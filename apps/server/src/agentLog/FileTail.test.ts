// Reading a growing file line by line (CEL-106): each read hands over complete lines written since the
// last, keeps a half-written line for later, starts again when the file is replaced or shrinks, and never
// reads more than it's allowed at once: a long transcript is read from near its end, in chunks.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fileTail, type TailIo } from "./FileTail.ts"

let dir: string
let file: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cel106-tail-"))
  file = path.join(dir, "t.jsonl")
})

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const lines = (lines: ReadonlyArray<string>, reset: boolean, extra: { more?: boolean; older?: boolean } = {}) => ({
  _tag: "lines",
  lines,
  reset,
  more: extra.more ?? false,
  older: extra.older ?? false,
})

describe("fileTail", () => {
  it("hands over complete lines once each, keeping a half-written one until its newline arrives", () => {
    fs.writeFileSync(file, "one\ntwo\nthr")
    const tail = fileTail(file)
    expect(tail.read()).toEqual(lines(["one", "two"], true))
    expect(tail.read()).toEqual(lines([], false))
    fs.appendFileSync(file, "ee\nfour\n")
    expect(tail.read()).toEqual(lines(["three", "four"], false))
  })

  it("keeps a character split across two writes whole", () => {
    const bytes = Buffer.from("café ✓\n")
    fs.writeFileSync(file, bytes.subarray(0, 4))
    const tail = fileTail(file)
    expect(tail.read()).toEqual(lines([], true))
    fs.appendFileSync(file, bytes.subarray(4))
    expect(tail.read()).toEqual(lines(["café ✓"], false))
  })

  it("says missing while the file isn't there, and reads it from the start once it is", () => {
    const tail = fileTail(file)
    expect(tail.read()).toEqual({ _tag: "missing" })
    fs.writeFileSync(file, "hello\n")
    expect(tail.read()).toEqual(lines(["hello"], true))
    fs.rmSync(file)
    expect(tail.read()).toEqual({ _tag: "missing" })
    fs.writeFileSync(file, "again\n")
    expect(tail.read()).toEqual(lines(["again"], true))
  })

  it("starts again from the top when the file shrinks (replaced)", () => {
    fs.writeFileSync(file, "a long first line\nsecond\n")
    const tail = fileTail(file)
    tail.read()
    fs.writeFileSync(file, "new\n")
    expect(tail.read()).toEqual(lines(["new"], true))
  })

  it("a long file is read from near its end, from the first whole line there, saying older lines exist", () => {
    // Ten lines of 9 bytes ("line-00X\n"); a window of 30 bytes starts mid-line 7.
    fs.writeFileSync(file, Array.from({ length: 10 }, (_, i) => `line-00${i}\n`).join(""))
    const tail = fileTail(file, { window: 30, chunk: 30 })
    expect(tail.read()).toEqual(lines(["line-007", "line-008", "line-009"], true, { older: true }))
  })

  it("reads what was appended in bounded chunks, saying when there's more", () => {
    fs.writeFileSync(file, "start\n")
    const tail = fileTail(file, { window: 30, chunk: 20 })
    tail.read()
    fs.appendFileSync(file, "aaaaaaaa\nbbbbbbbb\ncccccccc\n")
    expect(tail.read()).toEqual(lines(["aaaaaaaa", "bbbbbbbb"], false, { more: true }))
    expect(tail.read()).toEqual(lines(["cccccccc"], false))
  })

  it("drops a single line longer than it will hold, and goes on with the next", () => {
    fs.writeFileSync(file, "")
    const tail = fileTail(file, { window: 100, chunk: 10, maxLine: 15 })
    tail.read()
    fs.appendFileSync(file, `${"x".repeat(40)}\nok\n`)
    const read: string[] = []
    for (let i = 0; i < 10; i++) {
      const r = tail.read()
      if (r._tag === "lines") read.push(...r.lines)
      if (r._tag !== "lines" || !r.more) break
    }
    expect(read).toEqual(["ok"])
  })

  it("a file gone between looking and opening is missing; one it may not read is unreadable", () => {
    fs.writeFileSync(file, "x\n")
    const error = (code: string) => Object.assign(new Error(code), { code })
    const io = (code: string): TailIo => ({
      statSync: fs.statSync,
      openSync: () => {
        throw error(code)
      },
      readSync: fs.readSync,
      closeSync: fs.closeSync,
    })
    expect(fileTail(file, { io: io("ENOENT") }).read()).toEqual({ _tag: "missing" })
    expect(fileTail(file, { io: io("EACCES") }).read()).toEqual({ _tag: "unreadable" })
  })
})
