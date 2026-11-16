// CEL-105 UI scope: a task a plain session works on never gets a stage, so In Progress put it under
// "No stage" while its agent was active. Two designs, side by side, for Lucas to pick (the switch is
// apps/web/src/board/workingOption.ts): A, a Working lane; B, the lanes as they were and the card says
// Working. Both show the new Designing stage. The board has one task Designing, one Building, one
// claimed by an active session with no stage, and one whose session has ended, with no stage.
import { spawnSync } from "node:child_process"
import * as path from "node:path"
import type { Page } from "@playwright/test"
import { newCommandId } from "../packages/client/test/support/promiseClient.ts"
import { agentAs, caption, card, column, defaultWorkspace, expect, seedProject, test, uniqueKey } from "./fixtures.ts"
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

/** The In Progress column in light, then dark: `cel-105-<name>-<theme>.png`. */
async function shoot(page: Page, name: string) {
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await column(page, "In Progress").screenshot({ path: path.join(SHOTS, `cel-105-${name}-${theme}.png`), animations: "disabled" })
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"))
}

/** Picks the design (read once at load), then reloads. */
async function pick(page: Page, option: "A" | "B") {
  await page.evaluate((o) => localStorage.setItem("cello:cel105-option", o), option)
  await page.reload()
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (localStorage.getItem("cello:agent-cursors") === null) localStorage.setItem("cello:agent-cursors", "off")
  })
})

test("CEL-105 scope: a task an agent works on with no stage shows Working; the new Designing stage (options A and B)", async ({ page, cello, baseURL }) => {
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

  await caption(page, "Lanes off (the default): the card of the active agent with no stage says Working; the ended one says nothing")
  await expect(card(page, designing).locator('[data-stage="designing"]')).toHaveText("Designing")
  await expect(card(page, working).locator('[data-stage="working"]')).toHaveText("Working")
  await expect(card(page, ended).locator("[data-stage]")).toHaveCount(0)
  await shoot(page, "lanes-off")

  await caption(page, "Option A: Display → Group In Progress by stage. Designing first, then Building, a Working lane, and No stage for the ended one")
  await groupByStage(page, true)
  await expect(progress.locator("[data-lane]")).toHaveText([/Designing\s*1/, /Building\s*1/, /Working\s*1/, /No stage\s*1/])
  await expect(progress.locator("[data-card-work] [data-stage]")).toHaveCount(0)
  await shoot(page, "A-lanes")

  await caption(page, "Option B: the lanes stay as they were; the card in No stage says Working itself")
  await pick(page, "B")
  await expect(progress.locator("[data-lane]")).toHaveText([/Designing\s*1/, /Building\s*1/, /No stage\s*2/])
  await expect(card(page, working).locator('[data-stage="working"]')).toHaveText("Working")
  await expect(card(page, ended).locator("[data-stage]")).toHaveCount(0)
  await shoot(page, "B-lanes")

  await live.run((c) => c["task.release"]({ commandId: newCommandId(), key: working }))
  await Promise.all([live.close(), gone.close()])
})
