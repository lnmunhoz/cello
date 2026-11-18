// CEL-176: a diff an agent writes in markdown (a ```diff block) shows as the diff view, not as a plain
// code block with lines cut off: in a comment in the task panel, and in a Cello page. It's the inline
// form of CEL-173's view: it grows with its content, wraps long lines, offers Unified / Split / Raw only
// when there's room, and has a Copy button. The fixture is a look-alike of a real comment (no `diff
// --git` lines, list items as context, blank context lines, a 200+ character line).
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Browser, Locator, Page } from "@playwright/test"
import { DIFF_BLOCK, DIFF_BLOCK_COMMENT, DIFF_BLOCK_LONG_LINE, DIFF_BLOCK_PATHS, HEADERLESS_BLOCK_COMMENT } from "../packages/text/src/diff.fixture.ts"
import { caption, card, createProject, expect, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { cello, celloAs, SHOTS, WEB_URL } from "./packets.ts"
import { isReview } from "./recording.ts"

test.beforeEach(() => {
  if (isReview(process.env)) test.setTimeout(240_000)
})

/** A comment with the same diff in a block marked `ts`: the writer said what it is, so it stays code. */
const TS_COMMENT = ["The same text, in a ts block:", "", "```ts", DIFF_BLOCK, "```"].join("\n")

const COMMENTS = { diff: "The greeting prompt now refuses nicknames", headerless: "Two places changed, no file names", ts: "The same text, in a ts block" } as const

const commentOf = (panel: Locator, which: keyof typeof COMMENTS) => panel.locator("[data-comment-id]").filter({ hasText: COMMENTS[which] })
const blockOf = (comment: Locator) => comment.locator("[data-diff-block]")
const background = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).backgroundColor)
const style = (locator: Locator, property: string) => locator.evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), property)
const overflowsSideways = (el: Element) => el.scrollWidth > el.clientWidth
const edgeOf = (panel: Locator) => panel.getByRole("separator", { name: "Resize task panel" })

/** A task with the three comments an agent would write; returns its key. */
function seedComments(key: string) {
  celloAs(`e2e0diffblocks-${key}`)("task", "create", "Show what changed in the greeting prompt", "--project", key)
  for (const body of [DIFF_BLOCK_COMMENT, HEADERLESS_BLOCK_COMMENT, TS_COMMENT]) {
    celloAs(`e2e0diffblocks-${key}`, { stdin: body })("task", "comment", `${key}-1`, "--body-file", "-")
  }
  return `${key}-1`
}

/** → on the focused edge (it narrows the panel), enough times to reach the narrowest panel (360 px from 560, 32 px a press). */
async function narrowest(page: Page, panel: Locator) {
  await edgeOf(panel).focus()
  for (let i = 0; i < 7; i++) await page.keyboard.press("ArrowRight")
  await expect(edgeOf(panel)).toHaveAttribute("aria-valuenow", "360")
}

/** Stills for the report, each in its own unrecorded window in `colorScheme`: saved as e2e/videos/cel-176-<what>-<scheme>.png. */
async function screenshotComments(browser: Browser, task: string, colorScheme: "light" | "dark") {
  const [projectKey, number] = task.split("-") as [string, string]
  const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 }, colorScheme })
  const page = await context.newPage()
  await page.goto(`/${projectKey}/${number}`)
  const panel = taskPanel(page, task)
  const first = blockOf(commentOf(panel, "diff"))
  await expect(first.locator("section[data-diff-file]")).toHaveCount(3)
  await first.scrollIntoViewIfNeeded()
  await panel.screenshot({ path: path.join(SHOTS, `cel-176-comment-${colorScheme}.png`), animations: "disabled" })

  const headerless = blockOf(commentOf(panel, "headerless"))
  await expect(headerless.locator("[data-diff-file=headerless]")).toHaveCount(2)
  await headerless.scrollIntoViewIfNeeded()
  await panel.screenshot({ path: path.join(SHOTS, `cel-176-headerless-${colorScheme}.png`), animations: "disabled" })

  await narrowest(page, panel)
  await first.scrollIntoViewIfNeeded()
  await panel.screenshot({ path: path.join(SHOTS, `cel-176-comment-narrow-${colorScheme}.png`), animations: "disabled" })
  await context.close()
}

test("CEL-176: a diff an agent writes in a comment shows as a diff view in the task panel: files, counts, colours, line numbers, wrapped lines, Show as, Copy; hunks without file headers show too; a ts block stays code; the narrowest panel keeps only Copy", async ({
  page,
  browser,
}) => {
  const key = uniqueKey("DFB")
  await createProject(page, "Diff blocks", key)
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])

  await caption(page, "An agent comments what it changed: a sentence and a ```diff block, with no diff --git lines")
  const task = seedComments(key)
  await card(page, task).click()
  const panel = taskPanel(page, task)
  const comment = commentOf(panel, "diff")
  const block = blockOf(comment)

  await caption(page, "The comment shows a diff view: a summary, then one section per file")
  await expect(block.locator("[data-text-view=diff]")).toBeVisible()
  await expect(block.locator("[data-diff-summary]")).toContainText("3 files changed · +9 −2")
  const files = block.locator("section[data-diff-file]")
  await expect(files).toHaveCount(3)
  expect(await files.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")))).toEqual([...DIFF_BLOCK_PATHS])
  await expect(comment.locator("code.language-diff")).toHaveCount(0)

  await caption(page, "Added lines are green, removed lines red, each with its line number")
  const added = block.locator("[data-diff-line=add]").first()
  await expect(added.locator("[data-new-line]")).toHaveAttribute("data-new-line", "14")
  const addedBackground = await background(added)
  expect(addedBackground).not.toBe(await background(block.locator("[data-diff-line=context]").first()))
  expect(addedBackground).not.toBe(await background(block.locator("[data-diff-line=remove]").first()))
  // The context lines that are list items, and the blank ones, are context, not changes.
  await expect(block.locator("[data-diff-line=context]").filter({ hasText: "- A kind tone, never a joke at their expense." })).toHaveCount(1)
  await expect(block.locator("[data-diff-line=add]")).toHaveCount(9)
  await expect(block.locator("[data-diff-line=remove]")).toHaveCount(2)

  await caption(page, "Nothing is cut off: the 200+ character line wraps, and neither the comment nor the panel scrolls sideways")
  const long = block.locator("[data-diff-line=add]").filter({ hasText: "Always sign off" })
  await expect(long).toContainText(DIFF_BLOCK_LONG_LINE.slice(1, 60))
  expect((await long.boundingBox())!.height).toBeGreaterThan(2 * 19)
  expect(await comment.evaluate(overflowsSideways)).toBe(false)
  expect(await panel.evaluate(overflowsSideways)).toBe(false)

  await caption(page, "The file headers keep the app's type: the comment's heading styles don't reach into the diff")
  const heading = block.locator("[data-diff-file] [role=heading]").first()
  expect(await style(heading, "margin-top")).toBe("0px")
  expect(await style(heading, "font-weight")).toBe("400")
  expect(await style(heading, "font-size")).toBe("12.5px")

  await caption(page, "Show as: Unified is on, Split isn't offered at this width, Raw shows the block as written")
  const unified = block.getByRole("radio", { name: "Unified" })
  await expect(unified).toBeChecked()
  await expect(block.getByRole("radio", { name: "Split" })).toHaveCount(0)
  await block.getByRole("radio", { name: "Raw" }).click()
  await expect(block.locator("code.language-diff")).toContainText("--- a/src/greeting/prompt.ts")
  await expect(block.locator("[data-text-view=diff]")).toHaveCount(0)
  await unified.click()
  await expect(block.locator("[data-text-view=diff]")).toBeVisible()

  await caption(page, "Copy puts the block's text on the clipboard")
  await block.getByRole("button", { name: "Copy" }).click()
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("Copied", { exact: true })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(DIFF_BLOCK)

  await caption(page, "A second comment with hunks only: no file sections, line numbers only where an @@ line gives them")
  const second = commentOf(panel, "headerless")
  const hunks = blockOf(second).locator("[data-diff-file=headerless]")
  await expect(hunks).toHaveCount(2)
  await expect(blockOf(second).locator("section[data-diff-file]")).toHaveCount(0)
  await expect(hunks.first().locator("[data-diff-hunk]")).toHaveText("@@ -10,3 +10,4 @@")
  await expect(hunks.first().locator("[data-new-line]").first()).toHaveAttribute("data-new-line", "10")
  await expect(hunks.last().locator("[data-diff-hunk]")).toHaveCount(0)
  await expect(hunks.last().locator("[data-new-line]")).toHaveCount(0)
  await expect(hunks.last().locator("[data-diff-line=add]")).toHaveCount(2)
  await expect(hunks.last().locator("[data-diff-line=remove]")).toHaveCount(1)
  expect(await background(hunks.last().locator("[data-diff-line=add]").first())).not.toBe(await background(hunks.last().locator("[data-diff-line=remove]").first()))
  await expect(blockOf(second).locator("[data-diff-summary]")).toHaveText(/^\+4 −2/)

  await caption(page, "A third comment holds the same text in a ts block: the writer said it's code, so it stays code")
  const third = commentOf(panel, "ts")
  await expect(third.locator("code.language-ts")).toBeVisible()
  await expect(blockOf(third)).toHaveCount(0)

  await caption(page, "In the narrowest panel (360 px) only Copy stays: Show as would not fit, and nothing scrolls sideways")
  await narrowest(page, panel)
  await block.scrollIntoViewIfNeeded()
  await expect(block.getByRole("radio")).toHaveCount(0)
  await expect(block.getByRole("button", { name: "Copy" })).toBeVisible()
  await expect(block.locator("[data-diff-summary]")).toContainText("3 files changed · +9 −2")
  expect(await comment.evaluate(overflowsSideways)).toBe(false)
  expect(await panel.evaluate(overflowsSideways)).toBe(false)
  expect(await long.evaluate(overflowsSideways)).toBe(false)
  await caption(page, "The same diff, nothing cut off")

  for (const scheme of ["light", "dark"] as const) await screenshotComments(browser, task, scheme)
})

/** A page: prose, a ```diff block, and an unmarked block that is a whole git diff. */
const PAGE = [
  "# Diff blocks check",
  "",
  "## What changed",
  "",
  "The prompt refuses nicknames now:",
  "",
  "```diff",
  DIFF_BLOCK,
  "```",
  "",
  "## The same in git's own words",
  "",
  "```",
  "diff --git a/src/greeting/format.ts b/src/greeting/format.ts",
  "index 3f2a9c1..8b7d4e0 100644",
  "--- a/src/greeting/format.ts",
  "+++ b/src/greeting/format.ts",
  "@@ -1,3 +1,3 @@ export const formatGreeting = (name: string) => {",
  "   const first = name.split(' ')[0]",
  "-  return `Hello ${name}`",
  "+  return `Hello ${first}`",
  " }",
  "```",
  "",
].join("\n")

/** The page's first diff in Split, in an unrecorded window in `colorScheme`: saved as e2e/videos/cel-176-page-<scheme>.png. */
async function screenshotPage(browser: Browser, key: string, colorScheme: "light" | "dark") {
  const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 }, colorScheme })
  const page = await context.newPage()
  await page.goto(`/${key}/pages/diff-blocks-check`)
  const block = page.getByRole("article").locator(".page-diff [data-diff-block]").first()
  await block.getByRole("radio", { name: "Split" }).click()
  await expect(block.locator("[data-diff-mode=split]")).toBeVisible()
  await block.scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(SHOTS, `cel-176-page-${colorScheme}.png`), animations: "disabled" })
  await context.close()
}

test("CEL-176: a diff block in a page shows as a diff view in the page's own frame, Split when the page is wide; an unmarked block that is a whole git diff does too", async ({ page, browser }) => {
  const key = uniqueKey("DFP")
  await createProject(page, "Diff blocks in a page", key)

  await caption(page, "An agent publishes a page with a ```diff block and a plain block holding a whole git diff")
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-diffpage-"))
  const file = path.join(dir, "diff-blocks-check.md")
  fs.writeFileSync(file, PAGE)
  cello("doc", "publish", file, "--project", key)
  fs.rmSync(dir, { recursive: true, force: true })

  await caption(page, "Open the page: both blocks are diff views, framed like the page's code blocks")
  await page.goto(`/${key}/pages/diff-blocks-check`)
  const article = page.getByRole("article")
  const blocks = article.locator(".page-diff [data-diff-block]")
  await expect(blocks).toHaveCount(2)
  await expect(article.locator("code.language-diff")).toHaveCount(0)
  const first = blocks.first()
  await expect(first.locator("[data-diff-summary]")).toContainText("3 files changed · +9 −2")
  await expect(blocks.last().locator("[data-diff-summary]")).toContainText("1 file changed · +1 −1")

  await caption(page, "The page's heading and paragraph styles don't reach into it: the file headers keep the diff's own type")
  const heading = first.locator("[data-diff-file] [role=heading]").first()
  expect(await style(heading, "margin-top")).toBe("0px")
  expect(await style(heading, "font-size")).toBe("12.5px")
  expect(await style(first.locator("[data-diff-line]").first(), "margin-top")).toBe("0px")

  await caption(page, "The page is wide, so Split is offered: old on the left, new on the right")
  await first.scrollIntoViewIfNeeded()
  const split = first.getByRole("radio", { name: "Split" })
  await expect(split).toBeVisible()
  await split.click()
  const view = first.locator("[data-text-view=diff]")
  await expect(view).toHaveAttribute("data-diff-mode", "split")
  await expect(view.locator("[data-diff-row]").first().locator(":scope > *")).toHaveCount(2)

  await caption(page, "Raw shows the block as the page draws code")
  await first.getByRole("radio", { name: "Raw" }).click()
  await expect(first.locator(".page-code pre")).toContainText("--- a/src/greeting/prompt.ts")
  await first.getByRole("radio", { name: "Unified" }).click()
  await expect(view).toHaveAttribute("data-diff-mode", "unified")

  for (const scheme of ["light", "dark"] as const) await screenshotPage(browser, key, scheme)
})
