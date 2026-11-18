// CEL-60: Cello's own pages and text files open in the side panel beside the board, rendered natively
// (the page reader, a text view), never as a website: from a task's Pages list, from a link in a
// comment and from a link inside a page; a packet's text evidence (a terminal transcript, markdown)
// opens there too. The panel resizes and remembers its width, expands to the full page and closes.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Browser, Locator, Page } from "@playwright/test"
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

/** A 1.5 MB test log: 30,000 numbered lines of 50 bytes. The panel shows only its first 1 MB. */
const BIG_LINES = 30_000
const BIG_LOG = Array.from({ length: BIG_LINES }, (_, i) => `line ${String(i + 1).padStart(6, "0")} ${"x".repeat(37)}\n`).join("")
const BIG_LAST_LINE = `line ${String(BIG_LINES).padStart(6, "0")} `

const notes = (key: string) =>
  [
    "# Panel notes",
    "",
    `How ${key}-1 shows Cello's own pages beside the board, and where each kind of file opens.`,
    "",
    "## Findings",
    "",
    `Pages render in the page reader, in the side panel, the way the task panel docks. The test run is in [the test log](run.log). See [the task it was built under](/${key}/1).`,
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
  // The second line is the page's address; the third its cello:// link, for replies (CEL-88).
  const pageUrl = cello("doc", "publish", file, "--project", key, "--task", `${key}-1`).split("\n")[1]!
  expect(pageUrl).toMatch(new RegExp(`/${key}/pages/panel-notes$`))

  await caption(page, "Open the task; its Pages list has the page")
  await card(page, `${key}-1`).click()
  const panel = taskPanel(page, `${key}-1`)
  const viewer = viewerOf(page)
  const pages = panel.getByRole("region", { name: "Pages" })

  await captionWithUrl(page, "Click it: the page opens in the side panel, rendered by the app (no iframe); the task moves to the main area beside it")
  await pages.getByRole("link", { name: /Panel notes/ }).click()
  await expect(viewer.getByRole("heading", { level: 1, name: "Panel notes" })).toBeVisible()
  await expect(viewer.locator("iframe")).toHaveCount(0)
  await expect(panel).toHaveAttribute("data-placement", "page")
  await expect(page).toHaveURL(new RegExp(`/${key}/1\\?viewer=`))
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

  await caption(page, "Close it: the task is back in the side panel, where it was")
  await viewer.getByRole("button", { name: "Close viewer" }).click()
  await expect(viewer).toHaveCount(0)
  await expect(panel).toHaveAttribute("data-placement", "side")

  await captionWithUrl(page, "After a reload, it opens at the width it was left at")
  await page.reload()
  await pages.getByRole("link", { name: /Panel notes/ }).click()
  await expect(viewer.getByRole("heading", { level: 1, name: "Panel notes" })).toBeVisible()
  expect(await width(page)).toBe(wider)

  await caption(page, "The page's task chip opens the task, even the one under the panel")
  await viewer.getByRole("group", { name: "Linked tasks" }).getByRole("link", { name: new RegExp(`${key}-1`) }).click()
  await expect(viewer).toHaveCount(0)
  await expect(panel).toBeVisible()

  await caption(page, "A hand-written link to the task in the page opens the task too, not a page in the panel")
  await pages.getByRole("link", { name: /Panel notes/ }).click()
  const taskLink = viewer.getByRole("link", { name: "the task it was built under" })
  await expect(taskLink).toHaveAttribute("href", `/${key}/1`)
  await taskLink.click()
  await expect(viewer).toHaveCount(0)
  await expect(panel).toBeVisible()

  await captionWithUrl(page, "Expand to full page: the page takes the board's place, and Back returns to the task with the page beside it")
  await pages.getByRole("link", { name: /Panel notes/ }).click()
  await viewer.getByRole("button", { name: "Expand to full page" }).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/pages/panel-notes$`))
  await expect(viewer).toHaveCount(0)
  await expect(page.getByRole("heading", { level: 1, name: "Panel notes" })).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/${key}/1\\?viewer=`))
  await expect(panel).toHaveAttribute("data-placement", "page")
  await expect(viewer.getByRole("heading", { level: 1, name: "Panel notes" })).toBeVisible()
  await viewer.getByRole("button", { name: "Close viewer" }).click()
  await expect(panel).toHaveAttribute("data-placement", "side")

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
  const bigLog = path.join(dir, "full-test.log")
  fs.writeFileSync(bigLog, BIG_LOG)
  cello(
    "task", "submit", `${key}-1`,
    "--summary", "Text evidence opens in the side panel.",
    "--step", "Open the transcript from the packet",
    "--attach", transcript, "--caption", "Terminal transcript",
    "--attach", release, "--caption", "Release notes",
    "--attach", bigLog, "--caption", "Full test log",
  )

  await caption(page, "Open the task; its packet lists the files")
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
  await expect(panel).toHaveAttribute("data-placement", "page")

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

  await caption(page, "A 1.5 MB log: the panel shows its first 1 MB and says so; Copy copies what's shown")
  await viewer.getByRole("button", { name: "Close viewer" }).click()
  await packet.getByRole("link", { name: "Open full-test.log" }).click()
  await expect(viewer.getByRole("note")).toHaveText("Showing the first 1 MB. Download for all of it.")
  const big = viewer.locator("pre[data-text-view=plain]")
  await expect(big).toContainText("line 000001 ")
  expect(await big.evaluate((el) => el.textContent!.length)).toBeLessThanOrEqual(1024 * 1024)
  expect(await big.textContent()).not.toContain(BIG_LAST_LINE)
  await viewer.getByRole("button", { name: "Copy" }).click()
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("Copied the first 1 MB")).toBeVisible()
  await expect(viewer.getByRole("link", { name: "Download" })).toHaveAttribute("download", "full-test.log")

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

// CEL-173: a unified diff opens in the side panel as a diff view (unified or split), not plain text.

const LONG_URL = `https://example.com/${"a".repeat(120)}`

/** What an agent attaches as `thai-138-diff.txt`: a note on the first line, six files, the last hunk ending without a newline. */
const THAI_138_DIFF = [
  "The diff (the AGENTS.md hunk at the end is THAI-137's, not this task's)",
  "",
  "diff --git a/LIFECYCLE.md b/LIFECYCLE.md",
  "index 3f2a9c1..8b7d4e0 100644",
  "--- a/LIFECYCLE.md",
  "+++ b/LIFECYCLE.md",
  "@@ -18,3 +18,3 @@ ## Workflows",
  " A task goes from Todo to Done.",
  "-Each task is built in a worktree.",
  "+Each task is built in its own worktree.",
  " The reviewer reads the diff.",
  "@@ -23,3 +23,6 @@ ## Landing",
  " Work lands on main.",
  "+Merging needs the human's approval.",
  "+A release is never cut unprompted.",
  `+See ${LONG_URL}`,
  " The branch is deleted after.",
  " Nothing is pushed.",
  "diff --git a/docs/old-dev.md b/docs/dev-server.md",
  "similarity index 91%",
  "rename from docs/old-dev.md",
  "rename to docs/dev-server.md",
  "index 1111111..2222222 100644",
  "--- a/docs/old-dev.md",
  "+++ b/docs/dev-server.md",
  "@@ -1,2 +1,2 @@",
  " # Dev server",
  "-The server listens on 4748.",
  "+The server listens on 4748, the web app on 5199.",
  "diff --git a/docs/previews.md b/docs/previews.md",
  "new file mode 100644",
  "index 0000000..3333333",
  "--- /dev/null",
  "+++ b/docs/previews.md",
  "@@ -0,0 +1,3 @@",
  "+# Previews",
  "+",
  "+A preview build has its own channel.",
  "diff --git a/notes/todo.md b/notes/todo.md",
  "deleted file mode 100644",
  "index 4444444..0000000",
  "--- a/notes/todo.md",
  "+++ /dev/null",
  "@@ -1,2 +0,0 @@",
  "-- find a name",
  "-- ship it",
  "diff --git a/art/logo.png b/art/logo.png",
  "index 5555555..6666666 100644",
  "Binary files a/art/logo.png and b/art/logo.png differ",
  "diff --git a/AGENTS.md b/AGENTS.md",
  "index 7777777..8888888 100644",
  "--- a/AGENTS.md",
  "+++ b/AGENTS.md",
  "@@ -40,2 +40,3 @@ ## Commands",
  " Docker runs need OrbStack.",
  "-Versions are pinned.",
  "\\ No newline at end of file",
  "+Versions are pinned: Bun 1.4.4.",
  "+Effect 4.1.4.",
  "\\ No newline at end of file",
  "",
].join("\n")

/** A `git format-patch` email: header, message, stat block, one file, the signature. */
const PATCH = [
  "From 1234567890abcdef1234567890abcdef12345678 Mon Sep 17 00:00:00 2001",
  "From: Ada Lovelace <ada@example.com>",
  "Date: Tue, 18 Nov 2026 10:00:00 +0000",
  "Subject: [PATCH] Fix the thing",
  "",
  "The thing was broken.",
  "---",
  " a.txt | 2 +-",
  " 1 file changed, 1 insertion(+), 1 deletion(-)",
  "",
  "diff --git a/a.txt b/a.txt",
  "index 1111111..2222222 100644",
  "--- a/a.txt",
  "+++ b/a.txt",
  "@@ -1,2 +1,2 @@",
  " same",
  "-broken",
  "+fixed",
  "-- ",
  "2.43.0",
  "",
].join("\n")

/** One new file of 3,000 lines: over the 1,500 a diff shows at first. */
const BIG_DIFF = [
  "diff --git a/big.txt b/big.txt",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/big.txt",
  "@@ -0,0 +1,3000 @@",
  ...Array.from({ length: 3000 }, (_, i) => `+row ${i + 1}`),
  "",
].join("\n")

/** A task with a packet whose evidence is `thai-138-diff.txt`, opened from the task panel's packet list. Returns the temp folder to remove. */
function submitDiffPacket(key: string) {
  cello("task", "create", "Diff evidence in the side panel", "--project", key)
  cello("task", "claim", `${key}-1`)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-diff-"))
  const file = path.join(dir, "thai-138-diff.txt")
  fs.writeFileSync(file, THAI_138_DIFF)
  cello("task", "submit", `${key}-1`, "--summary", "A diff as evidence.", "--step", "Open the diff from the packet", "--attach", file, "--caption", "The diff")
  return dir
}

const openDiff = (page: Page, key: string) =>
  taskPanel(page, `${key}-1`).getByRole("region", { name: "Review packet" }).getByRole("link", { name: "Open thai-138-diff.txt" }).click()

const showAs = (page: Page, name: "Unified" | "Split" | "Raw") => viewerOf(page).getByRole("radio", { name })

const background = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).backgroundColor)

test("CEL-173: a diff in a packet opens as a diff view: files with their status and counts, hunks, line numbers, red and green lines; Raw shows the text; it wraps at the narrowest width", async ({ page, browser }) => {
  const key = uniqueKey("DIF")
  await createProject(page, "Diff evidence", key)
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])

  await caption(page, "An agent submits a packet whose evidence is a git diff, saved as thai-138-diff.txt")
  const dir = submitDiffPacket(key)
  await caption(page, "Open the task and click the diff in its packet")
  await card(page, `${key}-1`).click()
  await openDiff(page, key)
  const viewer = viewerOf(page)

  await caption(page, "It opens as a diff: a summary, then one section per file with its status and counts")
  await expect(viewer.locator("[data-diff-summary]")).toContainText("6 files changed · +10 −5")
  const files = viewer.locator("section[data-diff-file]")
  await expect(files).toHaveCount(6)
  expect(await files.evaluateAll((els) => els.map((el) => el.getAttribute("data-diff-file")))).toEqual(["modified", "renamed", "added", "deleted", "modified", "modified"])
  await expect(viewer.getByRole("region", { name: "docs/dev-server.md" })).toContainText("docs/old-dev.md → docs/dev-server.md")
  await expect(viewer.getByRole("region", { name: "docs/previews.md" })).toContainText("Added")
  await expect(viewer.getByRole("region", { name: "notes/todo.md" })).toContainText("Deleted")
  await expect(viewer.getByRole("region", { name: "art/logo.png" })).toContainText("Binary file, not shown")
  await expect(viewer.locator("[data-diff-text]").first()).toContainText("The diff (the AGENTS.md hunk at the end is THAI-137's, not this task's)")

  await caption(page, "Each hunk has its header and old and new line numbers; added lines are green, removed lines red")
  const lifecycle = viewer.getByRole("region", { name: "LIFECYCLE.md" })
  await expect(lifecycle.locator("[data-diff-hunk]").first()).toContainText("@@ -18,3 +18,3 @@")
  const added = lifecycle.locator("[data-diff-line=add]").first()
  await expect(added.locator("[data-new-line]")).toHaveAttribute("data-new-line", "19")
  await expect(added.locator("[data-old-line]")).toHaveText("")
  await expect(added).toContainText("Each task is built in its own worktree.")
  await expect(lifecycle.locator("[data-diff-line=remove]").first().locator("[data-old-line]")).toHaveAttribute("data-old-line", "19")
  const addedBackground = await background(added)
  expect(addedBackground).not.toBe(await background(lifecycle.locator("[data-diff-line=context]").first()))
  expect(addedBackground).not.toBe(await background(lifecycle.locator("[data-diff-line=remove]").first()))
  await expect(viewer.getByRole("region", { name: "AGENTS.md" }).locator("[data-diff-noeol]")).toHaveCount(2)
  await expect(showAs(page, "Unified")).toBeChecked()
  await expect(showAs(page, "Split")).toHaveCount(0)

  await caption(page, "Raw shows the file's own text; Copy and Download keep it whole")
  await showAs(page, "Raw").click()
  await expect(viewer.locator("pre[data-text-view=plain]")).toContainText("diff --git a/LIFECYCLE.md b/LIFECYCLE.md")
  await viewer.getByRole("button", { name: "Copy" }).click()
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("Copied")).toBeVisible()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toContain("The diff (the AGENTS.md hunk at the end is THAI-137's, not this task's)")
  expect(copied).toContain("@@ -23,3 +23,6 @@")
  const download = page.waitForEvent("download")
  await viewer.getByRole("link", { name: "Download" }).click()
  expect((await download).suggestedFilename()).toBe("thai-138-diff.txt")
  await showAs(page, "Unified").click()
  const view = viewer.locator("[data-text-view=diff]")
  await expect(view).toBeVisible()

  await caption(page, "Drag the panel to its narrowest: the lines wrap, nothing scrolls sideways")
  await dragEdge(page, 600)
  expect(await width(page)).toBeLessThan(400)
  await expect(view.getByText(LONG_URL.slice(0, 40))).toBeVisible()
  expect(await view.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)

  await caption(page, "Drag it wide: the diff still reads")
  await dragEdge(page, -900)
  expect(await width(page)).toBeGreaterThan(900)
  await expect(viewer.locator("[data-diff-summary]")).toContainText("6 files changed")
  await expect(showAs(page, "Split")).toBeVisible()

  await caption(page, "A diff in a packet opens in the side panel as a diff, not as plain text")

  for (const scheme of ["light", "dark"] as const) {
    await still(browser, key, "diff", scheme, async (p) => {
      await openDiff(p, key)
      await expect(viewerOf(p).locator("[data-diff-summary]")).toContainText("6 files changed")
    })
    await still(browser, key, "diff-wide", scheme, async (p) => {
      await openDiff(p, key)
      await dragEdge(p, -500)
      await expect(showAs(p, "Split")).toBeVisible()
    })
    await still(browser, key, "diff-narrow", scheme, async (p) => {
      await openDiff(p, key)
      await dragEdge(p, 600)
      await expect(viewerOf(p).locator("[data-diff-summary]")).toContainText("6 files changed")
    })
    await still(browser, key, "diff-raw", scheme, async (p) => {
      await openDiff(p, key)
      await showAs(p, "Raw").click()
      await expect(viewerOf(p).locator("pre[data-text-view=plain]")).toContainText("diff --git a/LIFECYCLE.md")
    })
  }
  fs.rmSync(dir, { recursive: true, force: true })
})

test("CEL-173: Split puts the old lines on the left and the new on the right, row by row; it is offered only when the panel is wide, and falls back to Unified when it is narrow again", async ({ page, browser }) => {
  const key = uniqueKey("SPL")
  await createProject(page, "Split diff", key)

  await caption(page, "The same diff as packet evidence")
  const dir = submitDiffPacket(key)
  await card(page, `${key}-1`).click()
  await openDiff(page, key)
  const viewer = viewerOf(page)
  const view = viewer.locator("[data-text-view=diff]")

  await caption(page, "At the default width there is no Split: two columns would be too narrow to read")
  await expect(view).toHaveAttribute("data-diff-mode", "unified")
  await expect(showAs(page, "Split")).toHaveCount(0)

  await caption(page, "Drag the panel wide: Split appears; pick it")
  await dragEdge(page, -300)
  await showAs(page, "Split").click()
  await expect(view).toHaveAttribute("data-diff-mode", "split")
  await expect(showAs(page, "Split")).toBeChecked()

  await caption(page, "A removed line on the left, the line that replaced it on the right, in the same row")
  const lifecycle = viewer.getByRole("region", { name: "LIFECYCLE.md" })
  const changed = lifecycle.locator("[data-diff-row]").filter({ has: page.locator("[data-diff-side=old]", { hasText: "built in a worktree" }) })
  await expect(changed).toHaveCount(1)
  const left = changed.locator("[data-diff-side=old]")
  const right = changed.locator("[data-diff-side=new]")
  await expect(left).toHaveAttribute("data-diff-line", "remove")
  await expect(right).toHaveAttribute("data-diff-line", "add")
  await expect(right).toContainText("built in its own worktree")
  await expect(left.locator("[data-old-line]")).toHaveAttribute("data-old-line", "19")
  await expect(right.locator("[data-new-line]")).toHaveAttribute("data-new-line", "19")
  const [l, r] = [(await left.boundingBox())!, (await right.boundingBox())!]
  expect(Math.abs(l.y - r.y)).toBeLessThanOrEqual(1)
  expect(r.x).toBeGreaterThan(l.x + l.width - 2)
  expect(Math.abs(l.width - r.width)).toBeLessThanOrEqual(2)

  await caption(page, "Added lines with nothing to pair with face an empty cell; context sits on both sides")
  const unpaired = lifecycle.locator("[data-diff-row]").filter({ has: page.locator("[data-diff-side=new]", { hasText: "A release is never cut unprompted." }) })
  await expect(unpaired.locator("[data-diff-empty]")).toHaveCount(1)
  await expect(unpaired.locator("[data-diff-side=old]")).toHaveCount(0)
  const context = lifecycle.locator("[data-diff-row]").filter({ hasText: "The reviewer reads the diff." })
  await expect(context.locator("[data-diff-line=context]")).toHaveCount(2)
  await expect(lifecycle.locator("[data-diff-hunk]").first()).toContainText("@@ -18,3 +18,3 @@")
  expect(await view.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)

  await caption(page, "Drag the panel narrow: Split is no longer offered and the diff shows Unified")
  await dragEdge(page, 700)
  await expect(showAs(page, "Split")).toHaveCount(0)
  await expect(view).toHaveAttribute("data-diff-mode", "unified")
  await expect(showAs(page, "Unified")).toBeChecked()

  await caption(page, "Wide again: Split is back, and it is the choice it was")
  await dragEdge(page, -700)
  await expect(showAs(page, "Split")).toBeChecked()
  await expect(view).toHaveAttribute("data-diff-mode", "split")
  await caption(page, "Split is for a wide panel; the narrow one keeps Unified")

  for (const scheme of ["light", "dark"] as const) {
    await still(browser, key, "diff-split", scheme, async (p) => {
      await openDiff(p, key)
      await dragEdge(p, -500)
      await showAs(p, "Split").click()
      await expect(viewerOf(p).locator("[data-text-view=diff]")).toHaveAttribute("data-diff-mode", "split")
    })
  }
  fs.rmSync(dir, { recursive: true, force: true })
})

test("CEL-173: a page's .patch file opens as a diff (its email header and signature stay text, not changes); a large diff starts folded until Show it", async ({ page, browser }) => {
  const key = uniqueKey("PAT")
  await createProject(page, "Patch files", key)

  await caption(page, "An agent publishes a page that links a git format-patch file and a 3,000-line diff")
  cello("task", "create", "Patch files in the side panel", "--project", key)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-patch-"))
  fs.writeFileSync(path.join(dir, "fix.patch"), PATCH)
  fs.writeFileSync(path.join(dir, "big.diff"), BIG_DIFF)
  const file = path.join(dir, "patches.md")
  fs.writeFileSync(file, "# Patches\n\nThe fix is in [the patch](fix.patch). The big one is [the big diff](big.diff).\n")
  cello("doc", "publish", file, "--project", key, "--task", `${key}-1`)

  await caption(page, "Open the task, then its page, then the patch")
  await card(page, `${key}-1`).click()
  const panel = taskPanel(page, `${key}-1`)
  const viewer = viewerOf(page)
  await panel.getByRole("region", { name: "Pages" }).getByRole("link", { name: /Patches/ }).click()
  await viewer.getByRole("link", { name: "the patch" }).click()

  await caption(page, "The patch is a diff: its email header and its signature show as text, and are not counted as changes")
  await expect(viewer.locator("[data-diff-summary]")).toContainText("1 file changed · +1 −1")
  const texts = viewer.locator("[data-diff-text]")
  await expect(texts.first()).toContainText("Subject: [PATCH] Fix the thing")
  await expect(texts.last()).toHaveText("-- \n2.43.0")
  await expect(viewer.locator("[data-diff-line=remove]")).toHaveCount(1)
  await expect(viewer.locator("[data-diff-line=add]")).toHaveCount(1)

  await caption(page, "The 3,000-line diff starts folded: a note and no rows; Show it opens it")
  await viewer.getByRole("button", { name: "Close viewer" }).click()
  await panel.getByRole("region", { name: "Pages" }).getByRole("link", { name: /Patches/ }).click()
  await viewer.getByRole("link", { name: "the big diff" }).click()
  await expect(viewer.locator("[data-diff-folded]")).toContainText("Large diff · 3,000 lines")
  await expect(viewer.locator("[data-diff-line]")).toHaveCount(0)
  await viewer.getByRole("button", { name: "Show it" }).click()
  await expect(viewer.locator("[data-diff-line=add]")).toHaveCount(3000)
  await expect(viewer.locator("[data-diff-folded]")).toHaveCount(0)
  await caption(page, "Big diffs stay light until you ask for them")

  for (const scheme of ["light", "dark"] as const) {
    await still(browser, key, "diff-large", scheme, async (p) => {
      await taskPanel(p, `${key}-1`).getByRole("region", { name: "Pages" }).getByRole("link", { name: /Patches/ }).click()
      await viewerOf(p).getByRole("link", { name: "the big diff" }).click()
      await expect(viewerOf(p).locator("[data-diff-folded]")).toContainText("Large diff")
    })
  }
  fs.rmSync(dir, { recursive: true, force: true })
})
