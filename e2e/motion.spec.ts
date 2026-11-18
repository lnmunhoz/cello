// Motion (CEL-189): the UI primitives open and close on the shared motion tokens, the task panel slides
// in and out, and once the page settles nothing moves. The motion is read from the browser's own
// `transitionrun` and `animationstart` events, so nothing here waits on a clock. The checks are soft,
// so a run on a build without the motion still walks every step (the before video of the review packet).
import type { Page } from "@playwright/test"
import { addTasks, animationsSettled, caption, card, contentAnimations, createProject, expect, hold, taskPanel, test, uniqueKey } from "./fixtures.ts"

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
    // A select's popup holds its listbox; the popup is what moves.
    const name = (el: Element) =>
      el.getAttribute("data-side-panel") ?? el.getAttribute("role") ?? (el.querySelector("[role=listbox]") ? "listbox" : el.tagName.toLowerCase())
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

/** Whether something scaled or faded in, and then out. */
const movedInAndOut = (log: ReadonlyArray<string>) =>
  log.some((m) => / open (scale|opacity)$/.test(m)) && log.some((m) => / closing (scale|opacity)$/.test(m))

/** The transition duration an open popup computes (the role's element, or the popup around it): the token it reads. */
const durationOf = (page: Page, role: "menu" | "listbox") =>
  page.getByRole(role).evaluate((el) => {
    let at: Element | null = el
    while (at && getComputedStyle(at).transitionDuration === "0s" && at !== document.body) at = at.parentElement
    return at ? getComputedStyle(at).transitionDuration : "0s"
  })

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme })

    test(`${colorScheme}: every popup opens and closes smoothly; the task panel slides in and out; an idle page runs nothing`, async ({ page }) => {
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

      await caption(page, "Menu: open the task's menu, it scales and fades in")
      await panel.getByRole("button", { name: "Task actions" }).click()
      await expect(page.getByRole("menu")).toBeVisible()
      expect.soft(await durationOf(page, "menu")).toBe("0.12s")
      await animationsSettled(page)
      await caption(page, "Menu: Escape, it scales and fades out")
      await page.keyboard.press("Escape")
      await expect(page.getByRole("menu")).toHaveCount(0)
      await hold(page)
      expect.soft(await motionSince(page)).toEqual(expect.arrayContaining(["menu open scale", "menu open opacity", "menu closing scale", "menu closing opacity"]))

      await caption(page, "Select: open the status picker")
      await panel.getByRole("combobox", { name: "Status", exact: true }).click()
      await expect(page.getByRole("listbox")).toBeVisible()
      expect.soft(await durationOf(page, "listbox")).toBe("0.12s")
      await animationsSettled(page)
      await caption(page, "Select: Escape, it closes the same way")
      await page.keyboard.press("Escape")
      await expect(page.getByRole("listbox")).toHaveCount(0)
      await hold(page)
      expect.soft(await motionSince(page)).toEqual(expect.arrayContaining(["listbox open scale", "listbox closing scale", "listbox closing opacity"]))

      await caption(page, "Tabs: Preview, the picked tab eases into its raised look")
      await panel.getByRole("tab", { name: "Preview" }).click()
      await expect(panel.getByTestId("description-preview")).toBeVisible()
      await animationsSettled(page)
      expect.soft(await motionSince(page)).toContain("tab open background-color")
      await panel.getByRole("tab", { name: "Write" }).click()
      await animationsSettled(page)
      await motionSince(page)

      await caption(page, "Popover: comment, then open the reaction picker")
      await panel.getByLabel("New comment").fill("Looks smooth.")
      await panel.getByRole("button", { name: "Comment", exact: true }).click()
      const comment = panel.locator("[data-comment-id]").last()
      await expect(comment).toContainText("Looks smooth.")
      await animationsSettled(page)
      await motionSince(page)
      await comment.getByRole("button", { name: "Add a reaction" }).click()
      const picker = page.getByRole("group", { name: "Pick a reaction" })
      await expect(picker).toBeVisible()
      await animationsSettled(page)
      await caption(page, "Popover: Escape, the picker scales and fades out")
      await page.keyboard.press("Escape")
      await expect(picker).toHaveCount(0)
      await hold(page)
      expect.soft(movedInAndOut(await motionSince(page)), "popover").toBe(true)

      await caption(page, "Hover card: make the other task this one's parent, then hover its link in the header")
      await panel.getByRole("combobox", { name: "Parent", exact: true }).click()
      await page.getByRole("option", { name: `${key}-2 Slide the panel` }).click()
      const parentLink = panel.getByRole("link", { name: `Parent: ${key}-2 Slide the panel` })
      await expect(parentLink).toBeVisible()
      await animationsSettled(page)
      await motionSince(page)
      await parentLink.hover()
      const preview = page.locator(`[data-task-preview="${key}-2"]`)
      await expect(preview).toBeVisible()
      await animationsSettled(page)
      await caption(page, "Hover card: move away, it scales and fades out")
      await page.getByRole("heading", { name: "Todo" }).first().hover()
      await expect(preview).toHaveCount(0)
      await hold(page)
      expect.soft(movedInAndOut(await motionSince(page)), "hover card").toBe(true)

      await caption(page, "Tooltip: hover the sidebar's Collapse button")
      await page.getByRole("button", { name: "Collapse sidebar" }).hover()
      const tip = page.getByRole("tooltip")
      await expect(tip).toBeVisible()
      await animationsSettled(page)
      await caption(page, "Tooltip: move away, it fades out")
      await page.getByRole("heading", { name: "Todo" }).first().hover()
      await expect(tip).toHaveCount(0)
      await hold(page)
      expect.soft(movedInAndOut(await motionSince(page)), "tooltip").toBe(true)

      await caption(page, "Toast: copy the task's key, a toast fades in")
      await panel.getByRole("button", { name: `Copy key ${key}-1` }).click()
      const dismiss = page.getByRole("button", { name: "Dismiss" })
      await expect(dismiss).toBeVisible()
      await animationsSettled(page)
      await caption(page, "Toast: dismiss it, it fades out")
      await dismiss.click()
      await expect(dismiss).toHaveCount(0)
      await hold(page)
      expect.soft((await motionSince(page)).some((m) => m.endsWith("closing opacity")), "toast").toBe(true)

      await caption(page, "⌘K: the search bar scales in over a dim")
      await page.keyboard.press("ControlOrMeta+k")
      const bar = page.getByRole("dialog", { name: "Search Cello" })
      await expect(bar).toBeVisible()
      expect.soft(await bar.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0.18s")
      await animationsSettled(page)
      await caption(page, "⌘K: Escape, it scales and fades out")
      await page.keyboard.press("Escape")
      await expect(bar).toHaveCount(0)
      await hold(page)
      expect.soft(await motionSince(page)).toEqual(expect.arrayContaining(["dialog open scale", "dialog closing scale", "dialog closing opacity"]))

      await caption(page, "Idle with the panel open: nothing on the page is moving")
      await animationsSettled(page)
      expect(await contentAnimations(page)).toBe(0)

      await caption(page, "Close the task: the panel slides out, then the board has the room again")
      await panel.getByRole("button", { name: "Close task" }).click()
      await expect(panel).toHaveCount(0)
      await expect(page).toHaveURL(new RegExp(`/${key}/issues$`))
      await hold(page)
      expect.soft(await motionSince(page)).toContain("task closing task-panel-out")

      await caption(page, "Idle on the board: nothing is moving")
      await animationsSettled(page)
      expect(await contentAnimations(page)).toBe(0)

      await caption(page, "Reload with a task open: the panel is simply there, nothing slides")
      await card(page, `${key}-2`).click()
      await expect(taskPanel(page, `${key}-2`)).toBeVisible()
      await page.reload()
      await expect(taskPanel(page, `${key}-2`).getByLabel("Title")).toHaveValue("Slide the panel")
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
