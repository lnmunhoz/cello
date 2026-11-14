// CEL-10: an agent hands in a review packet through the real `cello` CLI (a real MP4 and a real
// screenshot), and Lucas reviews it in the browser: on the Review page (approve → Done) and in the
// task panel (send back with a note → In Progress).
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Browser, Page } from "@playwright/test"
import { caption, card, column, createProject, expect, test, uniqueKey } from "./fixtures.ts"

const root = path.resolve(import.meta.dirname, "..")
const SERVER_PORT = Number(process.env.CELLO_E2E_SERVER_PORT ?? 4791)
const WEB_URL = `http://localhost:${process.env.CELLO_WEB_PORT ?? 5199}`
const shots = path.join(import.meta.dirname, "videos")

/** Runs the `cello` CLI from source as a Claude Code session, against the e2e server. */
const cello = (...args: string[]) => {
  const result = spawnSync("bun", [path.join(root, "apps/cli/src/bin.ts"), ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      CELLO_PORT: String(SERVER_PORT),
      CLAUDE_CODE_SESSION_ID: "e2e0review-agent-session",
      CLAUDE_PID: String(process.pid),
    },
  })
  if (result.status !== 0) throw new Error(`cello ${args.join(" ")} failed: ${result.stderr}`)
  return result.stdout.trim()
}

/** An agent's packet for task 1 of `key`: a real MP4 and a real screenshot of the board. */
async function submitPacket(page: Page, key: string) {
  cello("task", "create", "Review packets on the board", "--project", key)
  cello("task", "claim", `${key}-1`)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-evidence-"))
  // A real MP4 (a test pattern). VP9 inside: Playwright's Chromium has no H.264.
  const video = path.join(dir, "board-flow.mp4")
  const ffmpeg = spawnSync("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=4:size=640x360:rate=25",
    "-c:v", "libvpx-vp9", "-deadline", "realtime", "-b:v", "0", "-crf", "40", "-pix_fmt", "yuv420p", "-movflags", "+faststart", video,
  ])
  if (ffmpeg.status !== 0) throw new Error(`ffmpeg failed: ${ffmpeg.stderr}`)
  const screenshot = path.join(dir, "board.png")
  await page.screenshot({ path: screenshot })
  const out = cello(
    "task", "submit", `${key}-1`,
    "--summary", "Adds **review packets**: a summary, steps and evidence on every task in In Review.",
    "--step", "Open Review in the sidebar",
    "--step", "Play the video and open the screenshot",
    "--step", "Approve it; the card lands in Done",
    "--attach", video, "--caption", "The whole flow",
    "--attach", screenshot, "--caption", "The board",
    "--link", "https://github.com/lnmunhoz/cello/pull/10", "--caption", "The PR",
  )
  expect(out).toContain(`Submitted ${key}-1 for review  In Progress → In Review`)
  return { dir }
}

/** The Review page in its own unrecorded tall window, saved to e2e/videos/review-page-<scheme>.png. */
async function screenshotReviewPage(browser: Browser, key: string, colorScheme: "light" | "dark") {
  const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 1560 }, colorScheme })
  const page = await context.newPage()
  await page.goto("/review")
  const item = page.getByRole("article", { name: new RegExp(`${key}-1`) })
  await expect(item.locator("img[data-evidence=screenshot]")).toHaveJSProperty("naturalWidth", 1440)
  const poster = await item.locator("video").getAttribute("poster")
  await page.evaluate((src) => new Promise((resolve) => Object.assign(new Image(), { onload: resolve, src })), poster!)
  await page.screenshot({ path: path.join(shots, `review-page-${colorScheme}.png`) })
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

  await caption(page, "The sidebar counts it: open Review")
  const reviewLink = page.getByRole("navigation", { name: "Inbox" }).getByRole("link", { name: /^Review/ })
  // Other tests share the server and may have left tasks in In Review: count relative to them.
  const count = reviewLink.locator("[data-review-count]")
  await expect(count).toHaveText(/^\d+ waiting$/)
  const waiting = Number.parseInt(await count.innerText(), 10)
  await reviewLink.click()
  await expect(page).toHaveURL(/\/review$/)

  const item = page.getByRole("article", { name: new RegExp(`${key}-1`) })
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

  await caption(page, "Open the screenshot large")
  const thumb = item.locator("img[data-evidence=screenshot]")
  await expect(thumb).toHaveJSProperty("naturalWidth", 1440)
  await item.getByRole("button", { name: "Open The board" }).click()
  const lightbox = page.getByRole("dialog", { name: "The board" })
  await expect(lightbox.getByRole("img", { name: "The board" })).toBeVisible()
  await lightbox.getByRole("button", { name: "Close" }).click()
  await expect(lightbox).toBeHidden()

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
