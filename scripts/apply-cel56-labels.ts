// CEL-56: puts the approved labels on the CEL board, through the `cello` CLI only.
//
//   bun scripts/apply-cel56-labels.ts [--project CEL] [--dry-run]
//
// 1. Creates the 5 kinds and 15 areas, with the page's colours (kinds one colour each, areas one
//    quieter colour per group), and recolours `server`, which stays as an area.
// 2. Labels every task in the table below with its kind and areas: it adds what's missing, and takes
//    off `ui` and any kind or area the table doesn't give it. Other labels (M2, M3) are left alone.
//    A task the table doesn't list only loses `ui`.
// 3. Archives `ui`.
//
// Running it again changes nothing: every step checks first. --dry-run prints what it would do.
// CELLO_CLI names the command to run ("cello" by default; "bun apps/cli/src/bin.ts" from source),
// and CELLO_PORT the server, as for `cello` itself. The proposal it applies:
// http://127.0.0.1:4747/CEL/pages/labels-for-cel-what-part-of-cello-and-what-kind-of-work

export const KIND_COLORS = {
  feature: "#3B82F6",
  bug: "#EF4444",
  polish: "#8B5CF6",
  chore: "#6B7280",
  docs: "#14B8A6",
} as const
export type Kind = keyof typeof KIND_COLORS

/** Areas in three groups, each with one quieter colour, so a card with three labels isn't a rainbow. */
export const AREA_GROUPS = {
  "app screens": { color: "#5B9A74", areas: ["board", "list", "task-panel", "review", "pages", "sidebar", "search", "viewer"] },
  agents: { color: "#C08552", areas: ["agents", "cli"] },
  "under the hood": { color: "#8D7B68", areas: ["server", "data", "desktop", "tests", "release"] },
} as const
export type Area = (typeof AREA_GROUPS)[keyof typeof AREA_GROUPS]["areas"][number]

/** Every label this script manages, with its colour: the kinds, then the areas. */
export const LABELS: ReadonlyArray<{ readonly name: string; readonly color: string }> = [
  ...Object.entries(KIND_COLORS).map(([name, color]) => ({ name, color })),
  ...Object.values(AREA_GROUPS).flatMap((g) => g.areas.map((name) => ({ name, color: g.color }))),
]

/** The label being replaced by the areas. */
export const RETIRED = "ui"

export interface Row {
  readonly kind: Kind
  readonly areas: ReadonlyArray<Area>
}

const row = (kind: Kind, ...areas: Area[]): Row => ({ kind, areas })

/** The page's table, task by task. CEL-40 (canceled) is left out, as on the page. */
export const TABLE: Readonly<Record<string, Row>> = {
  "CEL-1": row("chore", "agents", "board", "server"),
  "CEL-2": row("feature", "board", "server"),
  "CEL-3": row("feature", "cli"),
  "CEL-4": row("feature", "agents", "server"),
  "CEL-5": row("feature", "agents", "board", "task-panel"),
  "CEL-6": row("feature", "agents", "board"),
  "CEL-7": row("feature", "list", "search"),
  "CEL-8": row("chore", "server", "cli", "release"),
  "CEL-9": row("polish", "board"),
  "CEL-10": row("feature", "review", "cli"),
  "CEL-11": row("feature", "search", "cli", "server"),
  "CEL-12": row("feature", "viewer"),
  "CEL-13": row("feature", "pages", "cli"),
  "CEL-14": row("feature", "desktop", "viewer"),
  "CEL-15": row("feature", "agents", "cli"),
  "CEL-16": row("bug", "tests"),
  "CEL-17": row("bug", "server"),
  "CEL-18": row("chore", "server", "cli"),
  "CEL-19": row("bug", "pages"),
  "CEL-20": row("feature", "task-panel", "pages"),
  "CEL-21": row("feature", "board", "list"),
  "CEL-22": row("polish", "review"),
  "CEL-23": row("feature", "data", "cli"),
  "CEL-24": row("feature", "sidebar"),
  "CEL-25": row("bug", "board", "desktop"),
  "CEL-26": row("feature", "pages"),
  "CEL-27": row("polish", "desktop", "sidebar"),
  "CEL-28": row("feature", "agents"),
  "CEL-29": row("chore", "tests"),
  "CEL-30": row("docs", "cli"),
  "CEL-31": row("chore", "tests"),
  "CEL-32": row("feature", "tests"),
  "CEL-33": row("polish", "tests", "agents"),
  "CEL-34": row("feature", "agents"),
  "CEL-35": row("feature", "agents", "board"),
  "CEL-36": row("chore", "release"),
  "CEL-37": row("feature", "release", "desktop"),
  "CEL-38": row("polish", "review"),
  "CEL-39": row("feature", "task-panel"),
  "CEL-41": row("feature", "cli"),
  "CEL-42": row("feature", "pages"),
  "CEL-43": row("feature", "search"),
  "CEL-44": row("feature", "review", "pages"),
  "CEL-45": row("feature", "agents"),
  "CEL-46": row("feature", "agents", "cli"),
  "CEL-47": row("feature", "review", "agents", "cli"),
  "CEL-48": row("polish", "pages"),
  "CEL-49": row("polish", "task-panel"),
  "CEL-50": row("feature", "release"),
  "CEL-51": row("chore", "desktop", "release"),
  "CEL-52": row("feature", "board", "list"),
  "CEL-53": row("feature", "agents"),
  "CEL-54": row("bug", "pages", "desktop"),
  "CEL-55": row("feature", "agents"),
  // Made after the page was written; labelled the same way.
  "CEL-56": row("feature", "cli"),
  "CEL-57": row("feature", "agents", "cli"),
}

const MANAGED = new Set([...LABELS.map((l) => l.name), RETIRED])
const KINDS = new Set(Object.keys(KIND_COLORS))

/** What to add to and take off a task that has `current` (lower-case names), given its row (or none). */
export const planTask = (current: ReadonlyArray<string>, wanted: Row | undefined): { add: string[]; remove: string[] } => {
  if (wanted === undefined) return { add: [], remove: current.filter((name) => name === RETIRED) }
  const desired: ReadonlyArray<string> = [wanted.kind, ...wanted.areas]
  return {
    add: desired.filter((name) => !current.includes(name)),
    remove: current.filter((name) => MANAGED.has(name) && !desired.includes(name)),
  }
}

/** Runs one `cello` command and returns what it printed, or the failure it printed. */
export type Cli = (args: ReadonlyArray<string>) => Promise<{ readonly out: string; readonly failure: string | null }>

interface ListedLabel {
  readonly label: { readonly id: string; readonly name: string; readonly color: string; readonly archivedAt: number | null }
  readonly tasks: number
  readonly otherProjects: number
}
interface ListedTask {
  readonly key: string
  readonly labelIds: ReadonlyArray<string>
}

/** Applies the labels; returns one line per change made (or that would be, with `dryRun`). */
export const apply = async (cli: Cli, options: { readonly project: string; readonly dryRun: boolean }): Promise<string[]> => {
  const { project, dryRun } = options
  const lines: string[] = []
  const call = async (args: ReadonlyArray<string>) => {
    const { out, failure } = await cli(args)
    if (failure !== null) throw new Error(`cello ${args.join(" ")} failed: ${failure}`)
    return out
  }
  const json = async <T>(args: ReadonlyArray<string>): Promise<T> => JSON.parse(await call([...args, "--json"])) as T
  const change = async (line: string, args: ReadonlyArray<string>) => {
    lines.push(dryRun ? `Would: ${line}` : line)
    if (!dryRun) await call(args)
  }
  const labelList = () => json<{ labels: ReadonlyArray<ListedLabel> }>(["label", "list", "--project", project]).then((l) => l.labels)

  // 1. The labels, with their colours.
  const before = await labelList()
  for (const wanted of LABELS) {
    const found = before.find((l) => l.label.name.toLowerCase() === wanted.name)
    if (found === undefined) {
      await change(`created label ${wanted.name} ${wanted.color}`, ["label", "create", wanted.name, "--color", wanted.color, "--project", project])
    } else if (found.label.archivedAt !== null) {
      throw new Error(`The label ${found.label.name} is archived, so it can't be used. Ask Lucas: there's no unarchive yet.`)
    } else if (found.label.color.toUpperCase() !== wanted.color) {
      await change(`recoloured label ${found.label.name} ${found.label.color} → ${wanted.color}`, [
        "label", "update", found.label.name, "--color", wanted.color, "--project", project,
      ])
    }
  }

  // 2. Every task, whatever its status.
  const names = new Map((await labelList()).filter((l) => l.label.archivedAt === null).map((l) => [l.label.id, l.label.name.toLowerCase()]))
  const statuses = (await json<{ statuses: ReadonlyArray<{ name: string }> }>(["context", "--project", project])).statuses
  const tasks: ListedTask[] = []
  for (const status of statuses) {
    tasks.push(...(await json<{ tasks: ReadonlyArray<ListedTask> }>(["task", "list", "--project", project, "--status", status.name])).tasks)
  }
  const byNumber = (a: ListedTask, b: ListedTask) => Number(a.key.split("-")[1]) - Number(b.key.split("-")[1])
  const unlabelled: string[] = []
  for (const task of tasks.sort(byNumber)) {
    const current = task.labelIds.flatMap((id) => names.get(id) ?? [])
    const { add, remove } = planTask(current, TABLE[task.key])
    if (add.length || remove.length) {
      const changes = [...add.map((n) => `+${n}`), ...remove.map((n) => `-${n}`)]
      await change(`${task.key} ${changes.join(" ")}`, ["task", "label", task.key, ...changes])
    }
    if (TABLE[task.key] === undefined && !current.some((n) => KINDS.has(n))) unlabelled.push(task.key)
  }

  // 3. Retire `ui`.
  const retired = (await labelList()).find((l) => l.label.name.toLowerCase() === RETIRED)
  if (retired !== undefined && retired.label.archivedAt === null) {
    await change(`archived label ${retired.label.name}`, ["label", "archive", retired.label.name, "--project", project])
    if (retired.otherProjects) {
      lines.push(`Note: ${retired.otherProjects} tasks in other projects of the workspace carried ${RETIRED}; archiving hides it on them too.`)
    }
  }

  if (lines.length === 0) lines.push(`Nothing to change: ${project}'s labels already match the CEL-56 table.`)
  if (unlabelled.length) lines.push(`Not in the table, so without a kind: ${unlabelled.join(", ")}. Label them with \`cello task label\`.`)
  return lines
}

/** `cello` as a process: CELLO_CLI, or `cello` on the PATH. */
const processCli = (command: ReadonlyArray<string>): Cli => async (args) => {
  const proc = Bun.spawn([...command, ...args], { stdout: "pipe", stderr: "pipe", env: process.env })
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  return { out: out.trimEnd(), failure: code === 0 ? null : err.trim() || `exit code ${code}` }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const at = args.indexOf("--project")
  const project = at === -1 ? "CEL" : args[at + 1] ?? "CEL"
  const command = (process.env.CELLO_CLI ?? "cello").split(/\s+/).filter(Boolean)
  try {
    const lines = await apply(processCli(command), { project, dryRun: args.includes("--dry-run") })
    console.log(lines.join("\n"))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
