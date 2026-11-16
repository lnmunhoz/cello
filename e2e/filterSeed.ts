// CEL-52: the board the filter specs share: thirty of Cello's own tasks with CEL-56's grouped labels and
// the milestones M2, M3 and M4 (CEL-113), some claimed by agent sessions (two live, one whose process is
// gone) and one by Lucas.
import { spawnSync } from "node:child_process"
import type { LabelGroup } from "../packages/contract/src/entities.ts"
import { newCommandId, type PromiseClient } from "../packages/client/test/support/promiseClient.ts"
import { AREA_GROUPS, KIND_COLORS } from "../scripts/apply-cel56-labels.ts"
import { agentAs, defaultWorkspace, seedProject, uniqueKey } from "./fixtures.ts"

/** CEL-56's labels with their colours and groups. */
const LABELS: ReadonlyArray<{ name: string; color: string; group: LabelGroup }> = [
  ...Object.entries(KIND_COLORS).map(([name, color]) => ({ name, color, group: "kind" as const })),
  ...Object.values(AREA_GROUPS).flatMap((g) => g.areas.map((name) => ({ name, color: g.color, group: "area" as const }))),
]

/** The project's milestones in order (CEL-113); M4 has no tasks. A task listing one of these names is in it. */
export const MILESTONES = ["M2", "M3", "M4"] as const

/** Thirty of Cello's own tasks, labelled as CEL-56 does, three in a milestone; the last ones are claimed below. */
export const TASKS: ReadonlyArray<readonly [title: string, status: "Done" | "Todo", labels: ReadonlyArray<string>]> = [
  ["M0 spikes: identity, drag, cursor, Effect", "Done", ["chore", "agents", "board", "server"]],
  ["M1 local board", "Done", ["feature", "board", "server", "M2"]],
  ["cello CLI: task create, claim, move, comment", "Done", ["feature", "cli"]],
  ["Agent sessions from CLAUDE_CODE_SESSION_ID", "Done", ["feature", "agents", "server"]],
  ["Provenance on cards and task detail", "Done", ["feature", "agents", "board", "task-panel"]],
  ["Agent cursors and the animation queue", "Done", ["feature", "agents", "board"]],
  ["Basic list layout and cello search", "Done", ["feature", "list", "search"]],
  ["Review packets: evidence on tasks and a Review queue", "Done", ["feature", "review", "cli"]],
  ["Viewer side panel: evidence, pages and links next to the board", "Done", ["feature", "viewer"]],
  ["Pages: agents publish reports into Cello", "Done", ["feature", "pages", "cli"]],
  ["Comments reach agents: inbox, hook delivery, clickable links", "Done", ["feature", "agents", "cli"]],
  ["Flaky e2e: a review test failed once in a full run", "Todo", ["bug", "tests"]],
  ["Server hangs on SIGTERM while a board tab is connected", "Todo", ["bug", "server"]],
  ["Page reader: Mermaid boxes wrap too narrow", "Todo", ["bug", "pages"]],
  ["Empty space under the app when the board scrolls sideways", "Todo", ["bug", "board", "desktop"]],
  ["The hook delivers the same comment twice after a reconnect", "Todo", ["bug", "agents", "cli"]],
  ["An agent cursor stalls when two agents move cards at once", "Todo", ["bug", "agents", "board"]],
  ["Backups of the database and evidence", "Todo", ["feature", "data", "cli", "M2"]],
  ["Sidebar: collapse and resize", "Todo", ["feature", "sidebar"]],
  ["Use the new app icon everywhere", "Todo", ["polish", "desktop", "sidebar"]],
  ["Run e2e and desktop tests in Docker", "Todo", ["chore", "tests"]],
  ["CLI reference for agents in docs/cli.md", "Todo", ["docs", "cli"]],
  ["Release management: versions, changelog and releases", "Todo", ["chore", "release", "M3"]],
  ["Review page uses the screen width", "Todo", ["polish", "review"]],
  ["Task panel: expand button opens the task as a full page", "Todo", ["feature", "task-panel"]],
  ["Needs input: agents ask Lucas on the card", "Todo", ["feature", "review", "agents", "cli"]],
  ["Cards show when an agent session is working on them", "Todo", ["feature", "agents", "board"]],
  ["Build history: every deploy with what changed", "Todo", ["feature", "release"]],
  ["Filter the board and list by label and more", "Todo", ["feature", "board", "list"]],
  ["Diagrams open in the zoomable image modal", "Todo", ["polish", "pages"]],
]

/** The project's labels (each project has its own, CEL-80), in their groups. */
async function seedGroupedLabels(cello: PromiseClient, projectId: string) {
  const ids = new Map<string, string>()
  for (const wanted of LABELS) {
    ids.set(wanted.name, (await cello.run((c) => c["label.create"]({ commandId: newCommandId(), projectId, ...wanted }))).result.id)
  }
  return ids
}

/**
 * A project with the thirty tasks. Sessions 8a41c9e2 and 3f07b1d4 (live) hold 26–27 and 28–29, session
 * c19e55a0 (its process already gone) holds 30, and Lucas holds 24.
 */
export async function seedFilterBoard(cello: PromiseClient, baseURL: string, prefix: string, name = "Cello") {
  const key = uniqueKey(prefix)
  const project = await seedProject(cello, name, key)
  const { statuses } = await defaultWorkspace(cello)
  const labels = await seedGroupedLabels(cello, project.id)
  const milestones = new Map<string, string>()
  for (const name of MILESTONES) {
    milestones.set(name, (await cello.run((c) => c["milestone.create"]({ commandId: newCommandId(), projectId: project.id, name }))).result.id)
  }
  for (const [title, status, names] of TASKS) {
    const milestoneId = names.flatMap((n) => milestones.get(n) ?? [])[0]
    await cello.run((c) =>
      c["task.create"]({
        commandId: newCommandId(),
        projectId: project.id,
        title,
        statusId: statuses[status]!.id,
        labelIds: names.filter((n) => !milestones.has(n)).map((n) => labels.get(n)!),
        ...(milestoneId ? { milestoneId } : {}),
      }))
  }
  const k = (n: number) => `${key}-${n}`
  const first = await agentAs(baseURL, "8a41c9e2-filters", process.pid)
  const second = await agentAs(baseURL, "3f07b1d4-filters", process.pid)
  const gone = await agentAs(baseURL, "c19e55a0-filters", spawnSync("true").pid!)
  for (const [agent, n] of [[first, 26], [first, 27], [second, 28], [second, 29], [gone, 30]] as const) {
    await agent.run((c) => c["task.claim"]({ commandId: newCommandId(), key: k(n) }))
  }
  await cello.run((c) => c["task.claim"]({ commandId: newCommandId(), key: k(24) }))
  await Promise.all([first.close(), second.close(), gone.close()])
  return { key, k }
}
