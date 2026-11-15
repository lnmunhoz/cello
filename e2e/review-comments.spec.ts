// CEL-70: an open packet on the Review page shows the task's comments with a comment box, under "How
// to check" and above Send back and Approve. A comment keeps the task In Review and reaches the agent
// that submitted it; it's in the task panel too. Send back sends what's typed in the box as the note;
// with the box empty it asks for a note, as before. Approve is unchanged. Stills go to e2e/videos/.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Browser, Locator, Page } from "@playwright/test"
import { caption, captionWithUrl, card, column, createProject, expect, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { celloAs, SHOTS, WEB_URL } from "./packets.ts"
import { isReview } from "./recording.ts"

test.beforeEach(() => {
  if (isReview(process.env)) test.setTimeout(180_000)
})

/** A row on the Review page: the article, the button that opens it, its comments and its comment box. */
const rowOf = (page: Page, key: string) => {
  const article = page.getByRole("article", { name: new RegExp(`${key}\\b`) })
  return {
    article,
    header: article.getByRole("button", { name: new RegExp(`^${key}\\b`) }),
    comments: article.getByRole("region", { name: "Comments" }),
    box: article.getByLabel("New comment"),
  }
}

/** Two tasks of `key`, each claimed and handed in by `session` with a real screenshot of the board. Remove `dir` when done. */
async function submitTwo(page: Page, key: string, session: string): Promise<{ dir: string }> {
  const agent = celloAs(session)
  agent("task", "create", "Comment on a packet from the Review page", "--project", key)
  agent("task", "create", "Approve stays as it is", "--project", key)
  await expect(card(page, `${key}-2`)).toBeVisible()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-evidence-"))
  const screenshot = path.join(dir, "board.png")
  await page.screenshot({ path: screenshot })
  for (const n of [1, 2]) {
    agent("task", "claim", `${key}-${n}`)
    agent(
      "task", "submit", `${key}-${n}`,
      "--summary", n === 1 ? "Adds a **comment box** to the Review page." : "Nothing to say: approve it.",
      "--step", `Open ${key}-${n} on the Review page`,
      "--step", "Read the comments under these steps",
      "--attach", screenshot, "--caption", "The board",
    )
  }
  return { dir }
}

/** The Review page with `key` open in its own unrecorded window, saved to e2e/videos/review-comments-<scheme>.png. */
async function screenshotComments(browser: Browser, key: string, colorScheme: "light" | "dark") {
  const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 1100 }, colorScheme })
  const page = await context.newPage()
  await page.goto(`/review?open=${key}`)
  const row = rowOf(page, key)
  await expect(row.comments.locator("[data-comment-id]")).toHaveCount(2)
  await expect(row.article.locator("img[data-evidence=screenshot]")).toHaveJSProperty("complete", true)
  await row.box.fill("The empty state needs the same box.")
  await page.screenshot({ path: path.join(SHOTS, `review-comments-${colorScheme}.png`) })
  await context.close()
}

/** `below` starts under `above` on the page. */
const expectBelow = async (below: Locator, above: Locator) => {
  const [a, b] = [(await above.boundingBox())!, (await below.boundingBox())!]
  expect(b.y).toBeGreaterThanOrEqual(a.y + a.height)
}

test("CEL-70: comment on an open packet from the Review page; it stays In Review, reaches the agent and shows in the task panel; Send back sends the box's text; an empty box asks for a note; Approve is unchanged", async ({ page, browser }) => {
  const key = uniqueKey("RVC")
  const session = `e2e0review-comments-${key}`
  const agent = celloAs(session)
  await createProject(page, "Review comments test", key)
  await caption(page, `An agent hands in ${key}-1 and ${key}-2, and comments on ${key}-1`)
  const { dir } = await submitTwo(page, key, session)
  agent("task", "comment", `${key}-1`, "Heads up: the video is silent on purpose.")
  const [one, two] = [rowOf(page, `${key}-1`), rowOf(page, `${key}-2`)]

  await captionWithUrl(page, `Open Review, then ${key}-1: the task's comments sit under How to check, with a comment box`)
  await page.getByRole("navigation", { name: "Inbox" }).getByRole("link", { name: /^Review/ }).click()
  await one.header.click()
  await expect(one.comments.locator("[data-comment-id]")).toHaveText([/Heads up: the video is silent on purpose\./])
  // Under the steps, above Send back and Approve.
  await expectBelow(one.comments, one.article.getByRole("region", { name: "How to check" }))
  await expectBelow(one.article.getByRole("button", { name: "Approve" }), one.box)
  await expect(one.box).toHaveAttribute("placeholder", /Send back/)

  await caption(page, "Write a comment and click Comment: it joins the thread, and the task stays In Review")
  await one.box.fill("Looks right. Does it also work on a narrow window?")
  await one.article.getByRole("button", { name: "Comment", exact: true }).click()
  await expect(one.comments.locator("[data-comment-id]").last()).toContainText("Does it also work on a narrow window?")
  await expect(one.box).toHaveValue("")
  await expect(one.header).toHaveAttribute("aria-expanded", "true")
  await expect(one.article.getByText("In Review", { exact: true })).toBeVisible()

  await caption(page, "In the agent's session: `cello inbox --new` has the comment")
  const inbox = agent("inbox", "--new")
  expect(inbox).toContain(`${key}-1  Comment on a packet from the Review page`)
  expect(inbox).toContain("Looks right. Does it also work on a narrow window?")
  for (const colorScheme of ["light", "dark"] as const) await screenshotComments(browser, `${key}-1`, colorScheme)

  await caption(page, `Open ${key}-1 on the board: the comment is in the task panel too, and the card is still in In Review`)
  await page.getByRole("link", { name: "Review comments test", exact: true }).click()
  await expect(column(page, "In Review").locator(`[data-task-key="${key}-1"]`)).toBeVisible()
  await card(page, `${key}-1`).click()
  const panel = taskPanel(page, `${key}-1`)
  await expect(panel.locator("[data-comment-id]").last()).toContainText("Does it also work on a narrow window?")
  await page.keyboard.press("Escape")

  await captionWithUrl(page, `Back on Review: write what to change in the box, then Send back; no second note to type`)
  await page.getByRole("navigation", { name: "Inbox" }).getByRole("link", { name: /^Review/ }).click()
  await one.header.click()
  await one.box.fill("On a narrow window the steps overlap the evidence; stack them.")
  await one.article.getByRole("button", { name: "Send back" }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(one.article).toHaveCount(0)
  await expect(two.header).toHaveAttribute("aria-expanded", "true")

  await caption(page, "The agent gets it as a Send back, and the note is on the card as a comment")
  const sentBack = agent("inbox", "--new")
  expect(sentBack).toContain("On a narrow window the steps overlap the evidence; stack them.")
  expect(sentBack).toContain("sent it back, just now")

  await caption(page, `${key}-2 opened next. With the box empty, Send back asks for a note, as before`)
  await two.article.getByRole("button", { name: "Send back" }).click()
  const dialog = page.getByRole("dialog", { name: `Send ${key}-2 back` })
  await expect(dialog.getByRole("button", { name: "Send back" })).toBeDisabled()
  await dialog.getByRole("button", { name: "Cancel" }).click()
  await expect(dialog).toBeHidden()

  await caption(page, `Approve ${key}-2: it leaves the queue, as before`)
  await two.article.getByRole("button", { name: "Approve" }).click()
  await expect(two.article).toHaveCount(0)

  await caption(page, `On the board: ${key}-1 is back in In Progress with the note as a comment, ${key}-2 is Done`)
  await page.getByRole("link", { name: "Review comments test", exact: true }).click()
  await expect(column(page, "In Progress").locator(`[data-task-key="${key}-1"]`)).toBeVisible()
  await expect(column(page, "Done").locator(`[data-task-key="${key}-2"]`)).toBeVisible()
  await card(page, `${key}-1`).click()
  await expect(panel.locator("[data-comment-id]").last()).toContainText("stack them")
  await caption(page, "Comment, send back or approve, all from the Review page")
  fs.rmSync(dir, { recursive: true, force: true })
})
