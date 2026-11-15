// CEL-25: the app fills the window exactly. The page itself never scrolls; the sidebar and the main
// panel reach the bottom; scrolling (sideways on a wide board) happens inside the page's own area,
// and the task panel and the viewer stretch to the bottom beside it.
import type { Locator, Page } from "@playwright/test"
import { caption, defaultWorkspace, expect, newCommandId, seedProject, switchWorkspace, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { WEB_URL } from "./packets.ts"
import { slowMo } from "./recording.ts"

// Classic scrollbars, as on a Mac with a mouse plugged in: the board's sideways scrollbar takes room and shows.
test.use({ launchOptions: { slowMo: slowMo(process.env), ignoreDefaultArgs: ["--hide-scrollbars"] } })

/**
 * Checks the shell around `probe` (an element inside the page's scrolling area, or the area itself):
 * - the page doesn't scroll: the document is exactly the window
 * - the sidebar's last row (Settings) sits at the bottom of the window
 * - the main panel reaches the bottom (less its 8px margin), and nothing in it is cut off
 * - the page's scrolling area, and each side panel, reach the main panel's bottom
 * - `sideways`: the area scrolls sideways and draws the horizontal scrollbar itself
 */
async function expectFills(page: Page, probe: Locator, { panels = [], sideways = false }: { panels?: Locator[]; sideways?: boolean } = {}) {
  const fit = await probe.evaluate((el) => {
    const doc = document.documentElement
    const main = document.querySelector("main")!
    let area: HTMLElement | null = el as HTMLElement
    while (area && area !== main) {
      const style = getComputedStyle(area)
      if (/auto|scroll/.test(style.overflowX + style.overflowY)) break
      area = area.parentElement
    }
    if (!area || area === main) throw new Error("no scrolling area inside main")
    const mainBox = main.getBoundingClientRect()
    const areaBox = area.getBoundingClientRect()
    return {
      window: { width: innerWidth, height: innerHeight },
      page: { scrollWidth: doc.scrollWidth, scrollHeight: doc.scrollHeight, x: scrollX, y: scrollY },
      // The group Settings sits in: the last row of the expanded sidebar, the bottom icons of the rail.
      settingsBottom: document.querySelector('a[href="/settings"]')!.parentElement!.getBoundingClientRect().bottom,
      main: {
        bottom: mainBox.bottom,
        innerBottom: mainBox.top + main.clientTop + main.clientHeight,
        cutOffX: main.scrollWidth - main.clientWidth,
        cutOffY: main.scrollHeight - main.clientHeight,
      },
      area: {
        bottom: areaBox.bottom,
        overflowX: area.scrollWidth - area.clientWidth,
        // What the borders don't explain is the horizontal scrollbar.
        scrollbar: area.offsetHeight - area.clientHeight - area.clientTop - (parseFloat(getComputedStyle(area).borderBottomWidth) || 0),
      },
    }
  })
  expect(fit.page, "the page itself doesn't scroll").toEqual({ scrollWidth: fit.window.width, scrollHeight: fit.window.height, x: 0, y: 0 })
  expect(fit.window.height - fit.settingsBottom, "Settings sits at the bottom of the sidebar").toBeGreaterThanOrEqual(0)
  expect(fit.window.height - fit.settingsBottom, "Settings sits at the bottom of the sidebar").toBeLessThanOrEqual(16)
  expect(fit.window.height - fit.main.bottom, "the main panel reaches the bottom, less its margin").toBe(8)
  expect({ x: fit.main.cutOffX, y: fit.main.cutOffY }, "nothing in the main panel is cut off").toEqual({ x: 0, y: 0 })
  expect(Math.abs(fit.main.innerBottom - fit.area.bottom), "the page's area reaches the bottom").toBeLessThanOrEqual(1)
  if (sideways) {
    expect(fit.area.overflowX, "the area scrolls sideways").toBeGreaterThan(0)
    expect(fit.area.scrollbar, "the horizontal scrollbar is the area's own").toBeGreaterThan(0)
  }
  for (const panel of panels) {
    await expect(panel).toBeVisible()
    const bottom = await panel.evaluate((el) => el.getBoundingClientRect().bottom)
    expect(Math.abs(fit.main.innerBottom - bottom), "the side panel reaches the bottom").toBeLessThanOrEqual(1)
  }
}

/**
 * Listens for `el`'s next scrollend before anything scrolls it (the listener is in place when this
 * resolves), and returns a wait for it: how far it then is scrolled, down plus sideways.
 */
async function scrollEnd(el: Locator): Promise<() => Promise<number>> {
  await el.evaluate((node) => {
    const target = node as HTMLElement & { e2eScrollEnd?: Promise<number> }
    target.e2eScrollEnd = new Promise((resolve) => node.addEventListener("scrollend", () => resolve(node.scrollTop + node.scrollLeft), { once: true }))
  })
  return () => el.evaluate((node) => (node as HTMLElement & { e2eScrollEnd?: Promise<number> }).e2eScrollEnd!)
}

const boardOf = (page: Page) => page.getByRole("application", { name: /board$/ })
const listOf = (page: Page) => page.getByRole("region", { name: /list$/ })
const viewerOf = (page: Page) => page.getByRole("complementary", { name: "Viewer" })

/** A project with a full Todo column, a published doc, and a comment on its first task linking an image. */
async function seedWideProject(cello: Parameters<typeof seedProject>[0], key: string) {
  const project = await seedProject(cello, "Wide board", key)
  const { statuses } = await defaultWorkspace(cello)
  const taskIds: string[] = []
  for (let i = 1; i <= 24; i++) {
    taskIds.push((await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title: `Task ${i}`, statusId: statuses.Todo!.id }))).result.id)
  }
  await cello.run((c) => c["comment.add"]({ commandId: newCommandId(), taskId: taskIds[0]!, body: `The icon: ${WEB_URL}/icons/icon-512.png` }))
  await cello.run((c) =>
    c["document.publish"]({ commandId: newCommandId(), project: { key }, body: "# Layout notes\n\nThe app fills the window.\n" }),
  )
  return project
}

test("CEL-25: with a wide board, the app fills the window: no page scroll, the sidebar and the board reach the bottom, the board scrolls sideways in its own area; the same on the list, Review and Docs, with the task panel and the viewer open", async ({ page, cello }) => {
  const key = uniqueKey("FILL")
  await seedWideProject(cello, key)

  await caption(page, "A board wider than the window: it scrolls sideways inside the board area")
  await page.goto(`/${key}/issues`)
  await expect(page.locator(`[data-task-key="${key}-24"]`)).toBeVisible()
  await expectFills(page, boardOf(page), { sideways: true })

  await caption(page, "Scroll a column to its end and keep going, then the board sideways: the page stays put")
  await page.locator(`[data-task-key="${key}-3"]`).hover()
  const todo = page.locator('section[data-column="Todo"] [role="list"]')
  const columnEnd = await scrollEnd(todo)
  await page.mouse.wheel(0, 4000)
  expect(await columnEnd(), "the column scrolled").toBeGreaterThan(0)
  // At the column's end the wheel has nowhere to go: the page can't scroll (it's exactly the window).
  await page.mouse.wheel(0, 4000)
  const boardEnd = await scrollEnd(boardOf(page).locator("xpath=.."))
  await page.mouse.wheel(400, 0)
  expect(await boardEnd(), "the board scrolled sideways").toBeGreaterThan(0)
  await expectFills(page, boardOf(page), { sideways: true })

  await caption(page, "Open a task: the task panel stretches to the bottom too")
  await page.goto(`/${key}/1`)
  const panel = taskPanel(page, `${key}-1`)
  await expectFills(page, boardOf(page), { panels: [panel], sideways: true })

  await caption(page, "Open the image linked in a comment: the viewer stretches to the bottom")
  await panel.locator("[data-comment-id]").getByRole("link").click()
  await expect(viewerOf(page).locator("img[data-viewer-image]")).toBeVisible()
  await expectFills(page, boardOf(page), { panels: [viewerOf(page)], sideways: true })
  await page.keyboard.press("Escape")
  await expect(viewerOf(page)).toHaveCount(0)

  await caption(page, "The list layout, with and without the task panel")
  await page.goto(`/${key}/issues?layout=list`)
  await expectFills(page, listOf(page))
  await page.goto(`/${key}/1?layout=list`)
  await expectFills(page, listOf(page), { panels: [taskPanel(page, `${key}-1`)] })

  await caption(page, "Review")
  await page.goto("/review")
  await expectFills(page, page.getByRole("heading", { level: 1, name: /^Review/ }))

  await caption(page, "Docs")
  await page.goto(`/${key}/docs`)
  await expectFills(page, page.getByRole("link", { name: /Layout notes/ }))

  await caption(page, "A phone-sized window: the board, a task and Review still fill it")
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/${key}/issues`)
  await expect(page.locator(`[data-task-key="${key}-1"]`)).toBeVisible()
  await expectFills(page, boardOf(page), { sideways: true })
  // In a narrow window the open task takes the board's place; its own area scrolls.
  await page.goto(`/${key}/1`)
  const narrowPanel = taskPanel(page, `${key}-1`)
  await expectFills(page, narrowPanel.getByRole("textbox", { name: "Title" }), { panels: [narrowPanel] })
  await page.goto("/review")
  await expectFills(page, page.getByRole("heading", { level: 1, name: /^Review/ }))
  await caption(page, "The app fills the window everywhere")
})

test("CEL-25: a short window with many projects: the project list scrolls inside the sidebar, the page doesn't, and Settings stays at the bottom", async ({ page, cello }) => {
  const name = `Many projects ${uniqueKey("W")}`
  const workspace = (await cello.run((c) => c["workspace.create"]({ commandId: newCommandId(), name }))).result
  const prefix = uniqueKey("M").slice(0, 6)
  for (let i = 0; i < 30; i++) {
    await cello.run((c) => c["project.create"]({ commandId: newCommandId(), workspaceId: workspace.id, name: `Project ${i + 1}`, key: `${prefix}${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}` }))
  }
  await page.setViewportSize({ width: 1280, height: 600 })
  await page.goto("/")
  await caption(page, `Switch to “${name}”: 30 projects in a 600px-tall window`)
  await switchWorkspace(page, name)
  await expect(boardOf(page)).toBeVisible()
  await expectFills(page, boardOf(page), { sideways: true })
  const projects = page.getByRole("navigation", { name: "Projects" })
  expect(await projects.evaluate((el) => el.scrollHeight > el.clientHeight), "the project list scrolls").toBe(true)

  await caption(page, "Scroll the project list to the last project and open it")
  await projects.getByRole("link", { name: "Project 30" }).click()
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Project 30")
  await expectFills(page, boardOf(page), { sideways: true })
  await caption(page, "The page never scrolled; the project list did")
})
