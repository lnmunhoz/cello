// CEL-20: task keys in rendered text link to their task, with its live status: in a page an agent
// published (a progress table), in comments, and from a page shown inside the viewer panel, where a
// click opens the task in the main window.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Browser } from "@playwright/test"
import { caption, captionWithUrl, createProject, expect, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { cello, SHOTS, WEB_URL } from "./packets.ts"
import { isReview } from "./recording.ts"

// Review videos hold every step (e2e/recording.ts), which takes these flows past the default timeout.
test.beforeEach(() => {
  if (isReview(process.env)) test.setTimeout(180_000)
})

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
  await expect(page.locator(`table [data-task-link="${key}-1"] [data-task-status]`).first()).toHaveText("In Progress")
  await page.screenshot({ path: path.join(SHOTS, `task-keys-page-${colorScheme}.png`) })
  await context.close()
}

/** A task's description and a kind-doc page, each naming a task, in unrecorded windows: e2e/videos/task-keys-{description,doc}-<scheme>.png. */
async function screenshotDescriptionAndDoc(browser: Browser, key: string, docPath: string, colorScheme: "light" | "dark") {
  const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 }, colorScheme })
  const page = await context.newPage()
  await page.goto(`/${key}/1`)
  const panel = taskPanel(page, `${key}-1`)
  await panel.getByRole("tab", { name: "Preview" }).click()
  await expect(panel.getByTestId("description-preview").locator(`[data-task-link="${key}-2"] [data-task-status]`)).toHaveText("Todo")
  await page.screenshot({ path: path.join(SHOTS, `task-keys-description-${colorScheme}.png`) })
  await page.goto(docPath)
  await expect(page.getByRole("article").locator(`[data-task-link="${key}-1"] [data-task-status]`).first()).toHaveText("In Progress")
  await page.screenshot({ path: path.join(SHOTS, `task-keys-doc-${colorScheme}.png`) })
  await context.close()
}

/** A kind-doc (how something works) that names the project's tasks, published through the CLI. Returns its path. */
function publishDoc(key: string, dir: string): string {
  const file = path.join(dir, "keys.md")
  fs.writeFileSync(
    file,
    [
      "# How task keys work",
      "",
      `Any key of a task on the board links to it, with its status: ${key}-1 and ${key}-2.`,
      "",
      "## What stays plain",
      "",
      `- keys of tasks that don't exist, like ${key}-99`,
      `- keys in code, like \`cello task claim ${key}-1\``,
    ].join("\n"),
  )
  expect(cello("doc", "publish", file, "--project", key, "--kind", "doc")).toContain(`/${key}/pages/how-task-keys-work`)
  return `/${key}/pages/how-task-keys-work`
}

test("CEL-20: a page's task table links its keys with their live status; moving a task on the board updates the page; a key opens its task; keys in comments link too", async ({ page, browser }) => {
  const key = uniqueKey("KEYS")
  await createProject(page, "Progress links test", key)
  await caption(page, "An agent publishes a progress page with a task table")
  const { path: pagePath, dir } = publishProgress(key)

  await page.goto(pagePath)
  await captionWithUrl(page, "Open the page: the keys are links, each with its task's status")
  const article = page.getByRole("article")
  // Each task's own row (the second row also names the first task, in its notes).
  const first = article.locator("tbody tr").nth(0).locator(`[data-task-link="${key}-1"]`)
  const second = article.locator("tbody tr").nth(1).locator(`[data-task-link="${key}-2"]`)
  await expect(first).toHaveAttribute("href", `/${key}/1`)
  await expect(first).toHaveAttribute("title", `${key}-1 · Link task keys`)
  await expect(first.locator("[data-task-status]")).toHaveText("Todo")
  await expect(second.locator("[data-task-status]")).toHaveText("Todo")
  // In running text too, and in the "after KEY-1" cell.
  await expect(article.locator(`p [data-task-link="${key}-1"]`)).toBeVisible()
  await expect(article.locator(`td [data-task-link="${key}-1"]`)).toHaveCount(2)

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

  await captionWithUrl(page, `Click ${key}-1: its task opens`)
  await first.click()
  await expect(page).toHaveURL(new RegExp(`/${key}/1$`))
  const panel = taskPanel(page, `${key}-1`)
  await expect(panel.getByLabel("Title")).toHaveValue("Link task keys")
  expect(await page.evaluate(() => (window as { stillTheSamePage?: boolean }).stillTheSamePage)).toBe(true)

  await caption(page, "A description that names a task links it, with its status")
  await panel.getByLabel("Description", { exact: true }).fill(`Ships after ${key}-2, so pages show live status.`)
  await panel.getByRole("tab", { name: "Preview" }).click()
  await expect(panel.getByTestId("description-preview").locator(`[data-task-link="${key}-2"] [data-task-status]`)).toHaveText("Todo")

  await caption(page, "A comment that names a task links it too")
  await panel.getByLabel("New comment").fill(`Needs ${key}-2 first, not \`${key}-2\` in code.`)
  await panel.getByRole("button", { name: "Comment", exact: true }).click()
  const comment = panel.locator("[data-comment-id]").last()
  await expect(comment.locator(`[data-task-link="${key}-2"] [data-task-status]`)).toHaveText("Todo")
  await expect(comment.locator("code a")).toHaveCount(0)
  await captionWithUrl(page, `Click ${key}-2 in the comment: its task opens`)
  await comment.locator(`[data-task-link="${key}-2"]`).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/2$`))
  await expect(taskPanel(page, `${key}-2`).getByLabel("Title")).toHaveValue("Live status on pages")
  await captionWithUrl(page, "Task keys link to their task, with its live status")

  // Stills: the description, and a kind-doc page naming the tasks.
  const docPath = publishDoc(key, dir)
  for (const colorScheme of ["light", "dark"] as const) await screenshotDescriptionAndDoc(browser, key, docPath, colorScheme)
  fs.rmSync(dir, { recursive: true, force: true })
})

test("CEL-20, CEL-60: inside the side panel (the page rendered by the app, no iframe), a key in a page opens its task in the main window", async ({ page }) => {
  const key = uniqueKey("KEYV")
  await createProject(page, "Viewer links test", key)
  const { path: pagePath, dir } = publishProgress(key)

  await page.goto(`/${key}/1`)
  await captionWithUrl(page, `Open ${key}-1 and leave a comment with a link to the page`)
  const panel = taskPanel(page, `${key}-1`)
  const pageUrl = `${WEB_URL}${pagePath}`
  await panel.getByLabel("New comment").fill(`Progress: ${pageUrl}`)
  await panel.getByRole("button", { name: "Comment", exact: true }).click()

  await caption(page, "The link opens the page in the viewer, beside the board")
  await panel.locator("[data-comment-id]").getByRole("link", { name: pageUrl }).click()
  const viewer = page.getByRole("complementary", { name: "Viewer" })
  await expect(viewer.getByRole("heading", { level: 1, name: "M2 progress" })).toBeVisible()
  const inFrame = viewer.locator(`table [data-task-link="${key}-2"]`)
  await expect(inFrame.locator("[data-task-status]")).toHaveText("Todo")

  await captionWithUrl(page, `Click ${key}-2 inside the viewer: the task opens in the main window`)
  await page.evaluate(() => Object.assign(window, { stillTheSamePage: true }))
  await inFrame.click()
  await expect(page).toHaveURL(new RegExp(`/${key}/2$`))
  await expect(viewer).toHaveCount(0)
  await expect(taskPanel(page, `${key}-2`).getByLabel("Title")).toHaveValue("Live status on pages")
  // The board navigated in place: no reload, and no second copy of the app inside the panel.
  expect(await page.evaluate(() => (window as { stillTheSamePage?: boolean }).stillTheSamePage)).toBe(true)

  await page.goto(`/${key}/1`)
  await captionWithUrl(page, `Back on ${key}-1, the page's linked-task chip does the same`)
  await panel.locator("[data-comment-id]").getByRole("link", { name: pageUrl }).click()
  await viewer.locator(`[data-task-chip="${key}-2"]`).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/2$`))
  await expect(viewer).toHaveCount(0)
  await expect(taskPanel(page, `${key}-2`)).toBeVisible()

  await page.goto(`/${key}/1`)
  await captionWithUrl(page, `The key of ${key}-1, the task under the viewer: the viewer closes and shows it`)
  await panel.locator("[data-comment-id]").getByRole("link", { name: pageUrl }).click()
  await viewer.locator(`tbody tr`).nth(0).locator(`[data-task-link="${key}-1"]`).click()
  await expect(viewer).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`/${key}/1$`))
  await expect(panel).toBeVisible()
  await captionWithUrl(page, "Keys in a page in the viewer open their task in the main window")
  fs.rmSync(dir, { recursive: true, force: true })
})
