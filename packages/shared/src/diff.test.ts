import { describe, expect, it } from "vitest"
import {
  DIFF_LARGE_FILE_LINES,
  DIFF_SHOWN_BUDGET,
  diffTotals,
  fileLineCount,
  foldedAtStart,
  isUnifiedDiff,
  parseUnifiedDiff,
  splitRows,
  type DiffFile,
  type DiffHunk,
  type DiffLine,
} from "./diff.ts"

const join = (...lines: string[]) => lines.join("\n") + "\n"

const MODIFIED = join(
  "diff --git a/LIFECYCLE.md b/LIFECYCLE.md",
  "index 3f2a9c1..8b7d4e0 100644",
  "--- a/LIFECYCLE.md",
  "+++ b/LIFECYCLE.md",
  "@@ -18,3 +18,4 @@ ## Workflows",
  " keep",
  "-old line",
  "+new line",
  "+another new line",
  " tail",
)

const only = (text: string): DiffFile => {
  const parsed = parseUnifiedDiff(text)
  expect(parsed.files).toHaveLength(1)
  return parsed.files[0]!
}

describe("parseUnifiedDiff: a modified file", () => {
  it("reads the paths without a/ and b/, the hunk's numbers and section, each line's kind and numbers, and the counts", () => {
    const file = only(MODIFIED)
    expect(file).toMatchObject({ path: "LIFECYCLE.md", oldPath: "LIFECYCLE.md", newPath: "LIFECYCLE.md", status: "modified", binary: false, additions: 2, deletions: 1 })
    expect(file.hunks).toHaveLength(1)
    const hunk = file.hunks[0]!
    expect(hunk).toMatchObject({ header: "@@ -18,3 +18,4 @@ ## Workflows", oldStart: 18, oldLines: 3, newStart: 18, newLines: 4, section: "## Workflows" })
    expect(hunk.lines).toEqual([
      { kind: "context", text: "keep", oldLine: 18, newLine: 18 },
      { kind: "remove", text: "old line", oldLine: 19 },
      { kind: "add", text: "new line", newLine: 19 },
      { kind: "add", text: "another new line", newLine: 20 },
      { kind: "context", text: "tail", oldLine: 20, newLine: 21 },
    ])
  })
})

describe("parseUnifiedDiff: several files and hunks", () => {
  const text = MODIFIED + join(
    "@@ -40,2 +41,2 @@",
    " a",
    "-b",
    "+c",
    "diff --git a/src/x.ts b/src/x.ts",
    "--- a/src/x.ts",
    "+++ b/src/x.ts",
    "@@ -1 +1,2 @@",
    " one",
    "+two",
  )
  it("keeps every hunk of a file and every file in order, with totals", () => {
    const parsed = parseUnifiedDiff(text)
    expect(parsed.files.map((f) => [f.path, f.hunks.length, f.additions, f.deletions])).toEqual([
      ["LIFECYCLE.md", 2, 3, 2],
      ["src/x.ts", 1, 1, 0],
    ])
    expect(diffTotals(parsed.files)).toEqual({ files: 2, additions: 4, deletions: 2 })
    expect(parsed.parts.map((p) => p.kind)).toEqual(["file", "file"])
  })
})

describe("parseUnifiedDiff: new, deleted and empty files", () => {
  it("a new file is added, its path the new one, every line an addition", () => {
    const file = only(join("diff --git a/docs/previews.md b/docs/previews.md", "new file mode 100644", "index 0000000..1234567", "--- /dev/null", "+++ b/docs/previews.md", "@@ -0,0 +1,2 @@", "+# Previews", "+Text"))
    expect(file).toMatchObject({ path: "docs/previews.md", oldPath: null, newPath: "docs/previews.md", status: "added", additions: 2, deletions: 0, newMode: "100644" })
    expect(file.hunks[0]!.lines.map((l) => l.kind)).toEqual(["add", "add"])
  })
  it("a deleted file is deleted, its path the old one", () => {
    const file = only(join("diff --git a/notes/todo.md b/notes/todo.md", "deleted file mode 100644", "index 1234567..0000000", "--- a/notes/todo.md", "+++ /dev/null", "@@ -1,2 +0,0 @@", "-one", "-two"))
    expect(file).toMatchObject({ path: "notes/todo.md", oldPath: "notes/todo.md", newPath: null, status: "deleted", additions: 0, deletions: 2 })
  })
  it("an empty new file has no hunks and still counts as a file", () => {
    const file = only(join("diff --git a/empty.txt b/empty.txt", "new file mode 100644", "index 0000000..e69de29"))
    expect(file).toMatchObject({ path: "empty.txt", status: "added", hunks: [], additions: 0, deletions: 0 })
  })
})

describe("parseUnifiedDiff: renames", () => {
  it("a pure rename (similarity 100%) has no hunks and keeps both paths", () => {
    const file = only(join("diff --git a/docs/old-dev.md b/docs/dev-server.md", "similarity index 100%", "rename from docs/old-dev.md", "rename to docs/dev-server.md"))
    expect(file).toMatchObject({ path: "docs/dev-server.md", oldPath: "docs/old-dev.md", newPath: "docs/dev-server.md", status: "renamed", similarity: 100, hunks: [] })
  })
  it("a rename with edits has its hunks and the similarity", () => {
    const file = only(join("diff --git a/docs/old-dev.md b/docs/dev-server.md", "similarity index 91%", "rename from docs/old-dev.md", "rename to docs/dev-server.md", "index 1111111..2222222 100644", "--- a/docs/old-dev.md", "+++ b/docs/dev-server.md", "@@ -1,2 +1,2 @@", " title", "-port 4748", "+port 5199"))
    expect(file).toMatchObject({ path: "docs/dev-server.md", oldPath: "docs/old-dev.md", status: "renamed", similarity: 91, additions: 1, deletions: 1 })
  })
  it("a mode change alone is a modified file with both modes", () => {
    const file = only(join("diff --git a/run.sh b/run.sh", "old mode 100644", "new mode 100755"))
    expect(file).toMatchObject({ path: "run.sh", status: "modified", oldMode: "100644", newMode: "100755", hunks: [] })
  })
})

describe("parseUnifiedDiff: binary files", () => {
  it("'Binary files … differ' is a binary file without hunks", () => {
    const file = only(join("diff --git a/art/logo.png b/art/logo.png", "index 1111111..2222222 100644", "Binary files a/art/logo.png and b/art/logo.png differ"))
    expect(file).toMatchObject({ path: "art/logo.png", binary: true, status: "modified", hunks: [] })
  })
  it("a new binary file reads its path from the Binary line, with /dev/null as no path", () => {
    const file = only(join("diff --git a/art/new.png b/art/new.png", "new file mode 100644", "index 0000000..2222222", "Binary files /dev/null and b/art/new.png differ"))
    expect(file).toMatchObject({ path: "art/new.png", oldPath: null, status: "added", binary: true })
  })
  it("a GIT binary patch block is skipped, and the next file still parses", () => {
    const text = join(
      "diff --git a/art/logo.png b/art/logo.png",
      "index 1111111..2222222 100644",
      "GIT binary patch",
      "literal 12",
      "zcmV-Y0Oxyn",
      "",
      "literal 0",
      "HcmV?d00001",
      "",
      "diff --git a/a.txt b/a.txt",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1 +1 @@",
      "-x",
      "+y",
    )
    const parsed = parseUnifiedDiff(text)
    expect(parsed.files.map((f) => [f.path, f.binary])).toEqual([["art/logo.png", true], ["a.txt", false]])
    expect(parsed.files[1]!.hunks[0]!.lines).toHaveLength(2)
    expect(parsed.parts.filter((p) => p.kind === "text")).toEqual([])
  })
})

describe("parseUnifiedDiff: no newline at end of file", () => {
  it("marks the line before it and counts nothing for the marker", () => {
    const file = only(join("diff --git a/AGENTS.md b/AGENTS.md", "--- a/AGENTS.md", "+++ b/AGENTS.md", "@@ -1,2 +1,2 @@", " keep", "-last", "\\ No newline at end of file", "+last!", "\\ No newline at end of file"))
    expect(file.hunks[0]!.lines).toEqual([
      { kind: "context", text: "keep", oldLine: 1, newLine: 1 },
      { kind: "remove", text: "last", oldLine: 2, noNewline: true },
      { kind: "add", text: "last!", newLine: 2, noNewline: true },
    ])
    expect(file).toMatchObject({ additions: 1, deletions: 1 })
  })
})

describe("parseUnifiedDiff: text around the diff", () => {
  it("a junk first line becomes a text part before the files", () => {
    const parsed = parseUnifiedDiff("The diff (the AGENTS.md hunk is THAI-137's)\n\n" + MODIFIED)
    expect(parsed.parts.map((p) => p.kind)).toEqual(["text", "file"])
    expect(parsed.parts[0]).toEqual({ kind: "text", text: "The diff (the AGENTS.md hunk is THAI-137's)" })
    expect(parsed.files).toHaveLength(1)
  })
  it("a git format-patch email header, the stat block and the signature are text, never removed lines", () => {
    const text = join(
      "From 1234567890abcdef Mon Sep 17 00:00:00 2001",
      "From: Ada <ada@example.com>",
      "Subject: [PATCH] Fix the thing",
      "",
      "Longer explanation.",
      "---",
      " a.txt | 2 +-",
      " 1 file changed, 1 insertion(+), 1 deletion(-)",
      "",
      "diff --git a/a.txt b/a.txt",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1 +1 @@",
      "-x",
      "+y",
      "-- ",
      "2.43.0",
    )
    const parsed = parseUnifiedDiff(text)
    expect(parsed.files).toHaveLength(1)
    const file = parsed.files[0]!
    expect(file).toMatchObject({ additions: 1, deletions: 1 })
    expect(file.hunks[0]!.lines).toHaveLength(2)
    const texts = parsed.parts.filter((p) => p.kind === "text").map((p) => (p as { text: string }).text)
    expect(texts[0]).toContain("Subject: [PATCH] Fix the thing")
    expect(texts[0]).toContain(" 1 file changed")
    expect(texts.at(-1)).toBe("-- \n2.43.0")
  })
})

describe("parseUnifiedDiff: plain diff -u", () => {
  it("starts a file at --- and +++ followed by a hunk, drops the timestamps, and reads /dev/null", () => {
    const text = join("--- old/notes.txt\t2024-05-01 10:00:00.000000000 +0000", "+++ new/notes.txt\t2024-05-02 10:00:00.000000000 +0000", "@@ -1 +1 @@", "-a", "+b")
    const file = only(text)
    expect(file).toMatchObject({ path: "new/notes.txt", oldPath: "old/notes.txt", newPath: "new/notes.txt", status: "modified", additions: 1, deletions: 1 })
  })
  it("--- alone, or --- and +++ without a hunk, is not a file", () => {
    expect(parseUnifiedDiff("--- a\n+++ b\nplain\n").files).toEqual([])
    expect(parseUnifiedDiff("--- \nbody\n").files).toEqual([])
  })
})

describe("parseUnifiedDiff: quoted paths", () => {
  it("unquotes C-style octal escapes as UTF-8 and handles a path with a space", () => {
    const file = only(join('diff --git "a/caf\\303\\251.md" "b/caf\\303\\251.md"', '--- "a/caf\\303\\251.md"', '+++ "b/caf\\303\\251.md"', "@@ -1 +1 @@", "-a", "+b"))
    expect(file.path).toBe("café.md")
    const spaced = only(join("diff --git a/my notes.md b/my notes.md", "index 1111111..2222222 100644", "Binary files a/my notes.md and b/my notes.md differ"))
    expect(spaced.path).toBe("my notes.md")
  })
})

describe("parseUnifiedDiff: counts and empty lines", () => {
  it("@@ -3 +3 @@ means a count of one, and an empty line inside a hunk is context", () => {
    const file = only(join("diff --git a/a b/a", "--- a/a", "+++ b/a", "@@ -3 +3 @@", "-x", "+y"))
    expect(file.hunks[0]).toMatchObject({ oldLines: 1, newLines: 1 })
    const blank = only("diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1,3 +1,3 @@\n one\n\n-two\n+three\n")
    expect(blank.hunks[0]!.lines.map((l) => [l.kind, l.text])).toEqual([["context", "one"], ["context", ""], ["remove", "two"], ["add", "three"]])
  })
})

describe("parseUnifiedDiff: damaged input", () => {
  it("a diff cut off in the middle of a hunk parses what is there, and CRLF line ends are dropped", () => {
    const cut = only("diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1,10 +1,10 @@\n one\n-two\n+t")
    expect(cut.hunks[0]!.lines.map((l) => l.text)).toEqual(["one", "two", "t"])
    const crlf = only("diff --git a/a b/a\r\n--- a/a\r\n+++ b/a\r\n@@ -1 +1 @@\r\n-x\r\n+y\r\n")
    expect(crlf.hunks[0]!.lines.map((l) => l.text)).toEqual(["x", "y"])
  })
  it("a trailing newline in a cut-off hunk adds no phantom line", () => {
    const cut = only("diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1,10 +1,10 @@\n one\n")
    expect(cut.hunks[0]!.lines).toHaveLength(1)
  })
})

describe("isUnifiedDiff: only real diffs", () => {
  it("is true for a diff, even with text around it", () => {
    expect(isUnifiedDiff(MODIFIED)).toBe(true)
    expect(isUnifiedDiff("note\n" + MODIFIED)).toBe(true)
  })
  it("is false for a terminal transcript, a vitest comparison, markdown rules, prose that mentions diff --git, and nothing", () => {
    expect(isUnifiedDiff("$ bun run test\n✓ a.test.ts (3 tests)\n\n Tests  3 passed (3)\n")).toBe(false)
    expect(isUnifiedDiff("- Expected\n+ Received\n\n- 1\n+ 2\n")).toBe(false)
    expect(isUnifiedDiff("# Title\n\n---\n\nSome text\n\n---\n\nmore\n")).toBe(false)
    expect(isUnifiedDiff("Run diff --git a/x b/x to see it.\ndiff --git a/x b/x\n")).toBe(false)
    expect(isUnifiedDiff("")).toBe(false)
  })
})

describe("foldedAtStart: what a big diff shows first", () => {
  const file = (lines: number): DiffFile => ({
    path: "f",
    oldPath: "f",
    newPath: "f",
    status: "modified",
    binary: false,
    additions: lines,
    deletions: 0,
    hunks: [{ header: "@@", oldStart: 1, oldLines: 0, newStart: 1, newLines: lines, section: "", lines: Array.from({ length: lines }, (_, i): DiffLine => ({ kind: "add", text: "x", newLine: i + 1 })) }],
  })
  it("counts the lines of a file", () => {
    expect(fileLineCount(file(7))).toBe(7)
  })
  it("folds a file over 1,500 lines, and only that one", () => {
    expect(DIFF_LARGE_FILE_LINES).toBe(1500)
    expect(foldedAtStart([file(10), file(1500), file(1501), file(10)])).toEqual([false, false, true, false])
  })
  it("folds every file once 5,000 lines are shown", () => {
    expect(DIFF_SHOWN_BUDGET).toBe(5000)
    expect(foldedAtStart([file(1400), file(1400), file(1400), file(1400), file(10), file(10)])).toEqual([false, false, false, false, true, true])
  })
})

describe("splitRows: the split view's pairing", () => {
  const hunk = (lines: ReadonlyArray<DiffLine>): DiffHunk => ({ header: "@@", oldStart: 1, oldLines: 0, newStart: 1, newLines: 0, section: "", lines })
  const ctx = (text: string, n: number): DiffLine => ({ kind: "context", text, oldLine: n, newLine: n })
  const rem = (text: string, n: number): DiffLine => ({ kind: "remove", text, oldLine: n })
  const add = (text: string, n: number): DiffLine => ({ kind: "add", text, newLine: n })
  const view = (rows: ReturnType<typeof splitRows>) => rows.map((r) => [r.left?.text ?? null, r.right?.text ?? null])

  it("a context line sits on both sides of one row", () => {
    const rows = splitRows(hunk([ctx("keep", 1)]))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.left).toBe(rows[0]!.right)
  })
  it("a run of removed lines then a run of added ones pairs row by row", () => {
    expect(view(splitRows(hunk([ctx("a", 1), rem("b", 2), rem("c", 3), add("B", 2), add("C", 3), ctx("d", 4)])))).toEqual([["a", "a"], ["b", "B"], ["c", "C"], ["d", "d"]])
  })
  it("the longer run's leftovers face an empty cell", () => {
    expect(view(splitRows(hunk([rem("b", 1), rem("c", 2), rem("d", 3), add("B", 1)])))).toEqual([["b", "B"], ["c", null], ["d", null]])
    expect(view(splitRows(hunk([rem("b", 1), add("B", 1), add("C", 2), add("D", 3)])))).toEqual([["b", "B"], [null, "C"], [null, "D"]])
  })
  it("removes with no adds after them, and adds alone, face empty cells", () => {
    expect(view(splitRows(hunk([ctx("a", 1), rem("b", 2), ctx("c", 3), add("D", 3), ctx("e", 4)])))).toEqual([["a", "a"], ["b", null], ["c", "c"], [null, "D"], ["e", "e"]])
  })
  it("an add run then a remove run (git never writes it, but a hand-made diff may) does not pair", () => {
    expect(view(splitRows(hunk([add("A", 1), rem("b", 1)])))).toEqual([[null, "A"], ["b", null]])
  })
  it("the no-newline marker travels with its line", () => {
    const rows = splitRows(hunk([{ kind: "remove", text: "x", oldLine: 1, noNewline: true }, { kind: "add", text: "y", newLine: 1, noNewline: true }]))
    expect(rows[0]!.left).toMatchObject({ noNewline: true })
    expect(rows[0]!.right).toMatchObject({ noNewline: true })
  })
})
