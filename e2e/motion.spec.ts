// Motion (CEL-189): the UI primitives open and close on the shared motion tokens, the task panel slides
// in and out, and once the page settles nothing moves. The motion is read from the browser's own
// `transitionrun` and `animationstart` events, so nothing here waits on a clock. The checks are soft,
// so a run on a build without the motion still walks every step (the before video of the review packet).
import type { Page } from "@playwright/test"
import { addTasks, animationsSettled, caption, card, contentAnimations, createProject, expect, taskPanel, test, uniqueKey } from "./fixtures.ts"

declare global {
  interface Window {
    /** What moved since `recordMotion`: `<element> <open|closing> <property or animation>`. */
    __motion?: string[]
  }
}

/** Starts writing down every transition and animation that starts on the page. */
const recordMotion = (page: Page) =>
  page.evaluate(() => {
    const log: string[] = []
    window.__motion = log
    const name = (el: Element) => el.getAttribute("data-side-panel") ?? el.getAttribute("role") ?? el.tagName.toLowerCase()
    const phase = (el: Element) => (el.hasAttribute("data-ending-style") || el.hasAttribute("data-closing") ? "closing" : "open")
    document.addEventListener("transitionrun", (e) => {
      if (e.target instanceof Element) log.push(`${name(e.target)} ${phase(e.target)} ${e.propertyName}`)
    })
    document.addEventListener("animationstart", (e) => {
      if (e.target instanceof Element) log.push(`${name(e.target)} ${phase(e.target)} ${e.animationName}`)
    })
  })

/** What moved since `recordMotion`, and starts a new list. */
const motionSince = (page: Page) =>
  page.evaluate(() => {
    const log = [...(window.__motion ?? [])]
    window.__motion?.splice(0)
    return log
  })

/** The transition duration an open popup computes: the token it reads. */
const durationOf = (page: Page, role: string) => page.getByRole(role as "menu").evaluate((el) => getComputedStyle(el).transitionDuration)

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme })

    test(`menus, selects, the ⌘K bar and tabs open and close smoothly; the task panel slides in and out; an idle page runs nothing (${colorScheme})`, async ({ page }) => {
      const key = uniqueKey("MOTN")
      await createProject(page, "Motion", key)
      await addTasks(page, "Todo", ["Smooth the menus", "Slide the panel"])
      await animationsSettled(page)
      await recordMotion(page)

      await caption(page, "Open a task: the panel slides in from the right")
      await card(page, `${key}-1`).click()
      const panel = taskPanel(page, `${key}-1`)
      await expect(panel).toBeVisible()
      await animationsSettled(page)
      expect.soft(await motionSince(page)).toContain("task open task-panel-in")

      await caption(page, "The task's menu scales and fades in, and out again on Escape")
      await panel.getByRole("button", { name: "Task actions" }).click()
      await expect(page.getByRole("menu")).toBeVisible()
      expect.soft(await durationOf(page, "menu")).toBe("0.12s")
      await animationsSettled(page)
      await page.keyboard.press("Escape")
      await expect(page.getByRole("menu")).toHaveCount(0)
      expect.soft(await motionSince(page)).toEqual(expect.arrayContaining(["menu open scale", "menu open opacity", "menu closing scale", "menu closing opacity"]))

      await caption(page, "The status picker opens and closes the same way")
      await panel.getByRole("combobox", { name: "Status", exact: true }).click()
      await expect(page.getByRole("listbox")).toBeVisible()
      expect.soft(await durationOf(page, "listbox")).toBe("0.12s")
      await animationsSettled(page)
      await page.keyboard.press("Escape")
      await expect(page.getByRole("listbox")).toHaveCount(0)
      expect.soft(await motionSince(page)).toEqual(expect.arrayContaining(["listbox open scale", "listbox closing scale", "listbox closing opacity"]))

      await caption(page, "Preview: the tab's panel fades in")
      await panel.getByRole("tab", { name: "Preview" }).click()
      await expect(panel.getByTestId("description-preview")).toBeVisible()
      await animationsSettled(page)
      expect.soft(await motionSince(page)).toContain("tabpanel open motion-fade-in")
      await panel.getByRole("tab", { name: "Write" }).click()
      await animationsSettled(page)
      await motionSince(page)

      await caption(page, "⌘K: the search bar scales in over a dim, and out on Escape")
      await page.keyboard.press("ControlOrMeta+k")
      const bar = page.getByRole("dialog", { name: "Search Cello" })
      await expect(bar).toBeVisible()
      expect.soft(await bar.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0.18s")
      await animationsSettled(page)
      await page.keyboard.press("Escape")
      await expect(bar).toHaveCount(0)
      expect.soft(await motionSince(page)).toEqual(expect.arrayContaining(["dialog open scale", "dialog closing scale", "dialog closing opacity"]))

      await caption(page, "Idle with the panel open: nothing on the page is moving")
      await animationsSettled(page)
      expect(await contentAnimations(page)).toBe(0)

      await caption(page, "Close the task: the panel slides out, then the board has the room again")
      await panel.getByRole("button", { name: "Close task" }).click()
      await expect(panel).toHaveCount(0)
      await expect(page).toHaveURL(new RegExp(`/${key}/issues$`))
      expect.soft(await motionSince(page)).toContain("task closing task-panel-out")

      await caption(page, "Idle on the board: nothing is moving")
      await animationsSettled(page)
      expect(await contentAnimations(page)).toBe(0)
    })
  })
}

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" })

  test("with reduced motion the tokens are 0 and Close task leaves at once", async ({ page }) => {
    const key = uniqueKey("MOTR")
    await createProject(page, "Motion reduced", key)
    await addTasks(page, "Todo", ["Hold still"])
    await card(page, `${key}-1`).click()
    const panel = taskPanel(page, `${key}-1`)
    await panel.getByRole("button", { name: "Task actions" }).click()
    expect(await durationOf(page, "menu")).toBe("0s")
    await page.keyboard.press("Escape")
    await recordMotion(page)
    await panel.getByRole("button", { name: "Close task" }).click()
    await expect(panel).toHaveCount(0)
    expect(await motionSince(page)).not.toContain("task closing task-panel-out")
  })
})
