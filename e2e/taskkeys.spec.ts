// CEL-20: task keys in rendered text link to their task, with its live status: in a page an agent
// published (a progress table), in comments, and from a page shown inside the viewer panel, where a
// click opens the task in the main window.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Browser } from "@playwright/test"
import { caption, createProject, expect, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { cello, SHOTS, WEB_URL } from "./packets.ts"

/** Two tasks in Todo and a page with a progress table of them, published through the CLI. Returns the page's path. */
function publishProgress(key: string): { path: string; dir: string } {
  cello("task", "create", "Link task keys", "--project", key, "--status", "Todo")
  cello("task", "create", "Live status on pages", "--project", key, "--status", "Todo")
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-keys-"))
  const file = path.join(dir, "progress.md")
  fs.writeFileSync(
    file,
    [
      "# M2 progress",
      "",
      `Where M2 stands. ${key}-1 goes first; see https://github.com/lnmunhoz/cello/issues?q=${key}-1 for the thread.`,
      "",
      "## Tasks",
      "",
      "| Task | What | Notes |",
      "| --- | --- | --- |",
      `| ${key}-1 | Link task keys | claimed with \`cello task claim ${key}-1\` |`,
      `| ${key}-2 | Live status on pages | after ${key}-1 |`,
      `| ${key}-99 | Not on the board | stays text |`,
    ].join("\n"),
  )
  const out = cello("doc", "publish", file, "--project", key, "--task", `${key}-2`)
  expect(out).toContain(`/${key}/pages/m2-progress`)
  return { path: `/${key}/pages/m2-progress`, dir }
}

/** The page in its own unrecorded window, saved to e2e/videos/task-keys-page-<scheme>.png. */
async function screenshotPage(browser: Browser, url: string, key: string, colorScheme: "light" | "dark") {
  const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 }, colorScheme })
  const page = await context.newPage()
  await page.goto(url)
  await expect(page.locator(`table [data-task-key="${key}-1"] [data-task-status]`).first()).toHaveText("In Progress")
  await page.screenshot({ path: path.join(SHOTS, `task-keys-page-${colorScheme}.png`) })
  await context.close()
}

test("CEL-20: a page's task table links its keys with their live status; moving a task on the board updates the page; a key opens its task; keys in comments link too", async ({ page, browser }) => {
  const key = uniqueKey("KEYS")
  await createProject(page, "Progress links test", key)
  await caption(page, "An agent publishes a progress page with a task table")
  const { path: pagePath, dir } = publishProgress(key)

  await page.goto(pagePath)
  await caption(page, "Open the page: the keys are links, each with its task's status")
  const article = page.getByRole("article")
  // Each task's own row (the second row also names the first task, in its notes).
  const first = article.locator("tbody tr").nth(0).locator(`[data-task-key="${key}-1"]`)
  const second = article.locator("tbody tr").nth(1).locator(`[data-task-key="${key}-2"]`)
  await expect(first).toHaveAttribute("href", `/${key}/1`)
  await expect(first).toHaveAttribute("title", `${key}-1 · Link task keys`)
  await expect(first.locator("[data-task-status]")).toHaveText("Todo")
  await expect(second.locator("[data-task-status]")).toHaveText("Todo")
  // In running text too, and in the "after KEY-1" cell.
  await expect(article.locator(`p [data-task-key="${key}-1"]`)).toBeVisible()
  await expect(article.locator(`td [data-task-key="${key}-1"]`)).toHaveCount(2)

  await caption(page, "Unknown keys, keys in code and keys inside a web address stay as they are")
  await expect(article.locator("td", { hasText: `${key}-99` }).locator("a")).toHaveCount(0)
  await expect(article.locator("code", { hasText: `cello task claim ${key}-1` }).locator("a")).toHaveCount(0)
  await expect(article.getByRole("link", { name: `https://github.com/lnmunhoz/cello/issues?q=${key}-1` })).toBeVisible()

  await caption(page, `${key}-1 moves to In Progress on the board: the page updates live`)
  await page.evaluate(() => Object.assign(window, { stillTheSamePage: true }))
  cello("task", "move", `${key}-1`, "In Progress")
  await expect(first.locator("[data-task-status]")).toHaveText("In Progress")
  await expect(second.locator("[data-task-status]")).toHaveText("Todo")
  expect(await page.evaluate(() => (window as { stillTheSamePage?: boolean }).stillTheSamePage)).toBe(true)
  for (const colorScheme of ["light", "dark"] as const) await screenshotPage(browser, pagePath, key, colorScheme)

  await caption(page, `Click ${key}-1: its task opens`)
  await first.click()
  await expect(page).toHaveURL(new RegExp(`/${key}/1$`))
  const panel = taskPanel(page, `${key}-1`)
  await expect(panel.getByLabel("Title")).toHaveValue("Link task keys")
  expect(await page.evaluate(() => (window as { stillTheSamePage?: boolean }).stillTheSamePage)).toBe(true)

  await caption(page, "A comment that names a task links it too, with its status")
  await panel.getByLabel("New comment").fill(`Needs ${key}-2 first, not \`${key}-2\` in code.`)
  await panel.getByRole("button", { name: "Comment", exact: true }).click()
  const comment = panel.locator("[data-comment-id]").last()
  await expect(comment.locator(`[data-task-key="${key}-2"] [data-task-status]`)).toHaveText("Todo")
  await expect(comment.locator("code a")).toHaveCount(0)
  await comment.locator(`[data-task-key="${key}-2"]`).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/2$`))
  await expect(taskPanel(page, `${key}-2`).getByLabel("Title")).toHaveValue("Live status on pages")
  await caption(page, "Task keys link to their task, with its live status")
  fs.rmSync(dir, { recursive: true, force: true })
})

test("CEL-20: inside the viewer panel, a key in a page opens its task in the main window, not in the panel", async ({ page }) => {
  const key = uniqueKey("KEYV")
  await createProject(page, "Viewer links test", key)
  const { path: pagePath, dir } = publishProgress(key)

  await page.goto(`/${key}/1`)
  await caption(page, `Open ${key}-1 and leave a comment with a link to the page`)
  const panel = taskPanel(page, `${key}-1`)
  const pageUrl = `${WEB_URL}${pagePath}`
  await panel.getByLabel("New comment").fill(`Progress: ${pageUrl}`)
  await panel.getByRole("button", { name: "Comment", exact: true }).click()

  await caption(page, "The link opens the page in the viewer, beside the board")
  await panel.locator("[data-comment-id]").getByRole("link", { name: pageUrl }).click()
  const viewer = page.getByRole("complementary", { name: "Viewer" })
  const frame = viewer.frameLocator("iframe")
  await expect(frame.getByRole("heading", { level: 1, name: "M2 progress" })).toBeVisible()
  const inFrame = frame.locator(`table [data-task-key="${key}-2"]`)
  await expect(inFrame.locator("[data-task-status]")).toHaveText("Todo")

  await caption(page, `Click ${key}-2 inside the viewer: the task opens in the main window`)
  await page.evaluate(() => Object.assign(window, { stillTheSamePage: true }))
  await inFrame.click()
  await expect(page).toHaveURL(new RegExp(`/${key}/2$`))
  await expect(viewer).toHaveCount(0)
  await expect(taskPanel(page, `${key}-2`).getByLabel("Title")).toHaveValue("Live status on pages")
  // The board navigated in place: no reload, and no second copy of the app inside the panel.
  expect(await page.evaluate(() => (window as { stillTheSamePage?: boolean }).stillTheSamePage)).toBe(true)

  await page.goto(`/${key}/1`)
  await caption(page, `Back on ${key}-1, the page's linked-task chip does the same`)
  await panel.locator("[data-comment-id]").getByRole("link", { name: pageUrl }).click()
  await frame.locator(`[data-task-chip="${key}-2"]`).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/2$`))
  await expect(viewer).toHaveCount(0)
  await expect(taskPanel(page, `${key}-2`)).toBeVisible()
  await caption(page, "Keys in a page in the viewer open their task in the main window")
  fs.rmSync(dir, { recursive: true, force: true })
})
