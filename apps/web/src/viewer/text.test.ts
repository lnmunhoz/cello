import { describe, expect, it } from "vitest"
import { asDiff, downloadName, MAX_SHOWN_BYTES, readShown, shownText, stripAnsi, textFormat } from "./text.ts"

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
  it("a diff by its name (.diff, .patch, any case) or its type", () => {
    expect(textFormat("text/plain", "changes.diff")).toBe("diff")
    expect(textFormat(null, "fix.PATCH")).toBe("diff")
    expect(textFormat("text/x-diff", undefined)).toBe("diff")
    expect(textFormat("text/x-patch; charset=utf-8", undefined)).toBe("diff")
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

describe("shownText for a diff", () => {
  it("is the text without its ANSI codes, as for plain text", () => {
    expect(shownText("\u001b[32m+added\u001b[0m", "diff")).toBe("+added")
  })
})

describe("asDiff: when the text view shows a diff view", () => {
  const DIFF = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-x\n+y\n"
  it("a .diff or .patch that parses", () => {
    expect(asDiff("diff", DIFF)?.files).toHaveLength(1)
  })
  it("a .txt or .log whose text is a diff, with a junk first line", () => {
    expect(asDiff("plain", "The diff, as promised\n" + DIFF)?.files).toHaveLength(1)
  })
  it("a diff that carries ANSI colour codes, as git diff --color writes it", () => {
    const coloured = "\u001b[1mdiff --git a/a.txt b/a.txt\u001b[m\n\u001b[1m--- a/a.txt\u001b[m\n\u001b[1m+++ b/a.txt\u001b[m\n\u001b[36m@@ -1 +1 @@\u001b[m\n\u001b[31m-x\u001b[m\n\u001b[32m+y\u001b[m\n"
    expect(asDiff("plain", coloured)?.files[0]).toMatchObject({ path: "a.txt", additions: 1, deletions: 1 })
  })
  it("null for a transcript, for a .diff that doesn't parse, and for markdown or JSON", () => {
    expect(asDiff("plain", "$ bun run test\n✓ a.test.ts\n")).toBeNull()
    expect(asDiff("diff", "just some words")).toBeNull()
    expect(asDiff("markdown", DIFF)).toBeNull()
    expect(asDiff("json", DIFF)).toBeNull()
  })
})

describe("downloadName: the name Download saves the file under", () => {
  it("the file's own name, else the last part of its address", () => {
    expect(downloadName("http://localhost:4747/attachments/f1", "test-output.txt")).toBe("test-output.txt")
    expect(downloadName("http://localhost:4747/files/run.log", undefined)).toBe("run.log")
    expect(downloadName("http://localhost:4747/attachments/f1", undefined)).toBe("f1")
  })
})

describe("readShown: the text view reads at most MAX_SHOWN_BYTES of a file, and stops reading there", () => {
  const stream = (chunks: ReadonlyArray<string>) => {
    const encoder = new TextEncoder()
    let cancelled = false
    let pulled = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled === chunks.length) return controller.close()
        controller.enqueue(encoder.encode(chunks[pulled++]!))
      },
      cancel() {
        cancelled = true
      },
    })
    return { body, cancelled: () => cancelled, pulled: () => pulled }
  }

  it("a file under the limit, whole", async () => {
    const { body } = stream(["line 1\n", "line 2\n"])
    expect(await readShown(body, 100)).toEqual({ text: "line 1\nline 2\n", clipped: false })
  })

  it("a file over the limit: up to the last whole line inside it, and the rest is never read", async () => {
    const { body, cancelled, pulled } = stream(["aaaa\nbbbb\n", "cccc\ndddd\n", "eeee\n", "ffff\n"])
    expect(await readShown(body, 12)).toEqual({ text: "aaaa\nbbbb\n", clipped: true })
    expect(cancelled()).toBe(true)
    expect(pulled()).toBeLessThan(4)
  })

  it("never cuts a character in half", async () => {
    const { body } = stream(["ééééé"]) // 10 bytes, no newline
    expect(await readShown(body, 5)).toEqual({ text: "éé", clipped: true })
  })

  it("the limit is 1 MB", () => {
    expect(MAX_SHOWN_BYTES).toBe(1024 * 1024)
  })
})
