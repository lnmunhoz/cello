// `cello init --agents-md`: the "Tracking work in Cello" section for a repo's AGENTS.md or CLAUDE.md.
// Its text lives once, in docs/cli.md ("Set up a repo for Cello", between the agents-md markers);
// the command reads it from `cello guide`'s generated copy of that doc, so the two can't drift.
import * as fs from "node:fs"
import * as path from "node:path"

const START = "<!-- agents-md:start -->"
const END = "<!-- agents-md:end -->"

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

/** `current` with `section` appended after a blank line, unless it already has a "Tracking work in Cello" heading. */
export const withAgentsSection = (current: string, section: string): { readonly text: string; readonly changed: boolean } => {
  if (current.split("\n").some((line) => line.trim() === AGENTS_HEADING)) return { text: current, changed: false }
  const gap = current === "" || current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n"
  return { text: `${current}${gap}${section}\n`, changed: true }
}

/** Where the section goes in a checkout: AGENTS.md if there is one, else CLAUDE.md (created when missing). */
export const agentsFile = (checkoutRoot: string): string => {
  const agents = path.join(checkoutRoot, "AGENTS.md")
  return fs.existsSync(agents) ? agents : path.join(checkoutRoot, "CLAUDE.md")
}

/**
 * Adds the section for project `key` to the checkout's agents file; changes nothing when it's there.
 * Only appends, so whatever the file holds stays byte for byte (a symlinked CLAUDE.md stays a link).
 */
export const addAgentsSection = (checkoutRoot: string, doc: string, key: string): { readonly file: string; readonly changed: boolean } => {
  const file = agentsFile(checkoutRoot)
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
  const next = withAgentsSection(current, agentsSection(doc, key))
  if (next.changed) fs.appendFileSync(file, next.text.slice(current.length))
  return { file, changed: next.changed }
}
