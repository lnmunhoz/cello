// CEL-48: a Mermaid diagram opens in the image modal the way a screenshot does (CEL-44). A click, or
// Enter on the focused diagram, opens it fitted, drawn again as vector in the current theme; the wheel,
// +/− and a double-click zoom it, a drag pans it, ←/→ step through the page's or packet's other images
// and diagrams in document order, and Esc closes it with the focus back on the diagram. A diagram that
// didn't render isn't a button.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Browser, Locator, Page } from "@playwright/test"
import { caption, createProject, expect, test, uniqueKey } from "./fixtures.ts"
import { cello, SHOTS, submitDiagramPacket, WEB_URL } from "./packets.ts"
import { isReview } from "./recording.ts"

test.beforeEach(() => {
  if (isReview(process.env)) test.setTimeout(240_000)
})

const modalOf = (page: Page) => page.getByRole("dialog")
const sheetOf = (modal: Locator) => modal.locator("[data-modal-diagram]")
const zoomOf = (modal: Locator) => modal.locator("[data-zoom-percent]")
const box = async (locator: Locator) => (await locator.boundingBox())!
const percent = async (modal: Locator) => Number((await zoomOf(modal).textContent())!.replace("%", ""))

/** Where the diagram's sheet is placed, read from its style: its box lags behind while a zoom from + or a double-click eases in. */
const placementOf = (sheet: Locator) =>
  sheet.evaluate((el: HTMLElement) => {
    const [x, y, scale] = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/.exec(el.style.transform)!.slice(1).map(Number)
    return { x: x!, y: y!, scale: scale! }
  })

/** A page with a diagram, a screenshot after it, and a diagram that doesn't parse. */
const PAGE = [
  "# Diagram check",
  "",
  "How a diagram opens:",
  "",
  "```mermaid",
  "flowchart TD",
  '  A["Click a diagram"] --> B["It opens in the image modal, fitted"]',
  '  B --> C{"Zoom in?"}',
  '  C -->|Yes| D["Wheel, pinch, double-click or +"]',
  '  C -->|No| E["Esc closes it"]',
  "```",
  "",
  "## The page after",
  "",
  "![After](after.png)",
  "",
  "## A broken one",
  "",
  "```mermaid",
  "flowchart TD",
  "  A[Unclosed --> B",
  "```",
  "",
].join("\n")

/** Stills for the report, in an unrecorded window: the page's diagram zoomed in the modal, in `colorScheme`. */
async function screenshotZoomedDiagram(browser: Browser, key: string, colorScheme: "light" | "dark") {
  const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 }, colorScheme })
  const page = await context.newPage()
  await page.goto(`/${key}/pages/diagram-check`)
  await page.getByRole("button", { name: "Open Diagram: Click a diagram" }).click()
  const modal = modalOf(page)
  await expect(sheetOf(modal).locator("svg")).toBeVisible()
  await expect(sheetOf(modal)).toHaveAttribute("data-theme", colorScheme)
  await page.screenshot({ path: path.join(SHOTS, `diagram-modal-fit-${colorScheme}.png`), animations: "disabled" })
  for (let i = 0; i < 3; i++) await page.keyboard.press("+")
  await expect(modal.locator("[data-image-stage]")).toHaveAttribute("data-zoomed", "")
  await page.screenshot({ path: path.join(SHOTS, `diagram-modal-zoomed-${colorScheme}.png`), animations: "disabled" })
  await context.close()
}

test("CEL-48: a diagram in a page opens in the image modal: crisp vector in the theme, zoomed with the wheel and +, dragged, → to the page's image, Esc back to the diagram, Enter opens it again; a broken diagram isn't a button", async ({
  page,
  browser,
}) => {
  const key = uniqueKey("DGM")
  await createProject(page, "Diagram modal", key)
  await caption(page, "An agent publishes a page with a diagram, a screenshot and a broken diagram")
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-diagram-"))
  await page.screenshot({ path: path.join(dir, "after.png") })
  const file = path.join(dir, "diagram.md")
  fs.writeFileSync(file, PAGE)
  cello("doc", "publish", file, "--project", key)
  await page.goto(`/${key}/pages/diagram-check`)
  const article = page.getByRole("article")

  await caption(page, "The diagram is a button named by its first label; the broken one only says it didn't render")
  const diagram = article.getByRole("button", { name: "Open Diagram: Click a diagram" })
  await expect(diagram.locator("svg")).toBeVisible()
  const broken = article.locator("figure[data-mermaid]").filter({ hasText: "didn’t render" })
  await expect(broken).toBeVisible()
  await expect(broken.getByRole("button")).toHaveCount(0)
  const pageSvg = await box(diagram.locator("svg"))

  await caption(page, "Click the diagram: it opens over the page, fitted, larger than on the page, 1 of 2")
  await diagram.click()
  const modal = modalOf(page)
  await expect(modal).toHaveAccessibleName("Diagram: Click a diagram")
  await expect(modal.locator("[data-image-count]")).toHaveText("1 of 2")
  const sheet = sheetOf(modal)
  await expect(sheet.locator("svg")).toBeVisible()
  await expect(sheet).toHaveAttribute("data-theme", "light")
  // Drawn again for the modal (its own ids), as an SVG: vector, not a picture of the page's copy.
  const ids = await Promise.all([diagram.locator("svg").getAttribute("id"), sheet.locator("svg").getAttribute("id")])
  expect(ids[0]).not.toBe(ids[1])
  await expect(sheet.locator("img, canvas")).toHaveCount(0)
  const fitted = await box(sheet)
  const fittedAt = await placementOf(sheet)
  expect(fitted.height).toBeGreaterThan(pageSvg.height)
  expect(fitted.y).toBeGreaterThanOrEqual(0)
  expect(fitted.y + fitted.height).toBeLessThanOrEqual(900)
  await expect(modal).toBeFocused()
  // A diagram has no file to open in the viewer.
  await expect(modal.getByRole("button", { name: /in the viewer$/ })).toHaveCount(0)

  await caption(page, "Scroll the wheel up over it: it zooms in around the pointer")
  const fitPercent = await percent(modal)
  await page.mouse.move(fitted.x + fitted.width * 0.5, fitted.y + fitted.height * 0.3)
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -120)
  await expect(modal.locator("[data-image-stage]")).toHaveAttribute("data-zoomed", "")
  expect(await percent(modal)).toBeGreaterThan(fitPercent * 1.5)

  await caption(page, "Press + twice: closer still, and the labels stay sharp (the SVG is redrawn at that size)")
  const before = await percent(modal)
  await page.keyboard.press("+")
  await page.keyboard.press("+")
  await expect(zoomOf(modal)).not.toHaveText(`${before}%`)
  expect((await placementOf(sheet)).scale).toBeGreaterThan(fittedAt.scale * 3)
  // The SVG fills the scaled sheet: one vector drawing at the zoomed size, not a picture scaled up.
  const fill = await sheet.evaluate((el) => el.querySelector("svg")!.getBoundingClientRect().width / el.getBoundingClientRect().width)
  expect(fill).toBeGreaterThan(0.8)

  await caption(page, "Drag it: the diagram moves with the mouse")
  const held = await placementOf(sheet)
  await page.mouse.move(700, 450)
  await page.mouse.down()
  await page.mouse.move(820, 530, { steps: 10 })
  await page.mouse.up()
  const dragged = await placementOf(sheet)
  expect(dragged.x - held.x).toBeGreaterThan(60)
  expect(dragged.y - held.y).toBeGreaterThan(30)
  await expect(modal).toBeVisible()

  await caption(page, "Double-click: back to fit")
  await page.mouse.dblclick(700, 450)
  await expect(modal.locator("[data-image-stage]")).not.toHaveAttribute("data-zoomed", "")
  await expect(zoomOf(modal)).toHaveText(`${fitPercent}%`)

  await caption(page, "Press →: the page's screenshot, 2 of 2; the broken diagram isn't in the gallery")
  await page.keyboard.press("ArrowRight")
  await expect(modal).toHaveAccessibleName("After")
  await expect(modal.locator("[data-image-count]")).toHaveText("2 of 2")
  await expect(modal.locator("img[data-modal-image]")).toHaveJSProperty("naturalWidth", 1440)
  await expect(modal.getByRole("button", { name: "Next image" })).toBeDisabled()

  await caption(page, "Esc closes it; the focus is back on the diagram")
  await page.keyboard.press("Escape")
  await expect(modal).toHaveCount(0)
  await expect(diagram).toBeFocused()

  await caption(page, "Enter on the focused diagram opens it again")
  await page.keyboard.press("Enter")
  await expect(modal).toHaveAccessibleName("Diagram: Click a diagram")
  await expect(sheetOf(modal).locator("svg")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(modal).toHaveCount(0)
  await expect(diagram).toBeFocused()

  for (const colorScheme of ["light", "dark"] as const) await screenshotZoomedDiagram(browser, key, colorScheme)
  await caption(page, "Diagrams zoom like screenshots, sharp at every size")
  fs.rmSync(dir, { recursive: true, force: true })
})

test("CEL-48: a diagram in a review packet's summary opens in the image modal; it zooms and pans, → steps to the packet's screenshot, and Esc gives the focus back to the diagram", async ({
  page,
}) => {
  const key = uniqueKey("DGP")
  await createProject(page, "Diagram packet", key)
  await caption(page, "An agent submits a packet whose summary explains the flow with a diagram")
  const { dir } = await submitDiagramPacket(page, key, "Diagrams open in the image modal")

  await page.goto(`/review?open=${key}-1`)
  const item = page.getByRole("article", { name: new RegExp(`${key}-1`) })
  const diagram = item.getByRole("button", { name: "Diagram: An agent runs cello task submit" })
  await expect(diagram.locator("svg")).toBeVisible()

  await caption(page, "Click the summary's diagram: it opens fitted, 1 of 2 (the diagram, then the screenshot)")
  await diagram.click()
  const modal = modalOf(page)
  await expect(modal).toHaveAccessibleName("Diagram: An agent runs cello task submit")
  await expect(modal.locator("[data-image-count]")).toHaveText("1 of 2")
  const sheet = sheetOf(modal)
  await expect(sheet.locator("svg")).toBeVisible()

  await caption(page, "Press + three times: it zooms in")
  const fitPercent = await percent(modal)
  for (let i = 0; i < 3; i++) await page.keyboard.press("+")
  await expect(modal.locator("[data-image-stage]")).toHaveAttribute("data-zoomed", "")
  expect(await percent(modal)).toBeGreaterThan(fitPercent * 2)

  await caption(page, "Scroll with two fingers on a trackpad: it pans")
  const scrolled = await placementOf(sheet)
  const placed = (await sheet.getAttribute("style"))!
  await page.mouse.move(720, 450)
  await page.mouse.wheel(40, 25)
  await expect(sheet).not.toHaveAttribute("style", placed)
  const panned = await placementOf(sheet)
  expect(panned.x - scrolled.x).toBeCloseTo(-40, 0)
  expect(panned.y - scrolled.y).toBeCloseTo(-25, 0)

  await caption(page, "Press →: the packet's screenshot, The board, 2 of 2")
  await page.keyboard.press("ArrowRight")
  await expect(modal).toHaveAccessibleName("The board")
  await expect(modal.locator("[data-image-count]")).toHaveText("2 of 2")
  await expect(modal.locator("img[data-modal-image]")).toBeVisible()

  await caption(page, "← goes back to the diagram, fitted again")
  await page.keyboard.press("ArrowLeft")
  await expect(modal).toHaveAccessibleName("Diagram: An agent runs cello task submit")
  await expect(modal.locator("[data-image-stage]")).not.toHaveAttribute("data-zoomed", "")

  await caption(page, "Esc closes it; the focus is back on the diagram in the summary")
  await page.keyboard.press("Escape")
  await expect(modal).toHaveCount(0)
  await expect(diagram).toBeFocused()

  await caption(page, "Clicking the screenshot steps back to the diagram with ←")
  await item.getByRole("button", { name: "Open The board" }).click()
  await expect(modal.locator("[data-image-count]")).toHaveText("2 of 2")
  await page.keyboard.press("ArrowLeft")
  await expect(modal).toHaveAccessibleName("Diagram: An agent runs cello task submit")
  await page.keyboard.press("Escape")
  await expect(item.getByRole("button", { name: "Open The board" })).toBeFocused()
  await caption(page, "A packet's diagrams and screenshots are one gallery")
  fs.rmSync(dir, { recursive: true, force: true })
})
