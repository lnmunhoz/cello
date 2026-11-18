import { DIFF_BLOCK, HEADERLESS_BLOCK } from "@cello/text/diff.fixture"
import { createElement } from "react"
import { describe, expect, it } from "vitest"
import { blockView, codeBlockOf } from "./codeBlock.ts"

const code = (language: string | null, text: string) => createElement("code", language === null ? {} : { className: `language-${language}` }, text)

const GIT_DIFF = "diff --git a/a.txt b/a.txt\nindex 1111111..2222222 100644\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n same\n-old\n+new\n"

describe("codeBlockOf: the language and text of a fenced block", () => {
  it("reads both from the <code> inside a <pre>", () => {
    expect(codeBlockOf(code("ts", "const a = 1\n"))).toEqual({ language: "ts", text: "const a = 1\n" })
    expect(codeBlockOf(code(null, "plain\n"))).toEqual({ language: null, text: "plain\n" })
  })
  it("is null for a string or anything that is not a <code> element", () => {
    expect(codeBlockOf("plain text")).toBeNull()
    expect(codeBlockOf(createElement("span", null, "x"))).toBeNull()
  })
})

describe("blockView: how a fenced block is drawn", () => {
  it("mermaid is a diagram, source without its final newline (what mermaidSource gave)", () => {
    expect(blockView(code("mermaid", "flowchart TD\n  A --> B\n"))).toEqual({ kind: "mermaid", source: "flowchart TD\n  A --> B" })
  })

  it("a diff block is read loosely: three files, and the source for Copy without its final newline", () => {
    const view = blockView(code("diff", DIFF_BLOCK + "\n"))
    expect(view.kind).toBe("diff")
    if (view.kind !== "diff") return
    expect(view.diff.files).toHaveLength(3)
    expect(view.source).toBe(DIFF_BLOCK)
  })
  it("a patch block is a diff too, and the language is case-insensitive", () => {
    expect(blockView(code("patch", GIT_DIFF)).kind).toBe("diff")
    expect(blockView(code("DIFF", GIT_DIFF)).kind).toBe("diff")
  })
  it("a diff block of hunks without file headers is a diff", () => {
    const view = blockView(code("diff", HEADERLESS_BLOCK))
    expect(view.kind).toBe("diff")
    if (view.kind === "diff") expect(view.diff.files.every((f) => f.headerless)).toBe(true)
  })
  it("a diff block with nothing that is a change in it stays code", () => {
    expect(blockView(code("diff", "hello\n")).kind).toBe("code")
  })

  it("a block with no language is a diff only when its text is a whole git diff, read strictly", () => {
    expect(blockView(code(null, GIT_DIFF)).kind).toBe("diff")
    expect(blockView(code(null, "-a\n+b\n")).kind).toBe("code")
    expect(blockView(code(null, "- Expected\n+ Received\n\n- 1\n+ 2\n")).kind).toBe("code")
    expect(blockView(code(null, "@@ -1 +1 @@\n-a\n+b\n")).kind).toBe("code")
  })
  it("a block in another language stays code, even a git diff in a ts or text block", () => {
    expect(blockView(code("ts", GIT_DIFF)).kind).toBe("code")
    expect(blockView(code("text", GIT_DIFF)).kind).toBe("code")
    expect(blockView(code("ts", "const a = 1")).kind).toBe("code")
  })
  it("anything that is not a code element is code", () => {
    expect(blockView("plain text").kind).toBe("code")
    expect(blockView(createElement("span", null, GIT_DIFF)).kind).toBe("code")
  })
})
