// Labels in the CLI (CEL-56): `cello task label CEL-12 +board -ui` and `cello label list`. The pure parts:
// reading the changes, matching names (with close matches for a typo), label groups (CEL-52) and the list's text.
import { type Label, LABEL_GROUP_NAMES, LABEL_GROUPS, type LabelGroup } from "@cello/contract/entities"
import type { LabelList } from "@cello/contract/views"
import { andList, columns, plural } from "./format.ts"

const FLAGS = new Set(["--json", "--help", "-h"])

/**
 * `cello task label CEL-1 +board -ui` as the parser can take it: `-ui` would read as the flags -u -i,
 * so the changes go after a `--`, with the flags before the key. Other commands pass through.
 */
export const labelArgs = (args: ReadonlyArray<string>): ReadonlyArray<string> => {
  if (args[0] !== "task" || args[1] !== "label") return args
  const rest = args.slice(2)
  if (rest.includes("--") || rest.some((a) => a === "--help" || a === "-h")) return args
  const flags = rest.filter((a) => FLAGS.has(a))
  const [key, ...changes] = rest.filter((a) => !FLAGS.has(a))
  if (key === undefined) return args
  return ["task", "label", ...flags, key, ...(changes.length ? ["--", ...changes] : [])]
}

export interface Changes {
  readonly add: ReadonlyArray<string>
  readonly remove: ReadonlyArray<string>
}

/** `+name` adds, `-name` removes; names in lower case, each once. A string is the reason they can't be read. */
export const parseChanges = (tokens: ReadonlyArray<string>): Changes | string => {
  if (tokens.length === 0) return "Say which labels to add and remove, e.g. `cello task label CEL-12 +board -ui`."
  const add: string[] = []
  const remove: string[] = []
  for (const token of tokens) {
    const sign = token[0]
    const name = token.slice(1).trim().toLowerCase()
    if (sign !== "+" && sign !== "-") {
      return `Each change starts with + to add a label or - to remove one, e.g. +board -ui; "${token}" has neither.`
    }
    if (name === "") return `"${token}" names no label: write ${sign}board to ${sign === "+" ? "add" : "remove"} board.`
    const list = sign === "+" ? add : remove
    if (!list.includes(name)) list.push(name)
  }
  return { add, remove }
}

/** Edit distance between two strings (insertions, deletions, substitutions). */
const distance = (a: string, b: string): number => {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    previous = current
  }
  return previous[b.length]!
}

/** Up to three names close to `name`: a typo away (two for names of six letters or more), or containing it (or it them), closest first. */
export const closeMatches = (name: string, names: ReadonlyArray<string>): ReadonlyArray<string> => {
  const wanted = name.toLowerCase()
  const allowed = Math.max(1, Math.floor(wanted.length / 3))
  return names
    .map((candidate) => {
      const lower = candidate.toLowerCase()
      const contains = Math.min(lower.length, wanted.length) >= 3 && (lower.includes(wanted) || wanted.includes(lower))
      const score = contains ? Math.abs(lower.length - wanted.length) / 10 : distance(wanted, lower)
      return { candidate, score, close: contains || distance(wanted, lower) <= allowed }
    })
    .filter((m) => m.close)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((m) => m.candidate)
}

/**
 * The labels `changes` names, from a workspace's live labels. Unknown names are refused together,
 * each with its close matches: nothing is ever created implicitly.
 */
export const resolveChanges = (
  changes: Changes,
  labels: ReadonlyArray<Label>,
): { readonly add: ReadonlyArray<Label>; readonly remove: ReadonlyArray<Label> } | string => {
  const find = (name: string) => labels.find((l) => l.name.toLowerCase() === name.toLowerCase())
  const unknown = [...changes.add, ...changes.remove].filter((name) => find(name) === undefined)
  if (unknown.length) {
    const names = labels.map((l) => l.name)
    const parts = unknown.map((name, i) => {
      const close = closeMatches(name, names)
      return `${i === 0 ? "No label named" : "none named"} "${name}"${close.length ? ` (did you mean ${close.join(" or ")}?)` : ""}`
    })
    return `${andList(parts)}. Nothing was changed. Labels: ${names.join(", ") || "none yet"}. ` +
      "Make a new one with `cello label create <name>`."
  }
  return { add: changes.add.map((n) => find(n)!), remove: changes.remove.map((n) => find(n)!) }
}

/** A task's labels by name, in its order; archived labels (missing from `labels`) are left out, as on the cards. */
export const labelNames = (task: { readonly labelIds: ReadonlyArray<string> }, labels: ReadonlyArray<Label>): ReadonlyArray<string> =>
  task.labelIds.flatMap((id) => labels.filter((l) => l.id === id && l.archivedAt === null).map((l) => l.name))

const counts = (key: string, tasks: number, otherProjects: number) => {
  const parts = [...(tasks ? [`${plural(tasks, "task")} in ${key}`] : []), ...(otherProjects ? [`${otherProjects} in other projects`] : [])]
  return parts.join(" · ")
}

/** `--group area`, in any case, and `other` for none (what every screen calls it); a string is the reason it can't be read. */
export const parseGroup = (value: string): LabelGroup | string => {
  const wanted = value.trim().toLowerCase()
  const group = LABEL_GROUPS.find((g) => g === wanted || LABEL_GROUP_NAMES[g].toLowerCase() === wanted)
  return group ?? `No group named "${value}". Groups: ${LABEL_GROUPS.join(", ")} (shown as ${LABEL_GROUP_NAMES.none}). Nothing was changed.`
}

/** How a group reads after a label's colour: "Kind", "Other". */
export const groupWord = (group: LabelGroup): string => LABEL_GROUP_NAMES[group]

const GROUP_HEADINGS = LABEL_GROUP_NAMES

/**
 * `cello label list`: live labels with colour and counts, then the archived ones on one line. Once any
 * label has a group (CEL-52), each group gets a heading, in LABEL_GROUPS' order, the ungrouped last.
 */
export const labelListText = (list: LabelList): string => {
  const key = list.project.key
  if (list.labels.length === 0) return `No labels yet in ${key}'s workspace. Make one with \`cello label create <name> --color #3B82F6\`.`
  const archived = list.labels.filter((l) => l.label.archivedAt !== null)
  const live = list.labels
    .filter((l) => l.label.archivedAt === null)
    .sort((a, b) => LABEL_GROUPS.indexOf(a.label.group) - LABEL_GROUPS.indexOf(b.label.group))
  const rows = columns(live.map((l) => [l.label.name, l.label.color, counts(key, l.tasks, l.otherProjects) || "no tasks"]))
  const grouped = live.some((l) => l.label.group !== "none")
  const lines = grouped
    ? live.flatMap((l, i) => {
      const heading = i === 0 || live[i - 1]!.label.group !== l.label.group
        ? [...(i === 0 ? [] : [""]), GROUP_HEADINGS[l.label.group]]
        : []
      return [...heading, `  ${rows[i]}`]
    })
    : rows
  if (archived.length) {
    const names = archived.map((l) => {
      const n = counts(key, l.tasks, l.otherProjects)
      return n ? `${l.label.name} (${n})` : l.label.name
    })
    lines.push(...(lines.length ? [""] : []), `Archived (hidden from cards and pickers; tasks keep the link): ${names.join(", ")}`)
  }
  return lines.join("\n")
}
