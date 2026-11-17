// CEL-141: a task link on a page that isn't the task's board (the Review page's asks and packets, a doc
// page) opens the task in that page's side panel, and the page stays where it was: no jump to the
// project's board. Back returns to what the panel showed before, closing it leaves you where you were,
// Open in board takes you to the board, and ⌘-click still opens the task's own page in a new tab.
// Stills of the Review page with a task beside it, in light and dark, go to e2e/videos/.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Browser, Page } from "@playwright/test"
import { caption, captionWithUrl, createProject, expect, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { cello, SHOTS, WEB_URL } from "./packets.ts"
import { isReview } from "./recording.ts"

// Review videos hold every step (e2e/recording.ts), which takes this flow past the default timeout.
test.beforeEach(() => {
  if (isReview(process.env)) test.setTimeout(180_000)
})

const viewerOf = (page: Page) => page.getByRole("complementary", { name: "Viewer" })

/** The page is at `pathname`, with task `key` in its side panel. */
const showsBeside = (pathname: string, key: string) => (url: URL) => {
  const [projectKey, number] = key.split("-")
  return url.pathname === pathname && url.searchParams.get("viewer") === `/${projectKey}/${number}`
}

/**
 * KEY-1 asks a question whose intro names KEY-2 and KEY-3, KEY-4 is handed in with a packet that names
 * KEY-2, and a doc names KEY-2. Returns the folder to remove and the doc's path.
 */
function seed(key: string): { dir: string; docPath: string } {
  cello("task", "create", "Saved library: the design", "--project", key)
  cello("task", "create", "Import the bookmarks", "--project", key)
  cello("task", "create", "Export the library", "--project", key)
  cello("task", "create", "Library search", "--project", key)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-tasklinks-"))
  cello("task", "claim", `${key}-1`)
  fs.writeFileSync(
    path.join(dir, "ask.yaml"),
    [
      "title: Which import first?",
      `intro: The import is ${key}-2; ${key}-3 exports what it imports.`,
      "questions:",
      "  - prompt: Ship the import before the export?",
      "    options:",
      "      - label: Import first",
      "        recommended: true",
      "        because: Nothing to export until it's in",
      "      - label: Both together",
    ].join("\n"),
  )
  cello("task", "ask", `${key}-1`, "--file", path.join(dir, "ask.yaml"))
  cello("task", "claim", `${key}-4`)
  cello("task", "submit", `${key}-4`, "--summary", `Search over the library, built on the import (${key}-2).`, "--step", `Search for a bookmark ${key}-2 imported`, "--link", "https://github.com/lnmunhoz/cello/pull/141", "--caption", "The PR")
  fs.writeFileSync(path.join(dir, "library-plan.md"), ["# Library plan", "", `The import comes first: ${key}-2.`].join("\n"))
  cello("doc", "publish", path.join(dir, "library-plan.md"), "--project", key)
  return { dir, docPath: `/${key}/pages/library-plan` }
}

/** The Review page with the ask open and KEY-2 beside it, in an unrecorded window: e2e/videos/cel-141-review-task-panel-<scheme>.png. */
async function still(browser: Browser, key: string, colorScheme: "light" | "dark") {
  const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 }, colorScheme })
  const page = await context.newPage()
  await page.goto(`/review?open=${key}-1&viewer=%2F${key}%2F2`)
  await expect(viewerOf(page).getByLabel("Title")).toHaveValue("Import the bookmarks")
  await expect(page.locator(`[data-review-task="${key}-1"] [data-ask]`)).toBeVisible()
  await page.screenshot({ path: path.join(SHOTS, `cel-141-review-task-panel-${colorScheme}.png`) })
  await context.close()
}

test("CEL-141: a task key in an ask or a packet on the Review page, or in a doc, opens the task in that page's side panel; Back, close, Open in board and ⌘-click", async ({ page, context, browser }) => {
  const key = uniqueKey("TLP")
  await createProject(page, "Task links", key)
  const { dir, docPath } = seed(key)

  await caption(page, `${key}-1 asks a question that names ${key}-2: open it on the Review page`)
  await page.goto(`/review?open=${key}-1`)
  const ask = page.locator(`[data-review-task="${key}-1"] [data-ask]`)
  const inAsk = ask.locator(`[data-task-link="${key}-2"]`)
  await expect(inAsk).toHaveAttribute("href", `/${key}/2`)
  await page.evaluate(() => Object.assign(window, { stillTheSamePage: true }))

  await captionWithUrl(page, `Click ${key}-2 in the ask: it opens in the side panel, and Review stays`)
  await inAsk.click()
  const viewer = viewerOf(page)
  await expect(page).toHaveURL(showsBeside("/review", `${key}-2`))
  await expect(viewer.getByRole("heading", { name: `${key}-2 Import the bookmarks` })).toBeVisible()
  await expect(viewer.getByLabel("Title")).toHaveValue("Import the bookmarks")
  await expect(ask).toBeVisible()
  // The board never showed: no project page, no docked task.
  await expect(taskPanel(page, `${key}-2`)).toHaveCount(0)
  expect(await page.evaluate(() => (window as { stillTheSamePage?: boolean }).stillTheSamePage)).toBe(true)

  await caption(page, `A comment on ${key}-2 names ${key}-3: click it, and ${key}-3 replaces it, with a Back to ${key}-2`)
  await viewer.getByLabel("New comment").fill(`Exports go in ${key}-3.`)
  await viewer.getByRole("button", { name: "Comment", exact: true }).click()
  await viewer.locator("[data-comment-id]").last().locator(`[data-task-link="${key}-3"]`).click()
  await expect(page).toHaveURL(showsBeside("/review", `${key}-3`))
  await expect(viewer.getByLabel("Title")).toHaveValue("Export the library")

  await captionWithUrl(page, `Back: ${key}-2 again, still on Review`)
  await viewer.getByRole("button", { name: `Back to ${key}-2` }).click()
  await expect(page).toHaveURL(showsBeside("/review", `${key}-2`))
  await expect(viewer.getByLabel("Title")).toHaveValue("Import the bookmarks")

  await captionWithUrl(page, "Close the panel: Review, exactly as it was, the ask still open")
  await viewer.getByRole("button", { name: "Close viewer" }).click()
  await expect(viewer).toHaveCount(0)
  await expect(page).toHaveURL((url) => url.pathname === "/review" && url.searchParams.get("open") === `${key}-1` && !url.searchParams.has("viewer"))
  await expect(ask).toBeVisible()

  await caption(page, `${key}-4's packet names ${key}-2 too: open it, and click the key in its summary`)
  await page.locator(`[data-review-row="${key}-4"]`).click()
  const packet = page.locator(`[data-review-task="${key}-4"]`)
  await packet.locator(`[data-task-link="${key}-2"]`).first().click()
  await expect(page).toHaveURL(showsBeside("/review", `${key}-2`))
  await expect(viewer.getByLabel("Title")).toHaveValue("Import the bookmarks")

  await captionWithUrl(page, `"Open ${key}-4" on the packet does the same: the packet's own task, beside it`)
  await packet.getByRole("link", { name: `Open ${key}-4` }).click()
  await expect(page).toHaveURL(showsBeside("/review", `${key}-4`))
  await expect(viewer.getByLabel("Title")).toHaveValue("Library search")

  await caption(page, `⌘-click a key: the task's own page opens in a new tab, and this one stays`)
  const [tab] = await Promise.all([context.waitForEvent("page"), packet.locator(`[data-task-link="${key}-2"]`).first().click({ modifiers: ["ControlOrMeta"] })])
  await expect(tab).toHaveURL(new RegExp(`/${key}/2$`))
  await tab.close()
  await expect(page).toHaveURL(showsBeside("/review", `${key}-4`))

  await captionWithUrl(page, "A doc page that names a task: the key opens it beside the doc")
  await page.goto(docPath)
  await page.locator(`[data-page-reader] [data-task-link="${key}-2"]`).click()
  await expect(page).toHaveURL(showsBeside(docPath, `${key}-2`))
  await expect(viewer.getByLabel("Title")).toHaveValue("Import the bookmarks")
  await expect(page.getByRole("heading", { level: 1, name: "Library plan" })).toBeVisible()

  await captionWithUrl(page, "Open in board: now the task on its project's board")
  await viewer.getByRole("button", { name: "Open in board" }).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/2$`))
  await expect(taskPanel(page, `${key}-2`).getByLabel("Title")).toHaveValue("Import the bookmarks")
  await caption(page, "A task link opens beside the page you're on")

  for (const scheme of ["light", "dark"] as const) await still(browser, key, scheme)
  fs.rmSync(dir, { recursive: true, force: true })
})
