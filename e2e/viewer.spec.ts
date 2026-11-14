// CEL-12: evidence, Cello pages and links open in the viewer side panel beside the board, from the
// Review page, the task panel's pinned packet, a card's evidence badge and links in comments.
import * as fs from "node:fs"
import * as http from "node:http"
import type { AddressInfo } from "node:net"
import * as path from "node:path"
import type { Browser, Locator, Page } from "@playwright/test"
import { caption, card, column, createProject, expect, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { SHOTS, submitPacket, WEB_URL } from "./packets.ts"

const viewerOf = (page: Page) => page.getByRole("complementary", { name: "Viewer" })

/** Resolves once the video has played past one second (on its own timeupdate events). */
const playedPastOneSecond = (video: Locator) =>
  video.evaluate(
    (v: HTMLVideoElement) =>
      new Promise<number>((resolve) => {
        const check = () => v.currentTime > 1 && resolve(v.currentTime)
        v.addEventListener("timeupdate", check)
        check()
      }),
  )

/** Drags the viewer's left edge by `dx` px (negative: to the left, wider) with the mouse. */
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

/** The Review page with the viewer open, in an unrecorded window, saved to e2e/videos/viewer-<what>-<scheme>.png. */
async function screenshotViewer(browser: Browser, key: string, colorScheme: "light" | "dark") {
  const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 }, colorScheme })
  const page = await context.newPage()
  await page.goto("/review")
  const item = page.getByRole("article", { name: new RegExp(`${key}-1`) })
  const viewer = viewerOf(page)
  await item.getByRole("button", { name: "Open The board" }).click()
  await expect(viewer.locator("img[data-viewer-image]")).toHaveJSProperty("complete", true)
  await page.screenshot({ path: path.join(SHOTS, `viewer-screenshot-${colorScheme}.png`) })
  await item.getByRole("link", { name: "The PR" }).click()
  await expect(viewer.getByRole("heading", { name: "This site can't be shown inside Cello" })).toBeVisible()
  await page.screenshot({ path: path.join(SHOTS, `viewer-external-${colorScheme}.png`) })
  await context.close()
}

test("CEL-12: a packet's screenshot, video and PR link open in the viewer beside the Review page; the PR shows the fallback card; it resizes, keeps its width and closes", async ({ page, browser }) => {
  const key = uniqueKey("VWR")
  await createProject(page, "Viewer test", key)
  const { dir } = await submitPacket(page, key)
  await page.getByRole("navigation", { name: "Inbox" }).getByRole("link", { name: /^Review/ }).click()
  const item = page.getByRole("article", { name: new RegExp(`${key}-1`) })
  const viewer = viewerOf(page)
  await expect(viewer).toHaveCount(0)
  const feedWidth = (await item.boundingBox())!.width

  await caption(page, "Click the screenshot: it opens in the viewer, fitted to the panel")
  await item.getByRole("button", { name: "Open The board" }).click()
  await expect(viewer.getByRole("heading", { name: "The board" })).toBeVisible()
  const image = viewer.locator("img[data-viewer-image]")
  await expect(image).toHaveJSProperty("naturalWidth", 1440)
  expect((await image.boundingBox())!.width).toBeLessThan(560)
  // The feed shrinks beside it instead of hiding under it.
  expect((await item.boundingBox())!.width).toBeLessThan(feedWidth)
  await expect(viewer.getByRole("link", { name: "Open in new tab" })).toHaveAttribute("href", /\/attachments\/[^/]+$/)

  await caption(page, "Click the image to see it at full size, and again to fit it")
  await viewer.getByRole("button", { name: "Zoom to full size" }).click()
  await expect(viewer.getByRole("button", { name: "Fit to panel" })).toHaveAttribute("aria-pressed", "true")
  expect((await image.boundingBox())!.width).toBe(1440)
  await viewer.getByRole("button", { name: "Fit to panel" }).click()
  await expect(viewer.getByRole("button", { name: "Zoom to full size" })).toHaveAttribute("aria-pressed", "false")

  await caption(page, "Open the video in the viewer: it plays there, with controls")
  const played = playedPastOneSecond(viewer.locator("video[data-viewer-video]"))
  await item.getByRole("button", { name: "Open The whole flow in the viewer" }).click()
  await expect(viewer.getByRole("heading", { name: "The whole flow" })).toBeVisible()
  await expect(viewer.locator("video[data-viewer-video]")).toHaveJSProperty("controls", true)
  expect(await played).toBeGreaterThan(1)
  await expect(item.locator("video[data-evidence=video]")).toHaveJSProperty("paused", true)

  await caption(page, "Open the PR link: GitHub can't be framed, so the viewer offers the browser instead")
  await item.getByRole("link", { name: "The PR" }).click()
  await expect(viewer.getByRole("heading", { name: "The PR" })).toBeVisible()
  const fallback = viewer.getByRole("region", { name: "Can't show this site" })
  await expect(fallback.getByRole("heading", { name: "This site can't be shown inside Cello" })).toBeVisible()
  await expect(fallback.getByRole("link", { name: "Open in browser" })).toHaveAttribute("href", "https://github.com/lnmunhoz/cello/pull/10")
  await expect(fallback).toContainText("The Cello desktop app shows any site in its built-in browser")
  await expect(viewer.locator("iframe")).toHaveCount(0)

  await caption(page, "Drag the viewer's left edge 200px to the left: it gets wider")
  const before = (await viewer.boundingBox())!.width
  expect(before).toBe(560)
  await dragEdge(page, -200)
  expect((await viewer.boundingBox())!.width).toBe(before + 200)

  await caption(page, "Esc closes it")
  await page.keyboard.press("Escape")
  await expect(viewer).toHaveCount(0)

  await caption(page, "Reload and open the screenshot again: the viewer keeps its width")
  await page.reload()
  await item.getByRole("button", { name: "Open The board" }).click()
  await expect(viewer.getByRole("heading", { name: "The board" })).toBeVisible()
  expect((await viewer.boundingBox())!.width).toBe(before + 200)

  await caption(page, "The close button closes it too")
  await viewer.getByRole("button", { name: "Close viewer" }).click()
  await expect(viewer).toHaveCount(0)
  await expect(item.getByRole("button", { name: "Open The board" })).toBeFocused()

  // Stills for the report: the viewer with the screenshot and with the fallback card, light and dark.
  await page.evaluate(() => localStorage.removeItem("cello:viewer-width"))
  for (const colorScheme of ["light", "dark"] as const) await screenshotViewer(browser, key, colorScheme)
  await caption(page, "Screenshots, videos and links open beside the Review page")
  fs.rmSync(dir, { recursive: true, force: true })
})

test("CEL-12: on the board, the evidence badge and the task panel's packet open the viewer in the panel's place, Esc brings the task back, and links in comments (a Cello page, a dev server) open there too", async ({ page }) => {
  const key = uniqueKey("VWB")
  await createProject(page, "Viewer board test", key)
  const { dir } = await submitPacket(page, key)
  const viewer = viewerOf(page)
  const taskCard = card(page, `${key}-1`)

  await caption(page, "Click the evidence badge on the card: its first piece, the video, opens beside the board")
  await taskCard.locator("[data-evidence-badge]").click()
  await expect(viewer.locator("video[data-viewer-video]")).toBeVisible()
  await expect(viewer.getByRole("heading", { name: "The whole flow" })).toBeVisible()
  // The card didn't open, and the board stays usable beside the viewer.
  await expect(page).toHaveURL(new RegExp(`/${key}/issues$`))
  await expect(column(page, "In Review").locator(`[data-task-key="${key}-1"]`)).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(viewer).toHaveCount(0)

  await caption(page, "Open the card, then its screenshot: the viewer takes the task panel's place")
  await taskCard.click()
  const panel = taskPanel(page, `${key}-1`)
  const pinned = panel.getByRole("region", { name: "Review packet" })
  await pinned.getByRole("button", { name: "Open The board" }).click()
  await expect(viewer.getByRole("img", { name: "The board" })).toBeVisible()
  await expect(panel).toBeHidden()
  await expect(page).toHaveURL(new RegExp(`/${key}/1$`))

  await caption(page, "Esc closes the viewer and brings the task back, where it was")
  await page.keyboard.press("Escape")
  await expect(viewer).toHaveCount(0)
  await expect(panel).toBeVisible()
  await expect(pinned.getByRole("button", { name: "Open The board" })).toBeFocused()

  await caption(page, "A comment with a bare address: it's a link, and it opens in the viewer")
  const reviewUrl = `${WEB_URL}/review`
  await panel.getByLabel("New comment").fill(`The queue is at ${reviewUrl}.`)
  await panel.getByRole("button", { name: "Comment", exact: true }).click()
  const link = panel.locator("[data-comment-id]").getByRole("link", { name: reviewUrl })
  await expect(link).toHaveAttribute("href", reviewUrl)
  await link.click()
  await expect(viewer.getByRole("heading", { name: reviewUrl.replace(/^http:\/\//, "") })).toBeVisible()

  await caption(page, "A Cello page shows inside the viewer without the sidebar")
  const frame = viewer.frameLocator("iframe")
  await expect(frame.getByRole("heading", { name: /^Review/ })).toBeVisible()
  await expect(frame.getByRole("article", { name: new RegExp(`${key}-1`) })).toBeVisible()
  await expect(frame.getByRole("navigation", { name: "Projects" })).toHaveCount(0)

  await caption(page, "Close the viewer: the task is back")
  await viewer.getByRole("button", { name: "Close viewer" }).click()
  await expect(viewer).toHaveCount(0)
  await expect(panel).toBeVisible()

  await caption(page, "A link to another site that allows framing (a dev server): it shows in the viewer, with Open in browser at hand")
  const site = await framableSite()
  await panel.getByLabel("New comment").fill(`Preview: ${site.url}`)
  await panel.getByRole("button", { name: "Comment", exact: true }).click()
  await panel.locator("[data-comment-id]").getByRole("link", { name: site.url }).click()
  await expect(viewer.frameLocator("iframe").getByRole("heading", { name: "A dev server page" })).toBeVisible()
  await expect(viewer.getByText("Blank? Some sites can't be shown inside Cello.")).toBeVisible()
  await expect(viewer.getByRole("link", { name: "Open in browser" })).toHaveAttribute("href", site.url)
  await page.keyboard.press("Escape")
  await expect(viewer).toHaveCount(0)
  await caption(page, "The badge, the packet and comment links all open in the viewer")
  await site.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

/** A page on another origin that allows framing, like a local dev server. */
async function framableSite() {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    response.end(`<!doctype html><title>Dev server</title><body style="font:16px system-ui;padding:24px"><h1>A dev server page</h1></body>`)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
