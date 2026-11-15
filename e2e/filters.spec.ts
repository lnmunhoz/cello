// CEL-52: the filter panel on the Issues tab. Labels in their groups (any within a group, all across),
// Area cut to its busiest 6 until Show all, "An agent" opening into the sessions holding claims, and
// the filter kept per project on this device, shared by board and list, a link winning over it.
import { spawnSync } from "node:child_process"
import * as path from "node:path"
import type { Locator, Page } from "@playwright/test"
import type { LabelGroup } from "../packages/contract/src/entities.ts"
import { newCommandId, openClient, type PromiseClient } from "../packages/client/test/support/promiseClient.ts"
import { AREA_GROUPS, KIND_COLORS } from "../scripts/apply-cel56-labels.ts"
import { caption, captionWithUrl, defaultWorkspace, expect, seedProject, test, uniqueKey } from "./fixtures.ts"
import { SHOTS, WEB_URL } from "./packets.ts"

/** CEL-56's labels with their colours and groups, and the milestones. */
const LABELS: ReadonlyArray<{ name: string; color: string; group: LabelGroup }> = [
  ...Object.entries(KIND_COLORS).map(([name, color]) => ({ name, color, group: "kind" as const })),
  ...Object.values(AREA_GROUPS).flatMap((g) => g.areas.map((name) => ({ name, color: g.color, group: "area" as const }))),
  { name: "M2", color: "#26B5CE", group: "milestone" },
  { name: "M3", color: "#26B5CE", group: "milestone" },
]

/** Thirty of Cello's own tasks, labelled as CEL-56 does; the last ones are claimed below. */
const TASKS: ReadonlyArray<readonly [title: string, status: "Done" | "Todo", labels: ReadonlyArray<string>]> = [
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

/** An agent session over RPC, as the CLI would call: its session id, and its process's pid. */
const agentAs = (baseURL: string, session: string, pid: number) =>
  openClient(`${baseURL.replace(/^http/, "ws")}/rpc`, { "x-cello-session": session, "x-cello-client": "Claude Code", "x-cello-pid": String(pid) })

/** The labels in the default workspace, in their groups: reused when another test made one (in any case). */
async function seedLabels(cello: PromiseClient) {
  const { workspaceId, labels: existing } = await defaultWorkspace(cello)
  const ids = new Map<string, string>()
  for (const wanted of LABELS) {
    const found = existing.find((l) => l.name.toLowerCase() === wanted.name.toLowerCase() && l.archivedAt === null)
    if (found && found.group !== wanted.group) await cello.run((c) => c["label.update"]({ commandId: newCommandId(), id: found.id, group: wanted.group }))
    const id = found?.id ?? (await cello.run((c) => c["label.create"]({ commandId: newCommandId(), workspaceId, ...wanted }))).result.id
    ids.set(wanted.name, id)
  }
  return ids
}

/**
 * A project with the thirty tasks. Sessions 8a41c9e2 and 3f07b1d4 (live) hold 26–27 and 28–29, session
 * c19e55a0 (its process already gone) holds 30, and Lucas holds 24.
 */
async function seed(cello: PromiseClient, baseURL: string, prefix: string) {
  const key = uniqueKey(prefix)
  const project = await seedProject(cello, "Cello", key)
  const { statuses } = await defaultWorkspace(cello)
  const labels = await seedLabels(cello)
  for (const [title, status, names] of TASKS) {
    await cello.run((c) =>
      c["task.create"]({ commandId: newCommandId(), projectId: project.id, title, statusId: statuses[status]!.id, labelIds: names.map((n) => labels.get(n)!) }))
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

const panel = (page: Page) => page.getByRole("complementary", { name: "Filters" })
const option = (page: Page, id: string) => panel(page).locator(`[data-facet-option="${id}"]`)
const tick = async (page: Page, id: string, checked: "true" | "false" | "mixed") => {
  await option(page, id).click()
  await expect(option(page, id)).toHaveAttribute("aria-checked", checked)
}

/** Expects exactly these tasks on the board (or the list), by number. */
async function expectShown(items: Locator, key: string, numbers: ReadonlyArray<number>) {
  await expect(items).toHaveCount(numbers.length)
  const keys = await items.evaluateAll((els) => els.map((el) => el.getAttribute("data-task-key")))
  expect(keys.sort()).toEqual(numbers.map((n) => `${key}-${n}`).sort())
}
const boardCards = (page: Page) => page.locator("[data-agent-board] [data-task-key]")
const listRows = (page: Page) => page.locator('[data-layout="list"] [data-task-key]')

test.beforeEach(async ({ context }) => {
  // Agent cursors off, so claimed cards change in place.
  await context.addInitScript(() => {
    if (localStorage.getItem("cello:agent-cursors") === null) localStorage.setItem("cello:agent-cursors", "off")
  })
})

test("CEL-52: filter the board by kind and area: a bug and an area show the bugs in that area; Show all lists every area, and a picked one stays", async ({ page, cello, baseURL }) => {
  const { key } = await seed(cello, baseURL!, "FLT")
  await page.goto(`/${key}/issues`)
  await expectShown(boardCards(page), key, Array.from({ length: 30 }, (_, i) => i + 1))

  await caption(page, "The filter panel: labels in Kind, Area and Milestone, each with how many tasks it would show")
  await expect(panel(page).locator('[data-label-group="kind"] [data-facet-option]')).toHaveCount(5)
  await expect(option(page, "label-bug").locator("[data-facet-count]")).toHaveText("6")
  // The 6 busiest areas, by task count across the project.
  await expect(panel(page).locator('[data-label-group="area"] [data-facet-option]')).toHaveText(
    ["agents9", "board8", "cli8", "server4", "pages3", "review3"],
  )

  await caption(page, "Tick bug: only the 6 bugs stay, every column says how many of its cards match")
  await tick(page, "label-bug", "true")
  await expectShown(boardCards(page), key, [12, 13, 14, 15, 16, 17])
  await expect(page.locator('section[data-column="Todo"] [data-column-count]')).toHaveText(/^6 \/ \d+$/)
  await expect(panel(page).locator("[data-filter-result]")).toHaveText("6 of 30 tasks")
  // Counts move with the filter: agents now counts the bugs in agents.
  await expect(option(page, "label-agents").locator("[data-facet-count]")).toHaveText("2")

  await caption(page, "Tick agents too: a kind and an area match together, so it's the bugs in agents")
  await tick(page, "label-agents", "true")
  await expectShown(boardCards(page), key, [16, 17])

  await caption(page, "Tick board as well: two areas match either, so bugs in agents or on the board")
  await tick(page, "label-board", "true")
  await expectShown(boardCards(page), key, [15, 16, 17])
  // Rows don't move while filtering: the areas keep their project-wide order.
  await expect(panel(page).locator('[data-label-group="area"] [data-facet-option]').first()).toHaveAttribute("data-facet-option", "label-agents")

  await caption(page, "Clear all, then Show all 15: the other 9 areas, A to Z, under the top 6")
  await panel(page).getByRole("button", { name: "Clear all" }).click()
  await expectShown(boardCards(page), key, Array.from({ length: 30 }, (_, i) => i + 1))
  await panel(page).getByRole("button", { name: "Show all 15" }).click()
  await expect(panel(page).locator('[data-label-group="area"] [data-facet-option]')).toHaveCount(15)
  await expect(panel(page).locator('[data-label-group="area"] [data-facet-option]').nth(6)).toHaveAttribute("data-facet-option", "label-data")

  await caption(page, "Pick desktop, then Show fewer: a picked area always shows, even outside the top 6")
  await tick(page, "label-desktop", "true")
  await expectShown(boardCards(page), key, [15, 20])
  await panel(page).getByRole("button", { name: "Show fewer" }).click()
  await expect(panel(page).locator('[data-label-group="area"] [data-facet-option]')).toHaveCount(7)
  await expect(option(page, "label-desktop")).toHaveAttribute("aria-checked", "true")

  await caption(page, "Untick it: every task is back, and desktop goes back behind Show all")
  await option(page, "label-desktop").click()
  await expectShown(boardCards(page), key, Array.from({ length: 30 }, (_, i) => i + 1))
  await expect(option(page, "label-desktop")).toHaveCount(0)
  await expect(panel(page).locator('[data-label-group="area"] [data-facet-option]')).toHaveCount(6)
})

test("CEL-52: filter by who's working on it: An agent opens into the sessions holding claims, with their presence; ticking some makes its box a dash", async ({ page, cello, baseURL }) => {
  // The server notices the gone session's process within 30 s: this test waits for it once, at the end.
  test.setTimeout(Math.max(test.info().timeout, 90_000))
  const { key } = await seed(cello, baseURL!, "WHO")
  await page.goto(`/${key}/issues`)
  await expectShown(boardCards(page), key, Array.from({ length: 30 }, (_, i) => i + 1))

  await caption(page, "Working on it: An agent, Lucas, Nobody. The dots beside An agent are the sessions holding claims")
  await expect(option(page, "who-agent").locator("[data-facet-count]")).toHaveText("5")
  await expect(panel(page).locator("[data-session-dots]")).toBeVisible()

  await caption(page, "Tick An agent: the five tasks agents hold")
  await tick(page, "who-agent", "true")
  await expectShown(boardCards(page), key, [26, 27, 28, 29, 30])

  await caption(page, "Untick it, and open the sessions: each one with its presence, the panel a little wider")
  await tick(page, "who-agent", "false")
  await panel(page).getByRole("button", { name: "Show agent sessions" }).click()
  await expect(option(page, "session-8a41c9e2")).toContainText("Claude Code · 8a41c9e2")
  await expect(option(page, "session-8a41c9e2")).toContainText("active now")
  await expect(option(page, "session-3f07b1d4")).toContainText("active now")
  await expect(option(page, "session-c19e55a0")).toBeVisible()

  await caption(page, "Tick session 8a41c9e2: only its two tasks, and An agent's box turns into a dash")
  await tick(page, "session-8a41c9e2", "true")
  await expectShown(boardCards(page), key, [26, 27])
  await expect(option(page, "who-agent")).toHaveAttribute("aria-checked", "mixed")

  await caption(page, "Add session 3f07b1d4: both sessions' tasks; still some of the agents")
  await tick(page, "session-3f07b1d4", "true")
  await expectShown(boardCards(page), key, [26, 27, 28, 29])
  await expect(option(page, "who-agent")).toHaveAttribute("aria-checked", "mixed")

  await caption(page, "Tick Lucas as well: his task joins them")
  await tick(page, "who-human", "true")
  await expectShown(boardCards(page), key, [24, 26, 27, 28, 29])

  await caption(page, "Untick Lucas and add the last session: every session ticked is An agent")
  await tick(page, "who-human", "false")
  await tick(page, "session-c19e55a0", "true")
  await expect(option(page, "who-agent")).toHaveAttribute("aria-checked", "true")
  await expectShown(boardCards(page), key, [26, 27, 28, 29, 30])

  await caption(page, "Within 30 s the server notices session c19e55a0's process is gone: its row says ended, last")
  await expect(option(page, "session-c19e55a0")).toContainText("ended", { timeout: 45_000 })
  await expect(panel(page).locator('[data-facet-option^="session-"]').last()).toHaveAttribute("data-facet-option", "session-c19e55a0")
})

test("CEL-52: the filter is kept per project across a reload, shared by the board and the list, and a link with a filter wins", async ({ page, cello, baseURL }) => {
  const { key, k } = await seed(cello, baseURL!, "KEEP")
  await page.goto(`/${key}/issues`)
  await expectShown(boardCards(page), key, Array.from({ length: 30 }, (_, i) => i + 1))

  await captionWithUrl(page, "Tick bug: the URL carries the filter")
  await tick(page, "label-bug", "true")
  await expectShown(boardCards(page), key, [12, 13, 14, 15, 16, 17])
  await expect(page).toHaveURL(/label=bug/)

  await captionWithUrl(page, "Reload: the filter stays")
  await page.reload()
  await expectShown(boardCards(page), key, [12, 13, 14, 15, 16, 17])
  await expect(option(page, "label-bug")).toHaveAttribute("aria-checked", "true")

  await captionWithUrl(page, "Switch to the list: the same filter, and only the groups with a match")
  await page.getByRole("button", { name: /^Display/ }).click()
  await page.getByRole("radio", { name: "List" }).click()
  await page.keyboard.press("Escape")
  await expectShown(listRows(page), key, [12, 13, 14, 15, 16, 17])
  await expect(page.locator('[data-layout="list"] section[data-group]')).toHaveCount(1)
  await expect(page.locator('section[data-group="Todo"] [data-group-count]')).toHaveText(/^6 \/ \d+$/)

  await captionWithUrl(page, "Come back to the project with no filter in the address: the kept filter shows")
  await page.goto(`/${key}/issues?layout=list`)
  await expectShown(listRows(page), key, [12, 13, 14, 15, 16, 17])
  await expect(page).not.toHaveURL(/label=/)

  await captionWithUrl(page, "Open a link with another filter (polish): the link wins")
  await page.goto(`/${key}/issues?label=polish`)
  await expectShown(boardCards(page), key, [20, 24, 30])
  await expect(option(page, "label-polish")).toHaveAttribute("aria-checked", "true")
  await expect(option(page, "label-bug")).toHaveAttribute("aria-checked", "false")

  await captionWithUrl(page, "Open one of its tasks and close it: the link's filter stays on screen")
  await page.locator(`[data-task-key="${k(24)}"]`).click()
  await expect(page.getByRole("complementary", { name: `${k(24)} details` })).toBeVisible()
  await expectShown(boardCards(page), key, [20, 24, 30])
  await page.getByRole("button", { name: "Close task" }).click()
  await expect(page.getByRole("complementary", { name: `${k(24)} details` })).toBeHidden()
  await expectShown(boardCards(page), key, [20, 24, 30])

  await captionWithUrl(page, "Clear all, and reload: no filter is kept")
  await panel(page).getByRole("button", { name: "Clear all" }).click()
  await expectShown(boardCards(page), key, Array.from({ length: 30 }, (_, i) => i + 1))
  await page.goto(`/${key}/issues`)
  await expectShown(boardCards(page), key, Array.from({ length: 30 }, (_, i) => i + 1))
  await expect(panel(page).getByRole("button", { name: "Clear all" })).toHaveCount(0)
})

test("CEL-52: screenshots of the filter panel, light and dark", async ({ browser, cello, baseURL }) => {
  const { key } = await seed(cello, baseURL!, "SHOT")
  for (const colorScheme of ["light", "dark"] as const) {
    // Its own unrecorded window, so the screenshots show no test cursor or captions.
    const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 }, colorScheme })
    await context.addInitScript(() => localStorage.setItem("cello:agent-cursors", "off"))
    const page = await context.newPage()
    const shot = async (name: string) => {
      // No row left hovered by the last click.
      await page.mouse.move(1430, 890)
      await page.screenshot({ path: path.join(SHOTS, `cel-52-${name}-${colorScheme}.png`) })
    }

    await page.goto(`/${key}/issues`)
    await expectShown(boardCards(page), key, Array.from({ length: 30 }, (_, i) => i + 1))
    await shot("board")

    await page.goto(`/${key}/issues?label=bug,agents`)
    await expectShown(boardCards(page), key, [16, 17])
    await shot("bugs-in-agents")

    await page.goto(`/${key}/issues?label=desktop`)
    await panel(page).getByRole("button", { name: "Show all 15" }).click()
    await expect(panel(page).locator('[data-label-group="area"] [data-facet-option]')).toHaveCount(15)
    await shot("show-all-areas")

    await page.goto(`/${key}/issues?session=${await sessionId(cello, "8a41c9e2-filters")}`)
    await expectShown(boardCards(page), key, [26, 27])
    await expect(option(page, "session-8a41c9e2")).toHaveAttribute("aria-checked", "true")
    // Working on it at the top of the panel, so the sessions are in view.
    await panel(page).locator('[data-facet="holder"]').evaluate((el) => el.scrollIntoView({ block: "start" }))
    await shot("one-session")

    await page.goto(`/${key}/issues?layout=list&label=bug`)
    await expectShown(listRows(page), key, [12, 13, 14, 15, 16, 17])
    await shot("list-bugs")
    await context.close()
  }
})

/** A session's id on the board, from its host's session id. */
async function sessionId(cello: PromiseClient, external: string) {
  const snapshot = await cello.run((c) => c["snapshot.get"]({}))
  return snapshot.sessions.find((s) => s.externalId === external)!.id
}
