// Unified diffs (`git diff`, `git format-patch`, `diff -u`): what a diff file is made of, parsed once so
// the side panel's diff view (CEL-173), and later the review page's (CEL-128), draw from the same
// model. `parseUnifiedDiff` is strict, and decides what a text file is: it only calls something a file
// when a git header carries a change, or a `---`/`+++` pair is followed by a hunk, so a terminal
// transcript, a markdown rule or prose that mentions `diff --git` is never taken for a diff.
// `parseDiffBlock` (CEL-176) is for text someone fenced as a diff (a ```diff block in a comment or a
// page): the same walk, but it also takes hunks without file headers, a hunk whose counts are off and
// bare `+`/`-` lines, because the writer already said what it is.

export type DiffLine =
  | { readonly kind: "context"; readonly text: string; readonly oldLine: number; readonly newLine: number; readonly noNewline?: true }
  | { readonly kind: "add"; readonly text: string; readonly newLine: number; readonly noNewline?: true }
  | { readonly kind: "remove"; readonly text: string; readonly oldLine: number; readonly noNewline?: true }

export interface DiffHunk {
  /** The whole `@@ -a,b +c,d @@ section` line; as written when it has no ranges, empty for a run of bare `+`/`-` lines. */
  readonly header: string
  readonly oldStart: number
  readonly oldLines: number
  readonly newStart: number
  readonly newLines: number
  /** What follows the closing `@@` (git puts the enclosing function or heading there). */
  readonly section: string
  /**
   * Set when the hunk has no `@@` ranges to number its lines from (only `parseDiffBlock` makes one). Its
   * lines still carry numbers, counted from 1, so the split rows work, but a view shows none of them.
   */
  readonly unnumbered?: true
  readonly lines: ReadonlyArray<DiffLine>
}

export type DiffStatus = "modified" | "added" | "deleted" | "renamed" | "copied"

export interface DiffFile {
  /** The new path, else the old one: the name to show. */
  readonly path: string
  /** Null for an added file. */
  readonly oldPath: string | null
  /** Null for a deleted file. */
  readonly newPath: string | null
  readonly status: DiffStatus
  readonly binary: boolean
  /** A rename's or copy's similarity, in percent. */
  readonly similarity?: number
  readonly oldMode?: string
  readonly newMode?: string
  readonly additions: number
  readonly deletions: number
  readonly hunks: ReadonlyArray<DiffHunk>
  /** Hunks that came with no file header (only `parseDiffBlock` makes one): it has no name and is not counted as a file. */
  readonly headerless?: true
}

/** A diff file is made of `file` parts; whatever sits between them (a junk line, an email header, a signature) is `text`. */
export type DiffPart = { readonly kind: "text"; readonly text: string } | { readonly kind: "file"; readonly file: DiffFile }

export interface ParsedDiff {
  readonly parts: ReadonlyArray<DiffPart>
  readonly files: ReadonlyArray<DiffFile>
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/

/** The extended header lines git writes between `diff --git` and the first hunk. */
const EXTENDED = /^(?:old mode |new mode |deleted file mode |new file mode |copy from |copy to |rename from |rename to |similarity index |dissimilarity index |index |Binary files |GIT binary patch$)/

/** A line of a `GIT binary patch` block: `literal N`, `delta N`, a base85 data line, or a blank separator. */
const BINARY_BLOCK = /^(?:literal \d+|delta \d+|[A-Za-z][0-9A-Za-z!#$%&()*+\-;<=>?@^_`{|}~]*|)$/

const ESCAPES: Record<string, number> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, "\\": 92, '"': 34 }

/** A path git quoted (`"caf\303\251.md"`): C-style escapes, octal ones being the UTF-8 bytes of the name. */
const unquote = (quoted: string): string => {
  const bytes: number[] = []
  const encoder = new TextEncoder()
  for (let i = 1; i < quoted.length - 1; i++) {
    const char = quoted[i]!
    if (char !== "\\") {
      bytes.push(...encoder.encode(char))
      continue
    }
    const octal = /^[0-7]{1,3}/.exec(quoted.slice(i + 1, i + 4))?.[0]
    if (octal) {
      bytes.push(parseInt(octal, 8))
      i += octal.length
      continue
    }
    const escaped = quoted[i + 1]
    if (escaped === undefined) continue
    bytes.push(ESCAPES[escaped] ?? escaped.charCodeAt(0))
    i++
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

/** The end (exclusive) of the quoted path starting at `from`, which is a `"`. */
const quoteEnd = (text: string, from: number): number => {
  for (let i = from + 1; i < text.length; i++) {
    if (text[i] === "\\") i++
    else if (text[i] === '"') return i + 1
  }
  return text.length
}

/** The path a `---`/`+++` line names: unquoted, without a trailing timestamp (after a tab). */
const pathOf = (raw: string): string => {
  const rest = raw.startsWith('"') ? raw.slice(0, quoteEnd(raw, 0)) : (raw.split("\t")[0] ?? raw)
  return rest.startsWith('"') ? unquote(rest) : rest
}

/** git's prefixes: `a/` and `b/`, or with diff.mnemonicPrefix `c/`, `i/`, `w/` and `o/`. */
const GIT_PREFIX = /^[abciwo]\//

/**
 * Both sides lose git's one-letter prefix. Two paths lose it only when their letters differ (`a/` and `b/`),
 * so a `--no-prefix` diff of `x/y.ts` keeps its folder; one path alone only when its letter is one git uses.
 */
const withoutPrefixes = (sides: readonly [string | null, string | null]): [string | null, string | null] => {
  const present = sides.filter((s): s is string => s !== null)
  const strip =
    present.length === 2
      ? present.every((s) => GIT_PREFIX.test(s)) && present[0]![0] !== present[1]![0]
      : present.length === 1 && GIT_PREFIX.test(present[0]!)
  const one = (s: string | null) => (s !== null && strip ? s.slice(2) : s)
  return [one(sides[0]), one(sides[1])]
}

const devNull = (path: string) => (path === "/dev/null" ? null : path)

/** The two paths of a `diff --git <a> <b>` line, still with their prefixes. */
const gitLinePaths = (rest: string): readonly [string, string] => {
  if (rest.startsWith('"')) {
    const end = quoteEnd(rest, 0)
    const second = rest.slice(end + 1)
    return [unquote(rest.slice(0, end)), second.startsWith('"') ? unquote(second.slice(0, quoteEnd(second, 0))) : second]
  }
  // `a/P b/P`: the halves are equal, which tells where a path with spaces splits.
  const length = (rest.length - 5) / 2
  if (Number.isInteger(length) && length >= 1 && rest[length + 2] === " " && rest.slice(2, 2 + length) === rest.slice(length + 5)) {
    return [rest.slice(0, length + 2), rest.slice(length + 3)]
  }
  const two = /^(\S+) (\S+)$/.exec(rest)
  return two ? [two[1]!, two[2]!] : [rest, rest]
}

/** Loose mode: can this line sit inside a hunk's body (a context, added or removed line, a marker, or a blank)? */
const isBodyLine = (line: string): boolean => line === "" || line.startsWith(" ") || line.startsWith("+") || line.startsWith("-") || line.startsWith("\\")

/**
 * Loose mode: does the body of a hunk end before `lines[i]`? Always at the end of the text, a line that
 * isn't a body line, and git's `-- ` signature. A run of bare lines (no counts to stop it) also ends at
 * any `---` or `+++` line; a hunk read by its counts only where a file starts.
 */
const bodyEnds = (lines: ReadonlyArray<string>, i: number, bare: boolean): boolean => {
  const line = lines[i]
  if (line === undefined || !isBodyLine(line) || line === "-- ") return true
  if (bare) return line.startsWith("---") || line.startsWith("+++")
  return startsFile(lines, i, true)
}

/** Loose mode: a run of bare lines starts at `from`: it starts at a context, added or removed line and holds a change. */
const startsBareRun = (lines: ReadonlyArray<string>, from: number): boolean => {
  const first = lines[from]
  if (first === undefined || first === "" || first.startsWith("\\")) return false
  for (let j = from; !bodyEnds(lines, j, true); j++) {
    if (lines[j]!.startsWith("+") || lines[j]!.startsWith("-")) return true
  }
  return false
}

/** Where the run of bare lines that starts at `from` ends (exclusive). */
const bareRunEnd = (lines: ReadonlyArray<string>, from: number): number => {
  let j = from
  while (!bodyEnds(lines, j, true)) j++
  return j
}

/** A file starts at a `---`/`+++` pair and a hunk; in loose mode the hunk may be an `@@` line of any kind, or bare lines. */
const startsFile = (lines: ReadonlyArray<string>, i: number, loose: boolean): boolean =>
  (lines[i]?.startsWith("--- ") ?? false) &&
  (lines[i + 1]?.startsWith("+++ ") ?? false) &&
  (HUNK.test(lines[i + 2] ?? "") || (loose && ((lines[i + 2]?.startsWith("@@") ?? false) || startsBareRun(lines, i + 2))))

interface Draft {
  oldPath: string | null | undefined
  newPath: string | null | undefined
  renameFrom?: string
  renameTo?: string
  copyFrom?: string
  copyTo?: string
  similarity?: number
  oldMode?: string
  newMode?: string
  newFile: boolean
  deletedFile: boolean
  binary: boolean
  hunks: DiffHunk[]
  qualifies: boolean
}

/** A `\ No newline at end of file` marker belongs to the line before it. */
const markNoNewline = (out: DiffLine[]) => {
  const last = out.at(-1)
  if (last) out[out.length - 1] = { ...last, noNewline: true }
}

/**
 * Loose mode: takes the body lines from `from` (see `bodyEnds`) into `out`, numbering from the given
 * counters, and gives back the blank lines at its end, which belong to the text that follows. Returns the
 * index after the last line taken.
 */
const takeLoose = (lines: ReadonlyArray<string>, from: number, bare: boolean, out: DiffLine[], oldStart: number, newStart: number): number => {
  let oldLine = oldStart
  let newLine = newStart
  let i = from
  for (; !bodyEnds(lines, i, bare); i++) {
    const line = lines[i]!
    if (line.startsWith("\\")) markNoNewline(out)
    else if (line.startsWith("+")) out.push({ kind: "add", text: line.slice(1), newLine: newLine++ })
    else if (line.startsWith("-")) out.push({ kind: "remove", text: line.slice(1), oldLine: oldLine++ })
    else out.push({ kind: "context", text: line.slice(1), oldLine: oldLine++, newLine: newLine++ })
  }
  while (i > from && lines[i - 1] === "") {
    out.pop()
    i--
  }
  return i
}

const countKind = (hunks: ReadonlyArray<DiffHunk>, kind: DiffLine["kind"]): number => hunks.reduce((n, h) => n + h.lines.filter((l) => l.kind === kind).length, 0)

/**
 * Reads the hunks starting at `at` (a hunk header); returns them and the index after the last. Loose
 * (`parseDiffBlock`) it also reads what follows a hunk's counts, an `@@` line with no ranges, and, when
 * `allowBare` and the first thing there is a run of bare lines, that run as a hunk with no header.
 */
const readHunks = (lines: ReadonlyArray<string>, at: number, loose = false, allowBare = false): { hunks: DiffHunk[]; next: number } => {
  const hunks: DiffHunk[] = []
  let i = at
  for (;;) {
    const match = HUNK.exec(lines[i] ?? "")
    if (!match) {
      const bare = loose && allowBare && hunks.length === 0 && startsBareRun(lines, i)
      if (!loose || !(bare || lines[i]?.startsWith("@@"))) break
      const out: DiffLine[] = []
      const header = bare ? "" : lines[i]!
      i = takeLoose(lines, bare ? i : i + 1, true, out, 1, 1)
      const oldLines = out.filter((l) => l.kind !== "add").length
      const newLines = out.filter((l) => l.kind !== "remove").length
      hunks.push({ header, oldStart: 1, oldLines, newStart: 1, newLines, section: "", unnumbered: true, lines: out })
      continue
    }
    const oldStart = Number(match[1])
    let oldLines = match[2] === undefined ? 1 : Number(match[2])
    const newStart = Number(match[3])
    let newLines = match[4] === undefined ? 1 : Number(match[4])
    const out: DiffLine[] = []
    let oldLeft = oldLines
    let newLeft = newLines
    let oldLine = oldStart
    let newLine = newStart
    const header = lines[i]!
    i++
    while (i < lines.length && (oldLeft > 0 || newLeft > 0)) {
      const line = lines[i]!
      if (line.startsWith("\\")) {
        markNoNewline(out)
      } else if (line.startsWith("diff --git ") || startsFile(lines, i, loose)) {
        break
      } else if ((line === "" || line.startsWith(" ")) && oldLeft > 0 && newLeft > 0) {
        out.push({ kind: "context", text: line.slice(1), oldLine: oldLine++, newLine: newLine++ })
        oldLeft--
        newLeft--
      } else if (line.startsWith("+") && newLeft > 0) {
        out.push({ kind: "add", text: line.slice(1), newLine: newLine++ })
        newLeft--
      } else if (line.startsWith("-") && oldLeft > 0) {
        out.push({ kind: "remove", text: line.slice(1), oldLine: oldLine++ })
        oldLeft--
      } else {
        break
      }
      i++
    }
    // A marker after the last line of the hunk belongs to it too.
    while (lines[i]?.startsWith("\\")) {
      markNoNewline(out)
      i++
    }
    if (loose) {
      // Counts that are off: whatever else follows that still looks like part of the hunk is part of it.
      const counted = out.length
      i = takeLoose(lines, i, false, out, oldLine, newLine)
      if (out.length > counted) {
        oldLines = out.filter((l) => l.kind !== "add").length
        newLines = out.filter((l) => l.kind !== "remove").length
      }
    }
    hunks.push({ header, oldStart, oldLines, newStart, newLines, section: (match[5] ?? "").trim(), lines: out })
  }
  return { hunks, next: i }
}

const finish = (draft: Draft, gitLine: readonly [string, string] | null, sides: readonly [string | null, string | null] | null): DiffFile => {
  const renamed = draft.renameFrom !== undefined || draft.copyFrom !== undefined
  const from = draft.renameFrom ?? draft.copyFrom
  const to = draft.renameTo ?? draft.copyTo
  const [oldPath, newPath] =
    renamed && from !== undefined && to !== undefined
      ? [from, to]
      : withoutPrefixes(sides ?? (gitLine ? [gitLine[0], gitLine[1]] : [null, null]))
  const status: DiffStatus =
    draft.renameFrom !== undefined ? "renamed" : draft.copyFrom !== undefined ? "copied" : draft.newFile || oldPath === null ? "added" : draft.deletedFile || newPath === null ? "deleted" : "modified"
  const additions = countKind(draft.hunks, "add")
  const deletions = countKind(draft.hunks, "remove")
  return {
    path: newPath ?? oldPath ?? "",
    oldPath: status === "added" ? null : oldPath,
    newPath: status === "deleted" ? null : newPath,
    status,
    binary: draft.binary,
    ...(draft.similarity !== undefined ? { similarity: draft.similarity } : {}),
    ...(draft.oldMode ? { oldMode: draft.oldMode } : {}),
    ...(draft.newMode ? { newMode: draft.newMode } : {}),
    additions,
    deletions,
    hunks: draft.hunks,
  }
}

const emptyDraft = (): Draft => ({ oldPath: undefined, newPath: undefined, newFile: false, deletedFile: false, binary: false, hunks: [], qualifies: false })

/** One file of a `diff --git` diff starting at `at`, or null when its header carries no change. */
const readGitFile = (lines: ReadonlyArray<string>, at: number, loose: boolean): { file: DiffFile; next: number } | null => {
  const draft = emptyDraft()
  const gitLine = gitLinePaths(lines[at]!.slice("diff --git ".length))
  let sides: [string | null, string | null] | null = null
  let i = at + 1
  while (i < lines.length && EXTENDED.test(lines[i]!)) {
    const line = lines[i]!
    if (line.startsWith("Binary files ")) {
      draft.binary = true
      draft.qualifies = true
      const both = /^Binary files (.*) and (.*) differ$/.exec(line)
      if (both) sides = [devNull(pathOf(both[1]!)), devNull(pathOf(both[2]!))]
    } else if (line === "GIT binary patch") {
      draft.binary = true
      draft.qualifies = true
      i++
      while (i < lines.length && BINARY_BLOCK.test(lines[i]!)) i++
      continue
    } else if (line.startsWith("old mode ")) {
      draft.oldMode = line.slice("old mode ".length)
      draft.qualifies = true
    } else if (line.startsWith("new mode ")) {
      draft.newMode = line.slice("new mode ".length)
      draft.qualifies = true
    } else if (line.startsWith("new file mode ")) {
      draft.newFile = true
      draft.newMode = line.slice("new file mode ".length)
      draft.qualifies = true
    } else if (line.startsWith("deleted file mode ")) {
      draft.deletedFile = true
      draft.oldMode = line.slice("deleted file mode ".length)
      draft.qualifies = true
    } else if (line.startsWith("rename from ")) {
      draft.renameFrom = pathOf(line.slice("rename from ".length))
      draft.qualifies = true
    } else if (line.startsWith("rename to ")) {
      draft.renameTo = pathOf(line.slice("rename to ".length))
    } else if (line.startsWith("copy from ")) {
      draft.copyFrom = pathOf(line.slice("copy from ".length))
      draft.qualifies = true
    } else if (line.startsWith("copy to ")) {
      draft.copyTo = pathOf(line.slice("copy to ".length))
    } else if (line.startsWith("similarity index ")) {
      const percent = /^(\d+)%/.exec(line.slice("similarity index ".length))?.[1]
      if (percent) draft.similarity = Number(percent)
      draft.qualifies = true
    }
    i++
  }
  let headed = false
  if (lines[i]?.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) {
    sides = [devNull(pathOf(lines[i]!.slice(4))), devNull(pathOf(lines[i + 1]!.slice(4)))]
    i += 2
    headed = true
  }
  const read = readHunks(lines, i, loose, headed)
  if (read.hunks.length > 0) {
    draft.hunks = read.hunks
    draft.qualifies = true
    i = read.next
  }
  return draft.qualifies ? { file: finish(draft, gitLine, sides), next: i } : null
}

/** One file of a plain `diff -u` diff starting at `at` (the `---` line, already known to be followed by `+++` and a hunk). */
const readPlainFile = (lines: ReadonlyArray<string>, at: number, loose: boolean): { file: DiffFile; next: number } => {
  const draft = emptyDraft()
  const sides: [string | null, string | null] = [devNull(pathOf(lines[at]!.slice(4))), devNull(pathOf(lines[at + 1]!.slice(4)))]
  const read = readHunks(lines, at + 2, loose, true)
  draft.hunks = read.hunks
  return { file: finish(draft, null, sides), next: read.next }
}

/** Loose mode: hunks with no file header, from an `@@` line or a run of bare lines at `at`; every hunk that follows joins them. */
const readHeaderless = (lines: ReadonlyArray<string>, at: number): { file: DiffFile; next: number } | null => {
  if (!lines[at]!.startsWith("@@") && !startsBareRun(lines, at)) return null
  const read = readHunks(lines, at, true, true)
  if (read.hunks.length === 0) return null
  const file: DiffFile = {
    path: "",
    oldPath: null,
    newPath: null,
    status: "modified",
    binary: false,
    additions: countKind(read.hunks, "add"),
    deletions: countKind(read.hunks, "remove"),
    hunks: read.hunks,
    headerless: true,
  }
  return { file, next: read.next }
}

const parse = (text: string, loose: boolean): ParsedDiff => {
  const lines = text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
  if (lines.at(-1) === "") lines.pop()
  const parts: DiffPart[] = []
  const files: DiffFile[] = []
  let pending: string[] = []
  const flush = () => {
    const first = pending.findIndex((l) => l.trim() !== "")
    if (first !== -1) {
      const last = pending.findLastIndex((l) => l.trim() !== "")
      parts.push({ kind: "text", text: pending.slice(first, last + 1).join("\n") })
    }
    pending = []
  }
  // Loose mode: a run of bare lines that holds no change is text, and so is every line inside it.
  let noRunBefore = 0
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    let read = line.startsWith("diff --git ") ? readGitFile(lines, i, loose) : startsFile(lines, i, loose) ? readPlainFile(lines, i, loose) : null
    if (!read && loose && i >= noRunBefore) {
      read = readHeaderless(lines, i)
      if (!read && line !== "" && !line.startsWith("\\") && !bodyEnds(lines, i, true)) noRunBefore = bareRunEnd(lines, i)
    }
    if (read) {
      flush()
      parts.push({ kind: "file", file: read.file })
      files.push(read.file)
      i = read.next
    } else {
      pending.push(line)
      i++
    }
  }
  flush()
  return { parts, files }
}

/**
 * Parses unified-diff text, strictly. Everything that isn't part of a file (a note above the diff, a patch
 * email's header and stat block, a signature after it) comes back as `text` parts, in order.
 */
export const parseUnifiedDiff = (text: string): ParsedDiff => parse(text, false)

/**
 * Parses the text of a block someone fenced as a diff (```diff, ```patch): what `parseUnifiedDiff` reads,
 * the same way, and also hunks without file headers (a file with no name), a hunk whose counts are off,
 * and runs of bare `+`/`-` lines. Anything that isn't a change is still `text`. Not for deciding that a
 * text is a diff: that is `isUnifiedDiff`'s.
 */
export const parseDiffBlock = (text: string): ParsedDiff => parse(text, true)

/** True when `text` holds at least one file of a unified diff. */
export const isUnifiedDiff = (text: string): boolean => parseUnifiedDiff(text).files.length > 0

/** `files` counts the files that have a name; hunks without a file header add to the line counts only. */
export const diffTotals = (files: ReadonlyArray<DiffFile>): { files: number; additions: number; deletions: number } => ({
  files: files.filter((f) => f.headerless !== true).length,
  additions: files.reduce((n, f) => n + f.additions, 0),
  deletions: files.reduce((n, f) => n + f.deletions, 0),
})

/** The changed and context lines of a file, hunk headers not counted. */
export const fileLineCount = (file: DiffFile): number => file.hunks.reduce((n, h) => n + h.lines.length, 0)

/** A file over this many lines starts folded. Agent diffs are usually small; folding sooner hides what you came to read. */
export const DIFF_LARGE_FILE_LINES = 1500
/** Once this many lines are shown, every file after starts folded. */
export const DIFF_SHOWN_BUDGET = 5000

/**
 * Which files start folded: the large ones, and every one after the budget of shown lines is spent. A
 * file with no header has nothing to fold by, so it is never folded, but its lines count toward the budget.
 */
export const foldedAtStart = (files: ReadonlyArray<DiffFile>): ReadonlyArray<boolean> => {
  let shown = 0
  return files.map((file) => {
    const lines = fileLineCount(file)
    if (file.headerless === true) {
      shown += lines
      return false
    }
    if (lines > DIFF_LARGE_FILE_LINES || shown >= DIFF_SHOWN_BUDGET) return true
    shown += lines
    return false
  })
}

/** One row of the split view: the old line on the left, the new on the right, either side empty. */
export interface SplitRow {
  readonly left: DiffLine | null
  readonly right: DiffLine | null
}

/**
 * The split view's rows for a hunk. A context line sits on both sides. A run of removed lines followed
 * by a run of added ones pairs row by row (the changed lines face each other); the longer run's
 * leftovers face an empty cell, as do removed lines not followed by added ones and added lines alone.
 */
export const splitRows = (hunk: DiffHunk): ReadonlyArray<SplitRow> => {
  const rows: SplitRow[] = []
  const lines = hunk.lines
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (line.kind === "context") {
      rows.push({ left: line, right: line })
      i++
      continue
    }
    const removed: DiffLine[] = []
    while (lines[i]?.kind === "remove") removed.push(lines[i++]!)
    const added: DiffLine[] = []
    while (lines[i]?.kind === "add") added.push(lines[i++]!)
    for (let row = 0; row < Math.max(removed.length, added.length); row++) {
      rows.push({ left: removed[row] ?? null, right: added[row] ?? null })
    }
  }
  return rows
}
