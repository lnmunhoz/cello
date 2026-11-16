// CEL-73: screenshots in comments, the way Needs input answers take them. Lucas pastes (⌘V) a screenshot
// into a task's comment box in the task panel: a thumbnail shows under the box, the draft survives a
// reload, an × takes one out, and the sent comment shows it under its text, opening in the image modal.
// The agent's `cello inbox` prints where the screenshot was saved. On the Review page, the comment box
// under an open packet takes screenshots too. An agent attaches its own with `--attach`. Stills (light
// and dark) go to e2e/videos/.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Browser, Page } from "@playwright/test"
import { copyImage, hideTerminal, pngSize, showTerminal } from "./agentScreen.ts"
import { animationsSettled, caption, captionWithUrl, card, createProject, expect, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { celloAs, SHOTS, WEB_URL } from "./packets.ts"
import { isReview } from "./recording.ts"

test.beforeEach(() => {
  if (isReview(process.env)) test.setTimeout(240_000)
})

/** Pastes `file` from the clipboard into `box`, the way ⌘V does after a screenshot tool. */
const paste = async (page: Page, box: ReturnType<Page["getByLabel"]>, file: string) => {
  await copyImage(page, file)
  await box.focus()
  await page.keyboard.press("ControlOrMeta+V")
}

/** The Review page with `key` open, its thread showing a screenshot, in its own unrecorded window: saved as e2e/videos/cel-73-review-<scheme>.png. */
async function stillOfReview(browser: Browser, key: string, colorScheme: "light" | "dark") {
  const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 1100 }, colorScheme })
  const page = await context.newPage()
  await page.goto(`/review?open=${key}`)
  const article = page.getByRole("article", { name: new RegExp(`${key}\\b`) })
  const thread = article.getByRole("region", { name: "Comments" })
  const shots = thread.locator("[data-comment-id] img[data-screenshot]")
  await expect(shots).not.toHaveCount(0)
  for (const img of await shots.all()) await expect(img).toHaveJSProperty("complete", true)
  await thread.scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(SHOTS, `cel-73-review-${colorScheme}.png`) })
  await context.close()
}

test("CEL-73: paste screenshots into comments in the task panel and on the Review page; thumbnails open in the image modal; the draft survives a reload; the agent's inbox prints where each was saved; an agent attaches its own", async ({ page, context, browser }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  const key = uniqueKey("SHOT")
  const task = `${key}-1`
  const session = `e2e0comment-shots-${key}`
  const agent = celloAs(session)
  await createProject(page, "Comment screenshots", key)

  await caption(page, `An agent claims ${task} and hands it in for review`)
  agent("task", "create", "Empty state for search", "--project", key)
  agent("task", "claim", task)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-shots-"))
  await expect(card(page, task)).toBeVisible()
  const board = path.join(dir, "board.png")
  await page.screenshot({ path: board })
  agent("task", "submit", task, "--summary", "The **empty state** for search.", "--step", `Open ${task}`, "--attach", board, "--caption", "The board")

  await caption(page, `Lucas opens ${task}: the comment box says it takes screenshots`)
  await card(page, task).click()
  const panel = taskPanel(page, task)
  const box = panel.getByLabel("New comment")
  await expect(panel.getByText("Paste or drop screenshots here")).toBeVisible()

  await caption(page, "He writes a comment and pastes a screenshot from the clipboard (⌘V)")
  await box.fill("The empty state overlaps the footer, see:")
  const overlap = path.join(dir, "overlap.png")
  await page.screenshot({ path: overlap, clip: { x: 0, y: 0, width: 640, height: 400 } })
  await paste(page, box, overlap)
  const drafts = panel.locator("img[data-pasted-screenshot]")
  await expect(drafts).toHaveCount(1)
  await expect(box).toHaveValue("The empty state overlaps the footer, see:")

  await caption(page, "A second one by mistake: the × takes it out before sending")
  const extra = path.join(dir, "extra.png")
  await page.screenshot({ path: extra, clip: { x: 0, y: 0, width: 320, height: 200 } })
  await paste(page, box, extra)
  await expect(drafts).toHaveCount(2)
  await panel.getByRole("button", { name: /^Remove / }).last().click()
  await expect(drafts).toHaveCount(1)

  await caption(page, "The draft survives a reload: the words and the screenshot are still there")
  await page.reload()
  await expect(taskPanel(page, task).getByLabel("New comment")).toHaveValue("The empty state overlaps the footer, see:")
  await expect(taskPanel(page, task).locator("img[data-pasted-screenshot]")).toHaveCount(1)

  await caption(page, "The thumbnail opens full size in the image modal")
  await taskPanel(page, task).getByRole("button", { name: /^Open / }).first().click()
  const modal = page.locator("[data-image-modal]")
  await expect(modal).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(modal).toBeHidden()

  await caption(page, "⌘Enter sends it: the comment shows the screenshot under its words")
  await taskPanel(page, task).getByLabel("New comment").focus()
  await page.keyboard.press("ControlOrMeta+Enter")
  const sent = taskPanel(page, task).locator("[data-comment-id]").last()
  await expect(sent).toContainText("The empty state overlaps the footer, see:")
  await expect(sent.locator("img[data-screenshot]")).toHaveCount(1)
  await expect(taskPanel(page, task).getByLabel("New comment")).toHaveValue("")
  await expect(taskPanel(page, task).locator("img[data-pasted-screenshot]")).toHaveCount(0)
  await sent.getByRole("button", { name: /^Open / }).click()
  await expect(modal).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(modal).toBeHidden()

  await caption(page, "In the agent's session: `cello inbox --new` has the comment, with the screenshot saved as a file")
  const inbox = agent("inbox", "--new")
  await showTerminal(page, "cello inbox --new", inbox)
  expect(inbox).toContain("The empty state overlaps the footer, see:")
  expect(inbox).toContain("(its screenshots are files you can open)")
  const saved = /Screenshot: (\S+)/.exec(inbox)![1]!
  expect(saved).toContain("cello-comments")
  // The clipboard re-encodes an image, so compare what it shows: a PNG of the same size as the one copied.
  expect(pngSize(saved)).toEqual(pngSize(overlap))
  await expect(page.getByLabel("Agent terminal")).toContainText("Screenshot: ")
  await page.screenshot({ path: path.join(SHOTS, "cel-73-agent-inbox.png") })
  await hideTerminal(page)
  // Stills of the task panel's thread, light and dark, with nothing focused.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await taskPanel(page, task).getByRole("region", { name: "Comments" }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(SHOTS, "cel-73-task-panel-light.png") })
  await page.getByRole("button", { name: "Use dark theme" }).click()
  await expect(page.locator("html")).toHaveClass(/dark/)
  await animationsSettled(page)
  await page.screenshot({ path: path.join(SHOTS, "cel-73-task-panel-dark.png") })
  await page.getByRole("button", { name: "Use light theme" }).click()
  await page.keyboard.press("Escape")

  await captionWithUrl(page, `On the Review page, the comment box under ${task}'s packet takes screenshots too`)
  await page.getByRole("navigation", { name: "Inbox" }).getByRole("link", { name: /^Review/ }).click()
  const article = page.getByRole("article", { name: new RegExp(`${task}\\b`) })
  await article.getByRole("button", { name: new RegExp(`^${task}\\b`) }).click()
  const reviewBox = article.getByLabel("New comment")
  await reviewBox.fill("And on a narrow window:")
  const narrow = path.join(dir, "narrow.png")
  await page.screenshot({ path: narrow, clip: { x: 0, y: 0, width: 400, height: 600 } })
  await paste(page, reviewBox, narrow)
  await expect(article.locator("img[data-pasted-screenshot]")).toHaveCount(1)
  await article.getByRole("button", { name: "Comment", exact: true }).click()
  const thread = article.getByRole("region", { name: "Comments" })
  await expect(thread.locator("[data-comment-id]").last()).toContainText("And on a narrow window:")
  await expect(thread.locator("[data-comment-id]").last().locator("img[data-screenshot]")).toHaveCount(1)
  // Still In Review: a comment isn't a decision.
  await expect(article).toBeVisible()

  await caption(page, "The agent gets that one too, as a file")
  const second = agent("inbox", "--new")
  await showTerminal(page, "cello inbox --new", second)
  expect(second).toContain("And on a narrow window:")
  expect(pngSize(/Screenshot: (\S+)/.exec(second)![1]!)).toEqual(pngSize(narrow))
  await hideTerminal(page)

  await caption(page, "The agent answers with its own screenshot: `cello task comment --attach`")
  const fixed = path.join(dir, "fixed.png")
  await page.screenshot({ path: fixed, clip: { x: 0, y: 0, width: 800, height: 500 } })
  const out = agent("task", "comment", task, "Fixed: the footer moves down now.", "--attach", fixed)
  await showTerminal(page, `cello task comment ${task} "Fixed: the footer moves down now." --attach fixed.png`, out)
  expect(out).toBe(`Commented on ${task} with 1 image`)
  const reply = thread.locator("[data-comment-id]").last()
  await expect(reply).toContainText("Fixed: the footer moves down now.")
  await expect(reply.locator("img[data-screenshot]")).toHaveCount(1)
  await hideTerminal(page)
  for (const colorScheme of ["light", "dark"] as const) await stillOfReview(browser, task, colorScheme)

  await caption(page, "Send back with a screenshot in the box: the note carries it to the agent")
  await reviewBox.fill("Almost: the footer still jumps on load.")
  const jump = path.join(dir, "jump.png")
  await page.screenshot({ path: jump, clip: { x: 0, y: 0, width: 500, height: 300 } })
  await paste(page, reviewBox, jump)
  await expect(article.locator("img[data-pasted-screenshot]")).toHaveCount(1)
  await article.getByRole("button", { name: "Send back" }).click()
  await expect(article).toHaveCount(0)
  const sentBack = agent("inbox", "--new")
  await showTerminal(page, "cello inbox --new", sentBack)
  expect(sentBack).toContain("sent it back, just now")
  expect(sentBack).toContain("Almost: the footer still jumps on load.")
  expect(pngSize(/Screenshot: (\S+)/.exec(sentBack)![1]!)).toEqual(pngSize(jump))
  await hideTerminal(page)

  await caption(page, "Screenshots in comments: pasted, dropped or attached, shown in the thread, and saved as files for the agent")
  fs.rmSync(dir, { recursive: true, force: true })
})
