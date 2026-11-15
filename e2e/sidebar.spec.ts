// CEL-24: the sidebar resizes by its right edge (remembered on this device), collapses to a rail of
// icons with tooltips (the Review badge still showing), and hides completely; ⌘B / Ctrl+B and buttons.
import * as fs from "node:fs"
import * as path from "node:path"
import type { Browser, Page } from "@playwright/test"
import { caption, createProject, expect, test, uniqueKey } from "./fixtures.ts"
import { submitPacket, WEB_URL } from "./packets.ts"

const sidebarOf = (page: Page) => page.getByRole("complementary", { name: "Sidebar" })
const widthOf = async (page: Page) => Math.round((await sidebarOf(page).boundingBox())!.width)

/** Drags the sidebar's right edge by `dx` px with the mouse, in small steps like a person would. */
async function dragEdge(page: Page, dx: number) {
  const box = (await sidebarOf(page).getByRole("separator", { name: "Resize sidebar" }).boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y, { steps: 12 })
  await page.mouse.up()
}

/** The sidebar expanded, as a rail and hidden, in light and dark, saved to e2e/videos/evidence/sidebar-<mode>-<scheme>.png. */
async function screenshots(browser: Browser, key: string) {
  const dir = path.join(import.meta.dirname, "videos", "evidence")
  fs.mkdirSync(dir, { recursive: true })
  for (const colorScheme of ["light", "dark"] as const) {
    for (const mode of ["expanded", "rail", "hidden"] as const) {
      const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme })
      await context.addInitScript((state) => localStorage.setItem("cello:sidebar", state), JSON.stringify({ mode, collapsed: mode === "hidden" ? "hidden" : "rail" }))
      const page = await context.newPage()
      await page.goto(`/${key}/issues`)
      await expect(page.locator(`[data-task-key="${key}-1"]`)).toBeVisible()
      await page.screenshot({ path: path.join(dir, `sidebar-${mode}-${colorScheme}.png`) })
      await context.close()
    }
  }
}

test("CEL-24: drag the sidebar's edge and reload: the width stays; ⌘B and the button collapse it to a rail with tooltips and the Review badge; hide it completely and bring it back", async ({ page, browser }) => {
  const key = uniqueKey("SIDE")
  await createProject(page, "Sidebar test", key)
  const { dir } = await submitPacket(page, key)
  await page.goto(`/${key}/issues`)
  const sidebar = sidebarOf(page)
  const main = page.getByRole("main")
  await expect(sidebar).toHaveAttribute("data-sidebar", "expanded")
  expect(await widthOf(page)).toBe(240)

  await caption(page, "Drag the sidebar's right edge 100px to the right")
  await dragEdge(page, 100)
  expect(await widthOf(page)).toBe(340)
  await expect(sidebar.getByRole("separator", { name: "Resize sidebar" })).toHaveAttribute("aria-valuenow", "340")

  await caption(page, "Reload: the width is remembered on this device")
  await page.reload()
  await expect(sidebar).toHaveAttribute("data-sidebar", "expanded")
  expect(await widthOf(page)).toBe(340)

  await caption(page, "It stops at its widest (400px) and its narrowest (200px)")
  await dragEdge(page, 300)
  expect(await widthOf(page)).toBe(400)
  await dragEdge(page, -400)
  expect(await widthOf(page)).toBe(200)

  await caption(page, "← and → on the focused edge resize it too")
  const edge = sidebar.getByRole("separator", { name: "Resize sidebar" })
  await edge.focus()
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight")
  expect(await widthOf(page)).toBe(280)

  await caption(page, "⌘B (Ctrl+B elsewhere) collapses it to a rail of icons")
  await page.locator(`[data-task-key="${key}-1"]`).focus()
  await page.keyboard.press("ControlOrMeta+b")
  await expect(sidebar).toHaveAttribute("data-sidebar", "rail")
  expect(await widthOf(page)).toBe(48)

  await caption(page, "The Review badge still shows, and each icon has a tooltip")
  const review = sidebar.getByRole("navigation", { name: "Inbox" }).getByRole("link", { name: /^Review \d+ waiting$/ })
  await expect(review.locator("[data-review-count]")).toHaveText(/^\d+ waiting$/)
  await review.hover()
  await expect(page.getByRole("tooltip", { name: /^Review · \d+ waiting$/ })).toBeVisible()
  await sidebar.getByRole("link", { name: "Sidebar test" }).hover()
  await expect(page.getByRole("tooltip", { name: "Sidebar test" })).toBeVisible()
  await page.screenshot({ path: path.join(import.meta.dirname, "videos", "evidence", "sidebar-rail-tooltip.png") })

  await caption(page, "The rail's links work: open Review, then the project again")
  await review.click()
  await expect(page).toHaveURL(/\/review$/)
  await sidebar.getByRole("link", { name: "Sidebar test" }).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/issues$`))

  await caption(page, "⌘B again: expanded, at the width it had")
  await page.keyboard.press("ControlOrMeta+b")
  await expect(sidebar).toHaveAttribute("data-sidebar", "expanded")
  expect(await widthOf(page)).toBe(280)

  await caption(page, "The collapse button does the same, and the rail is remembered across a reload")
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click()
  await expect(sidebar).toHaveAttribute("data-sidebar", "rail")
  await page.reload()
  await expect(sidebar).toHaveAttribute("data-sidebar", "rail")

  await caption(page, "Hide it completely: the board gets the whole window")
  await sidebar.getByRole("button", { name: "Hide sidebar" }).click()
  await expect(sidebar).toHaveCount(0)
  expect(Math.round((await main.boundingBox())!.x)).toBe(8)
  const show = page.getByRole("button", { name: "Show sidebar" })
  await expect(show).toBeVisible()

  await caption(page, "⌘B brings it back expanded; ⌘B now hides it again, the way it was last collapsed")
  await page.keyboard.press("ControlOrMeta+b")
  await expect(sidebar).toHaveAttribute("data-sidebar", "expanded")
  await expect(show).toHaveCount(0)
  await page.keyboard.press("ControlOrMeta+b")
  await expect(sidebar).toHaveCount(0)

  await caption(page, "The Show sidebar button in the top bar brings it back too")
  await show.click()
  await expect(sidebar).toHaveAttribute("data-sidebar", "expanded")
  expect(await widthOf(page)).toBe(280)
  await caption(page, "Resized, collapsed to a rail, hidden and back")

  await screenshots(browser, key)
  fs.rmSync(dir, { recursive: true, force: true })
})
