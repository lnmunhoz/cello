// CEL-10: an agent hands in a review packet through the real `cello` CLI (a real MP4 and a real
// screenshot), and Lucas reviews it in the browser: on the Review page (approve → Done) and in the
// task panel (send back with a note → In Progress).
// CEL-22: the Review page shows the queue as collapsed rows and opens one packet at a time.
import * as fs from "node:fs"
import * as path from "node:path"
import type { Browser, Page } from "@playwright/test"
import { caption, card, column, createProject, expect, test, uniqueKey } from "./fixtures.ts"
import { SHOTS, submitPacket, submitPackets, WEB_URL } from "./packets.ts"

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

  await caption(page, "Open the screenshot large, in the viewer")
  const thumb = item.locator("img[data-evidence=screenshot]")
  await expect(thumb).toHaveJSProperty("naturalWidth", 1440)
  await item.getByRole("button", { name: "Open The board" }).click()
  const viewer = page.getByRole("complementary", { name: "Viewer" })
  await expect(viewer.getByRole("img", { name: "The board" })).toBeVisible()
  await viewer.getByRole("button", { name: "Close viewer" }).click()
  await expect(viewer).toBeHidden()

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
  await page.getByRole("link", { name: "Packets test" }).click()
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

  await caption(page, "Open Review: every packet is a collapsed row")
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

  await caption(page, `Click ${key}-1: its packet opens`)
  await one.header.click()
  await expect(one.header).toHaveAttribute("aria-expanded", "true")
  // The step names the task: its key links to it, with its status (CEL-20).
  await expect(one.steps.locator(`[data-task-link="${key}-1"] [data-task-status]`)).toHaveText("In Review")
  await expect(page).toHaveURL(new RegExp(`/review\\?open=${key}-1$`))

  await caption(page, `Click ${key}-2: it opens, and ${key}-1 closes`)
  await two.header.click()
  await expect(two.header).toHaveAttribute("aria-expanded", "true")
  await expect(two.steps).toBeVisible()
  await expect(one.header).toHaveAttribute("aria-expanded", "false")
  await expect(one.steps).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`/review\\?open=${key}-2$`))

  await caption(page, "k moves up a row, Enter opens it; the keyboard wins over the mouse's hover")
  await two.header.hover()
  await expect(two.header).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
  await page.keyboard.press("k")
  await expect(one.header).toBeFocused()
  // The mouse still rests on the other row: its hover highlight gives way while the keys are in use.
  await expect(two.header).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
  await page.keyboard.press("Enter")
  await expect(one.header).toHaveAttribute("aria-expanded", "true")
  await expect(two.header).toHaveAttribute("aria-expanded", "false")

  await caption(page, "j, j moves down two rows; Enter opens it")
  await page.keyboard.press("j")
  await expect(two.header).toBeFocused()
  await page.keyboard.press("j")
  await expect(three.header).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(three.header).toHaveAttribute("aria-expanded", "true")
  await expect(one.header).toHaveAttribute("aria-expanded", "false")

  await caption(page, "Esc closes it")
  await page.keyboard.press("Escape")
  await expect(three.header).toHaveAttribute("aria-expanded", "false")
  await expect(three.steps).toHaveCount(0)
  await expect(page).toHaveURL(/\/review$/)
  await expect(three.header).toBeFocused()

  await caption(page, `↑ to ${key}-2, Enter, then reload: ${key}-2 is still open`)
  await page.keyboard.press("ArrowUp")
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(new RegExp(`/review\\?open=${key}-2$`))
  await page.reload()
  await caption(page, `Reloaded: ${key}-2 is still open`)
  await expect(two.header).toHaveAttribute("aria-expanded", "true")
  await expect(two.steps.locator(`[data-task-link="${key}-2"]`)).toBeVisible()
  await expect(one.header).toHaveAttribute("aria-expanded", "false")

  await caption(page, `Approve ${key}-2: it leaves the queue and ${key}-3 opens`)
  await two.article.getByRole("button", { name: "Approve" }).click()
  await expect(two.article).toHaveCount(0)
  await expect(three.header).toHaveAttribute("aria-expanded", "true")
  await expect(page).toHaveURL(new RegExp(`/review\\?open=${key}-3$`))
  await expect(three.header).toBeFocused()

  await caption(page, `Open ${key}-1 and send it back: ${key}-3 opens again`)
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
  await caption(page, "One packet at a time, in order")
  fs.rmSync(dir, { recursive: true, force: true })
})
