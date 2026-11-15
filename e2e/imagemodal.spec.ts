// CEL-44: a packet's screenshots show at the evidence column's full width, one per row, and a click
// opens one in the image modal over the page: fitted on a dark backdrop, zoomed with the wheel or a
// double-click, dragged around, ←/→ through the others, Esc or the backdrop to close (the focus goes
// back to the thumbnail). Videos keep their player and links still open in the viewer. The same modal
// opens from the task panel's packet, the task's full page and images in a page.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Browser, Locator, Page } from "@playwright/test"
import { caption, card, createProject, expect, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { cello, SHOTS, submitScreenshotsPacket, WEB_URL } from "./packets.ts"
import { isReview } from "./recording.ts"

test.beforeEach(() => {
  if (isReview(process.env)) test.setTimeout(240_000)
})

const modalOf = (page: Page) => page.getByRole("dialog")
const imageOf = (modal: Locator) => modal.locator("img[data-modal-image]")
const box = async (locator: Locator) => (await locator.boundingBox())!

/** The zoom the modal's toolbar shows, as a number: 64 for "64%". */
const percent = async (modal: Locator) => Number((await modal.locator("[data-zoom-percent]").textContent())!.replace("%", ""))

/** Double-clicks `locator` at a fraction of its box (0.5, 0.5: the middle of what's drawn, whatever its transform). */
const dblclickAt = async (page: Page, locator: Locator, fx: number, fy: number) => {
  const b = await box(locator)
  await page.mouse.dblclick(b.x + b.width * fx, b.y + b.height * fy)
}

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

/** Stills for the report, in an unrecorded window: the packet with its full-width screenshots, and the modal fitted and zoomed. */
async function screenshotModal(browser: Browser, key: string, colorScheme: "light" | "dark") {
  const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 }, colorScheme })
  const page = await context.newPage()
  await page.goto(`/review?open=${key}-1`)
  const item = page.getByRole("article", { name: new RegExp(`${key}-1`) })
  const evidence = item.getByRole("region", { name: "Evidence" })
  for (const img of await evidence.locator("img[data-evidence=screenshot]").all()) {
    await img.scrollIntoViewIfNeeded()
    await expect(img).toHaveJSProperty("complete", true)
  }
  await evidence.getByRole("list", { name: "Screenshots" }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(SHOTS, `image-modal-packet-${colorScheme}.png`), animations: "disabled" })
  await item.getByRole("button", { name: "Open The board" }).click()
  const modal = modalOf(page)
  await expect(imageOf(modal)).toBeVisible()
  await page.screenshot({ path: path.join(SHOTS, `image-modal-fit-${colorScheme}.png`), animations: "disabled" })
  await dblclickAt(page, imageOf(modal), 0.15, 0.1)
  await expect(modal.locator("[data-zoom-percent]")).toHaveText("100%")
  await page.screenshot({ path: path.join(SHOTS, `image-modal-100-${colorScheme}.png`), animations: "disabled" })
  await page.keyboard.press("+")
  await page.keyboard.press("+")
  await expect(modal.locator("[data-zoom-percent]")).toHaveText("225%")
  await page.screenshot({ path: path.join(SHOTS, `image-modal-zoomed-${colorScheme}.png`), animations: "disabled" })
  await context.close()
}

test("CEL-44: a packet's screenshots show full width; one opens in the image modal, zooms with the wheel and a double-click, pans, steps with →, and Esc closes it back to the thumbnail; the video still plays inline and the link opens the viewer", async ({ page, browser }) => {
  const key = uniqueKey("IMG")
  await createProject(page, "Image modal test", key)
  await caption(page, "An agent submits a packet with a video, three screenshots and a link")
  const { dir } = await submitScreenshotsPacket(page, key, "Screenshots open in a zoomable modal")

  await caption(page, "On the Review page, the screenshots fill the evidence column, one per row")
  await page.goto(`/review?open=${key}-1`)
  const item = page.getByRole("article", { name: new RegExp(`${key}-1`) })
  const evidence = item.getByRole("region", { name: "Evidence" })
  const list = evidence.getByRole("list", { name: "Screenshots" })
  const thumbs = list.getByRole("button")
  await expect(thumbs).toHaveCount(3)
  const column = await box(list)
  const rows = await Promise.all([0, 1, 2].map((i) => box(thumbs.nth(i))))
  for (const row of rows) {
    expect(Math.abs(row.width - column.width)).toBeLessThan(1)
    expect(Math.abs(row.x - column.x)).toBeLessThan(1)
  }
  expect(rows[1]!.y).toBeGreaterThan(rows[0]!.y + rows[0]!.height)
  expect(rows[2]!.y).toBeGreaterThan(rows[1]!.y + rows[1]!.height)
  // As wide as the video above them.
  expect(Math.abs(column.width - (await box(evidence.locator("video[data-evidence=video]"))).width)).toBeLessThan(1)

  await caption(page, "Click the board's screenshot: it opens over the page, fitted to the window, 1 of 3")
  const boardThumb = item.getByRole("button", { name: "Open The board" })
  await boardThumb.scrollIntoViewIfNeeded()
  await boardThumb.click()
  const modal = modalOf(page)
  await expect(modal).toBeVisible()
  await expect(modal).toHaveAccessibleName("The board")
  await expect(modal.locator("[data-image-count]")).toHaveText("1 of 3")
  const image = imageOf(modal)
  await expect(image).toHaveJSProperty("naturalWidth", 1440)
  await expect(image).toBeVisible()
  const fitted = await box(image)
  expect(fitted.width).toBeLessThan(1440)
  expect(fitted.x).toBeGreaterThanOrEqual(0)
  expect(fitted.x + fitted.width).toBeLessThanOrEqual(1440)
  expect(await percent(modal)).toBeLessThan(100)
  // The focus is in the modal; the page behind it can't be reached.
  await expect(modal).toBeFocused()
  await expect(modal.getByRole("button", { name: "Open The board in the viewer" })).toBeVisible()

  await caption(page, "Scroll the wheel up over the image: it zooms in around the pointer")
  const fitPercent = await percent(modal)
  await page.mouse.move(fitted.x + fitted.width * 0.75, fitted.y + fitted.height * 0.4)
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -120)
  await expect(modal.locator("[data-image-stage]")).toHaveAttribute("data-zoomed", "")
  const zoomedPercent = await percent(modal)
  expect(zoomedPercent).toBeGreaterThan(fitPercent * 1.5)
  expect((await box(image)).width).toBeGreaterThan(fitted.width * 1.5)

  await caption(page, "Scroll with two fingers on a trackpad: it pans instead of zooming")
  const scrolled = await box(image)
  const placed = (await image.getAttribute("style"))!
  await page.mouse.wheel(40, 25)
  await expect(image).not.toHaveAttribute("style", placed)
  await expect(modal.locator("[data-zoom-percent]")).toHaveText(`${zoomedPercent}%`)
  const panned = await box(image)
  expect(panned.x - scrolled.x).toBeCloseTo(-40, 0)
  expect(panned.y - scrolled.y).toBeCloseTo(-25, 0)
  expect(panned.width).toBeCloseTo(scrolled.width, 0)

  await caption(page, "The wheel over the toolbar zooms nothing")
  const header = await box(modal.getByRole("toolbar", { name: "Zoom" }))
  await page.mouse.move(header.x + header.width / 2, header.y + header.height / 2)
  await page.mouse.wheel(0, -120)
  await expect(modal.locator("[data-zoom-percent]")).toHaveText(`${zoomedPercent}%`)
  expect((await box(image)).width).toBeCloseTo(panned.width, 0)

  await caption(page, "Drag it: the image moves with the mouse")
  const before = await box(image)
  await page.mouse.move(700, 450)
  await page.mouse.down()
  await page.mouse.move(820, 520, { steps: 10 })
  await page.mouse.up()
  const after = await box(image)
  expect(after.x - before.x).toBeGreaterThan(60)
  expect(after.y - before.y).toBeGreaterThan(30)
  // A drag isn't a click on the backdrop: the modal stays.
  await expect(modal).toBeVisible()

  await caption(page, "Double-click: back to fit; double-click again: 100%")
  // The zoomed image covers the stage: its middle is on the image.
  await dblclickAt(page, modal.locator("[data-image-stage]"), 0.5, 0.5)
  await expect(modal.locator("[data-image-stage]")).not.toHaveAttribute("data-zoomed", "")
  await expect(modal.locator("[data-zoom-percent]")).toHaveText(`${fitPercent}%`)
  // The middle again: the image is still easing back to fit, and the fitted board covers it.
  await dblclickAt(page, modal.locator("[data-image-stage]"), 0.5, 0.5)
  await expect(modal.locator("[data-zoom-percent]")).toHaveText("100%")
  await expect(modal.getByRole("button", { name: "Fit to screen" })).toHaveAttribute("aria-pressed", "true")

  await caption(page, "Press →: the next screenshot, the sidebar, 2 of 3, fitted again")
  await page.keyboard.press("ArrowRight")
  await expect(modal).toHaveAccessibleName("The sidebar")
  await expect(modal.locator("[data-image-count]")).toHaveText("2 of 3")
  await expect(image).toHaveJSProperty("naturalWidth", 320)
  await expect(modal.getByRole("button", { name: "Zoom to 100%" })).toHaveAttribute("aria-pressed", "false")

  await caption(page, "→ again: the header, 3 of 3, the last; ← goes back")
  await page.keyboard.press("ArrowRight")
  await expect(modal.locator("[data-image-count]")).toHaveText("3 of 3")
  await expect(modal.getByRole("button", { name: "Next image" })).toBeDisabled()
  await page.keyboard.press("ArrowLeft")
  await expect(modal.locator("[data-image-count]")).toHaveText("2 of 3")

  await caption(page, "Esc closes it; the focus is back on the screenshot clicked")
  await page.keyboard.press("Escape")
  await expect(modal).toHaveCount(0)
  await expect(boardThumb).toBeFocused()
  // The packet is still open on the Review page.
  await expect(evidence).toBeVisible()

  await caption(page, "Open it again and click the dark backdrop beside the image: it closes too")
  await item.getByRole("button", { name: "Open The header" }).click()
  await expect(modal).toHaveAccessibleName("The header")
  const stage = await box(modal.locator("[data-image-stage]"))
  await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height - 20)
  await expect(modal).toHaveCount(0)
  await expect(item.getByRole("button", { name: "Open The header" })).toBeFocused()

  await caption(page, "Open in viewer, from the modal: the screenshot moves to the viewer beside the page")
  await boardThumb.click()
  await modal.getByRole("button", { name: "Open The board in the viewer" }).click()
  await expect(modal).toHaveCount(0)
  const viewer = page.getByRole("complementary", { name: "Viewer" })
  await expect(viewer.getByRole("img", { name: "The board" })).toBeVisible()
  await viewer.getByRole("button", { name: "Close viewer" }).click()
  await expect(viewer).toHaveCount(0)

  await caption(page, "The video still plays inline, in the packet")
  const video = evidence.locator("video[data-evidence=video]")
  await video.scrollIntoViewIfNeeded()
  const played = playedPastOneSecond(video)
  await video.click()
  expect(await played).toBeGreaterThan(1)
  await video.evaluate((v: HTMLVideoElement) => v.pause())
  await expect(modal).toHaveCount(0)

  await caption(page, "And the PR link still opens in the viewer")
  await evidence.getByRole("link", { name: "The PR" }).click()
  await expect(viewer.getByRole("heading", { name: "The PR" })).toBeVisible()
  await expect(modal).toHaveCount(0)
  await viewer.getByRole("button", { name: "Close viewer" }).click()

  for (const colorScheme of ["light", "dark"] as const) await screenshotModal(browser, key, colorScheme)
  await caption(page, "Screenshots read at full width, and open large in the modal")
  fs.rmSync(dir, { recursive: true, force: true })
})

test("CEL-44: the same modal opens from the task panel's packet, the task's full page and an image in a page; Esc leaves the task open", async ({ page }) => {
  const key = uniqueKey("IMT")
  await createProject(page, "Image modal places", key)
  const { dir } = await submitScreenshotsPacket(page, key, "The modal everywhere")
  const modal = modalOf(page)

  await caption(page, "Open the card: in the task panel's packet, click a screenshot")
  await card(page, `${key}-1`).click()
  const panel = taskPanel(page, `${key}-1`)
  const pinned = panel.getByRole("region", { name: "Review packet" })
  const sidebarThumb = pinned.getByRole("button", { name: "Open The sidebar" })
  await sidebarThumb.scrollIntoViewIfNeeded()
  await sidebarThumb.click()
  await expect(modal).toHaveAccessibleName("The sidebar")
  await expect(modal.locator("[data-image-count]")).toHaveText("2 of 3")
  await expect(imageOf(modal)).toHaveJSProperty("naturalWidth", 320)

  await caption(page, "Esc closes the modal, not the task")
  await page.keyboard.press("Escape")
  await expect(modal).toHaveCount(0)
  await expect(panel).toBeVisible()
  await expect(sidebarThumb).toBeFocused()

  await caption(page, "The task as a full page: the screenshot opens in the modal there too")
  await page.goto(`/${key}/1?view=full`)
  const full = taskPanel(page, `${key}-1`).getByRole("region", { name: "Review packet" })
  await full.getByRole("button", { name: "Open The board" }).click()
  await expect(modal).toHaveAccessibleName("The board")
  await expect(imageOf(modal)).toHaveJSProperty("naturalWidth", 1440)
  await modal.getByRole("button", { name: "Close" }).click()
  await expect(modal).toHaveCount(0)

  await caption(page, "An agent publishes a page with two screenshots")
  const pageDir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-page-"))
  await page.screenshot({ path: path.join(pageDir, "before.png") })
  await page.screenshot({ path: path.join(pageDir, "after.png"), clip: { x: 0, y: 0, width: 720, height: 450 } })
  const file = path.join(pageDir, "report.md")
  fs.writeFileSync(
    file,
    ["# Image check", "", "The task page before:", "", "![Before](before.png)", "", "## After", "", "And a closer look:", "", '![After](after.png "The closer look")', "", "One that's gone:", "", "![Missing](/attachments/missing-image)", ""].join("\n"),
  )
  cello("doc", "publish", file, "--project", key, "--task", `${key}-1`)
  await page.goto(`/${key}/pages/image-check`)
  const article = page.getByRole("article")

  await caption(page, "Click the page's first image: the modal, 1 of 3; → shows the second")
  const first = article.getByRole("button", { name: "Open Before" })
  await expect(first.locator("img")).toHaveJSProperty("naturalWidth", 1440)
  await first.click()
  await expect(modal).toHaveAccessibleName("Before")
  await expect(modal.locator("[data-image-count]")).toHaveText("1 of 3")
  await page.keyboard.press("ArrowRight")
  await expect(modal).toHaveAccessibleName("After")
  await expect(imageOf(modal)).toHaveJSProperty("naturalWidth", 720)

  await caption(page, "→ again: an image that can't load says so; zooming is off, Open in viewer and ← still work")
  await page.keyboard.press("ArrowRight")
  await expect(modal).toHaveAccessibleName("Missing")
  await expect(modal.getByRole("alert")).toHaveText("Couldn't load this image")
  await expect(modal.getByRole("button", { name: "Zoom in" })).toBeDisabled()
  await expect(modal.getByRole("button", { name: "Zoom out" })).toBeDisabled()
  await expect(modal.getByRole("button", { name: "Zoom to 100%" })).toBeDisabled()
  await expect(modal.getByRole("button", { name: "Open Missing in the viewer" })).toBeEnabled()
  await page.keyboard.press("ArrowLeft")
  await expect(modal).toHaveAccessibleName("After")
  await expect(modal.getByRole("alert")).toHaveCount(0)
  await expect(imageOf(modal)).toBeVisible()

  await caption(page, "Esc closes it; the focus is back on the image clicked")
  await page.keyboard.press("Escape")
  await expect(modal).toHaveCount(0)
  await expect(first).toBeFocused()
  await caption(page, "The task panel, the full page and pages open the same modal")
  fs.rmSync(dir, { recursive: true, force: true })
  fs.rmSync(pageDir, { recursive: true, force: true })
})
