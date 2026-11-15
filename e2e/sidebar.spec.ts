// CEL-24: the sidebar resizes by its right edge (remembered on this device), collapses to a rail of
// icons with tooltips (the Review badge still showing), and hides completely; ⌘B / Ctrl+B and buttons.
import * as fs from "node:fs"
import * as path from "node:path"
import type { Browser, Page, WebSocketRoute } from "@playwright/test"
import { caption, createProject, expect, newCommandId, seedProject, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { submitPacket, WEB_URL } from "./packets.ts"

const sidebarOf = (page: Page) => page.getByRole("complementary", { name: "Sidebar" })
const widthOf = async (page: Page) => Math.round((await sidebarOf(page).boundingBox())!.width)

/** A still for the review, in e2e/videos/evidence/, without the video's caption and cursor. */
const still = (page: Page, name: string) =>
  page.screenshot({ path: path.join(import.meta.dirname, "videos", "evidence", `${name}.png`), animations: "disabled", style: "#e2e-caption, #e2e-cursor, .e2e-ripple { display: none !important; }" })

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

  await caption(page, "Reload: the width stays (remembered on this device)")
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
  await still(page, "sidebar-rail-tooltip")

  await caption(page, "The rail's links work: open Review, then the project again")
  await review.click()
  await expect(page).toHaveURL(/\/review$/)
  // The clicked link's tooltip doesn't linger: only the one under the pointer shows.
  await sidebar.getByRole("link", { name: "Sidebar test" }).hover()
  await expect(page.getByRole("tooltip", { name: "Sidebar test" })).toBeVisible()
  await expect(page.getByRole("tooltip")).toHaveCount(1)
  await sidebar.getByRole("link", { name: "Sidebar test" }).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/issues$`))

  await caption(page, "⌘B again: expanded, at the width it had")
  await page.keyboard.press("ControlOrMeta+b")
  await expect(sidebar).toHaveAttribute("data-sidebar", "expanded")
  expect(await widthOf(page)).toBe(280)

  await caption(page, "The collapse button collapses it to the rail too")
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click()
  await expect(sidebar).toHaveAttribute("data-sidebar", "rail")
  await caption(page, "Reload: still a rail")
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

  await caption(page, "Hidden on a page without a top bar (no such project): Show sidebar is still there")
  await page.keyboard.press("ControlOrMeta+b")
  await expect(sidebar).toHaveCount(0)
  await page.goto("/NOSUCHKEY/issues")
  await expect(page.getByText("No project with the key NOSUCHKEY")).toBeVisible()
  await show.click()
  await expect(sidebar).toHaveAttribute("data-sidebar", "expanded")
  await caption(page, "Resized, collapsed to a rail, hidden and back")

  await screenshots(browser, key)
  fs.rmSync(dir, { recursive: true, force: true })
})

test("CEL-24: while the server is unreachable, the reconnecting status shows in every mode: an icon with a tooltip on the rail, a pill when the sidebar is hidden", async ({ page }) => {
  // The page's /rpc socket goes through the test: it can drop it, and refuse new ones while "down".
  let down = false
  const sockets: WebSocketRoute[] = []
  await page.routeWebSocket(/\/rpc$/, (ws) => {
    if (down) return void ws.close()
    ws.connectToServer()
    sockets.push(ws)
  })
  await page.goto("/")
  const sidebar = sidebarOf(page)
  const status = page.getByRole("status").filter({ hasText: "Reconnecting to the Cello server" })
  await expect(page.getByRole("button", { name: "New project" }).first()).toBeEnabled()
  await expect(status).toHaveCount(0)

  await caption(page, "Collapse the sidebar to the rail (⌘B)")
  await page.keyboard.press("ControlOrMeta+b")
  await expect(sidebar).toHaveAttribute("data-sidebar", "rail")

  await caption(page, "The server goes away: the rail shows a reconnecting icon")
  down = true
  for (const ws of sockets.splice(0)) await ws.close()
  await expect(sidebar.getByRole("status")).toBeVisible()
  await sidebar.getByRole("status").hover()
  await expect(page.getByRole("tooltip", { name: "Reconnecting to the Cello server…" })).toBeVisible()
  await still(page, "status-rail-reconnecting")

  await caption(page, "Hide the sidebar: the status shows as a pill in the main panel")
  await sidebar.getByRole("button", { name: "Hide sidebar" }).click()
  await expect(sidebar).toHaveCount(0)
  await expect(page.getByRole("main").getByRole("status")).toContainText("Reconnecting to the Cello server")
  await still(page, "status-hidden-reconnecting")

  await caption(page, "The server is back: the status goes away")
  down = false
  await expect(status).toHaveCount(0, { timeout: 15_000 })
})

test("CEL-24: in a narrow window the sidebar starts as the rail without saving it, and an open task takes the main panel with everything fitting", async ({ page, cello }) => {
  const key = uniqueKey("NRW")
  const project = await seedProject(cello, "Narrow test", key)
  const task = (await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Read the board on a phone", description: "The panel should fit a phone-sized window." }))).result
  await cello.run((c) => c["comment.add"]({ commandId: newCommandId(), taskId: task.id, body: "Checked on a 390px window." }))

  await caption(page, "A 390px window: the sidebar starts as the rail")
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/${key}/1`)
  const sidebar = sidebarOf(page)
  await expect(sidebar).toHaveAttribute("data-sidebar", "rail")
  expect(await page.evaluate(() => localStorage.getItem("cello:sidebar")), "the automatic rail isn't saved").toBeNull()

  await caption(page, "The task panel takes the main panel, and its fields, tabs and comments fit")
  const panel = taskPanel(page, `${key}-1`)
  await expect(panel.locator("[data-comment-id]")).toBeVisible()
  await panel.getByRole("tab", { name: "Write" }).click()
  await expect(panel.getByRole("textbox", { name: "Description" })).toBeVisible()
  const fit = await panel.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const main = document.querySelector("main")!
    // Anything drawn outside the panel's sides (screen-reader-only text is 1px and doesn't count).
    const outside = Array.from(el.querySelectorAll("*")).filter((child) => {
      const r = child.getBoundingClientRect()
      return r.width > 1 && (r.left < box.left - 1 || r.right > box.right + 1)
    })
    return {
      width: box.width,
      mainWidth: main.clientWidth,
      outside: outside.map((child) => child.outerHTML.slice(0, 80)),
      description: el.querySelector("textarea[aria-label=Description]")?.getBoundingClientRect().width ?? 0,
      commentHeader: el.querySelector("[data-comment-id] > div")!.getBoundingClientRect().height,
    }
  })
  expect(Math.abs(fit.width - fit.mainWidth), "the panel takes the main panel's width").toBeLessThanOrEqual(1)
  expect(fit.outside, "nothing sticks out of the panel").toEqual([])
  expect(fit.description, "the description box is usable").toBeGreaterThan(240)
  expect(fit.commentHeader, "the comment's author and time stay on one line").toBeLessThan(32)
  await expect(panel.getByRole("tab", { name: "Write" })).toBeInViewport()
  await expect(panel.getByRole("tab", { name: "Preview" })).toBeInViewport()
  await still(page, "narrow-task-panel")

  await caption(page, "Close the task: the board is back beside the rail")
  await panel.getByRole("button", { name: "Close task" }).click()
  await expect(page.getByRole("application", { name: /board$/ })).toBeVisible()
  await still(page, "narrow-board")

  await caption(page, "Review beside the rail")
  await page.getByRole("navigation", { name: "Inbox" }).getByRole("link", { name: /^Review/ }).click()
  await expect(page.getByRole("heading", { level: 1, name: /^Review/ })).toBeVisible()
  await still(page, "narrow-review")

  await caption(page, "Widen the window: the sidebar is expanded again, as saved")
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(sidebar).toHaveAttribute("data-sidebar", "expanded")

  await caption(page, "Narrow again: the rail; ⌘B expands it on purpose")
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(sidebar).toHaveAttribute("data-sidebar", "rail")
  await page.keyboard.press("ControlOrMeta+b")
  await expect(sidebar).toHaveAttribute("data-sidebar", "expanded")
})
