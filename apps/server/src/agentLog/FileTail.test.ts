// Reading a growing file line by line (CEL-106): each read hands over the complete lines written since
// the last, keeps a half-written line for later, and starts again when the file is replaced or shrinks.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fileTail } from "./FileTail.ts"

let dir: string
let file: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cel106-tail-"))
  file = path.join(dir, "t.jsonl")
})

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("fileTail", () => {
  it("hands over complete lines once each, keeping a half-written one until its newline arrives", () => {
    fs.writeFileSync(file, "one\ntwo\nthr")
    const tail = fileTail(file)
    expect(tail.read()).toEqual({ _tag: "lines", lines: ["one", "two"], reset: true })
    expect(tail.read()).toEqual({ _tag: "lines", lines: [], reset: false })
    fs.appendFileSync(file, "ee\nfour\n")
    expect(tail.read()).toEqual({ _tag: "lines", lines: ["three", "four"], reset: false })
  })

  it("keeps a character split across two writes whole", () => {
    const bytes = Buffer.from("café ✓\n")
    fs.writeFileSync(file, bytes.subarray(0, 4))
    const tail = fileTail(file)
    expect(tail.read()).toEqual({ _tag: "lines", lines: [], reset: true })
    fs.appendFileSync(file, bytes.subarray(4))
    expect(tail.read()).toEqual({ _tag: "lines", lines: ["café ✓"], reset: false })
  })

  it("says missing while the file isn't there, and reads it from the start once it is", () => {
    const tail = fileTail(file)
    expect(tail.read()).toEqual({ _tag: "missing" })
    fs.writeFileSync(file, "hello\n")
    expect(tail.read()).toEqual({ _tag: "lines", lines: ["hello"], reset: true })
    fs.rmSync(file)
    expect(tail.read()).toEqual({ _tag: "missing" })
    fs.writeFileSync(file, "again\n")
    expect(tail.read()).toEqual({ _tag: "lines", lines: ["again"], reset: true })
  })

  it("starts again from the top when the file shrinks (replaced)", () => {
    fs.writeFileSync(file, "a long first line\nsecond\n")
    const tail = fileTail(file)
    tail.read()
    fs.writeFileSync(file, "new\n")
    expect(tail.read()).toEqual({ _tag: "lines", lines: ["new"], reset: true })
  })

  it("can start at a byte offset", () => {
    fs.writeFileSync(file, "skip\nkeep\n")
    expect(fileTail(file, 5).read()).toEqual({ _tag: "lines", lines: ["keep"], reset: true })
  })
})
