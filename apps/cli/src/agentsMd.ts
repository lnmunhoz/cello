// `cello init --agents-md`: the "Tracking work in Cello" section for a repo's AGENTS.md or CLAUDE.md.
// Its text lives once, in docs/cli.md ("Set up a repo for Cello", between the agents-md markers);
// the command reads it from `cello guide`'s generated copy of that doc, so the two can't drift.
//
// In the repo's file the section sits between Cello's own markers (CEL-61), so a later run puts the
// current text in its place. The start marker carries a fingerprint of the text written: when what's
// between the markers is no longer exactly that (someone's notes, another project's key), the old file
// is kept in a .bak first. A section from before the markers is recognised by its heading and its
// words (it mentions `cello guide` or `cello context`) and replaced the same way, with a .bak kept;
// a "Tracking work in Cello" section that doesn't read like Cello's is left alone. A .bak already
// there is never overwritten (.bak.1, .bak.2…).
import * as fs from "node:fs"
import * as path from "node:path"
import { writeFileAtomically } from "./claudeSettings.ts"

const START = "<!-- agents-md:start -->"
const END = "<!-- agents-md:end -->"

/** The markers around the section in a repo's AGENTS.md or CLAUDE.md; Cello writes the start one with a fingerprint (agentsBlock). */
export const AGENTS_START = "<!-- cello:agents-md:start -->"
export const AGENTS_END = "<!-- cello:agents-md:end -->"

export const AGENTS_HEADING = "## Tracking work in Cello"

/** The section between `doc`'s agents-md markers: unindented, without its code fence, with `KEY` replaced by `key`. */
export const agentsSection = (doc: string, key: string): string => {
  const start = doc.indexOf(START)
  const end = doc.indexOf(END)
  if (start === -1 || end === -1 || end < start) throw new Error(`docs/cli.md needs the ${START} and ${END} markers`)
  const lines = doc.slice(start + START.length, end).split("\n").filter((line) => !/^\s*```/.test(line))
  const indent = Math.min(...lines.filter((l) => l.trim() !== "").map((l) => l.length - l.trimStart().length))
  return lines.map((l) => l.slice(indent)).join("\n").trim().replace(/\bKEY\b/g, key)
}

/** A heading at any level that starts with "Tracking work in Cello" ("### Tracking work in Cello", "## Tracking work in Cello (THAI)"). */
const HEADING = /^\s{0,3}#{1,6}\s+tracking work in cello\b/i

/** An ATX heading ("## Title", "#### Release notes"), any level. */
const ATX_HEADING = /^\s{0,3}#{1,6}(\s|$)/

/** A setext underline ("=====" or "-----" under a line of text). */
const SETEXT_UNDERLINE = /^\s{0,3}(=+|-+)\s*$/

/** A thematic break: three or more `-`, `*` or `_`, spaces allowed between them. */
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/

/** Words only Cello's own section uses. */
const CELLO_WORDS = /`cello (guide|context)\b/

/**
 * What a run does to the file: added the section (none there), updated it between the markers,
 * replaced an old unmarked Cello section, found it already current, or found a section by that name
 * that isn't Cello's and left it.
 */
export type AgentsChange = "added" | "updated" | "replaced" | "unchanged" | "foreign"

/** Indexes of the lines outside code fences, so a `# comment` in a bash block isn't taken for a heading. */
const outsideFences = (lines: ReadonlyArray<string>): ReadonlyArray<boolean> => {
  let fenced = false
  return lines.map((line) => {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      fenced = !fenced
      return false
    }
    return !fenced
  })
}

/**
 * The old unmarked section: from its heading up to whatever starts something else, so nothing after it
 * is lost: the next heading of any level, a setext heading (its text line stays outside), a `---`
 * rule, or the end. Lines inside code fences don't count; trailing blank lines are left out.
 */
const oldSection = (lines: ReadonlyArray<string>): { readonly from: number; readonly to: number } | null => {
  const plain = outsideFences(lines)
  const from = lines.findIndex((line, i) => plain[i] && HEADING.test(line))
  if (from === -1) return null
  let to = lines.length
  for (let i = from + 1; i < lines.length; i++) {
    if (!plain[i]) continue
    const line = lines[i]!
    const underlines = SETEXT_UNDERLINE.test(line) && i - 1 > from && plain[i - 1] && lines[i - 1]!.trim() !== ""
    if (underlines) {
      to = i - 1
      break
    }
    if (ATX_HEADING.test(line) || RULE.test(line)) {
      to = i
      break
    }
  }
  while (to > from + 1 && lines[to - 1]!.trim() === "") to--
  return { from, to }
}

/** A short fingerprint of a section's text, so a later run can tell whether anyone changed what it wrote. */
const fingerprint = (section: string) => new Bun.CryptoHasher("sha256").update(section).digest("hex").slice(0, 12)

/** A start marker, with the fingerprint it carries (none on a marker typed by hand). */
const START_MARKER = /^<!-- cello:agents-md:start(?: sha256:([0-9a-f]{12}))? -->$/

/** The section as a repo's file holds it: between the markers, the start one carrying its fingerprint. */
export const agentsBlock = (section: string): string =>
  [`<!-- cello:agents-md:start sha256:${fingerprint(section)} -->`, section, AGENTS_END].join("\n")

/** The project key a section names ("project **THAI**"), if any. */
const keyOf = (section: string) => /project \*\*([^*\s]+)\*\*/.exec(section)?.[1] ?? null

/**
 * `current` with the current `section` in it, in the file's own line endings (CRLF when it uses
 * them): between the markers when they're there, in place of an old Cello section, else appended
 * after a blank line. `before` is the section the file had (null when there was none of Cello's).
 * Markers it can't pair are an error: it won't guess where the section ends.
 */
export const withAgentsSection = (
  current: string,
  section: string,
): { readonly text: string; readonly change: AgentsChange; readonly before: string | null; readonly backup: boolean } => {
  const eol = current.includes("\r\n") ? "\r\n" : "\n"
  const lines = current.split(/\r?\n/)
  const block = agentsBlock(section).split("\n")
  const starts = lines.flatMap((line, i) => (START_MARKER.test(line.trim()) ? [i] : []))
  const ends = lines.flatMap((line, i) => (line.trim() === AGENTS_END ? [i] : []))
  if (starts.length > 0 || ends.length > 0) {
    if (starts.length !== 1 || ends.length !== 1 || ends[0]! < starts[0]!) {
      throw new Error(`it has ${AGENTS_START} and ${AGENTS_END} markers that don't make one pair; fix them by hand`)
    }
    const before = lines.slice(starts[0]! + 1, ends[0]!).join("\n").trim()
    if (before === section) return { text: current, change: "unchanged", before, backup: false }
    // Exactly what an earlier run wrote, for this project, needs no copy; anything else (notes someone
    // added, a block typed by hand, another project's key) is kept in a .bak.
    const written = START_MARKER.exec(lines[starts[0]!]!.trim())?.[1] === fingerprint(before)
    const sameProject = keyOf(before) === keyOf(section)
    const next = [...lines.slice(0, starts[0]!), ...block, ...lines.slice(ends[0]! + 1)]
    return { text: next.join(eol), change: "updated", before, backup: !(written && sameProject) }
  }
  const old = oldSection(lines)
  if (old !== null) {
    const before = lines.slice(old.from, old.to).join("\n")
    if (!CELLO_WORDS.test(before)) return { text: current, change: "foreign", before: null, backup: false }
    const next = [...lines.slice(0, old.from), ...block, ...lines.slice(old.to)]
    return { text: next.join(eol), change: "replaced", before, backup: true }
  }
  const gap = current === "" || current.endsWith(eol + eol) ? "" : current.endsWith(eol) ? eol : eol + eol
  return { text: `${current}${gap}${block.join(eol)}${eol}`, change: "added", before: null, backup: false }
}

/** The lines taken out ("- …") and put in ("+ …") going from `before` to `after`, in order; unchanged and blank lines left out. */
export const lineDiff = (before: string, after: string): ReadonlyArray<string> => {
  const a = before.split("\n")
  const b = after.split("\n")
  // Longest common subsequence, from the end: common[i][j] is its length for a[i..] and b[j..].
  const common = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      common[i]![j] = a[i] === b[j] ? common[i + 1]![j + 1]! + 1 : Math.max(common[i + 1]![j]!, common[i]![j + 1]!)
    }
  }
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i++
      j++
    } else if (j >= b.length || (i < a.length && common[i + 1]![j]! >= common[i]![j + 1]!)) {
      out.push(`- ${a[i++]}`)
    } else {
      out.push(`+ ${b[j++]}`)
    }
  }
  return out.filter((line) => line.length > 2 && line.slice(2).trim() !== "")
}

/** Whether there's anything at `file`, a symlink to nothing included. */
const present = (file: string) => fs.lstatSync(file, { throwIfNoEntry: false }) !== undefined

/** Where the section goes in a checkout: AGENTS.md if there is one, else CLAUDE.md (created when missing). */
export const agentsFile = (checkoutRoot: string): string => {
  const agents = path.join(checkoutRoot, "AGENTS.md")
  return present(agents) ? agents : path.join(checkoutRoot, "CLAUDE.md")
}

export interface AgentsResult {
  readonly file: string
  readonly changed: boolean
  readonly change: AgentsChange
  /** The old file's copy: kept when an old unmarked section was replaced, or the marked text wasn't exactly what Cello wrote. */
  readonly backup: string | null
  /** What changed in the section (see lineDiff); empty when it was added or left. */
  readonly diff: ReadonlyArray<string>
}

/**
 * Puts the current section for project `key` in the checkout's agents file. Adding it only appends,
 * so whatever the file holds stays byte for byte; updating or replacing it rewrites the file
 * atomically (a symlinked CLAUDE.md stays a link), with a .bak when text that isn't an earlier render
 * of Cello's goes.
 * A symlink to nothing is refused: writing would create its target, maybe outside the repo.
 */
export const addAgentsSection = (checkoutRoot: string, doc: string, key: string): AgentsResult => {
  const file = agentsFile(checkoutRoot)
  if (present(file) && !fs.existsSync(file)) {
    throw new Error(`${path.basename(file)} is a symlink to ${fs.readlinkSync(file)}, which doesn't exist`)
  }
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
  const section = agentsSection(doc, key)
  const next = withAgentsSection(current, section)
  const diff = next.before === null || next.change === "unchanged" ? [] : lineDiff(next.before, section)
  const result = { file, changed: false, change: next.change, backup: null, diff }
  if (next.change === "added") {
    fs.appendFileSync(file, next.text.slice(current.length))
    return { ...result, changed: true }
  }
  if (next.change === "updated" || next.change === "replaced") {
    // An earlier .bak is never overwritten: the copy goes to the first free .bak, .bak.1, .bak.2…
    return { ...result, changed: true, backup: writeFileAtomically(file, next.text, { backup: next.backup ? "new" : false }).backup }
  }
  return result
}
