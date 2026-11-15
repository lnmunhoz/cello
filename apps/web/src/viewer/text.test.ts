import { describe, expect, it } from "vitest"
import { downloadName, shownText, stripAnsi, textFormat } from "./text.ts"

describe("stripAnsi: a terminal transcript without its colour and cursor codes", () => {
  it("drops colours, bold and resets", () => {
    expect(stripAnsi("\u001b[32m✓\u001b[39m 12 tests \u001b[1mpassed\u001b[22m\u001b[0m")).toBe("✓ 12 tests passed")
  })
  it("drops cursor moves, line clears and title sequences", () => {
    expect(stripAnsi("\u001b[2K\u001b[1Gdone\u001b]0;bun test\u0007 ok")).toBe("done ok")
  })
  it("leaves plain text alone", () => {
    expect(stripAnsi("a [bracket] stays\n  indented")).toBe("a [bracket] stays\n  indented")
  })
})

describe("textFormat: how the side panel's text view shows a file", () => {
  it("markdown through the page reader, by its type or its name", () => {
    expect(textFormat("text/markdown; charset=utf-8", undefined)).toBe("markdown")
    expect(textFormat("text/plain", "notes.MD")).toBe("markdown")
  })
  it("JSON as JSON", () => {
    expect(textFormat("application/json", undefined)).toBe("json")
    expect(textFormat(null, "report.json")).toBe("json")
  })
  it("everything else (transcripts, logs, CSV, casts) in monospace", () => {
    expect(textFormat("text/plain; charset=utf-8", "transcript.txt")).toBe("plain")
    expect(textFormat("text/csv", "runs.csv")).toBe("plain")
    expect(textFormat("application/x-asciicast", "demo.cast")).toBe("plain")
    expect(textFormat(null, undefined)).toBe("plain")
  })
})

describe("shownText: what the monospace view shows", () => {
  it("a transcript without its ANSI codes", () => {
    expect(shownText("\u001b[31mFAIL\u001b[0m x.test.ts", "plain")).toBe("FAIL x.test.ts")
  })
  it("JSON indented, when it parses", () => {
    expect(shownText('{"ok":true,"n":[1,2]}', "json")).toBe('{\n  "ok": true,\n  "n": [\n    1,\n    2\n  ]\n}')
  })
  it("JSON that doesn't parse (JSON lines, a cut-off file) as it is", () => {
    expect(shownText('{"a":1}\n{"b":2}', "json")).toBe('{"a":1}\n{"b":2}')
  })
})

describe("downloadName: the name Download saves the file under", () => {
  it("the file's own name, else the last part of its address", () => {
    expect(downloadName("http://localhost:4747/attachments/f1", "test-output.txt")).toBe("test-output.txt")
    expect(downloadName("http://localhost:4747/files/run.log", undefined)).toBe("run.log")
    expect(downloadName("http://localhost:4747/attachments/f1", undefined)).toBe("f1")
  })
})
