// CEL-105: a session working by itself may never set a stage, and In Progress put its task under
// "No stage" while its agent was active. A task with no stage whose agent is active now says Working: on
// its card, in a Working lane (Display → Group In Progress by stage), in the list's row and stage column,
// and in the task panel's header. Designing is the first stage. The board has one task Designing, one
// Building, one claimed by an active session with no stage, and one whose session has ended, with no stage.
import { spawnSync } from "node:child_process"
import * as path from "node:path"
import type { Locator, Page } from "@playwright/test"
import { newCommandId } from "../packages/client/test/support/promiseClient.ts"
import { agentAs, caption, card, column, defaultWorkspace, expect, seedProject, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { SHOTS } from "./packets.ts"

/** Turns Display → "Group In Progress by stage" on or off, then closes the popover. */
async function groupByStage(page: Page, on: boolean) {
  await page.getByRole("button", { name: /^Display/ }).click()
  const toggle = page.getByRole("switch", { name: "Group In Progress by stage" })
  if ((await toggle.getAttribute("aria-checked")) !== String(on)) await toggle.click()
  await expect(toggle).toHaveAttribute("aria-checked", String(on))
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Display options" })).toBeHidden()
}

/** `of` in light, then dark: `cel-105-<name>-<theme>.png`. */
async function shoot(page: Page, of: Page | Locator, name: string) {
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await of.screenshot({ path: path.join(SHOTS, `cel-105-${name}-${theme}.png`), animations: "disabled" })
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"))
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (localStorage.getItem("cello:agent-cursors") === null) localStorage.setItem("cello:agent-cursors", "off")
  })
})

test("CEL-105: a task an agent works on with no stage says Working on the board, in a Working lane, in the list and in the panel; Designing comes first", async ({ page, cello, baseURL }) => {
  // The server's sweep notices the exited process within 30 s: this test waits for it once.
  test.setTimeout(Math.max(test.info().timeout, 120_000))
  const key = uniqueKey("WORK")
  const project = await seedProject(cello, "Working lane", key)
  const { statuses } = await defaultWorkspace(cello)
  const titles = ["Sketch the onboarding flow", "Wire the stage command", "Fix the drag snap-back", "Tidy the release notes"]
  for (const title of titles) {
    await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title, statusId: statuses.Todo!.id }))
  }
  const [designing, building, working, ended] = titles.map((_, i) => `${key}-${i + 1}`) as [string, string, string, string]

  const live = await agentAs(baseURL!, "64a2ac46-working-live", process.pid)
  for (const [taskKey, stage] of [[designing, "designing"], [building, "building"], [working, null]] as const) {
    await live.run((c) => c["task.claim"]({ commandId: newCommandId(), key: taskKey }))
    if (stage) await live.run((c) => c["task.stage"]({ commandId: newCommandId(), key: taskKey, stage }))
  }
  const gone = await agentAs(baseURL!, "c1d2e3f4-working-gone", spawnSync("true").pid!)
  await gone.run((c) => c["task.claim"]({ commandId: newCommandId(), key: ended }))

  await page.goto(`/${key}/issues`)
  const progress = column(page, "In Progress")
  await expect(progress.locator("[data-task-key]")).toHaveCount(4)
  await caption(page, "Four tasks in In Progress: Designing, Building, one an active agent works on with no stage, one whose session ended")
  await expect(card(page, ended).locator("[data-card-work]")).toContainText("c1d2e3f4 ended", { timeout: 60_000 })

  await caption(page, "Each card says its step: the active agent's task with no stage says Working; the ended one says nothing")
  await expect(card(page, designing).locator('[data-stage="designing"]')).toHaveText("Designing")
  await expect(card(page, working).locator('[data-stage="working"]')).toHaveText("Working")
  await expect(card(page, ended).locator("[data-stage]")).toHaveCount(0)
  await shoot(page, progress, "board-cards")

  await caption(page, "Display → Group In Progress by stage: Designing first, then Building, a Working lane, and No stage for the ended one")
  await groupByStage(page, true)
  await expect(progress.locator("[data-lane]")).toHaveText([/Designing\s*1/, /Building\s*1/, /Working\s*1/, /No stage\s*1/])
  await expect(progress.locator("[data-task-key]")).toHaveText([new RegExp(designing), new RegExp(building), new RegExp(working), new RegExp(ended)])
  // The lane says the step, so the cards don't repeat it.
  await expect(progress.locator("[data-card-work] [data-stage]")).toHaveCount(0)
  await shoot(page, progress, "board-lanes")

  await caption(page, "The task panel's header says Working too")
  await card(page, working).click()
  const panel = taskPanel(page, working)
  await expect(panel.locator("[data-panel-work]")).toContainText("64a2ac46 active now")
  await expect(panel.locator('[data-panel-work] [data-stage="working"]')).toHaveText("Working")
  await shoot(page, page, "panel")
  await caption(page, "Back to the board")
  await panel.getByRole("button", { name: "Close task" }).click()

  await caption(page, "The list, grouped by stage: rows in lane order, the stage column says Designing, Building, Working, and nothing for the ended one")
  await page.goto(`/${key}/issues?layout=list`)
  const rows = page.locator('[data-layout="list"] section[data-group="In Progress"] [data-task-key]')
  await expect(rows).toHaveCount(4)
  await expect(rows.nth(0).locator('[data-stage-column] [data-stage="designing"]')).toHaveText("Designing")
  await expect(rows.nth(1).locator('[data-stage-column] [data-stage="building"]')).toHaveText("Building")
  await expect(rows.nth(2).locator('[data-stage-column] [data-stage="working"]')).toHaveText("Working")
  await expect(rows.nth(3).locator("[data-stage]")).toHaveCount(0)
  await shoot(page, page, "list-lanes")

  await caption(page, "Grouping off: each row says its step at the right, Working included")
  await groupByStage(page, false)
  await expect(rows.nth(2).locator('[data-row-work] [data-stage="working"]')).toHaveText("Working")
  await shoot(page, page, "list")

  await live.run((c) => c["task.release"]({ commandId: newCommandId(), key: working }))
  await Promise.all([live.close(), gone.close()])
})
