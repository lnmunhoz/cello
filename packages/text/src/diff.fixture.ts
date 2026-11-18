// A diff an agent pasted into a comment (CEL-176): the shape of one seen in the wild, with invented
// content. What makes it hard, and why the tests and the e2e use it:
//   - no `diff --git` or `index` lines, only `---`, `+++` and `@@`
//   - three files, the first with two hunks
//   - context lines that are markdown list items (` - A kind…`)
//   - blank context lines written both as a lone space and as an empty line (chat and email drop the space)
//   - a removed list item (`-- Use…`), and one line over 200 characters
// Shared by the parser's tests, the web tests and the e2e, so they all read the same text.

/** A hunk with its `@@ -a,b +c,d @@` line worked out from its lines, so the fixture can't miscount. */
const hunk = (oldStart: number, newStart: number, section: string, lines: ReadonlyArray<string>): ReadonlyArray<string> => {
  const old = lines.filter((line) => !line.startsWith("+")).length
  const now = lines.filter((line) => !line.startsWith("-")).length
  return [`@@ -${oldStart},${old} +${newStart},${now} @@${section === "" ? "" : ` ${section}`}`, ...lines]
}

/** The longest line of the diff: it must wrap in a narrow panel, never scroll sideways. */
export const DIFF_BLOCK_LONG_LINE =
  "+- Always sign off with the product name in lower case, and when the name is long, shorten it to the part before the first space, unless it has a hyphen, in which case keep both halves; if the name is missing, say hello and nothing else, and never ask for it."

export const DIFF_BLOCK = [
  "--- a/src/greeting/prompt.ts",
  "+++ b/src/greeting/prompt.ts",
  ...hunk(10, 10, "export const GREETING_PROMPT = `", [
    " Write a short greeting for the person below.",
    " ",
    " Rules:",
    " - Keep it under two sentences.",
    "-- Use their first name.",
    "+- Use their first name, and never a nickname they did not give.",
    "+- If the time of day is known, match it.",
    " - A kind tone, never a joke at their expense.",
    "",
    " Examples:",
  ]),
  ...hunk(34, 35, "", [" - Never mention the weather.", "", DIFF_BLOCK_LONG_LINE, " `"]),
  "--- a/src/greeting/prompt.test.ts",
  "+++ b/src/greeting/prompt.test.ts",
  ...hunk(5, 5, 'describe("GREETING_PROMPT", () => {', [
    '   it("asks for a short greeting", () => {',
    "     expect(GREETING_PROMPT).toContain(\"short greeting\")",
    "   })",
    "+",
    '+  it("never allows a nickname", () => {',
    "+    expect(GREETING_PROMPT).toContain(\"never a nickname\")",
    "+  })",
  ]),
  "--- a/src/greeting/GreetingService.ts",
  "+++ b/src/greeting/GreetingService.ts",
  ...hunk(21, 21, "export class GreetingService {", [
    "   greet(person: Person) {",
    "-    return render(GREETING_PROMPT, { name: person.firstName })",
    "+    const hour = person.localHour",
    "+    return render(GREETING_PROMPT, { name: person.firstName, hour })",
    "   }",
  ]),
].join("\n")

/** What `DIFF_BLOCK` adds up to: three files, 9 lines added, 2 removed. */
export const DIFF_BLOCK_TOTALS = { files: 3, additions: 9, deletions: 2 } as const

/** The paths of the fixture's files, in order. */
export const DIFF_BLOCK_PATHS = ["src/greeting/prompt.ts", "src/greeting/prompt.test.ts", "src/greeting/GreetingService.ts"] as const

/** A comment as an agent writes it: a sentence, then the diff in a fenced block. */
export const DIFF_BLOCK_COMMENT = ["The greeting prompt now refuses nicknames and matches the time of day. The diff:", "", "```diff", DIFF_BLOCK, "```", "", "Tests pass."].join("\n")

/** Hunks without file headers: one with its `@@` line, then prose, then bare `+`/`-` lines. */
export const HEADERLESS_BLOCK = ["@@ -10,3 +10,4 @@", " keep", "-old line", "+new line", "+another new line", " tail", "", "Then the second place:", "", "-const a = 1", "+const a = 2", "+const b = 3"].join("\n")

export const HEADERLESS_BLOCK_COMMENT = ["Two places changed, no file names:", "", "```diff", HEADERLESS_BLOCK, "```"].join("\n")
