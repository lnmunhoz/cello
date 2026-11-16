// CEL-117: opening a page from the task in the side panel no longer replaces the task. The task moves
// to the main area (as Expand does) and the page opens in the side panel beside it; closing the page
// docks the task again. Whatever the panel shows is in the URL, and a page or task opened from the
// panel gets a Back control (and ⌘[) that returns to exactly what was there before, scroll included.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Browser, Page } from "@playwright/test"
import { caption, captionWithUrl, card, column, createProject, expect, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { cello, SHOTS, WEB_URL } from "./packets.ts"

const viewerOf = (page: Page) => page.getByRole("complementary", { name: "Viewer" })

/** A long page linked to both tasks, so its TASKS chips show both and it scrolls; Part 6 names the second task. */
const notes = (key: string) =>
  [
    "# Saved library: design",
    "",
    `How ${key}-1 keeps saved items in one place; ${key}-2 builds the import.`,
    "",
    ...Array.from({ length: 12 }, (_, i) => [
      `## Part ${i + 1}`,
      "",
      `Part ${i + 1} of the design, with enough words to fill a few lines of the reader beside the task. `.repeat(4) + (i === 5 ? `The import is ${key}-2.` : ""),
      "",
    ]).flat(),
  ].join("\n")

function publish(key: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-panelback-"))
  const file = path.join(dir, "saved-library.md")
  fs.writeFileSync(file, notes(key))
  cello("doc", "publish", file, "--project", key, "--task", `${key}-1`, "--task", `${key}-2`)
  return dir
}

/** The side-by-side layout (the task in the main area, its page beside it), in an unrecorded window, saved to e2e/videos/panel-back-<scheme>.png. */
async function still(browser: Browser, key: string, colorScheme: "light" | "dark") {
  const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 }, colorScheme })
  const page = await context.newPage()
  await page.goto(`/${key}/1`)
  await taskPanel(page, `${key}-1`).getByRole("region", { name: "Pages" }).getByRole("link", { name: /Saved library: design/ }).click()
  await expect(viewerOf(page).getByRole("heading", { level: 1, name: "Saved library: design" })).toBeVisible()
  await page.screenshot({ path: path.join(SHOTS, `panel-back-side-by-side-${colorScheme}.png`) })
  await context.close()
}

test("CEL-117: a page opened from the task in the side panel opens beside it, the task moving to the main area; closing the page docks the task again", async ({ page, browser }) => {
  const key = uniqueKey("PBK")
  await createProject(page, "Panel back", key)
  cello("task", "create", "Saved library: replace Chrome bookmarks", "--project", key)
  cello("task", "create", "Import the bookmarks", "--project", key)
  const dir = publish(key)

  await caption(page, "Open the task: it docks in the side panel beside the board")
  await card(page, `${key}-1`).click()
  const panel = taskPanel(page, `${key}-1`)
  const viewer = viewerOf(page)
  await expect(panel).toHaveAttribute("data-placement", "side")
  await expect(column(page, "Todo")).toBeVisible()

  await captionWithUrl(page, "Click its page under Pages: the task moves to the main area, and the page opens beside it")
  await panel.getByRole("region", { name: "Pages" }).getByRole("link", { name: /Saved library: design/ }).click()
  await expect(viewer.getByRole("heading", { level: 1, name: "Saved library: design" })).toBeVisible()
  await expect(panel).toHaveAttribute("data-placement", "page")
  await expect(panel.getByLabel("Title")).toHaveValue("Saved library: replace Chrome bookmarks")
  await expect(panel.getByRole("button", { name: "Collapse to side panel" })).toBeVisible()
  await expect(column(page, "Todo")).toBeHidden()
  await expect(page).toHaveURL(new RegExp(`/${key}/1\\?viewer=%2F${key}%2Fpages%2Fsaved-library`))
  // Side by side: the task on the left, the page on the right, neither covering the other.
  const taskBox = (await panel.boundingBox())!
  const viewerBox = (await viewer.boundingBox())!
  expect(taskBox.x + taskBox.width).toBeLessThanOrEqual(viewerBox.x + 1)
  expect(taskBox.width).toBeGreaterThan(400)

  await captionWithUrl(page, "Reload: both stay where they were")
  await page.reload()
  await expect(viewer.getByRole("heading", { level: 1, name: "Saved library: design" })).toBeVisible()
  await expect(panel).toHaveAttribute("data-placement", "page")

  await caption(page, "Close the page: the task goes back to the side panel, over the board")
  await viewer.getByRole("button", { name: "Close viewer" }).click()
  await expect(viewer).toHaveCount(0)
  await expect(panel).toHaveAttribute("data-placement", "side")
  await expect(column(page, "Todo")).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/${key}/1$`))

  await captionWithUrl(page, "Expand the task first, then open its page: it just opens beside the expanded task")
  await panel.getByRole("button", { name: "Expand to full page" }).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/1\\?view=full$`))
  await panel.getByRole("region", { name: "Pages" }).getByRole("link", { name: /Saved library: design/ }).click()
  await expect(viewer.getByRole("heading", { level: 1, name: "Saved library: design" })).toBeVisible()
  await expect(panel).toHaveAttribute("data-placement", "page")

  await captionWithUrl(page, "Close the page: the task stays expanded")
  await viewer.getByRole("button", { name: "Close viewer" }).click()
  await expect(viewer).toHaveCount(0)
  await expect(panel).toHaveAttribute("data-placement", "page")
  await expect(page).toHaveURL(new RegExp(`/${key}/1\\?view=full$`))
  await caption(page, "A page opened from a task never hides the task")

  for (const scheme of ["light", "dark"] as const) await still(browser, key, scheme)
  fs.rmSync(dir, { recursive: true, force: true })
})

test("CEL-117: Back in the side panel returns to what it showed before: page → its TASKS chip or a key in its text → Back to the page, where it was scrolled; a linked task in a comment → Back; ⌘[, reload and browser back/forward too", async ({ page }) => {
  const key = uniqueKey("PBH")
  await createProject(page, "Panel history", key)
  cello("task", "create", "Saved library: replace Chrome bookmarks", "--project", key)
  cello("task", "create", "Import the bookmarks", "--project", key)
  const dir = publish(key)

  await caption(page, "Open the task, then its page: the page shows a Back to the task")
  await card(page, `${key}-1`).click()
  const first = taskPanel(page, `${key}-1`)
  const second = taskPanel(page, `${key}-2`)
  const viewer = viewerOf(page)
  await first.getByRole("region", { name: "Pages" }).getByRole("link", { name: /Saved library: design/ }).click()
  await expect(viewer.getByRole("heading", { level: 1, name: "Saved library: design" })).toBeVisible()
  await expect(viewer.getByRole("button", { name: `Back to ${key}-1` })).toBeVisible()

  await captionWithUrl(page, `Click ${key}-2 in the page's TASKS: it opens in the side panel, with a Back to the page`)
  await viewer.getByRole("group", { name: "Linked tasks" }).locator(`[data-task-chip="${key}-2"]`).click()
  await expect(second).toHaveAttribute("data-placement", "side")
  await expect(viewer).toHaveCount(0)
  const backToPage = second.getByRole("button", { name: "Back to Saved library: design" })
  await expect(backToPage).toBeVisible()

  await captionWithUrl(page, "Back: the page is there again, beside the task it came from")
  await backToPage.click()
  await expect(viewer.getByRole("heading", { level: 1, name: "Saved library: design" })).toBeVisible()
  await expect(first).toHaveAttribute("data-placement", "page")
  await expect(page).toHaveURL(new RegExp(`/${key}/1\\?viewer=`))

  await caption(page, `Scroll down to Part 6 and click ${key}-2 in its text: the task opens in the side panel`)
  const reader = viewer.locator("[data-page-reader]")
  // The last mention: the one in Part 6 (the first is in the opening line).
  const inText = viewer.locator(`p [data-task-link="${key}-2"]`).last()
  await inText.scrollIntoViewIfNeeded()
  const scrolled = await reader.evaluate((el) => el.scrollTop)
  expect(scrolled).toBeGreaterThan(200)
  await inText.click()
  await expect(second).toHaveAttribute("data-placement", "side")

  await caption(page, "Back: the page comes back scrolled where it was")
  await backToPage.click()
  await expect(viewer.getByRole("heading", { level: 2, name: "Part 6" })).toBeVisible()
  expect(await reader.evaluate((el) => el.scrollTop)).toBe(scrolled)

  await captionWithUrl(page, `Browser forward goes to ${key}-2 again; ⌘[ comes back to the page`)
  await page.goForward()
  await expect(second).toHaveAttribute("data-placement", "side")
  await page.keyboard.press("ControlOrMeta+BracketLeft")
  await expect(viewer.getByRole("heading", { level: 1, name: "Saved library: design" })).toBeVisible()
  await expect(first).toHaveAttribute("data-placement", "page")

  await captionWithUrl(page, `Forward to ${key}-2 and reload: its Back is still there`)
  await page.goForward()
  await expect(second).toHaveAttribute("data-placement", "side")
  await page.reload()
  await expect(second.getByRole("button", { name: "Back to Saved library: design" })).toBeVisible()

  await caption(page, `A comment on ${key}-2 names ${key}-1: clicking it opens ${key}-1, with a Back to ${key}-2`)
  await second.getByLabel("New comment").fill(`Needs ${key}-1 first.`)
  await second.getByRole("button", { name: "Comment", exact: true }).click()
  await second.locator("[data-comment-id]").last().locator(`[data-task-link="${key}-1"]`).click()
  await expect(first).toHaveAttribute("data-placement", "side")
  await first.getByRole("button", { name: `Back to ${key}-2` }).click()
  await expect(second).toHaveAttribute("data-placement", "side")
  await expect(second.getByRole("button", { name: "Back to Saved library: design" })).toBeVisible()

  await caption(page, "Opened from the board, a task has no Back: nothing was in the panel before")
  await page.goto(`/${key}/issues`)
  await card(page, `${key}-1`).click()
  await expect(first).toHaveAttribute("data-placement", "side")
  await expect(first.getByRole("button", { name: /^Back to/ })).toHaveCount(0)
  await caption(page, "Back always returns to what the side panel showed before")
  fs.rmSync(dir, { recursive: true, force: true })
})

test("CEL-117: in a narrow window (600 px) there's no room for both: the page covers the task, and Back or × brings the task back", async ({ page }) => {
  const key = uniqueKey("PBN")
  await createProject(page, "Panel narrow", key)
  cello("task", "create", "Saved library: replace Chrome bookmarks", "--project", key)
  cello("task", "create", "Import the bookmarks", "--project", key)
  const dir = publish(key)
  await page.setViewportSize({ width: 600, height: 900 })

  await caption(page, "A 600 px window: the open task takes the board's place")
  await page.goto(`/${key}/1`)
  const panel = taskPanel(page, `${key}-1`)
  const viewer = viewerOf(page)
  await expect(panel).toHaveAttribute("data-placement", "side")

  await captionWithUrl(page, "Click its page: the page covers the task, as before, with a Back to it")
  await panel.getByRole("region", { name: "Pages" }).getByRole("link", { name: /Saved library: design/ }).click()
  await expect(viewer.getByRole("heading", { level: 1, name: "Saved library: design" })).toBeVisible()
  await expect(panel).toBeHidden()
  // The page has the room to read: it isn't squeezed beside a task.
  expect((await viewer.boundingBox())!.width).toBeGreaterThanOrEqual(320)

  await caption(page, "Back: the task is there again")
  await viewer.getByRole("button", { name: `Back to ${key}-1` }).click()
  await expect(viewer).toHaveCount(0)
  await expect(panel).toHaveAttribute("data-placement", "side")

  await caption(page, "Open it again and close it with ×: the task is back too")
  await panel.getByRole("region", { name: "Pages" }).getByRole("link", { name: /Saved library: design/ }).click()
  await expect(panel).toBeHidden()
  await viewer.getByRole("button", { name: "Close viewer" }).click()
  await expect(viewer).toHaveCount(0)
  await expect(panel).toHaveAttribute("data-placement", "side")
  await expect(page).toHaveURL(new RegExp(`/${key}/1$`))
  await caption(page, "One panel at a time in a narrow window")
  fs.rmSync(dir, { recursive: true, force: true })
})
