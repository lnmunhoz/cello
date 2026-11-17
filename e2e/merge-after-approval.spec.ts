// CEL-143: Merge after I approve. Lucas turns the setting on in Settings → Merging; an agent hands in a
// packet through the real `cello` CLI; on the Review page the button reads "Approve and merge"; after it
// the task leaves the Review page and its card stays in In Review as "Approved · merging", still the
// agent's, with Send back in the task panel; the agent's `cello inbox` says to merge it now; its
// `cello task done` moves the card to Done.
import * as fs from "node:fs"
import * as path from "node:path"
import type { Browser, Page } from "@playwright/test"
import { caption, card, column, createProject, expect, projectLink, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { cello, SHOTS, submitPacket, WEB_URL } from "./packets.ts"
import { isReview } from "./recording.ts"

test.beforeEach(() => {
  if (isReview(process.env)) test.setTimeout(180_000)
})

/** `url` in its own unrecorded window, light or dark, saved to e2e/videos/<name>-<scheme>.png once `ready` says it's drawn. */
async function still(browser: Browser, url: string, name: string, ready: (page: Page) => Promise<void>) {
  for (const colorScheme of ["light", "dark"] as const) {
    const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 }, colorScheme })
    const page = await context.newPage()
    await page.goto(url)
    await ready(page)
    await page.screenshot({ path: path.join(SHOTS, `${name}-${colorScheme}.png`) })
    await context.close()
  }
}

test("CEL-143: with Merge after I approve on, Approve and merge leaves the card Approved · merging until the agent's `cello task done` moves it to Done", async ({ page, browser }) => {
  const key = uniqueKey("MRG")
  await createProject(page, "Merge after approval", key)

  await caption(page, "Settings → Merging: turn on “Merge after I approve” for this project")
  await page.goto(`/settings?project=${key}`)
  const merging = page.getByRole("region", { name: "Merging" })
  const toggle = merging.getByRole("switch")
  await expect(toggle).not.toBeChecked()
  await expect(merging).toContainText("Agents merge before they hand work in")
  await toggle.click()
  await expect(toggle).toBeChecked()
  await expect(merging).toContainText("Approve and merge tells the agent to merge it now")
  await still(browser, `/settings?project=${key}`, "merge-settings", async (p) => {
    const section = p.getByRole("region", { name: "Merging" })
    await expect(section.getByRole("switch")).toBeChecked()
    await section.scrollIntoViewIfNeeded()
  })

  await caption(page, "The agent hands in its packet with `cello task submit`, the PR linked")
  await projectLink(page, key).click()
  const { dir } = await submitPacket(page, key)
  const taskCard = card(page, `${key}-1`)
  await expect(column(page, "In Review").locator(`[data-task-key="${key}-1"]`)).toBeVisible()

  await caption(page, "On the Review page the button reads “Approve and merge”")
  await page.goto(`/review?open=${key}-1`)
  const item = page.getByRole("article", { name: new RegExp(`${key}-1`) })
  const approve = item.getByRole("button", { name: "Approve and merge" })
  await expect(approve).toBeVisible()
  await approve.hover()
  await expect(page.getByText("The agent merges it after you approve, then moves it to Done")).toBeVisible()

  await caption(page, "Approve and merge: the task leaves the Review page")
  await approve.click()
  await expect(item).toBeHidden()

  await caption(page, `${key}-1 stays in In Review, Approved · merging, still the agent's`)
  await projectLink(page, key).click()
  await expect(column(page, "In Review").locator(`[data-task-key="${key}-1"]`)).toBeVisible()
  await expect(taskCard.locator('[data-stage="merging"]')).toHaveText("Approved · merging")
  await taskCard.click()
  const panel = taskPanel(page, `${key}-1`)
  const approved = panel.getByRole("region", { name: "Approved, merging" })
  await expect(approved).toContainText("Its agent merges it now, then moves it to Done")
  await expect(approved.getByRole("button", { name: "Send back" })).toBeVisible()
  await expect(approved.getByRole("button", { name: /Approve/ })).toHaveCount(0)
  await still(browser, `/${key}/1`, "merge-approved", async (p) => {
    await expect(p.locator(`[data-task-key="${key}-1"] [data-stage="merging"]`)).toBeVisible()
    await expect(p.getByRole("region", { name: "Approved, merging" })).toBeVisible()
  })

  await caption(page, "The agent's `cello inbox`: Lucas approved it, merge it now")
  const inbox = cello("inbox", "--new")
  expect(inbox).toContain(`approved ${key}-1: merge it now, then \`cello task done ${key}-1\`.`)

  await caption(page, `Merged: the agent runs \`cello task done ${key}-1\``)
  expect(cello("task", "done", `${key}-1`)).toContain(`Done ${key}-1  In Review → Done`)
  await expect(column(page, "Done").locator(`[data-task-key="${key}-1"]`)).toBeVisible()
  await expect(taskCard.locator('[data-stage="merging"]')).toHaveCount(0)
  await caption(page, `${key}-1 is in Done, its claim ended`)
  fs.rmSync(dir, { recursive: true, force: true })
})
