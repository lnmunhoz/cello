import * as fs from "node:fs"
import * as path from "node:path"
import type { Browser } from "@playwright/test"
import { addTasks, caption, captionWithUrl, card, column, createProject, expect, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { celloAs, expectLeftAligned, expectOneColumn, expectTwoColumns, packetDrawn, SHOTS, submitDiagramPacket, WEB_URL } from "./packets.ts"
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
  // Aligned left (CEL-163), here and at a mid width, where the column no longer fills the page: it doesn't move to the middle.
  await expectLeftAligned(panel, pinned)
  await page.setViewportSize({ width: 1100, height: 900 })
  await expectOneColumn(pinned)
  await expectLeftAligned(panel, pinned)
  await page.setViewportSize({ width: 1440, height: 900 })
  await expectTwoColumns(pinned)

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

/** An agent's results comment (CEL-127): a table wider than the panel, a struck-out line and a checklist. */
const RESULTS_COMMENT = [
  "Results of the three runs:",
  "",
  "| Run | Where | Time | Tests | Videos | Notes |",
  "| --- | --- | ---: | --- | --- | --- |",
  "| unit | Mac | 41s | 812 passed | none | all green after the fix to the clock |",
  "| e2e | Docker | 4m 12s | 31 passed | 31 MP4s | review mode, slow motion on |",
  "| desktop | Docker + Xvfb | 2m 03s | 9 passed | 9 MP4s | captions burned in |",
  "",
  "~~Run the full suite~~ only the related specs.",
  "",
  "- [x] tests",
  "- [ ] evidence",
].join("\n")

/** `key`'s task panel in its own unrecorded window, scrolled to its comments: saved as e2e/videos/cel-127-table-<scheme>.png. */
async function stillOfCommentTable(browser: Browser, key: string, colorScheme: "light" | "dark") {
  const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 }, colorScheme })
  const page = await context.newPage()
  const [projectKey, number] = key.split("-") as [string, string]
  await page.goto(`/${projectKey}/${number}`)
  const panel = taskPanel(page, key)
  const table = panel.locator("[data-comment-id] [data-markdown-table]").first()
  await table.scrollIntoViewIfNeeded()
  await panel.screenshot({ path: path.join(SHOTS, `cel-127-table-${colorScheme}.png`) })
  await context.close()
}

test("CEL-127: a markdown table in a comment shows as a table that scrolls sideways inside the panel, never the page; strikethrough and task lists show too", async ({ page, browser }) => {
  const key = uniqueKey("TABLE")
  const task = `${key}-1`
  const agent = celloAs(`e2e0comment-table-${key}`, { stdin: RESULTS_COMMENT })
  await createProject(page, "Comment tables", key)

  await caption(page, `An agent creates ${task} and comments its test results as a markdown table`)
  agent("task", "create", "Speed up the e2e runs", "--project", key)
  agent("task", "comment", task, "--body-file", "-")

  await caption(page, `Open ${task}: the comment shows a table, not | pipes |`)
  await card(page, task).click()
  const panel = taskPanel(page, task)
  const comment = panel.locator("[data-comment-id]").filter({ hasText: "Results of the three runs" })
  const table = comment.locator("[data-markdown-table]")
  await expect(table.locator("th")).toHaveText(["Run", "Where", "Time", "Tests", "Videos", "Notes"])
  await expect(table.locator("tbody tr")).toHaveCount(3)
  await expect(comment).not.toContainText("| Run |")
  await table.scrollIntoViewIfNeeded()

  await caption(page, "It's wider than the panel: it scrolls sideways inside its frame, the panel and the page don't")
  const overflows = (el: Element) => el.scrollWidth > el.clientWidth
  expect(await table.evaluate(overflows)).toBe(true)
  expect(await panel.evaluate(overflows)).toBe(false)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await table.hover()
  await page.mouse.wheel(600, 0)
  await expect(table).not.toHaveJSProperty("scrollLeft", 0)

  await caption(page, "Strikethrough and the checklist show as GitHub draws them")
  await expect(comment.locator("del")).toHaveText("Run the full suite")
  await expect(comment.locator("input[type=checkbox]")).toHaveCount(2)
  await expect(comment.locator("input[type=checkbox]").first()).toBeChecked()

  await caption(page, "Lucas answers with a small table of his own from the comment box")
  await panel.getByLabel("New comment").fill("| Run | OK? |\n| --- | --- |\n| e2e | yes |")
  await panel.getByRole("button", { name: "Comment", exact: true }).click()
  const reply = panel.locator("[data-comment-id]").filter({ hasText: "OK?" })
  await expect(reply.locator("table td")).toHaveText(["e2e", "yes"])
  expect(await reply.locator("[data-markdown-table]").evaluate(overflows)).toBe(false)
  await caption(page, "Both comments show their tables")

  for (const scheme of ["light", "dark"] as const) await stillOfCommentTable(browser, task, scheme)
})
