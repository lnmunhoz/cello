// CEL-113, phase 1: milestones on the card and in the task panel. Lucas puts a task in a milestone from
// the panel's Milestone picker (its open milestones in order, No milestone, New milestone…) and the card
// shows the milestone as a chip next to its labels; an agent does the same with `cello task edit
// --milestone`, and the card follows live. Display can hide the chip.
import * as fs from "node:fs"
import * as path from "node:path"
import type { Browser, Page } from "@playwright/test"
import { caption, card, expect, newCommandId, seedLabels, seedProject, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { cello, SHOTS, WEB_URL } from "./packets.ts"

const milestonePicker = (page: Page, key: string) => taskPanel(page, key).getByRole("combobox", { name: "Milestone", exact: true })
const chipOf = (page: Page, key: string) => card(page, key).locator("[data-card-milestone]")

/** The board with the task open and its Milestone picker open, then the card's chip, in light and dark, in unrecorded windows. */
async function screenshots(browser: Browser, projectKey: string, key: string) {
  fs.mkdirSync(SHOTS, { recursive: true })
  for (const colorScheme of ["light", "dark"] as const) {
    const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 }, colorScheme })
    const page = await context.newPage()
    await page.goto(`/${projectKey}/${key.split("-")[1]}`)
    await expect(milestonePicker(page, key)).toContainText("M3")
    await expect(chipOf(page, key)).toHaveText("M3")
    await page.screenshot({ path: path.join(SHOTS, `milestone-card-chip-${colorScheme}.png`) })
    await milestonePicker(page, key).click()
    await expect(page.getByRole("option", { name: "New milestone…" })).toBeVisible()
    await page.screenshot({ path: path.join(SHOTS, `milestone-panel-picker-${colorScheme}.png`) })
    await context.close()
  }
}

test("CEL-113: put a task in a milestone from the task panel, see the chip on the card, make a new milestone from the picker; an agent's --milestone shows live; Display hides the chip", async ({ page, cello: rpc, browser }) => {
  test.setTimeout(180_000)
  const projectKey = uniqueKey("MILE")
  const project = await seedProject(rpc, "Milestones test", projectKey)
  const [feature] = await seedLabels(rpc, project.id, [{ name: "feature", color: "#3B82F6" }])
  const milestone = async (name: string, goal: string) =>
    (await rpc.run((c) => c["milestone.create"]({ commandId: newCommandId(), projectId: project.id, name, goal }))).result
  const m1 = await milestone("M1", "The board")
  await milestone("M2", "Review packets")
  await milestone("M3", "Watching agents")
  // M1 is done: closed, so it isn't offered.
  await rpc.run((c) => c["milestone.close"]({ commandId: newCommandId(), id: m1.id }))
  for (const title of ["Milestones: define them per project", "Burn-up chart", "Sidebar counts"]) {
    await rpc.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title, labelIds: [feature!.id] }))
  }
  const first = `${projectKey}-1`
  const second = `${projectKey}-2`
  const third = `${projectKey}-3`

  await page.goto(`/${projectKey}/issues`)
  await caption(page, "Three tasks, none in a milestone yet: no milestone chip on the cards")
  await expect(card(page, first)).toBeVisible()
  await expect(page.locator("[data-card-milestone]")).toHaveCount(0)

  await caption(page, "Open the first task: the panel's properties have a Milestone picker")
  await card(page, first).click()
  await expect(milestonePicker(page, first)).toContainText("No milestone")

  await caption(page, "Open the picker: the open milestones in order, No milestone, and New milestone… (M1 is closed, so it isn't offered)")
  await milestonePicker(page, first).click()
  const options = page.getByRole("option")
  await expect(options).toHaveText(["No milestone", "M2", "M3", "New milestone…"])

  await caption(page, "Pick M3: the card shows an M3 chip next to its label")
  await page.getByRole("option", { name: "M3" }).click()
  await expect(milestonePicker(page, first)).toContainText("M3")
  await expect(chipOf(page, first)).toHaveText("M3")
  await expect(taskPanel(page, first)).toContainText("put it in M3")

  await caption(page, "An agent runs `cello task edit --milestone M2` on the second task: its card shows M2 at once")
  cello("task", "edit", second, "--milestone", "M2")
  await expect(chipOf(page, second)).toHaveText("M2")

  await caption(page, "Open the third task and pick New milestone…")
  await card(page, third).click()
  await milestonePicker(page, third).click()
  await page.getByRole("option", { name: "New milestone…" }).click()
  const dialog = page.getByRole("dialog", { name: "New milestone" })
  await expect(dialog).toBeVisible()

  await caption(page, "Name it M4 with a goal and create it: the task goes in it, and the card says M4")
  await dialog.getByLabel("Name").fill("M4")
  await dialog.getByLabel("Goal (optional)").fill("Releases")
  await dialog.getByRole("button", { name: "Create milestone" }).click()
  await expect(dialog).toBeHidden()
  await expect(milestonePicker(page, third)).toContainText("M4")
  await expect(chipOf(page, third)).toHaveText("M4")

  await caption(page, "New milestone… again, typing m3, a name M3 already has: the task goes in M3 instead of failing")
  await milestonePicker(page, third).click()
  await page.getByRole("option", { name: "New milestone…" }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByLabel("Name").fill("m3")
  await dialog.getByRole("button", { name: "Create milestone" }).click()
  await expect(dialog).toBeHidden()
  await expect(chipOf(page, third)).toHaveText("M3")
  const created = (await rpc.run((c) => c["milestone.list"]({ project: { key: projectKey } }))).milestones.map((s) => s.milestone.name)
  expect(created).toEqual(["M1", "M2", "M3", "M4"])

  await caption(page, "Reload: every card keeps its milestone")
  await page.reload()
  await expect(chipOf(page, first)).toHaveText("M3")
  await expect(chipOf(page, second)).toHaveText("M2")
  await expect(chipOf(page, third)).toHaveText("M3")

  await caption(page, "Display → turn off Show milestone on cards: the chips go")
  await page.getByRole("button", { name: "Display" }).click()
  await page.getByRole("switch", { name: "Show milestone on cards" }).click()
  await expect(page.locator("[data-card-milestone]")).toHaveCount(0)

  await caption(page, "Turn it back on: they're back")
  await page.getByRole("switch", { name: "Show milestone on cards" }).click()
  await expect(chipOf(page, first)).toHaveText("M3")
  await page.keyboard.press("Escape")

  await caption(page, "Take the first task out: pick No milestone, and its chip goes")
  await card(page, first).click()
  await milestonePicker(page, first).click()
  await page.getByRole("option", { name: "No milestone" }).click()
  await expect(chipOf(page, first)).toHaveCount(0)
  await expect(taskPanel(page, first)).toContainText("took it out of M3")

  // Stills for the packet: put it back in M3 first.
  cello("task", "edit", first, "--milestone", "M3")
  await expect(chipOf(page, first)).toHaveText("M3")
  await screenshots(browser, projectKey, first)
})
