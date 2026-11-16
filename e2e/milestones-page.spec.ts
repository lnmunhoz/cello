// CEL-132, CEL-113 phase 2: the Milestones tab, a milestone's own page, and the board grouped by
// milestone. Each test seeds its own project shaped like a real one: M1 closed, M2 nearly done and due in
// 3 days, M3 four days late with an agent at work on it, M4 empty, and open tasks without a milestone.
// Progress is derived on the client from the board's tasks, so every bar here moves as cards move, with
// no reload.
import { type ChildProcess, spawn } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import type { Browser, Locator, Page } from "@playwright/test"
import type { Milestone, Project, Status } from "../packages/contract/src/entities.ts"
import { localDay } from "../packages/shared/src/milestone.ts"
import { agentAs, caption, card, defaultWorkspace, expect, hold, newCommandId, seedProject, taskPanel, test, uniqueKey } from "./fixtures.ts"
import type { PromiseClient } from "../packages/client/test/support/promiseClient.ts"
import { SHOTS, WEB_URL } from "./packets.ts"

const children: ChildProcess[] = []
test.afterAll(() => {
  for (const child of children) child.kill()
})

/** A day `days` from today, as the app's due dates are written. */
const inDays = (days: number) => localDay(Date.now() + days * 86_400_000)

const row = (page: Page, name: string) => page.locator(`[data-milestone-row="${name}"]`)
const rowNames = (page: Page) => page.locator("[data-milestone-row] [data-milestone-name]")
const lane = (page: Page, name: string) => page.locator(`section[data-lane="${name}"]`)
const laneColumn = (page: Page, laneName: string, status: string) => lane(page, laneName).locator(`section[data-column="${status}"]`)

interface Seeded {
  readonly project: Project
  readonly key: string
  readonly statuses: Record<string, Status>
  readonly m: Record<"M1" | "M2" | "M3" | "M4", Milestone>
  /** Task keys by title. */
  readonly tasks: Record<string, string>
}

/**
 * A project with four milestones and tasks in each status; an agent session (its process a child of this
 * test) claims M3's In Progress task and builds, so M3's row shows its mark.
 */
async function seed(rpc: PromiseClient, baseURL: string, prefix: string, name: string): Promise<Seeded> {
  const key = uniqueKey(prefix)
  const project = await seedProject(rpc, name, key)
  const { statuses } = await defaultWorkspace(rpc)
  const milestone = async (name: string, goal: string, targetDate: string | null) =>
    (await rpc.run((c) => c["milestone.create"]({ commandId: newCommandId(), projectId: project.id, name, goal, targetDate }))).result
  const m = {
    M1: await milestone("M1", "The board", inDays(-20)),
    M2: await milestone("M2", "Review packets", inDays(3)),
    M3: await milestone("M3", "Watching **agents** at work", inDays(-4)),
    M4: await milestone("M4", "Releases", null),
  }
  const plan: ReadonlyArray<readonly [string, string, Milestone | null]> = [
    ["Kanban board", "Done", m.M1],
    ["Retire the old board", "Backlog", m.M1],
    ["Review page", "Done", m.M2],
    ["Evidence videos", "Done", m.M2],
    ["Send back notes", "In Review", m.M2],
    ["Agent marks", "Done", m.M3],
    ["Live agent log", "In Progress", m.M3],
    ["Agents page", "Todo", m.M3],
    ["Burn-up chart", "Backlog", m.M3],
    ["Fix the sidebar width", "Todo", null],
    ["Dark mode contrast", "In Progress", null],
    ["Old cleanup", "Done", null],
  ]
  const tasks: Record<string, string> = {}
  for (const [title, status, ms] of plan) {
    const created = await rpc.run((c) =>
      c["task.create"]({ commandId: newCommandId(), projectId: project.id, title, statusId: statuses[status]!.id, ...(ms ? { milestoneId: ms.id } : {}) })
    )
    tasks[title] = created.result.key
  }
  await rpc.run((c) => c["milestone.close"]({ commandId: newCommandId(), id: m.M1.id }))
  const agentProcess = spawn("sleep", ["600"], { stdio: "ignore" })
  children.push(agentProcess)
  const agent = await agentAs(baseURL, `5b1e${key.toLowerCase()}-milestones`, agentProcess.pid!)
  await agent.run((c) => c["task.claim"]({ commandId: newCommandId(), key: tasks["Live agent log"]! }))
  await agent.run((c) => c["task.stage"]({ commandId: newCommandId(), key: tasks["Live agent log"]!, stage: "building" }))
  return { project, key, statuses, m, tasks }
}

const moveTo = async (rpc: PromiseClient, s: Seeded, title: string, status: string) => {
  const { task } = await rpc.run((c) => c["task.get"]({ key: s.tasks[title]! }))
  await rpc.run((c) => c["task.move"]({ commandId: newCommandId(), id: task.id, statusId: s.statuses[status]!.id }))
}

/** Drags `from` with the mouse to just above or below `to`, in small steps like a person would. */
async function dragTo(page: Page, from: Locator, to: Locator, where: "above" | "below") {
  const a = await from.boundingBox()
  const b = await to.boundingBox()
  if (!a || !b) throw new Error("not on screen")
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, where === "above" ? b.y + 4 : b.y + b.height - 4, { steps: 25 })
  await page.mouse.up()
}

/** Stills of the Milestones tab and of M3's page, in light and dark, in unrecorded windows. */
async function screenshots(browser: Browser, s: Seeded) {
  fs.mkdirSync(SHOTS, { recursive: true })
  for (const colorScheme of ["light", "dark"] as const) {
    const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 }, colorScheme })
    const page = await context.newPage()
    await page.goto(`/${s.key}/milestones`)
    await expect(row(page, "M3")).toContainText("4 days late")
    await page.getByRole("button", { name: "Closed" }).click()
    await expect(page.locator("[data-closed-milestone]").first()).toBeVisible()
    await page.screenshot({ path: path.join(SHOTS, `milestones-page-${colorScheme}.png`) })
    await page.goto(`/${s.key}/milestones/${s.m.M3.id}`)
    await expect(page.locator("[data-milestone-header]")).toContainText("M3")
    await page.screenshot({ path: path.join(SHOTS, `milestone-m3-page-${colorScheme}.png`) })
    await context.close()
  }
}

test("CEL-132: the Milestones tab: bars and numbers, due dates, an agent's mark; a card moving to Done fills the bar; All done: close M2?; drag to reorder; Closed and No milestone", async ({ page, cello: rpc, baseURL, browser }) => {
  test.setTimeout(180_000)
  const s = await seed(rpc, baseURL!, "MSPG", "Milestones tab")

  await page.goto(`/${s.key}/issues`)
  await caption(page, "The project's tabs have Milestones next to Issues")
  await page.getByRole("link", { name: "Milestones", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/${s.key}/milestones$`))

  await caption(page, "The open milestones in their order, each with its goal, its bar and how many are done")
  await expect(rowNames(page)).toHaveText(["M2", "M3", "M4"])
  await expect(row(page, "M2")).toContainText("Review packets")
  await expect(row(page, "M2").locator("[data-progress-text]")).toHaveText("2 of 3 done · 67%")
  await expect(row(page, "M3").locator("[data-progress-text]")).toHaveText("1 of 4 done · 25%")
  await expect(row(page, "M4").locator("[data-progress-text]")).toHaveText("0 of 0 done")
  // M3's bar: Done, In Progress, then Todo, then Backlog as the lighter tail.
  await expect(row(page, "M3").locator("[data-segment]")).toHaveCount(4)
  await expect(row(page, "M3").locator("[data-segment]").last()).toHaveAttribute("data-segment", "backlog")

  await caption(page, "M2 is due in 3 days; M3 is 4 days late, in red; M4 has no date")
  await expect(row(page, "M2").locator("[data-due]")).toHaveText("3 days left")
  await expect(row(page, "M3").locator("[data-due]")).toHaveText("4 days late")
  await expect(row(page, "M3").locator("[data-due]")).toHaveAttribute("data-due", "late")
  await expect(row(page, "M4").locator("[data-due]")).toHaveCount(0)

  await caption(page, "An agent is building a task in M3: its mark shows on M3's row")
  await expect(row(page, "M3").locator("[data-milestone-agents]")).toHaveAttribute("data-milestone-agents", "1")

  await caption(page, "No milestone counts the open tasks without one; M1 is closed, folded at the bottom")
  await expect(page.locator("[data-no-milestone]")).toContainText("No milestone · 2 open tasks")
  await expect(page.locator("[data-closed-milestone]")).toHaveCount(0)
  await page.getByRole("button", { name: "Closed" }).click()
  await expect(page.locator('[data-closed-milestone="M1"] [data-closed-at]')).toHaveText(/^Closed [A-Z][a-z]{2} \d+/)

  await caption(page, "M2's last task moves to Done (as an agent would): its bar fills, and the row asks to close it")
  await moveTo(rpc, s, "Send back notes", "Done")
  await expect(row(page, "M2").locator("[data-progress-text]")).toHaveText("3 of 3 done · 100%")
  await expect(row(page, "M2").locator("[data-close-suggestion]")).toContainText("All done: close M2?")

  await caption(page, "Close M2: it leaves the open list and joins Closed")
  await row(page, "M2").getByRole("button", { name: "Close M2" }).click()
  await expect(rowNames(page)).toHaveText(["M3", "M4"])
  await expect(page.locator('[data-closed-milestone="M2"]')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/${s.key}/milestones$`))

  await caption(page, "Drag M4 above M3: the order changes at once and stays")
  await dragTo(page, row(page, "M4"), row(page, "M3"), "above")
  await expect(rowNames(page)).toHaveText(["M4", "M3"])
  await page.reload()
  await expect(rowNames(page)).toHaveText(["M4", "M3"])

  await caption(page, "By keyboard too: focus M4, Space to pick it up, ↓, Space to drop")
  await row(page, "M4").focus()
  await page.keyboard.press("Space")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Space")
  await expect(rowNames(page)).toHaveText(["M3", "M4"])

  await caption(page, "Reload: the order and the closed list stay")
  await page.reload()
  await expect(rowNames(page)).toHaveText(["M3", "M4"])

  await caption(page, "New milestone: a name, a goal and a target date")
  await page.getByRole("button", { name: "New milestone" }).click()
  const dialog = page.getByRole("dialog", { name: "New milestone" })
  await dialog.getByLabel("Name").fill("M5")
  await dialog.getByLabel("Goal (optional)").fill("Burn-up chart and history")
  await dialog.getByLabel("Target date (optional)").fill(inDays(30))
  await dialog.getByRole("button", { name: "Create milestone" }).click()
  await expect(dialog).toBeHidden()
  await caption(page, "M5 appears last, with its goal, an empty bar and 30 days left")
  await expect(rowNames(page)).toHaveText(["M3", "M4", "M5"])
  await expect(row(page, "M5")).toContainText("Burn-up chart and history")
  await expect(row(page, "M5").locator("[data-due]")).toHaveText("30 days left")
  await expect(row(page, "M5").locator("[data-progress-text]")).toHaveText("0 of 0 done")

  await caption(page, "Open No milestone: its open tasks, grouped by status")
  await page.locator("[data-no-milestone]").click()
  await expect(page.getByRole("heading", { name: "No milestone", level: 1 })).toBeVisible()
  await expect(card(page, s.tasks["Fix the sidebar width"]!)).toBeVisible()
  await expect(card(page, s.tasks["Dark mode contrast"]!)).toBeVisible()
  await expect(card(page, s.tasks["Old cleanup"]!)).toHaveCount(0)

  await screenshots(browser, s)
})

test("CEL-132: a milestone's page: goal, date and bar; its tasks by status; Add a task opens it beside the page, already in M3; Edit; a task reopened after its milestone closed says so", async ({ page, cello: rpc, baseURL }) => {
  test.setTimeout(180_000)
  const s = await seed(rpc, baseURL!, "MSON", "One milestone")

  await page.goto(`/${s.key}/milestones`)
  await caption(page, "Open M3 from its row")
  await row(page, "M3").click()
  await expect(page).toHaveURL(new RegExp(`/${s.key}/milestones/${s.m.M3.id}$`))
  const header = page.locator("[data-milestone-header]")

  await caption(page, "Its header: the name, Open, the target date and how late it is, the goal as markdown, and the bar")
  await expect(header.getByRole("heading", { name: "M3" })).toBeVisible()
  await expect(header.locator("[data-milestone-state]")).toHaveText("Open")
  await expect(header.locator("[data-due]")).toHaveText("4 days late")
  await expect(header.locator("strong")).toHaveText("agents")
  await expect(header.locator("[data-progress-text]")).toHaveText("1 of 4 done · 25%")
  await expect(header).toContainText("1 in progress · 1 to do · 1 in Backlog")

  await caption(page, "Its tasks grouped by status, as the list's rows")
  await expect(page.locator("section[data-group]")).toHaveText([/Backlog/, /Todo/, /In Progress/, /Done/])
  await expect(page.locator('section[data-group="Done"]').locator(`[data-task-key="${s.tasks["Agent marks"]}"]`)).toBeVisible()

  await caption(page, "Add a task: type its title and press Enter")
  await page.getByRole("textbox", { name: "Add a task" }).fill("Milestone agent marks")
  await page.keyboard.press("Enter")
  const added = `${s.key}-13`

  await caption(page, "It opens beside the page, already in M3; its row is in Todo, and M3 counts it")
  await expect(taskPanel(page, added)).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/${s.key}/milestones/${s.m.M3.id}/13`))
  await expect(taskPanel(page, added).getByRole("combobox", { name: "Milestone", exact: true })).toContainText("M3")
  await expect(page.locator('section[data-group="Todo"]').locator(`[data-task-key="${added}"]`)).toBeVisible()
  await expect(header.locator("[data-progress-text]")).toHaveText("1 of 5 done · 20%")

  await caption(page, "Close the task: back to M3's page")
  await taskPanel(page, added).getByRole("button", { name: "Close task" }).click()
  await expect(page).toHaveURL(new RegExp(`/${s.key}/milestones/${s.m.M3.id}$`))
  await expect(taskPanel(page, added)).toHaveCount(0)

  await caption(page, "Edit: a new goal and a later date")
  await header.getByRole("button", { name: "Edit" }).click()
  const dialog = page.getByRole("dialog", { name: "Edit milestone" })
  await dialog.getByLabel("Goal (optional)").fill("See every agent at work")
  await dialog.getByLabel("Target date (optional)").fill(inDays(10))
  await dialog.getByRole("button", { name: "Save" }).click()
  await expect(dialog).toBeHidden()
  await expect(header).toContainText("See every agent at work")
  await expect(header.locator("[data-due]")).toHaveText("10 days left")

  await caption(page, "M2's last task reaches Done: its own page asks to close it")
  await page.goto(`/${s.key}/milestones/${s.m.M2.id}`)
  await expect(header.locator("[data-progress-text]")).toHaveText("2 of 3 done · 67%")
  await expect(header.locator("[data-close-suggestion]")).toHaveCount(0)
  await moveTo(rpc, s, "Send back notes", "Done")
  await expect(header.locator("[data-progress-text]")).toHaveText("3 of 3 done · 100%")
  await expect(header.locator("[data-close-suggestion]")).toContainText("All done: close M2?")
  await caption(page, "Close M2 from the suggestion: the page says Closed")
  await header.locator("[data-close-suggestion]").getByRole("button", { name: "Close M2" }).click()
  await expect(header.locator("[data-milestone-state]")).toHaveText(/^Closed/)
  await expect(header.locator("[data-close-suggestion]")).toHaveCount(0)
  await expect(header.getByRole("button", { name: "Reopen" })).toBeVisible()

  await caption(page, "M1 is closed. Its Backlog task, never Done, is renamed after the close: no warning")
  await page.goto(`/${s.key}/milestones/${s.m.M1.id}`)
  await expect(header.locator("[data-milestone-state]")).toHaveText(/^Closed/)
  await expect(page.getByRole("textbox", { name: "Add a task" })).toHaveCount(0)
  const retire = (await rpc.run((c) => c["task.get"]({ key: s.tasks["Retire the old board"]! }))).task
  await rpc.run((c) => c["task.update"]({ commandId: newCommandId(), id: retire.id, expectedVersion: retire.version, title: "Retire the old board, for good" }))
  await expect(card(page, retire.key)).toContainText("Retire the old board, for good")
  await expect(card(page, retire.key).locator("[data-reopened]")).toHaveCount(0)

  await caption(page, "Its Done task moves back to In Progress after the close")
  await moveTo(rpc, s, "Kanban board", "In Progress")
  await expect(card(page, s.tasks["Kanban board"]!).locator("[data-reopened]")).toHaveText("reopened after M1 closed")
  await caption(page, "The row says it reopened after M1 closed; M1 stays closed until Lucas reopens it")
  await expect(header.locator("[data-milestone-state]")).toHaveText(/^Closed/)
  await header.getByRole("button", { name: "Reopen" }).click()
  await expect(header.locator("[data-milestone-state]")).toHaveText("Open")
  await expect(card(page, s.tasks["Kanban board"]!).locator("[data-reopened]")).toHaveCount(0)
})

/** Room for every column: the sidebar folded to its rail and the filter panel hidden. */
async function roomForColumns(page: Page) {
  await page.getByRole("button", { name: "Collapse sidebar" }).click()
  await page.getByRole("complementary", { name: "Filters" }).getByRole("button", { name: "Hide filters" }).click()
}

async function groupBy(page: Page, grouping: "Milestone" | "Status") {
  await page.getByRole("button", { name: "Display" }).click()
  await page.getByRole("combobox", { name: "Grouping" }).click()
  await page.getByRole("option", { name: grouping, exact: true }).click()
  await page.keyboard.press("Escape")
}

test("CEL-132: the board grouped by milestone: a swimlane each, No milestone last; a card dragged to Done fills its lane's bar; one dragged into M4's lane goes in M4; a closed lane refuses with a toast", async ({ page, cello: rpc, baseURL }) => {
  test.setTimeout(180_000)
  const s = await seed(rpc, baseURL!, "MSBD", "Milestone lanes")

  await page.goto(`/${s.key}/issues`)
  await roomForColumns(page)
  await caption(page, "Display → Grouping → Milestone")
  await groupBy(page, "Milestone")
  await expect(page).toHaveURL(/group=milestone/)

  await caption(page, "A swimlane per open milestone in order, closed M1 (it still has a task), then No milestone; every column fits")
  await expect(page.locator("section[data-lane]")).toHaveCount(5)
  await expect(page.locator("section[data-lane] > header")).toHaveText([/^M2/, /^M3/, /^M4/, /^M1/, /^No milestone/])
  await expect(lane(page, "M2").locator("[data-progress-text]")).toHaveText("2 of 3 done · 67%")
  await expect(laneColumn(page, "M2", "Done")).toBeInViewport({ ratio: 1 })

  await caption(page, `Drag ${s.tasks["Send back notes"]} from In Review to Done in M2's lane: the lane's bar fills`)
  await dragTo(page, card(page, s.tasks["Send back notes"]!), laneColumn(page, "M2", "Done").locator('[role="list"]'), "below")
  await expect(laneColumn(page, "M2", "Done").locator(`[data-task-key="${s.tasks["Send back notes"]}"]`)).toBeVisible()
  await expect(lane(page, "M2").locator("[data-progress-text]")).toHaveText("3 of 3 done · 100%")

  const moving = s.tasks["Agents page"]!
  await caption(page, `Scroll down to M4's lane, then drag ${moving} from M3's Todo into M4's: it goes in M4, and both bars follow`)
  // M4's lane mid-screen, not at the bottom edge, where a slow drag would scroll the board under the pointer.
  await lane(page, "M4").evaluate((el) => el.scrollIntoView({ block: "center" }))
  await dragTo(page, card(page, moving), laneColumn(page, "M4", "Todo").locator('[role="list"]'), "below")
  await expect(laneColumn(page, "M4", "Todo").locator(`[data-task-key="${moving}"]`)).toBeVisible()
  await expect(card(page, moving).locator("[data-card-milestone]")).toHaveText("M4")
  await expect(lane(page, "M4").locator("[data-progress-text]")).toHaveText("0 of 1 done · 0%")
  await expect(lane(page, "M3").locator("[data-progress-text]")).toHaveText("1 of 3 done · 33%")

  await caption(page, `Drag ${moving} into closed M1's lane: refused, with a toast; it stays in M4`)
  await lane(page, "M1").evaluate((el) => el.scrollIntoView({ block: "center" }))
  await dragTo(page, card(page, moving), laneColumn(page, "M1", "Todo").locator('[role="list"]'), "below")
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("M1 is closed: reopen it on its page to put tasks in it.")).toBeVisible()
  await expect(laneColumn(page, "M4", "Todo").locator(`[data-task-key="${moving}"]`)).toBeVisible()

  await caption(page, "Scroll to the end: No milestone is the last lane")
  await page.locator("[data-agent-board]").evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
  await expect(lane(page, "No milestone")).toBeInViewport({ ratio: 1 })
  await hold(page)
  await hold(page)

  await caption(page, "Reload: still grouped by milestone, every card where it was dropped")
  await page.reload()
  await expect(page.locator("section[data-lane]")).toHaveCount(5)
  await expect(laneColumn(page, "M4", "Todo").locator(`[data-task-key="${moving}"]`)).toBeVisible()

  await caption(page, "Grouping → Status: the board is one row of columns again")
  await groupBy(page, "Status")
  await expect(page.locator("section[data-lane]")).toHaveCount(0)
})

test.describe("in dark mode", () => {
  test.use({ colorScheme: "dark" })

  test("CEL-132, dark: the Milestones tab, then the board grouped by milestone with a card moved into another lane", async ({ page, cello: rpc, baseURL }) => {
    test.setTimeout(180_000)
    const s = await seed(rpc, baseURL!, "MSDK", "Milestones in the dark")

    await page.goto(`/${s.key}/milestones`)
    await page.getByRole("button", { name: "Collapse sidebar" }).click()
    await caption(page, "The Milestones tab in dark mode: each bar on a visible track, the counts lined up")
    await expect(rowNames(page)).toHaveText(["M2", "M3", "M4"])
    await expect(row(page, "M3").locator("[data-milestone-agents-text]")).toHaveText("1 agent working")
    await hold(page)

    await caption(page, "The board, grouped by milestone")
    await page.getByRole("link", { name: "Issues", exact: true }).click()
    await page.getByRole("complementary", { name: "Filters" }).getByRole("button", { name: "Hide filters" }).click()
    await groupBy(page, "Milestone")
    await expect(page.locator("section[data-lane]")).toHaveCount(5)

    const moving = s.tasks["Agents page"]!
    await caption(page, `Drag ${moving} from M3's Todo into M4's: it goes in M4, and both lanes' bars follow`)
    await lane(page, "M4").evaluate((el) => el.scrollIntoView({ block: "center" }))
    await dragTo(page, card(page, moving), laneColumn(page, "M4", "Todo").locator('[role="list"]'), "below")
    await expect(laneColumn(page, "M4", "Todo").locator(`[data-task-key="${moving}"]`)).toBeVisible()
    await expect(lane(page, "M4").locator("[data-progress-text]")).toHaveText("0 of 1 done · 0%")
    await expect(lane(page, "M3").locator("[data-progress-text]")).toHaveText("1 of 3 done · 33%")
    await hold(page)
  })
})
