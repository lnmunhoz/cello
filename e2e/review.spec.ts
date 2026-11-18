// CEL-10: an agent hands in a review packet through the real `cello` CLI (a real MP4 and a real
// screenshot), and Lucas reviews it in the browser: on the Review page (approve → Done) and in the
// task panel (send back with a note → In Progress).
// CEL-22: the Review page shows the queue as collapsed rows and opens one packet at a time.
// CEL-38: on a wide panel the open packet splits in two, the evidence on the right and sticky.
// CEL-71: a task moved out of In Review takes its packet off the Review page (withdrawn).
import * as fs from "node:fs"
import * as path from "node:path"
import type { Browser, Page } from "@playwright/test"
import { caption, captionWithUrl, card, column, createProject, expect, projectLink, taskPanel, test, uniqueKey } from "./fixtures.ts"
import {
  cello,
  decidedSeen,
  decisionsThroughTest,
  expectLeftAligned,
  expectOneColumn,
  expectTwoColumns,
  packetDrawn,
  packetLayout,
  SHOTS,
  submitDiagramPacket,
  submitPacket,
  submitPackets,
  watchDecided,
  WEB_URL,
} from "./packets.ts"
import { isReview } from "./recording.ts"

// Review videos hold every step (e2e/recording.ts), which takes these flows past the default timeout.
test.beforeEach(() => {
  if (isReview(process.env)) test.setTimeout(180_000)
})

/** The Review page in its own unrecorded tall window, saved to e2e/videos/review-page-<scheme>.png. */
async function screenshotReviewPage(browser: Browser, key: string, colorScheme: "light" | "dark") {
  const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 1560 }, colorScheme })
  const page = await context.newPage()
  await page.goto(`/review?open=${key}-1`)
  const item = page.getByRole("article", { name: new RegExp(`${key}-1`) })
  await expect(item.locator("img[data-evidence=screenshot]")).toHaveJSProperty("naturalWidth", 1440)
  const poster = await item.locator("video").getAttribute("poster")
  await page.evaluate((src) => new Promise((resolve) => Object.assign(new Image(), { onload: resolve, src })), poster!)
  await page.screenshot({ path: path.join(SHOTS, `review-page-${colorScheme}.png`) })
  await context.close()
}

test("CEL-10: an agent submits a packet with a real MP4 and screenshot through the CLI; Lucas plays it on the Review page and approves; the card lands in Done", async ({ page, browser }) => {
  const key = uniqueKey("REV")
  await createProject(page, "Packets test", key)

  await caption(page, "An agent runs `cello task submit` with a video and a screenshot")
  const { dir } = await submitPacket(page, key)
  const taskCard = card(page, `${key}-1`)
  await expect(column(page, "In Review").locator(`[data-task-key="${key}-1"]`)).toBeVisible()
  await expect(taskCard.locator("[data-evidence-badge]")).toContainText("3")
  // The badge shows the video's poster frame (ffmpeg scaled it to the video's 640 px).
  await expect(taskCard.locator("[data-evidence-badge] img")).toHaveJSProperty("naturalWidth", 640)
  await caption(page, "The list layout shows the same badge")
  await page.goto(`/${key}/issues?layout=list`)
  await expect(page.locator('[data-layout="list"]').locator(`[data-task-key="${key}-1"] [data-evidence-badge]`)).toContainText("3")

  await caption(page, "The sidebar counts it: open Review")
  const reviewLink = page.getByRole("navigation", { name: "Inbox" }).getByRole("link", { name: /^Review/ })
  // Other tests share the server and may have left tasks in In Review: count relative to them.
  const count = reviewLink.locator("[data-review-count]")
  await expect(count).toHaveText(/^\d+ waiting$/)
  const waiting = Number.parseInt(await count.innerText(), 10)
  await reviewLink.click()
  await expect(page).toHaveURL(/\/review$/)

  await caption(page, "Open its row")
  const item = page.getByRole("article", { name: new RegExp(`${key}-1`) })
  await item.getByRole("button", { name: new RegExp(`${key}-1`) }).click()
  await expect(item.getByText("review packets", { exact: false }).first()).toBeVisible()
  await expect(item.getByRole("region", { name: "How to check" }).getByRole("listitem")).toHaveText([
    /Open Review in the sidebar/,
    /Play the video and open the screenshot/,
    /Approve it; the card lands in Done/,
  ])
  await expect(item.getByRole("link", { name: "The PR" })).toHaveAttribute("href", "https://github.com/lnmunhoz/cello/pull/10")
  await expect(item.getByText(/Submitted by Claude Code/)).toBeVisible()

  await caption(page, "Play the video: it has a poster, starts muted, and plays")
  const video = item.locator("video[data-evidence=video]")
  await expect(video).toHaveAttribute("poster", /\/attachments\/.+\/poster$/)
  await expect(video).toHaveJSProperty("muted", true)
  const played = video.evaluate(
    (v: HTMLVideoElement) =>
      new Promise<number>((resolve) => {
        const check = () => v.currentTime > 1 && resolve(v.currentTime)
        v.addEventListener("timeupdate", check)
        check()
      }),
  )
  await video.click()
  expect(await played).toBeGreaterThan(1)
  await expect(video).toHaveJSProperty("muted", false)
  await video.evaluate((v: HTMLVideoElement) => v.pause())

  await caption(page, "Open the screenshot large, in the image modal")
  const thumb = item.locator("img[data-evidence=screenshot]")
  await expect(thumb).toHaveJSProperty("naturalWidth", 1440)
  await item.getByRole("button", { name: "Open The board" }).click()
  const modal = page.getByRole("dialog", { name: "The board" })
  await expect(modal.locator("img[data-modal-image]")).toBeVisible()
  await modal.getByRole("button", { name: "Close" }).click()
  await expect(modal).toBeHidden()

  await caption(page, "In dark mode too")
  await page.getByRole("button", { name: "Use dark theme" }).click()
  await expect(page.locator("html")).toHaveClass(/dark/)
  await page.getByRole("button", { name: "Use light theme" }).click()
  // Stills for the report: the whole packet in a tall window, light and dark, without the test's overlay.
  for (const colorScheme of ["light", "dark"] as const) await screenshotReviewPage(browser, key, colorScheme)

  await caption(page, "Approve")
  await item.getByRole("button", { name: "Approve" }).click()
  await expect(item).toBeHidden()
  if (waiting === 1) {
    await expect(page.getByText("Nothing to review")).toBeVisible()
    await expect(count).toHaveCount(0)
  } else {
    await expect(count).toHaveText(`${waiting - 1} waiting`)
  }

  await caption(page, `${key}-1 is in Done`)
  await projectLink(page, key).click()
  await expect(column(page, "Done").locator(`[data-task-key="${key}-1"]`)).toBeVisible()
  await expect(taskCard.locator("[data-evidence-badge]")).toHaveCount(0)
  await caption(page, `Approved: ${key}-1 landed in Done`)
  fs.rmSync(dir, { recursive: true, force: true })
})

test("CEL-10: the task panel pins the open packet; sending it back with a note moves the card to In Progress and leaves the note as a comment", async ({ page }) => {
  const key = uniqueKey("SNB")
  await createProject(page, "Send back test", key)
  const { dir } = await submitPacket(page, key)

  await caption(page, "Open the card in In Review: the packet is pinned at the top")
  await card(page, `${key}-1`).click()
  const panel = page.getByRole("complementary", { name: `${key}-1 details` })
  const pinned = panel.getByRole("region", { name: "Review packet" })
  await expect(pinned.getByText("Waiting for your review")).toBeVisible()
  await expect(pinned.locator("video[data-evidence=video]")).toBeVisible()
  await expect(pinned.locator("img[data-evidence=screenshot]")).toHaveJSProperty("naturalWidth", 1440)

  await caption(page, "Send it back with a note")
  await pinned.getByRole("button", { name: "Send back" }).click()
  const dialog = page.getByRole("dialog", { name: `Send ${key}-1 back` })
  await expect(dialog.getByRole("button", { name: "Send back" })).toBeDisabled()
  await dialog.getByLabel("Note").fill("The poster is the first frame; grab one a second in.")
  await dialog.getByRole("button", { name: "Send back" }).click()
  await expect(dialog).toBeHidden()

  await caption(page, "Back in In Progress, with the note as a comment and the packet under Earlier reviews")
  await expect(column(page, "In Progress").locator(`[data-task-key="${key}-1"]`)).toBeVisible()
  await expect(pinned).toBeHidden()
  await expect(panel.locator("[data-comment-id]")).toContainText("The poster is the first frame; grab one a second in.")
  const earlier = panel.getByRole("region", { name: "Earlier reviews" })
  await expect(earlier.getByRole("button", { name: /Sent back/ })).toContainText("grab one a second in")
  await earlier.getByRole("button", { name: /Sent back/ }).click()
  await expect(earlier.locator("video[data-evidence=video]")).toBeVisible()
  await caption(page, `Sent back: ${key}-1 is in In Progress with Lucas's note`)
  fs.rmSync(dir, { recursive: true, force: true })
})

/** The Review page with `open` open and the other rows collapsed, unrecorded, saved to e2e/videos/review-rows-<scheme>.png. */
async function screenshotRows(browser: Browser, open: string, colorScheme: "light" | "dark") {
  const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 1100 }, colorScheme })
  const page = await context.newPage()
  await page.goto(`/review?open=${open}`)
  const item = page.getByRole("article", { name: new RegExp(`${open}\\b`) })
  await expect(item.locator("img[data-evidence=screenshot]")).toHaveJSProperty("complete", true)
  await page.screenshot({ path: path.join(SHOTS, `review-rows-${colorScheme}.png`) })
  await context.close()
}

/** A row on the Review page, and the button that opens and closes it. */
const rowOf = (page: Page, key: string) => {
  const article = page.getByRole("article", { name: new RegExp(`${key}\\b`) })
  return { article, header: article.getByRole("button", { name: new RegExp(`^${key}\\b`) }), steps: article.getByRole("region", { name: "How to check" }) }
}

test("CEL-22: the Review page lists packets as collapsed rows; one opens at a time by click or j/k and Enter; Esc closes; Approve and Send back open the next; ?open= survives a reload", async ({ page, browser }) => {
  const key = uniqueKey("ROW")
  await createProject(page, "Review rows test", key)
  await caption(page, "An agent submits three packets")
  const { dir } = await submitPackets(page, key, ["Collapse the review feed", "Open one packet at a time", "Keep the open row in the URL"])
  const [one, two, three] = [1, 2, 3].map((n) => rowOf(page, `${key}-${n}`)) as [ReturnType<typeof rowOf>, ReturnType<typeof rowOf>, ReturnType<typeof rowOf>]

  await captionWithUrl(page, "Open Review: every packet is a collapsed row")
  await page.getByRole("navigation", { name: "Inbox" }).getByRole("link", { name: /^Review/ }).click()
  await expect(page).toHaveURL(/\/review$/)
  for (const row of [one, two, three]) {
    await expect(row.header).toHaveAttribute("aria-expanded", "false")
    await expect(row.steps).toHaveCount(0)
  }
  // Key, title, project, who submitted it and when, and the evidence count with a thumbnail.
  await expect(one.header).toContainText(`${key}-1`)
  await expect(one.header).toContainText("Collapse the review feed")
  await expect(one.header).toContainText("Review rows test")
  await expect(one.header).toContainText(/Claude Code · (just now|\d+ min ago)/)
  // The evidence: the first screenshot (the board with the tasks on it), and how many pieces, with an icon.
  const badge = one.header.locator("[data-evidence-badge]")
  await expect(badge).toHaveText("2")
  await expect(badge).toHaveAttribute("title", "2 pieces of evidence")
  await expect(badge.locator("svg")).toHaveCount(1)
  await expect(badge.locator("img")).toHaveAttribute("src", /^\/attachments\/\w+$/)
  await expect(badge.locator("img")).toHaveJSProperty("naturalWidth", 1440)
  for (const colorScheme of ["light", "dark"] as const) await screenshotRows(browser, `${key}-1`, colorScheme)

  await captionWithUrl(page, `Click ${key}-1: its packet opens`)
  await one.header.click()
  await expect(one.header).toHaveAttribute("aria-expanded", "true")
  // The step names the task: its key links to it, with its status (CEL-20).
  await expect(one.steps.locator(`[data-task-link="${key}-1"] [data-task-status]`)).toHaveText("In Review")
  await expect(page).toHaveURL(new RegExp(`/review\\?open=${key}-1$`))

  await captionWithUrl(page, `Click ${key}-2: it opens, and ${key}-1 closes`)
  await two.header.click()
  await expect(two.header).toHaveAttribute("aria-expanded", "true")
  await expect(two.steps).toBeVisible()
  await expect(one.header).toHaveAttribute("aria-expanded", "false")
  await expect(one.steps).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`/review\\?open=${key}-2$`))

  await captionWithUrl(page, "k moves up a row, Enter opens it; the keyboard wins over the mouse's hover")
  await two.header.hover()
  await expect(two.header).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
  await page.keyboard.press("k")
  await expect(one.header).toBeFocused()
  // The mouse still rests on the other row: its hover highlight gives way while the keys are in use.
  await expect(two.header).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
  await page.keyboard.press("Enter")
  await expect(one.header).toHaveAttribute("aria-expanded", "true")
  await expect(two.header).toHaveAttribute("aria-expanded", "false")

  await captionWithUrl(page, "j, j moves down two rows; Enter opens it")
  await page.keyboard.press("j")
  await expect(two.header).toBeFocused()
  await page.keyboard.press("j")
  await expect(three.header).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(three.header).toHaveAttribute("aria-expanded", "true")
  await expect(one.header).toHaveAttribute("aria-expanded", "false")

  await captionWithUrl(page, "Esc closes it")
  await page.keyboard.press("Escape")
  await expect(three.header).toHaveAttribute("aria-expanded", "false")
  await expect(three.steps).toHaveCount(0)
  await expect(page).toHaveURL(/\/review$/)
  await expect(three.header).toBeFocused()

  await captionWithUrl(page, `↑ to ${key}-2, Enter, then reload: ${key}-2 is still open`)
  await page.keyboard.press("ArrowUp")
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(new RegExp(`/review\\?open=${key}-2$`))
  await page.reload()
  await captionWithUrl(page, `Reloaded: ${key}-2 is still open`)
  await expect(two.header).toHaveAttribute("aria-expanded", "true")
  await expect(two.steps.locator(`[data-task-link="${key}-2"]`)).toBeVisible()
  await expect(one.header).toHaveAttribute("aria-expanded", "false")

  await captionWithUrl(page, `Approve ${key}-2: it leaves the queue and ${key}-3 opens`)
  await two.article.getByRole("button", { name: "Approve" }).click()
  await expect(two.article).toHaveCount(0)
  await expect(three.header).toHaveAttribute("aria-expanded", "true")
  await expect(page).toHaveURL(new RegExp(`/review\\?open=${key}-3$`))
  await expect(three.header).toBeFocused()

  await captionWithUrl(page, `Open ${key}-1 and send it back: ${key}-3 opens again`)
  await one.header.click()
  // The mouse moved: hover highlights are back.
  await expect(one.header).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
  await one.article.getByRole("button", { name: "Send back" }).click()
  const dialog = page.getByRole("dialog", { name: `Send ${key}-1 back` })
  await dialog.getByLabel("Note").fill("Keep the thumbnail when the row is open, too.")
  await dialog.getByRole("button", { name: "Send back" }).click()
  await expect(dialog).toBeHidden()
  await expect(one.article).toHaveCount(0)
  await expect(three.header).toHaveAttribute("aria-expanded", "true")
  await expect(page).toHaveURL(new RegExp(`/review\\?open=${key}-3$`))
  await captionWithUrl(page, "One packet at a time, in order")
  fs.rmSync(dir, { recursive: true, force: true })
})

/**
 * CEL-187: Approve and Send back answer on the row. The decisions go through the test (packets.ts), so
 * it sees the page while one runs and when one fails, and reads the confirmations back afterwards.
 */
async function decideOnTheRow(page: Page) {
  const decisions = await decisionsThroughTest(page)
  const key = uniqueKey("ANS")
  await createProject(page, "Review answers test", key)
  await caption(page, "An agent submits three packets")
  const { dir } = await submitPackets(page, key, ["Show that Approve is running", "Say what was decided", "Open the next packet smoothly"])
  const [one, two, three] = [1, 2, 3].map((n) => rowOf(page, `${key}-${n}`)) as [ReturnType<typeof rowOf>, ReturnType<typeof rowOf>, ReturnType<typeof rowOf>]
  const buttons = (row: ReturnType<typeof rowOf>) => ({
    approve: row.article.locator('[data-decide="approved"]'),
    sendBack: row.article.locator('[data-decide="sent_back"]'),
    box: row.article.getByLabel("New comment"),
  })

  await captionWithUrl(page, `Open Review at ${key}-1 and write a note`)
  await page.goto(`/review?open=${key}-1`)
  await expect(one.header).toHaveAttribute("aria-expanded", "true")
  await watchDecided(page)
  const first = buttons(one)
  await first.box.fill("Ship it.")

  await captionWithUrl(page, "Approve, but the server refuses: the row says why, and the packet stays open with the note")
  decisions.failNext()
  await first.approve.click()
  await expect(one.article.getByRole("alert")).toContainText("no longer exists")
  await expect(one.header).toHaveAttribute("aria-expanded", "true")
  await expect(one.steps).toBeVisible()
  await expect(first.box).toHaveValue("Ship it.")
  await expect(first.approve).toBeEnabled()
  await expect(first.approve).toHaveAttribute("aria-busy", "false")

  await captionWithUrl(page, "Approve again: the button says it's approving, and both wait")
  decisions.holdNext()
  await first.approve.click()
  await expect(first.approve).toHaveAttribute("aria-busy", "true")
  await expect(first.approve).toHaveText("Approving…")
  await expect(first.approve).toBeDisabled()
  await expect(first.sendBack).toBeDisabled()
  await expect(one.article.getByRole("alert")).toHaveCount(0)
  // The task is already Done on the board (its events arrived), and the row is still here, in its place.
  await expect(one.steps.locator(`[data-task-link="${key}-1"] [data-task-status]`)).toHaveText("Done")
  const mine = page.getByRole("list", { name: "Waiting for review" }).locator(`[data-review-task^="${key}-"]`)
  expect(await mine.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-review-task")))).toEqual([`${key}-1`, `${key}-2`, `${key}-3`])

  await captionWithUrl(page, `The server took it: the row says Approved, folds away, and ${key}-2 opens`)
  decisions.release()
  await expect(one.article).toHaveCount(0)
  expect(await decidedSeen(page)).toEqual([`${key}-1: Approved`])
  await expect(two.header).toHaveAttribute("aria-expanded", "true")
  await expect(two.steps).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/review\\?open=${key}-2$`))
  await expect(two.header).toBeFocused()

  await captionWithUrl(page, `Write what to change on ${key}-2 and send it back`)
  const second = buttons(two)
  await second.box.fill("Make the fold a little slower.")
  decisions.holdNext()
  await second.sendBack.click()
  await expect(second.sendBack).toHaveAttribute("aria-busy", "true")
  await expect(second.sendBack).toHaveText("Sending back…")
  await expect(second.sendBack).toBeDisabled()
  await expect(second.approve).toBeDisabled()

  await captionWithUrl(page, `The row says Sent back, folds away, and ${key}-3 opens`)
  decisions.release()
  await expect(two.article).toHaveCount(0)
  expect(await decidedSeen(page)).toEqual([`${key}-1: Approved`, `${key}-2: Sent back`])
  await expect(three.header).toHaveAttribute("aria-expanded", "true")
  await expect(page).toHaveURL(new RegExp(`/review\\?open=${key}-3$`))

  await captionWithUrl(page, `Approve ${key}-3, the last one: it says Approved and folds away`)
  await buttons(three).approve.click()
  await expect(three.article).toHaveCount(0)
  expect(await decidedSeen(page)).toEqual([`${key}-1: Approved`, `${key}-2: Sent back`, `${key}-3: Approved`])
  // None of this test's rows is left; a row another test left in the queue may open instead.
  await expect(page).not.toHaveURL(new RegExp(`open=${key}-`))
  await caption(page, "Each decision is answered on its row, then the next packet opens")
  fs.rmSync(dir, { recursive: true, force: true })
}

test("CEL-187: Approve and Send back answer on the row: the button shows it's running, a failure stays on the row with the note, then the row says Approved or Sent back, folds away, and the next opens", async ({ page }) => {
  await decideOnTheRow(page)
})

// With reduced motion nothing folds: the row still says what was decided, then it's gone and the next is open.
test.describe("with reduced motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } })
  test("CEL-187 reduced motion: the row still says Approved or Sent back, then leaves without folding, and the next opens", async ({ page }) => {
    await decideOnTheRow(page)
  })
})

test("CEL-187: Send back from its dialog: a refused one keeps the dialog open with its note and says why; a taken one closes it and the row says Sent back", async ({ page }) => {
  const decisions = await decisionsThroughTest(page)
  const key = uniqueKey("DLG")
  await createProject(page, "Send back dialog test", key)
  await caption(page, "An agent submits two packets")
  const { dir } = await submitPackets(page, key, ["Ask for the note in a dialog", "Open after the dialog's Send back"])
  const [one, two] = [1, 2].map((n) => rowOf(page, `${key}-${n}`)) as [ReturnType<typeof rowOf>, ReturnType<typeof rowOf>]

  await captionWithUrl(page, `Open Review at ${key}-1 and click Send back with nothing typed: it asks for a note`)
  await page.goto(`/review?open=${key}-1`)
  await expect(one.header).toHaveAttribute("aria-expanded", "true")
  await watchDecided(page)
  await one.article.locator('[data-decide="sent_back"]').click()
  const dialog = page.getByRole("dialog", { name: `Send ${key}-1 back` })
  const note = dialog.getByLabel("Note")
  const send = dialog.locator('button[type="submit"]')
  await note.fill("The fold is too fast.")

  await captionWithUrl(page, "Send back, but the server refuses: the dialog stays open with the note, and says why")
  decisions.failNext()
  await send.click()
  await expect(dialog.getByRole("alert")).toContainText("no longer exists")
  await expect(note).toHaveValue("The fold is too fast.")
  await expect(send).toBeEnabled()
  await expect(send).toHaveAttribute("aria-busy", "false")
  // The reason shows once, in the dialog (which sits inside the row), not under the row's buttons too; the packet behind it is still open.
  await expect(page.locator("[data-decision-failed]")).toHaveCount(1)
  await expect(one.header).toHaveAttribute("aria-expanded", "true")

  await captionWithUrl(page, "Send back again: the dialog's button says it's sending, and waits")
  decisions.holdNext()
  await send.click()
  await expect(send).toHaveAttribute("aria-busy", "true")
  await expect(send).toHaveText("Sending back…")
  await expect(send).toBeDisabled()
  await expect(dialog.getByRole("alert")).toHaveCount(0)

  await captionWithUrl(page, `The server took it: the dialog closes, the row says Sent back and folds away, and ${key}-2 opens`)
  decisions.release()
  await expect(dialog).toBeHidden()
  await expect(one.article).toHaveCount(0)
  expect(await decidedSeen(page)).toEqual([`${key}-1: Sent back`])
  await expect(two.header).toHaveAttribute("aria-expanded", "true")
  await expect(page).toHaveURL(new RegExp(`/review\\?open=${key}-2$`))
  fs.rmSync(dir, { recursive: true, force: true })
})

test("CEL-187: in the task panel, a refused Send back on an approved task shows its reason on a line under the button, not squeezed beside it", async ({ page }) => {
  const decisions = await decisionsThroughTest(page)
  const key = uniqueKey("PNL")
  await createProject(page, "Panel failure test", key)
  await caption(page, "Merge after I approve is on, an agent submits a packet, and it's approved: the task waits for its merge")
  await page.goto(`/${key}/settings`)
  const toggle = page.getByRole("region", { name: "Merging" }).getByRole("switch")
  await toggle.click()
  await expect(toggle).toBeChecked()
  await projectLink(page, key).click()
  const { dir } = await submitPacket(page, key)
  await page.goto(`/review?open=${key}-1`)
  const item = page.getByRole("article", { name: new RegExp(`${key}-1`) })
  await item.getByRole("button", { name: "Approve and merge" }).click()
  await expect(item).toHaveCount(0)

  await captionWithUrl(page, "In the task panel, Send back with a note, but the server refuses")
  await page.goto(`/${key}/1`)
  const approved = taskPanel(page, `${key}-1`).getByRole("region", { name: "Approved, merging" })
  const sendBack = approved.locator('[data-decide="sent_back"]')
  await sendBack.click()
  const dialog = page.getByRole("dialog", { name: `Send ${key}-1 back` })
  await dialog.getByLabel("Note").fill("The merge left a conflict.")
  decisions.failNext()
  await dialog.locator('button[type="submit"]').click()
  await expect(dialog.getByRole("alert")).toContainText("no longer exists")

  await captionWithUrl(page, "Cancel the dialog: the reason is on a line of its own under Send back")
  await dialog.getByRole("button", { name: "Cancel" }).click()
  await expect(dialog).toBeHidden()
  const reason = approved.getByRole("alert")
  await expect(reason).toContainText("no longer exists")
  await expect(sendBack).toBeEnabled()
  const [button, line] = [(await sendBack.boundingBox())!, (await reason.boundingBox())!]
  expect(line.y, "under the button").toBeGreaterThanOrEqual(button.y + button.height)
  expect(Math.abs(line.x + line.width - (button.x + button.width)), "its right edge on the button's").toBeLessThan(1)
  fs.rmSync(dir, { recursive: true, force: true })
})

// The same walk in the dark theme, for the review videos only (CELLO_E2E_REVIEW=1): nothing in it depends on the theme.
test.describe("in the dark theme", () => {
  test.skip(!isReview(process.env), "recorded for review videos only")
  test.use({ colorScheme: "dark" })
  test("CEL-187 dark: Approve and Send back answer on the row", async ({ page }) => {
    await decideOnTheRow(page)
  })
})

/** The Review page with `key` open in its own unrecorded window, saved to e2e/videos/review-wide-<width>x<height>-<scheme>.png. */
async function screenshotWide(browser: Browser, key: string, viewport: { width: number; height: number }, colorScheme: "light" | "dark") {
  const context = await browser.newContext({ baseURL: WEB_URL, viewport, colorScheme })
  const page = await context.newPage()
  await page.goto(`/review?open=${key}`)
  const item = page.getByRole("article", { name: new RegExp(`${key}\\b`) })
  await packetDrawn(item)
  const poster = await item.locator("video").getAttribute("poster")
  await page.evaluate((src) => new Promise((resolve) => Object.assign(new Image(), { onload: resolve, src })), poster!)
  // A screenshot in the window has loaded (one below the fold loads lazily, out of the picture anyway).
  await item
    .locator("img[data-evidence=screenshot]")
    .first()
    .evaluate((img: HTMLImageElement) => img.complete || img.getBoundingClientRect().top > innerHeight || new Promise((resolve) => img.addEventListener("load", resolve)))
  await page.screenshot({ path: path.join(SHOTS, `review-wide-${viewport.width}x${viewport.height}-${colorScheme}.png`) })
  await context.close()
}

/** The Review page at a mid width: `key` open, and its video open in the viewer beside it. Saved to e2e/videos/review-mid-<scheme>.png. */
async function screenshotMid(browser: Browser, key: string, colorScheme: "light" | "dark") {
  const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 }, colorScheme })
  const page = await context.newPage()
  await page.goto(`/review?open=${key}`)
  const item = page.getByRole("article", { name: new RegExp(`${key}\\b`) })
  await packetDrawn(item)
  await item.getByRole("button", { name: "Open The whole flow in the viewer" }).click()
  await expect(page.getByRole("complementary", { name: "Viewer" }).getByRole("heading", { name: "The whole flow" })).toBeVisible()
  await expectOneColumn(item)
  await page.screenshot({ path: path.join(SHOTS, `review-mid-${colorScheme}.png`) })
  await context.close()
}

test("CEL-38: a wide Review page opens the packet in two columns, evidence on the right and sticky; a narrow panel and the task panel keep one column", async ({ page, browser }) => {
  const key = uniqueKey("WID")
  await createProject(page, "Wide review test", key)
  await caption(page, "An agent submits a packet with a diagram, a video and a screenshot")
  const { dir } = await submitDiagramPacket(page, key, "Use the screen width on the Review page")
  const item = page.getByRole("article", { name: new RegExp(`${key}-1\\b`) })

  await captionWithUrl(page, "Open it on the Review page, 1440 px wide: summary and steps on the left, evidence on the right")
  await page.goto(`/review?open=${key}-1`)
  await packetDrawn(item)
  await expectTwoColumns(item)

  await caption(page, "Scroll down: the evidence stays in view beside the steps")
  const evidence = item.getByRole("region", { name: "Evidence" })
  // Scroll the packet's top 120 px past the top of the page's scroll area.
  const { scrollerTop, padding } = await evidence.evaluate((el) => {
    const scroller = el.closest<HTMLElement>("[data-review-scroller]")!
    const packetTop = el.parentElement!.getBoundingClientRect().top
    const top = scroller.getBoundingClientRect().top
    scroller.scrollTop += packetTop - top + 120
    return { scrollerTop: top, padding: parseFloat(getComputedStyle(scroller).paddingTop) }
  })
  const scrolled = await packetLayout(item)
  expect(scrolled.diagram.y).toBeLessThan(scrollerTop)
  // Stuck at the scroll area's top padding, while the left column moved on.
  expect(Math.abs(scrolled.evidence.y - (scrollerTop + padding))).toBeLessThan(1)

  await caption(page, "A narrower window, 1100 px: too narrow for two columns, so one column as before")
  await page.setViewportSize({ width: 1100, height: 900 })
  await expectOneColumn(item)
  // Narrower than the column's cap, it still starts at the left edge (CEL-163), not in the middle.
  const reviewList = page.getByRole("list", { name: "Waiting for review" })
  const scroller = page.locator("[data-review-scroller]")
  await expectLeftAligned(scroller, reviewList)

  await caption(page, "Back to 1440 px, then open the video in the viewer: the panel narrows, so one column again")
  await page.setViewportSize({ width: 1440, height: 900 })
  await expectTwoColumns(item)
  await expectLeftAligned(scroller, reviewList)
  await item.getByRole("button", { name: "Open The whole flow in the viewer" }).click()
  const viewer = page.getByRole("complementary", { name: "Viewer" })
  await expect(viewer.getByRole("heading", { name: "The whole flow" })).toBeVisible()
  await expectOneColumn(item)
  // The side panel narrows the page to a mid width: the list keeps its left edge.
  await expectLeftAligned(scroller, reviewList)
  await caption(page, "Close the viewer: two columns again")
  await viewer.getByRole("button", { name: "Close viewer" }).click()
  await expect(viewer).toBeHidden()
  await expectTwoColumns(item)

  // Stills for the report, without the test's overlay: wide and laptop sizes in both themes, and a narrow one.
  for (const colorScheme of ["light", "dark"] as const) {
    await screenshotWide(browser, `${key}-1`, { width: 2560, height: 1440 }, colorScheme)
    await screenshotWide(browser, `${key}-1`, { width: 1440, height: 900 }, colorScheme)
  }
  await screenshotWide(browser, `${key}-1`, { width: 1100, height: 900 }, "light")
  for (const colorScheme of ["light", "dark"] as const) await screenshotMid(browser, `${key}-1`, colorScheme)

  // On a 2560 px screen the rows and the packet grow, but stop well short of the edges.
  const wide = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 2560, height: 1440 } })
  const widePage = await wide.newPage()
  await widePage.goto(`/review?open=${key}-1`)
  const wideItem = widePage.getByRole("article", { name: new RegExp(`${key}-1\\b`) })
  await packetDrawn(wideItem)
  const list = (await widePage.getByRole("list", { name: "Waiting for review" }).boundingBox())!
  const scrollArea = (await widePage.locator("[data-review-scroller]").boundingBox())!
  expect(list.width).toBeGreaterThan(1400)
  expect(list.width).toBeLessThanOrEqual(1536)
  // Aligned left, like at any other width (CEL-163): the same edge, not centred in the panel.
  expect(scrollArea.width).toBeGreaterThan(list.width)
  await expectLeftAligned(widePage.locator("[data-review-scroller]"), widePage.getByRole("list", { name: "Waiting for review" }))
  const at = await expectTwoColumns(wideItem)
  // The text column keeps a readable line length.
  expect(at.steps.width).toBeLessThan(720)
  await wide.close()

  await caption(page, "The task's pinned packet, in the side panel beside Review (CEL-141), stays in one column")
  await item.getByRole("link", { name: `Open ${key}-1` }).click()
  await expect(page).toHaveURL(/\/review\?/)
  const pinned = page.getByRole("complementary", { name: "Viewer" }).getByRole("region", { name: "Review packet" })
  await packetDrawn(pinned)
  await expectOneColumn(pinned)

  await caption(page, `Approve ${key}-1 from the panel`)
  await pinned.getByRole("button", { name: "Approve" }).click()
  await expect(pinned).toBeHidden()
  await caption(page, "Wide panels read on the left and watch on the right; narrow ones keep one column")
  fs.rmSync(dir, { recursive: true, force: true })
})

test("CEL-71: an agent moves its task out of In Review with `cello task move`: the packet leaves the Review page, withdrawn, and the task panel lists it under Earlier reviews", async ({ page }) => {
  const key = uniqueKey("WDR")
  await createProject(page, "Withdrawn packets test", key)
  await caption(page, "An agent submits two packets")
  const { dir } = await submitPackets(page, key, ["Filter the board", "Keep this one waiting"])
  const [one, two] = [1, 2].map((n) => rowOf(page, `${key}-${n}`)) as [ReturnType<typeof rowOf>, ReturnType<typeof rowOf>]

  await captionWithUrl(page, "Open Review: both packets wait for Lucas")
  await page.getByRole("navigation", { name: "Inbox" }).getByRole("link", { name: /^Review/ }).click()
  await expect(one.header).toBeVisible()
  await expect(two.header).toBeVisible()

  await captionWithUrl(page, `Lucas comments in chat; the agent runs \`cello task move ${key}-1 "In Progress"\``)
  cello("task", "move", `${key}-1`, "In Progress")
  await captionWithUrl(page, `${key}-1 leaves the Review page by itself; ${key}-2 still waits`)
  await expect(one.article).toHaveCount(0)
  await expect(two.header).toBeVisible()
  await page.screenshot({ path: path.join(SHOTS, "review-withdrawn.png") })

  await caption(page, `${key}-1 is in In Progress; its panel lists the packet as withdrawn`)
  await projectLink(page, key).click()
  await expect(column(page, "In Progress").locator(`[data-task-key="${key}-1"]`)).toBeVisible()
  await expect(card(page, `${key}-1`).locator("[data-evidence-badge]")).toHaveCount(0)
  await card(page, `${key}-1`).click()
  const panel = page.getByRole("complementary", { name: `${key}-1 details` })
  await expect(panel.getByRole("region", { name: "Review packet" })).toBeHidden()
  await expect(panel.getByRole("region", { name: "Earlier reviews" }).getByRole("button", { name: /Withdrawn/ })).toBeVisible()
  await caption(page, `Withdrawn: ${key}-1 is being worked on again, and the Review page shows only what waits on Lucas`)
  fs.rmSync(dir, { recursive: true, force: true })
})

for (const theme of ["light", "dark"] as const) {
  test(`CEL-188 (${theme}): the Review page narrows to a project: chips with counts, j and ↓ walk only the shown rows, a packet approved while filtered folds and the next shown row opens, the pick survives a reload`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("cello:theme", t), theme)
    const nameA = `Chips Alpha ${theme}`
    const nameB = `Chips Beta ${theme}`
    const keyA = uniqueKey(theme === "light" ? "CAL" : "CAD")
    await createProject(page, nameA, keyA)
    const alpha = await submitPackets(page, keyA, ["Alpha one", "Alpha two"])
    const keyB = uniqueKey(theme === "light" ? "CBL" : "CBD")
    await createProject(page, nameB, keyB)
    const beta = await submitPackets(page, keyB, ["Beta one"])
    const [one, two] = [1, 2].map((n) => rowOf(page, `${keyA}-${n}`)) as [ReturnType<typeof rowOf>, ReturnType<typeof rowOf>]
    const beta1 = rowOf(page, `${keyB}-1`)
    const chip = (name: string, count: number) => page.getByRole("radio", { name: `${name} ${count}` })
    const all = page.getByRole("radio", { name: /^All \d+$/ })
    // Every row the page shows: with a pick, only that project's (another test's packets are in other projects).
    const shown = page.locator("[data-review-task]")

    await page.goto("/review")
    await caption(page, "Review on All: packets from two projects")
    await expect(beta1.header).toBeVisible()
    await expect(one.header).toBeVisible()
    await expect(chip(nameA, 2)).toBeVisible()
    await expect(chip(nameB, 1)).toBeVisible()
    await expect(all).toHaveAttribute("aria-checked", "true")

    await caption(page, `Pick ${nameA}: only its two packets stay, and the page count follows`)
    await chip(nameA, 2).click()
    await expect(shown).toHaveCount(2)
    await expect(beta1.article).toHaveCount(0)
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Review 2")

    await caption(page, "j and ↓ move between the shown rows only, and stop at the last one")
    await one.header.focus()
    await page.keyboard.press("j")
    await expect(two.header).toBeFocused()
    await page.keyboard.press("ArrowDown")
    await expect(two.header).toBeFocused()
    await page.keyboard.press("k")
    await expect(one.header).toBeFocused()

    await captionWithUrl(page, "Reload: the pick stays on this device")
    await page.reload()
    await expect(chip(nameA, 2)).toHaveAttribute("aria-checked", "true")
    await expect(shown).toHaveCount(2)

    await caption(page, `Open ${keyA}-1 and approve it: it says Approved, folds away, and ${keyA}-2 opens`)
    await one.header.click()
    await expect(one.header).toHaveAttribute("aria-expanded", "true")
    await one.article.locator('[data-decide="approved"]').click()
    await expect(one.article).toHaveCount(0)
    await expect(two.header).toHaveAttribute("aria-expanded", "true")
    await expect(chip(nameA, 1)).toHaveAttribute("aria-checked", "true")
    await expect(shown).toHaveCount(1)

    await caption(page, "All: everything is back")
    await all.click()
    await expect(two.header).toBeVisible()
    await expect(beta1.header).toBeVisible()
    await expect(all).toHaveAttribute("aria-checked", "true")
    for (const { dir } of [alpha, beta]) fs.rmSync(dir, { recursive: true, force: true })
  })
}

test("CEL-188: the Review page's Display menu sorts the rows: Newest reverses the queue, Oldest brings it back; the trigger names the sort, and it is kept after a reload", async ({ page }) => {
  const key = uniqueKey("SRT")
  await createProject(page, "Review sort test", key)
  const { dir } = await submitPackets(page, key, ["Made first", "Made second", "Made third"])
  const mine = page.locator(`[data-review-task^="${key}-"]`)
  /** This test's rows, in the order the page shows them (another test's rows may share the page). */
  const expectOrder = async (order: ReadonlyArray<number>) => {
    await expect(mine).toHaveCount(order.length)
    for (const [i, n] of order.entries()) await expect(mine.nth(i)).toHaveAttribute("data-review-task", `${key}-${n}`)
  }
  const display = page.getByRole("button", { name: /^Display/ })
  const pickSort = async (label: string) => {
    await display.click()
    const sort = page.getByRole("combobox", { name: "Sort", exact: true })
    await sort.click()
    await page.getByRole("option", { name: label, exact: true }).click()
    await expect(sort).toContainText(label)
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog", { name: "Display options" })).toBeHidden()
  }

  await page.goto("/review")
  await caption(page, "Three packets, the oldest first")
  await expectOrder([1, 2, 3])
  await expect(display).toHaveText("Display")

  await caption(page, "Display, Sort by Newest: the last one submitted comes first")
  await pickSort("Newest")
  await expectOrder([3, 2, 1])
  await expect(display).toContainText(/Display\s*· Newest/)

  await captionWithUrl(page, "Reload: the sort stays on this device")
  await page.reload()
  await expectOrder([3, 2, 1])
  await expect(display).toContainText(/Display\s*· Newest/)

  await caption(page, "Sort by Oldest: the queue's own order is back")
  await pickSort("Oldest")
  await expectOrder([1, 2, 3])
  await expect(display).toHaveText("Display")
  fs.rmSync(dir, { recursive: true, force: true })
})
