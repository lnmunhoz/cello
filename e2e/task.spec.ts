import * as fs from "node:fs"
import * as path from "node:path"
import type { Browser } from "@playwright/test"
import { addTasks, caption, captionWithUrl, card, column, createProject, expect, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { expectOneColumn, expectTwoColumns, packetDrawn, SHOTS, submitDiagramPacket, WEB_URL } from "./packets.ts"
import { isReview } from "./recording.ts"

/** `key`'s task page as a full page in its own unrecorded window, saved to e2e/videos/task-full-<width>x<height>-<scheme>.png. */
async function screenshotFullPage(browser: Browser, key: string, viewport: { width: number; height: number }, colorScheme: "light" | "dark") {
  const context = await browser.newContext({ baseURL: WEB_URL, viewport, colorScheme })
  const page = await context.newPage()
  const [projectKey, number] = key.split("-") as [string, string]
  await page.goto(`/${projectKey}/${number}?view=full`)
  const pinned = taskPanel(page, key).getByRole("region", { name: "Review packet" })
  await packetDrawn(pinned)
  const poster = await pinned.locator("video").getAttribute("poster")
  await page.evaluate((src) => new Promise((resolve) => Object.assign(new Image(), { onload: resolve, src })), poster!)
  await pinned
    .locator("img[data-evidence=screenshot]")
    .first()
    .evaluate((img: HTMLImageElement) => img.complete || img.getBoundingClientRect().top > innerHeight || new Promise((resolve) => img.addEventListener("load", resolve)))
  await page.screenshot({ path: path.join(SHOTS, `task-full-${viewport.width}x${viewport.height}-${colorScheme}.png`) })
  await context.close()
}

test("CEL-39: the task panel's expand button opens the task as a full page (?view=full), the packet in two columns; a reload keeps it; collapse, Esc and F go back; ?embed survives", async ({ page, browser }) => {
  if (isReview(process.env)) test.setTimeout(180_000)
  const key = uniqueKey("FUL")
  await createProject(page, "Full page test", key)
  await caption(page, "An agent submits a packet with a diagram, a video and a screenshot")
  const { dir } = await submitDiagramPacket(page, key, "Open the task as a full page")
  const inReview = column(page, "In Review")

  await caption(page, "Open the card: the packet is in the narrow side panel, one column")
  await card(page, `${key}-1`).click()
  const panel = taskPanel(page, `${key}-1`)
  const pinned = panel.getByRole("region", { name: "Review packet" })
  await packetDrawn(pinned)
  await expectOneColumn(pinned)

  await captionWithUrl(page, "Expand it: the task fills the main area, the packet in two columns")
  await panel.getByRole("button", { name: "Expand to full page" }).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/1\\?view=full$`))
  await expect(inReview).toBeHidden()
  await expectTwoColumns(pinned)
  // The page fills the main area, and the packet fits inside it with room on both sides.
  const main = (await page.getByRole("main").boundingBox())!
  const area = (await panel.boundingBox())!
  const packet = (await pinned.boundingBox())!
  expect(area.width).toBeGreaterThan(main.width - 4)
  expect(packet.x).toBeGreaterThan(area.x)
  expect(packet.x + packet.width).toBeLessThan(area.x + area.width)

  await captionWithUrl(page, "Reload: still a full page")
  await page.reload()
  await packetDrawn(pinned)
  await expect(inReview).toBeHidden()
  await expectTwoColumns(pinned)

  await captionWithUrl(page, "Collapse: back to the board with the side panel")
  await panel.getByRole("button", { name: "Collapse to side panel" }).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/1$`))
  await expect(inReview).toBeVisible()
  await expectOneColumn(pinned)

  await captionWithUrl(page, "Press F: a full page again")
  await page.keyboard.press("f")
  await expect(page).toHaveURL(new RegExp(`/${key}/1\\?view=full$`))
  await expect(inReview).toBeHidden()

  await captionWithUrl(page, "Press Esc: back to the board with the side panel")
  await page.keyboard.press("Escape")
  await expect(page).toHaveURL(new RegExp(`/${key}/1$`))
  await expect(inReview).toBeVisible()
  await expect(panel).toBeVisible()

  await captionWithUrl(page, "In a panel (?embed=1), expanding keeps embed in the URL")
  await page.goto(`/${key}/1?embed=1`)
  await panel.getByRole("button", { name: "Expand to full page" }).click()
  await expect(page).toHaveURL(/[?&]embed=1(&|$)/)
  await expect(page).toHaveURL(/[?&]view=full(&|$)/)
  await captionWithUrl(page, "Collapse: embed stays, view goes")
  await panel.getByRole("button", { name: "Collapse to side panel" }).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/1\\?embed=1$`))

  // Stills for the report, without the test's overlay.
  for (const colorScheme of ["light", "dark"] as const) {
    await screenshotFullPage(browser, `${key}-1`, { width: 2560, height: 1440 }, colorScheme)
    await screenshotFullPage(browser, `${key}-1`, { width: 1440, height: 900 }, colorScheme)
  }

  await page.goto(`/${key}/1?view=full`)
  await caption(page, `Approve ${key}-1 from the full page`)
  await pinned.getByRole("button", { name: "Approve" }).click()
  await expect(pinned).toBeHidden()
  await caption(page, "Expand to read a packet at full width; Esc or collapse goes back")
  fs.rmSync(dir, { recursive: true, force: true })
})

test("18: create a task with a column's +, edit it in the panel, add a comment, reload: everything is still there", async ({ page }) => {
  const key = uniqueKey("TASK")
  await createProject(page, "Panel test", key)

  await caption(page, "Create a task with Todo's +")
  await addTasks(page, "Todo", ["Add dark mode toggle"])

  await caption(page, "Open it")
  await card(page, `${key}-1`).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/1$`))
  const panel = page.getByRole("complementary", { name: `${key}-1 details` })

  await caption(page, "Edit the title")
  const title = panel.getByLabel("Title")
  await title.fill("Add dark mode toggle in settings")
  await title.press("Enter")

  await caption(page, "Write a description in markdown, then preview it")
  await panel.getByLabel("Description", { exact: true }).fill("Users switch **light** and dark.\n\n- persists across sessions")
  await panel.getByRole("tab", { name: "Preview" }).click()
  await expect(panel.getByTestId("description-preview").locator("strong")).toHaveText("light")

  await caption(page, "Set priority and due date")
  await panel.getByRole("combobox", { name: "Priority" }).click()
  await page.getByRole("option", { name: "High" }).click()
  await expect(panel.getByRole("combobox", { name: "Priority" })).toContainText("High")
  await panel.getByLabel("Due date").fill("2026-12-01")

  await caption(page, "Add a comment")
  await panel.getByLabel("New comment").fill("Let's ship this with the **theme** tokens.")
  await panel.getByRole("button", { name: "Comment", exact: true }).click()
  await expect(panel.locator("[data-comment-id]")).toContainText("Let's ship this with the theme tokens.")
  await expect(card(page, `${key}-1`)).toContainText("Dec 1")

  await caption(page, "Reload")
  await page.reload()
  await expect(panel.getByLabel("Title")).toHaveValue("Add dark mode toggle in settings")
  await expect(panel.getByTestId("description-preview").locator("li")).toHaveText("persists across sessions")
  await expect(panel.getByRole("combobox", { name: "Priority" })).toContainText("High")
  await expect(panel.getByLabel("Due date")).toHaveValue("2026-12-01")
  await expect(panel.locator("[data-comment-id]")).toContainText("Let's ship this with the theme tokens.")
  await expect(panel.getByText(/created the task/)).toBeVisible()
  await caption(page, "Everything is still there after the reload")
})
