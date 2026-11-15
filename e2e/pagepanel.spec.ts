// CEL-60: Cello's own pages and text files open in the side panel beside the board, rendered natively
// (the page reader, a text view), never as a website: from a task's Pages list, from a link in a
// comment and from a link inside a page; a packet's text evidence (a terminal transcript, markdown)
// opens there too. The panel resizes and remembers its width, expands to the full page and closes.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Browser, Page } from "@playwright/test"
import { caption, captionWithUrl, card, createProject, expect, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { cello, SHOTS, WEB_URL } from "./packets.ts"

const viewerOf = (page: Page) => page.getByRole("complementary", { name: "Viewer" })

/** Drags the side panel's left edge by `dx` px (negative: to the left, wider) with the mouse. */
async function dragEdge(page: Page, dx: number) {
  const handle = viewerOf(page).getByRole("separator", { name: "Resize viewer" })
  const box = (await handle.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y, { steps: 12 })
  await page.mouse.up()
}

const width = async (page: Page) => Math.round((await viewerOf(page).boundingBox())!.width)

/** What a terminal transcript looks like on disk: colour codes and all. */
const TRANSCRIPT = [
  "$ bun run test",
  "\u001b[32m✓\u001b[39m apps/web/src/viewer/viewer.test.ts \u001b[2m(44 tests)\u001b[22m",
  "\u001b[32m✓\u001b[39m apps/web/src/viewer/text.test.ts \u001b[2m(12 tests)\u001b[22m",
  "",
  " \u001b[1mTest Files\u001b[22m  \u001b[1m\u001b[32m2 passed\u001b[39m\u001b[22m (2)",
  "      \u001b[1mTests\u001b[22m  \u001b[1m\u001b[32m56 passed\u001b[39m\u001b[22m (56)",
  "",
].join("\n")

const notes = (key: string) =>
  [
    "# Panel notes",
    "",
    `How ${key}-1 shows Cello's own pages beside the board, and where each kind of file opens.`,
    "",
    "## Findings",
    "",
    "Pages render in the page reader, in the side panel, the way the task panel docks. The test run is in [the test log](run.log).",
    "",
    "## Next steps",
    "",
    "- Read it beside the board",
    "- Expand it when it needs the room",
    "",
  ].join("\n")

/** The board with the side panel showing `open`'s result, in an unrecorded window, saved to e2e/videos/page-panel-<what>-<scheme>.png. */
async function still(browser: Browser, key: string, what: string, colorScheme: "light" | "dark", open: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 }, colorScheme })
  const page = await context.newPage()
  await page.goto(`/${key}/1`)
  await open(page)
  await page.screenshot({ path: path.join(SHOTS, `page-panel-${what}-${colorScheme}.png`) })
  await context.close()
}

test("CEL-60: a Cello page opens in the side panel from the task's Pages list and a comment link; it resizes, keeps its width, expands to the full page and closes; a task chip in it opens the task", async ({ page, browser }) => {
  const key = uniqueKey("PNL")
  await createProject(page, "Page panel", key)

  await caption(page, "An agent publishes a page linked to the task, with a link to a test log")
  cello("task", "create", "Pages in the side panel", "--project", key)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-pagepanel-"))
  fs.writeFileSync(path.join(dir, "run.log"), TRANSCRIPT)
  const file = path.join(dir, "panel-notes.md")
  fs.writeFileSync(file, notes(key))
  const pageUrl = cello("doc", "publish", file, "--project", key, "--task", `${key}-1`).split("\n").at(-1)!
  expect(pageUrl).toMatch(new RegExp(`/${key}/pages/panel-notes$`))

  await caption(page, "Open the task; its Pages list has the page")
  await card(page, `${key}-1`).click()
  const panel = taskPanel(page, `${key}-1`)
  const viewer = viewerOf(page)
  const pages = panel.getByRole("region", { name: "Pages" })

  await captionWithUrl(page, "Click it: the page opens in the side panel, in the task panel's place, rendered by the app (no iframe)")
  await pages.getByRole("link", { name: /Panel notes/ }).click()
  await expect(viewer.getByRole("heading", { level: 1, name: "Panel notes" })).toBeVisible()
  await expect(viewer.locator("iframe")).toHaveCount(0)
  await expect(panel).toBeHidden()
  await expect(page).toHaveURL(new RegExp(`/${key}/1$`))
  // Docked on the right at full height: from the main area's top edge to its bottom, like the task panel.
  const main = (await page.locator("main").boundingBox())!
  const box = (await viewer.boundingBox())!
  expect(Math.abs(box.y - main.y)).toBeLessThanOrEqual(2)
  expect(Math.abs(box.x + box.width - (main.x + main.width))).toBeLessThanOrEqual(2)
  expect(Math.abs(box.height - main.height)).toBeLessThanOrEqual(2)

  await caption(page, "Drag its left edge: it gets wider")
  const before = await width(page)
  await dragEdge(page, -160)
  const wider = await width(page)
  expect(wider).toBeGreaterThan(before + 100)

  await caption(page, "Close it: the task is back, where it was")
  await viewer.getByRole("button", { name: "Close viewer" }).click()
  await expect(viewer).toHaveCount(0)
  await expect(panel).toBeVisible()

  await captionWithUrl(page, "After a reload, it opens at the width it was left at")
  await page.reload()
  await pages.getByRole("link", { name: /Panel notes/ }).click()
  await expect(viewer.getByRole("heading", { level: 1, name: "Panel notes" })).toBeVisible()
  expect(await width(page)).toBe(wider)

  await caption(page, "The page's task chip opens the task, even the one under the panel")
  await viewer.getByRole("group", { name: "Linked tasks" }).getByRole("link", { name: new RegExp(`${key}-1`) }).click()
  await expect(viewer).toHaveCount(0)
  await expect(panel).toBeVisible()

  await captionWithUrl(page, "Expand to full page: the page takes the board's place, and Back returns to the task")
  await pages.getByRole("link", { name: /Panel notes/ }).click()
  await viewer.getByRole("button", { name: "Expand to full page" }).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/pages/panel-notes$`))
  await expect(viewer).toHaveCount(0)
  await expect(page.getByRole("heading", { level: 1, name: "Panel notes" })).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/${key}/1$`))
  await expect(panel).toBeVisible()

  await caption(page, "A comment with the page's address: it opens in the side panel too")
  // The board's own address for it (the e2e board is served on its own port, in front of the server).
  const boardPageUrl = `${WEB_URL}/${key}/pages/panel-notes`
  await panel.getByLabel("New comment").fill(`Notes are at ${boardPageUrl}`)
  await panel.getByRole("button", { name: "Comment", exact: true }).click()
  await panel.locator("[data-comment-id]").getByRole("link", { name: boardPageUrl }).click()
  await expect(viewer.getByRole("heading", { level: 1, name: "Panel notes" })).toBeVisible()
  await expect(viewer.locator("iframe")).toHaveCount(0)

  await caption(page, "The page's link to its test log: the log shows in the side panel as text, without its colour codes")
  await viewer.getByRole("link", { name: "the test log" }).click()
  const log = viewer.locator("pre[data-text-view=plain]")
  await expect(log).toContainText("56 passed (56)")
  expect(await log.textContent()).not.toContain("\u001b")
  await expect(viewer.getByRole("link", { name: "Download" })).toHaveAttribute("download", "run.log")

  await caption(page, "Esc closes it")
  await page.keyboard.press("Escape")
  await expect(viewer).toHaveCount(0)
  await expect(panel).toBeVisible()
  await caption(page, "Pages open beside the board, in the app's own side panel")

  for (const scheme of ["light", "dark"] as const) {
    await still(browser, key, "reader", scheme, async (p) => {
      await taskPanel(p, `${key}-1`).getByRole("region", { name: "Pages" }).getByRole("link", { name: /Panel notes/ }).click()
      await expect(viewerOf(p).getByRole("heading", { level: 1, name: "Panel notes" })).toBeVisible()
    })
  }
  fs.rmSync(dir, { recursive: true, force: true })
})

test("CEL-60: a packet's text evidence (a terminal transcript, markdown) opens in the side panel as text, with Copy and Download", async ({ page, browser }) => {
  const key = uniqueKey("TXT")
  await createProject(page, "Text evidence", key)
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])

  await caption(page, "An agent submits a packet with a terminal transcript and a markdown file")
  cello("task", "create", "Text evidence in the side panel", "--project", key)
  cello("task", "claim", `${key}-1`)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-textevidence-"))
  const transcript = path.join(dir, "transcript.txt")
  fs.writeFileSync(transcript, TRANSCRIPT)
  const release = path.join(dir, "release-notes.md")
  fs.writeFileSync(release, "# Release notes\n\nText evidence opens **beside the board**.\n\n- Transcripts in monospace\n- Markdown like a page\n")
  cello(
    "task", "submit", `${key}-1`,
    "--summary", "Text evidence opens in the side panel.",
    "--step", "Open the transcript from the packet",
    "--attach", transcript, "--caption", "Terminal transcript",
    "--attach", release, "--caption", "Release notes",
  )

  await caption(page, "Open the task; its packet lists the two files")
  await card(page, `${key}-1`).click()
  const panel = taskPanel(page, `${key}-1`)
  const packet = panel.getByRole("region", { name: "Review packet" })
  const viewer = viewerOf(page)

  await caption(page, "Click the transcript: it shows in the side panel, in monospace, wrapped, without colour codes")
  await packet.getByRole("link", { name: "Open transcript.txt" }).click()
  const text = viewer.locator("pre[data-text-view=plain]")
  await expect(text).toContainText("Test Files  2 passed (2)")
  expect(await text.textContent()).not.toContain("\u001b")
  expect(await text.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("pre-wrap")
  expect(await text.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/mono/i)
  await expect(viewer.getByRole("heading", { name: "Terminal transcript" })).toBeVisible()
  await expect(panel).toBeHidden()

  await caption(page, "Copy puts the text, without colour codes, on the clipboard; Download saves it as transcript.txt")
  await viewer.getByRole("button", { name: "Copy" }).click()
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("Copied")).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("56 passed (56)")
  const download = page.waitForEvent("download")
  await viewer.getByRole("link", { name: "Download" }).click()
  expect((await download).suggestedFilename()).toBe("transcript.txt")

  await caption(page, "Close it, then open the markdown file: it reads like a page")
  await viewer.getByRole("button", { name: "Close viewer" }).click()
  await expect(panel).toBeVisible()
  await packet.getByRole("link", { name: "Open release-notes.md" }).click()
  const markdown = viewer.locator("[data-text-view=markdown]")
  await expect(markdown.getByRole("heading", { name: "Release notes" })).toBeVisible()
  await expect(markdown.locator("strong")).toHaveText("beside the board")
  await expect(markdown.getByRole("listitem")).toHaveText(["Transcripts in monospace", "Markdown like a page"])

  await caption(page, "Esc brings the task back")
  await page.keyboard.press("Escape")
  await expect(viewer).toHaveCount(0)
  await expect(panel).toBeVisible()
  await caption(page, "Text evidence opens in the side panel, never the built-in browser")

  for (const scheme of ["light", "dark"] as const) {
    await still(browser, key, "transcript", scheme, async (p) => {
      await taskPanel(p, `${key}-1`).getByRole("region", { name: "Review packet" }).getByRole("link", { name: "Open transcript.txt" }).click()
      await expect(viewerOf(p).locator("pre[data-text-view=plain]")).toContainText("56 passed")
    })
  }
  fs.rmSync(dir, { recursive: true, force: true })
})
