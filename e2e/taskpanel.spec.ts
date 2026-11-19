// CEL-49: the task panel docks on the right of the main area at full height, from the top edge down,
// like a browser's side panel; the breadcrumb and the tabs row span only the board or list beside it.
// Its left edge drags (or ← and →) to resize it, within limits, remembered on this device.
import * as fs from "node:fs"
import * as path from "node:path"
import type { Browser, Locator, Page } from "@playwright/test"
import { caption, card, createProject, expect, newCommandId, seedProject, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { cello, SHOTS, submitPacket, WEB_URL } from "./packets.ts"
import { isReview } from "./recording.ts"

const viewerOf = (page: Page) => page.getByRole("complementary", { name: "Viewer" })
const listRow = (page: Page, key: string) => page.locator('[data-layout="list"]').locator(`[data-task-key="${key}"]`)

const boxOf = async (el: Locator) => (await el.boundingBox())!
const widthOf = async (el: Locator) => Math.round((await boxOf(el)).width)

/** Drags the task panel's left edge by `dx` px (negative: to the left, wider) with the mouse, in small steps. */
async function dragEdge(panel: Locator, dx: number) {
  const page = panel.page()
  const box = await boxOf(panel.getByRole("separator", { name: "Resize task panel" }))
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y, { steps: 12 })
  await page.mouse.up()
}

/**
 * The panel docked on the right from the main area's top edge to its bottom one, and the breadcrumb
 * and the tabs row (with Display) ending where the panel starts.
 */
async function expectDocked(page: Page, panel: Locator) {
  // A panel opened after the page loaded slides in from 24px to the right (CEL-189): measure where it lands (CEL-202).
  await panel.evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)))
  const main = await boxOf(page.getByRole("main"))
  const box = await boxOf(panel)
  // The main area has a 1px border.
  expect(Math.abs(box.y - (main.y + 1)), "the panel starts at the main area's top edge").toBeLessThanOrEqual(1)
  expect(Math.abs(box.y + box.height - (main.y + main.height - 1)), "and reaches its bottom").toBeLessThanOrEqual(1)
  expect(Math.abs(box.x + box.width - (main.x + main.width - 1)), "on its right side").toBeLessThanOrEqual(1)
  const crumbs = await boxOf(page.getByRole("navigation", { name: "Breadcrumb" }))
  expect(Math.abs(crumbs.x + crumbs.width - box.x), "the breadcrumb ends at the panel").toBeLessThanOrEqual(1)
  const display = await boxOf(page.getByRole("button", { name: "Display" }))
  expect(display.x + display.width, "the Display button sits left of the panel").toBeLessThanOrEqual(box.x)
}

/** The board (or list) with `key` open beside it, in an unrecorded window, saved to e2e/videos/taskpanel-<layout>-<scheme>.png. */
async function screenshots(browser: Browser, key: string) {
  fs.mkdirSync(SHOTS, { recursive: true })
  const [projectKey, number] = key.split("-") as [string, string]
  for (const colorScheme of ["light", "dark"] as const) {
    for (const layout of ["board", "list"] as const) {
      const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 }, colorScheme })
      const page = await context.newPage()
      await page.goto(`/${projectKey}/${number}${layout === "list" ? "?layout=list" : ""}`)
      await expect(taskPanel(page, key).getByLabel("Title")).toBeVisible()
      await expect(page.locator(`[data-task-key="${key}"]`).first()).toBeVisible()
      await page.screenshot({ path: path.join(SHOTS, `taskpanel-${layout}-${colorScheme}.png`) })
      await context.close()
    }
  }
}

test("CEL-49: on the board the task panel docks full height on the right; drag its edge, reload, the width stays; it stops at its limits; the viewer and the full page still work", async ({ page }) => {
  if (isReview(process.env)) test.setTimeout(240_000)
  const key = uniqueKey("DOCK")
  await createProject(page, "Docked panel test", key)
  const { dir } = await submitPacket(page, key)
  const panel = taskPanel(page, `${key}-1`)
  const main = page.getByRole("main")

  await caption(page, "Open the card: the panel docks on the right, from the top edge down; the tabs and Display stay over the board")
  await card(page, `${key}-1`).click()
  await expect(panel.getByLabel("Title")).toBeVisible()
  await expectDocked(page, panel)
  expect(await widthOf(panel)).toBe(560)
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText(`${key}-1`)

  await caption(page, "Drag its left edge 200px to the left: wider")
  await dragEdge(panel, -200)
  expect(await widthOf(panel)).toBe(760)
  await expect(panel.getByRole("separator", { name: "Resize task panel" })).toHaveAttribute("aria-valuenow", "760")
  await expectDocked(page, panel)

  await caption(page, "Reload: the width stays (remembered on this device)")
  await page.reload()
  await expect(panel.getByLabel("Title")).toBeVisible()
  expect(await widthOf(panel)).toBe(760)
  await expectDocked(page, panel)

  await caption(page, "Drag it far to the left: it stops where the board keeps 360px")
  await dragEdge(panel, -600)
  const room = await boxOf(main)
  expect(await widthOf(panel)).toBe(Math.round(room.width - 2 - 360))

  await caption(page, "In a wider window it stops at its widest, 960px")
  await page.setViewportSize({ width: 1920, height: 1080 })
  await dragEdge(panel, -600)
  expect(await widthOf(panel)).toBe(960)
  await expectDocked(page, panel)

  await caption(page, "Back to 1440px: it narrows to leave the board its room")
  await page.setViewportSize({ width: 1440, height: 900 })
  expect(await widthOf(panel)).toBe(Math.round(room.width - 2 - 360))

  await caption(page, "Drag it far to the right: it stops at its narrowest, 360px")
  await dragEdge(panel, 900)
  expect(await widthOf(panel)).toBe(360)

  await caption(page, "← and → on the focused edge resize it too")
  const edge = panel.getByRole("separator", { name: "Resize task panel" })
  await edge.focus()
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft")
  expect(await widthOf(panel)).toBe(520)
  await page.keyboard.press("ArrowRight")
  expect(await widthOf(panel)).toBe(488)

  await caption(page, "Open the screenshot in the viewer: the task moves to the main area, the viewer beside it (CEL-117)")
  const pinned = panel.getByRole("region", { name: "Review packet" })
  await pinned.getByRole("button", { name: "Open The board", exact: true }).click()
  await page.getByRole("dialog", { name: "The board" }).getByRole("button", { name: "Open The board in the viewer" }).click()
  const viewer = viewerOf(page)
  await expect(viewer.getByRole("img", { name: "The board" })).toBeVisible()
  await expect(panel).toHaveAttribute("data-placement", "page")
  const mainBox = await boxOf(main)
  const viewerBox = await boxOf(viewer)
  expect(Math.abs(viewerBox.x + viewerBox.width - (mainBox.x + mainBox.width - 1)), "the viewer is on the right").toBeLessThanOrEqual(1)
  await expect(page.getByRole("application", { name: /board$/ })).toBeHidden()
  const pageBox = await boxOf(panel)
  expect(pageBox.x + pageBox.width, "the task reaches the viewer, neither covering the other").toBeLessThanOrEqual(viewerBox.x + 1)
  expect(pageBox.x + pageBox.width, "no empty column between them").toBeGreaterThan(viewerBox.x - 24)

  await caption(page, "Close the viewer: the panel is back, docked, at its width")
  await viewer.getByRole("button", { name: "Close viewer" }).click()
  await expect(viewer).toHaveCount(0)
  await expect(panel).toBeVisible()
  expect(await widthOf(panel)).toBe(488)
  await expectDocked(page, panel)

  await caption(page, "Expand to a full page: the task fills the area under the tabs, the board hides")
  await panel.getByRole("button", { name: "Expand to full page" }).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/1\\?view=full$`))
  await expect(page.getByRole("application", { name: /board$/ })).toBeHidden()
  const tabs = await boxOf(page.getByRole("link", { name: "Issues" }))
  const full = await boxOf(panel)
  expect(full.y, "the full page starts under the tabs").toBeGreaterThanOrEqual(tabs.y + tabs.height)
  expect(full.width).toBeGreaterThan((await boxOf(main)).width - 4)
  await expect(panel.getByRole("separator", { name: "Resize task panel" })).toHaveCount(0)

  await caption(page, "The viewer opens beside the full page, as before")
  await pinned.getByRole("button", { name: "Open The board", exact: true }).click()
  await page.getByRole("dialog", { name: "The board" }).getByRole("button", { name: "Open The board in the viewer" }).click()
  await expect(viewer.getByRole("img", { name: "The board" })).toBeVisible()
  await expect(panel).toBeVisible()
  expect((await boxOf(panel)).x + (await boxOf(panel)).width).toBeLessThanOrEqual((await boxOf(viewer)).x + 1)
  await page.keyboard.press("Escape")
  await expect(viewer).toHaveCount(0)

  await caption(page, "Collapse: docked again at the width it had")
  await panel.getByRole("button", { name: "Collapse to side panel" }).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/1$`))
  await expect(page.getByRole("application", { name: /board$/ })).toBeVisible()
  expect(await widthOf(panel)).toBe(488)
  await expectDocked(page, panel)

  await caption(page, "A narrow window (700px): the task takes the main panel under the tabs, with no edge to drag")
  await page.setViewportSize({ width: 700, height: 900 })
  // The sidebar turns into the rail first (CEL-24), which widens the main area.
  await expect(page.getByRole("complementary", { name: "Sidebar" })).toHaveAttribute("data-sidebar", "rail")
  await expect(page.getByRole("application", { name: /board$/ })).toBeHidden()
  const narrowMain = await boxOf(main)
  const narrow = await boxOf(panel)
  expect(Math.abs(narrow.width - (narrowMain.width - 2))).toBeLessThanOrEqual(1)
  expect(narrow.y).toBeGreaterThanOrEqual((await boxOf(page.getByRole("link", { name: "Issues" }))).y)
  await expect(panel.getByRole("separator", { name: "Resize task panel" })).toBeHidden()

  await page.setViewportSize({ width: 1440, height: 900 })
  await caption(page, "Docked full height, resized by its edge, remembered")
  fs.rmSync(dir, { recursive: true, force: true })
})

test("CEL-49: in the list the task panel docks full height too, shares the width, and ↑↓, Enter and Esc still work", async ({ page, cello: rpc }) => {
  const key = uniqueKey("DOCKL")
  const project = await seedProject(rpc, "Docked list test", key)
  for (const title of ["Sketch the docked panel", "Drag its edge"]) {
    await rpc.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title }))
  }

  await page.goto(`/${key}/issues?layout=list`)
  await caption(page, `Click ${key}-1 in the list: its panel docks on the right, full height`)
  await listRow(page, `${key}-1`).click()
  const panel1 = taskPanel(page, `${key}-1`)
  await expect(panel1.getByLabel("Title")).toHaveValue("Sketch the docked panel")
  await expectDocked(page, panel1)

  await caption(page, "Drag its edge 120px to the left")
  await dragEdge(panel1, -120)
  expect(await widthOf(panel1)).toBe(680)

  await caption(page, `↓ and Enter open ${key}-2: the panel keeps its width`)
  await listRow(page, `${key}-1`).focus()
  await page.keyboard.press("ArrowDown")
  await expect(listRow(page, `${key}-2`)).toBeFocused()
  await page.keyboard.press("Enter")
  const panel2 = taskPanel(page, `${key}-2`)
  await expect(panel2.getByLabel("Title")).toHaveValue("Drag its edge")
  expect(await widthOf(panel2)).toBe(680)
  await page.keyboard.press("ArrowUp")
  await expect(listRow(page, `${key}-1`)).toBeFocused()

  await caption(page, "Reload: still docked at 680px")
  await page.reload()
  await expect(panel2.getByLabel("Title")).toHaveValue("Drag its edge")
  expect(await widthOf(panel2)).toBe(680)
  await expectDocked(page, panel2)

  await caption(page, "Switch to the board: the same width there")
  await page.goto(`/${key}/2`)
  await expect(panel2.getByLabel("Title")).toHaveValue("Drag its edge")
  expect(await widthOf(panel2)).toBe(680)

  await caption(page, "Back in the list, Esc on a row closes the task")
  await page.goto(`/${key}/2?layout=list`)
  await listRow(page, `${key}-2`).focus()
  await page.keyboard.press("Escape")
  await expect(page).toHaveURL(new RegExp(`/${key}/issues\\?layout=list$`))
  await expect(panel2).toHaveCount(0)
  await caption(page, "The list's panel docks and resizes like the board's")
})

test("CEL-49: stills of the board and the list with the task panel open, light and dark", async ({ page, browser }) => {
  const key = uniqueKey("DOCKS")
  await createProject(page, "Docked panel stills", key)
  const { dir } = await submitPacket(page, key)
  cello("task", "create", "Drag the panel's edge to resize it", "--project", key)
  cello("task", "create", "Open the viewer beside the board", "--project", key)
  await screenshots(browser, `${key}-1`)
  fs.rmSync(dir, { recursive: true, force: true })
})
