// CEL-52: the filter panel on the Issues tab. Labels in their groups (any within a group, all across),
// Area cut to its busiest 6 until Show all, "An agent" opening into the sessions holding claims, and
// the filter kept per project on this device, shared by board and list, a link winning over it; the
// panel folding to a rail (⌘⇧F) and its sections folding, both kept on this device.
import * as path from "node:path"
import type { Locator, Page } from "@playwright/test"
import { newCommandId, type PromiseClient } from "../packages/client/test/support/promiseClient.ts"
import { caption, captionWithUrl, defaultWorkspace, expect, seedProject, test, uniqueKey } from "./fixtures.ts"
import { seedFilterBoard as seed, TASKS } from "./filterSeed.ts"
import { SHOTS, WEB_URL } from "./packets.ts"

const panel = (page: Page) => page.getByRole("complementary", { name: "Filters" })
const option = (page: Page, id: string) => panel(page).locator(`[data-facet-option="${id}"]`)
/** The open panel, and the panel folded to its rail. */
const openPanel = (page: Page) => page.locator('[data-facets]:not([data-facets="rail"])')
const rail = (page: Page) => page.locator('[data-facets="rail"]')
/** Folds a section or label group by its heading. */
const fold = async (page: Page, heading: string) => {
  await panel(page).locator(`[data-fold="${heading}"]`).click()
  await expect(panel(page).locator(`[data-fold="${heading}"]`)).toHaveAttribute("aria-expanded", "false")
}
const tick = async (page: Page, id: string, checked: "true" | "false" | "mixed") => {
  await option(page, id).click()
  await expect(option(page, id)).toHaveAttribute("aria-checked", checked)
}

/** Expects exactly these tasks on the board (or the list), by number. */
async function expectShown(items: Locator, key: string, numbers: ReadonlyArray<number>) {
  await expect(items).toHaveCount(numbers.length)
  const keys = await items.evaluateAll((els) => els.map((el) => el.getAttribute("data-task-key")))
  expect(keys.sort()).toEqual(numbers.map((n) => `${key}-${n}`).sort())
}
const boardCards = (page: Page) => page.locator("[data-agent-board] [data-task-key]")
const listRows = (page: Page) => page.locator('[data-layout="list"] [data-task-key]')

test.beforeEach(async ({ context }) => {
  // Agent cursors off, so claimed cards change in place.
  await context.addInitScript(() => {
    if (localStorage.getItem("cello:agent-cursors") === null) localStorage.setItem("cello:agent-cursors", "off")
  })
})

test("CEL-52: filter the board by kind and area: a bug and an area show the bugs in that area; Show all lists every area, and a picked one stays", async ({ page, cello, baseURL }) => {
  const { key } = await seed(cello, baseURL!, "FLT")
  await page.goto(`/${key}/issues`)
  await expectShown(boardCards(page), key, Array.from({ length: 30 }, (_, i) => i + 1))

  await caption(page, "The filter panel: labels in Kind and Area, each with how many tasks it would show")
  // Milestones have their own section (CEL-113), not a label group.
  await expect(panel(page).locator('[data-label-group="milestone"]')).toHaveCount(0)
  await expect(panel(page).locator('[data-label-group="kind"] [data-facet-option]')).toHaveCount(5)
  await expect(option(page, "label-bug").locator("[data-facet-count]")).toHaveText("6")
  // The 6 busiest areas, by task count across the project.
  await expect(panel(page).locator('[data-label-group="area"] [data-facet-option]')).toHaveText(
    ["agents9", "board8", "cli8", "server4", "pages3", "review3"],
  )

  await caption(page, "Tick bug: only the 6 bugs stay, every column says how many of its cards match")
  await tick(page, "label-bug", "true")
  await expectShown(boardCards(page), key, [12, 13, 14, 15, 16, 17])
  await expect(page.locator('section[data-column="Todo"] [data-column-count]')).toHaveText(/^6 \/ \d+$/)
  await expect(panel(page).locator("[data-filter-result]")).toHaveText("6 of 30 tasks")
  // Counts move with the filter: agents now counts the bugs in agents.
  await expect(option(page, "label-agents").locator("[data-facet-count]")).toHaveText("2")

  await caption(page, "Tick agents too: a kind and an area match together, so it's the bugs in agents")
  await tick(page, "label-agents", "true")
  await expectShown(boardCards(page), key, [16, 17])

  await caption(page, "Tick board as well: two areas match either, so bugs in agents or on the board")
  await tick(page, "label-board", "true")
  await expectShown(boardCards(page), key, [15, 16, 17])
  // Rows don't move while filtering: the areas keep their project-wide order.
  await expect(panel(page).locator('[data-label-group="area"] [data-facet-option]').first()).toHaveAttribute("data-facet-option", "label-agents")

  await caption(page, "Clear all, then Show all 15: the other 9 areas, A to Z, under the top 6")
  await panel(page).getByRole("button", { name: "Clear all" }).click()
  await expectShown(boardCards(page), key, Array.from({ length: 30 }, (_, i) => i + 1))
  await panel(page).getByRole("button", { name: "Show all 15" }).click()
  await expect(panel(page).locator('[data-label-group="area"] [data-facet-option]')).toHaveCount(15)
  await expect(panel(page).locator('[data-label-group="area"] [data-facet-option]').nth(6)).toHaveAttribute("data-facet-option", "label-data")

  await caption(page, "Pick desktop, then Show fewer: a picked area always shows, even outside the top 6")
  await tick(page, "label-desktop", "true")
  await expectShown(boardCards(page), key, [15, 20])
  await panel(page).getByRole("button", { name: "Show fewer" }).click()
  await expect(panel(page).locator('[data-label-group="area"] [data-facet-option]')).toHaveCount(7)
  await expect(option(page, "label-desktop")).toHaveAttribute("aria-checked", "true")

  await caption(page, "Untick it: every task is back, and desktop goes back behind Show all")
  await option(page, "label-desktop").click()
  await expectShown(boardCards(page), key, Array.from({ length: 30 }, (_, i) => i + 1))
  await expect(option(page, "label-desktop")).toHaveCount(0)
  await expect(panel(page).locator('[data-label-group="area"] [data-facet-option]')).toHaveCount(6)
})

test("CEL-52: filter by who's working on it: An agent opens into the sessions holding claims, with their presence; ticking some makes its box a dash", async ({ page, cello, baseURL }) => {
  // The server notices the gone session's process within 30 s: this test waits for it once, at the end.
  test.setTimeout(Math.max(test.info().timeout, 90_000))
  const { key } = await seed(cello, baseURL!, "WHO")
  await page.goto(`/${key}/issues`)
  await expectShown(boardCards(page), key, Array.from({ length: 30 }, (_, i) => i + 1))

  await caption(page, "Working on it: An agent, Lucas, Nobody. The dots beside An agent are the sessions holding claims")
  await expect(option(page, "who-agent").locator("[data-facet-count]")).toHaveText("5")
  await expect(panel(page).locator("[data-session-dots]")).toBeVisible()

  await caption(page, "Tick An agent: the five tasks agents hold")
  await tick(page, "who-agent", "true")
  await expectShown(boardCards(page), key, [26, 27, 28, 29, 30])

  await caption(page, "Untick it, and open the sessions: each one with its presence, the panel a little wider")
  await tick(page, "who-agent", "false")
  await panel(page).getByRole("button", { name: "Show agent sessions" }).click()
  await expect(option(page, "session-8a41c9e2")).toContainText("Claude Code · 8a41c9e2")
  await expect(option(page, "session-8a41c9e2")).toContainText("active now")
  await expect(option(page, "session-3f07b1d4")).toContainText("active now")
  await expect(option(page, "session-c19e55a0")).toBeVisible()

  await caption(page, "Tick session 8a41c9e2: only its two tasks, and An agent's box turns into a dash")
  await tick(page, "session-8a41c9e2", "true")
  await expectShown(boardCards(page), key, [26, 27])
  await expect(option(page, "who-agent")).toHaveAttribute("aria-checked", "mixed")

  await caption(page, "Add session 3f07b1d4: both sessions' tasks; still some of the agents")
  await tick(page, "session-3f07b1d4", "true")
  await expectShown(boardCards(page), key, [26, 27, 28, 29])
  await expect(option(page, "who-agent")).toHaveAttribute("aria-checked", "mixed")

  await caption(page, "Tick Lucas as well: his task joins them")
  await tick(page, "who-human", "true")
  await expectShown(boardCards(page), key, [24, 26, 27, 28, 29])

  await caption(page, "Untick Lucas and add the last session: every session ticked is An agent")
  await tick(page, "who-human", "false")
  await tick(page, "session-c19e55a0", "true")
  await expect(option(page, "who-agent")).toHaveAttribute("aria-checked", "true")
  await expectShown(boardCards(page), key, [26, 27, 28, 29, 30])

  await caption(page, "Within 30 s the server notices session c19e55a0's process is gone: its row says ended, last")
  await expect(option(page, "session-c19e55a0")).toContainText("ended", { timeout: 45_000 })
  await expect(panel(page).locator('[data-facet-option^="session-"]').last()).toHaveAttribute("data-facet-option", "session-c19e55a0")
})

test("CEL-52: the filter is kept per project across a reload, shared by the board and the list, not by other projects, and a link with a filter wins", async ({ page, cello, baseURL }) => {
  const { key, k } = await seed(cello, baseURL!, "KEEP", "Cello filters")
  const other = { key: uniqueKey("TWO") }
  const second = await seedProject(cello, "Second project", other.key)
  const { statuses } = await defaultWorkspace(cello)
  for (const title of ["Pricing page", "Onboarding emails"]) {
    await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: second.id, title, statusId: statuses["Todo"]!.id }))
  }
  await page.goto(`/${key}/issues`)
  await expectShown(boardCards(page), key, Array.from({ length: 30 }, (_, i) => i + 1))

  await captionWithUrl(page, "Tick bug: the URL carries the filter")
  await tick(page, "label-bug", "true")
  await expectShown(boardCards(page), key, [12, 13, 14, 15, 16, 17])
  await expect(page).toHaveURL(/label=bug/)

  await captionWithUrl(page, "Reload: the filter stays")
  await page.reload()
  await expectShown(boardCards(page), key, [12, 13, 14, 15, 16, 17])
  await expect(option(page, "label-bug")).toHaveAttribute("aria-checked", "true")

  await captionWithUrl(page, "Switch to the list: the same filter, and only the groups with a match")
  await page.getByRole("button", { name: /^Display/ }).click()
  await page.getByRole("radio", { name: "List" }).click()
  await page.keyboard.press("Escape")
  await expectShown(listRows(page), key, [12, 13, 14, 15, 16, 17])
  await expect(page.locator('[data-layout="list"] section[data-group]')).toHaveCount(1)
  await expect(page.locator('section[data-group="Todo"] [data-group-count]')).toHaveText(/^6 \/ \d+$/)

  await captionWithUrl(page, "Come back to the project with no filter in the address: the kept filter shows")
  await page.goto(`/${key}/issues?layout=list`)
  await expectShown(listRows(page), key, [12, 13, 14, 15, 16, 17])
  await expect(page).not.toHaveURL(/label=/)

  await captionWithUrl(page, "Another project, from the sidebar: it has no filter of its own, so everything shows")
  const sidebar = page.locator('aside[data-sidebar="expanded"]')
  await sidebar.getByRole("link", { name: "Second project", exact: true }).click()
  await expectShown(listRows(page), other.key, [1, 2])
  await expect(panel(page).getByRole("button", { name: "Clear all" })).toHaveCount(0)

  await captionWithUrl(page, "Back to the first project: its filter is still there")
  await sidebar.getByRole("link", { name: "Cello filters", exact: true }).click()
  await expectShown(listRows(page), key, [12, 13, 14, 15, 16, 17])
  await expect(option(page, "label-bug")).toHaveAttribute("aria-checked", "true")

  await captionWithUrl(page, "In a narrow window the panel hides: a strip says the list is filtered, with Clear")
  await page.setViewportSize({ width: 700, height: 900 })
  await expect(panel(page)).toBeHidden()
  await expect(page.locator("[data-filter-strip]")).toBeVisible()
  await expect(page.locator("[data-filter-strip]")).toContainText("Filtered: 6 of 30 tasks")
  await page.locator("[data-filter-strip]").getByRole("button", { name: "Clear" }).click()
  await expect(page.locator("[data-filter-strip]")).toHaveCount(0)
  await expectShown(listRows(page), key, Array.from({ length: 30 }, (_, i) => i + 1))
  await page.setViewportSize({ width: 1440, height: 900 })

  await captionWithUrl(page, "Open a link with another filter (polish): the link wins")
  await page.goto(`/${key}/issues?label=polish`)
  await expectShown(boardCards(page), key, [20, 24, 30])
  await expect(option(page, "label-polish")).toHaveAttribute("aria-checked", "true")
  await expect(option(page, "label-bug")).toHaveAttribute("aria-checked", "false")

  await captionWithUrl(page, "Open one of its tasks and close it: the link's filter stays on screen")
  await page.locator(`[data-task-key="${k(24)}"]`).click()
  await expect(page.getByRole("complementary", { name: `${k(24)} details` })).toBeVisible()
  await expectShown(boardCards(page), key, [20, 24, 30])
  await page.getByRole("button", { name: "Close task" }).click()
  await expect(page.getByRole("complementary", { name: `${k(24)} details` })).toBeHidden()
  await expectShown(boardCards(page), key, [20, 24, 30])

  await captionWithUrl(page, "Clear all, and reload: no filter is kept")
  await panel(page).getByRole("button", { name: "Clear all" }).click()
  await expectShown(boardCards(page), key, Array.from({ length: 30 }, (_, i) => i + 1))
  await page.goto(`/${key}/issues`)
  await expectShown(boardCards(page), key, Array.from({ length: 30 }, (_, i) => i + 1))
  await expect(panel(page).getByRole("button", { name: "Clear all" })).toHaveCount(0)
})

test("CEL-52: while filtered: the text box keeps up with typing and an edit mid-word, a drag lands next to its shown neighbour, and a new card is created as usual", async ({ page, cello, baseURL }) => {
  const { key, k } = await seed(cello, baseURL!, "WHILE")
  await page.goto(`/${key}/issues`)
  await expectShown(boardCards(page), key, Array.from({ length: 30 }, (_, i) => i + 1))
  const box = panel(page).getByRole("searchbox", { name: "Filter by text" })
  const titled = (word: string) => TASKS.flatMap(([title], i) => (title.toLowerCase().includes(word) ? [i + 1] : []))

  await captionWithUrl(page, "Type “agnt” key by key: the box keeps every letter while the URL follows")
  await box.pressSequentially("agnt")
  await expect(box).toHaveValue("agnt")
  await expect(page).toHaveURL(/q=agnt/)

  await captionWithUrl(page, "Fix it in the middle: ← ← then “e” makes “agent”, the caret stays where it was put")
  await box.press("ArrowLeft")
  await box.press("ArrowLeft")
  await box.pressSequentially("e")
  await expect(box).toHaveValue("agent")
  await expect(page).toHaveURL(/q=agent/)
  await expectShown(boardCards(page), key, titled("agent"))

  await caption(page, "Clear all empties the box too")
  await panel(page).getByRole("button", { name: "Clear all" }).click()
  await expect(box).toHaveValue("")
  await expectShown(boardCards(page), key, Array.from({ length: 30 }, (_, i) => i + 1))

  await caption(page, "Tick cli: Todo shows 16, 22 and 18, with the other Todo cards hidden between them")
  await tick(page, "label-cli", "true")
  const todo = page.locator('section[data-column="Todo"] [data-task-key]')
  await expect(todo).toHaveText([new RegExp(k(16)), new RegExp(k(18)), new RegExp(k(22))])

  await caption(page, `Drag ${k(22)} up one place with the keyboard, between ${k(16)} and ${k(18)}`)
  await page.locator(`[data-task-key="${k(22)}"]`).focus()
  await page.keyboard.press("Space")
  await page.keyboard.press("ArrowUp")
  await page.keyboard.press("Space")
  await expect(todo).toHaveText([new RegExp(k(16)), new RegExp(k(22)), new RegExp(k(18))])

  await caption(page, "Make a card while filtered: “Write the filter docs” has no cli label, so it's made as usual and leaves this view")
  await page.getByRole("button", { name: "New task in Todo" }).click()
  const input = page.getByLabel("New task title in Todo")
  await input.fill("Write the filter docs")
  await input.press("Enter")
  await input.press("Escape")
  await expect(todo).toHaveCount(3)

  await caption(page, `Clear the filter: ${k(22)} sits right after ${k(16)}, where it was dropped, and the new card is at the bottom`)
  await panel(page).getByRole("button", { name: "Clear all" }).click()
  await expect(todo).toHaveCount(14)
  const keys = await todo.evaluateAll((els) => els.map((el) => el.getAttribute("data-task-key")))
  expect(keys.indexOf(k(22))).toBe(keys.indexOf(k(16)) + 1)
  await expect(todo.last()).toContainText("Write the filter docs")
})

test("CEL-52: the panel folds to a rail counting the filters on, ⌘⇧F opens and folds it, sections fold, and a reload keeps it all", async ({ page, cello, baseURL }) => {
  const { key } = await seed(cello, baseURL!, "RAIL")
  await page.goto(`/${key}/issues?label=bug,agents&who=nobody`)
  await expectShown(boardCards(page), key, [16, 17])

  await caption(page, "Bugs in agents that nobody is on: 3 filters. Hide the panel: it folds to a rail")
  await panel(page).getByRole("button", { name: "Hide filters" }).click()
  await expect(rail(page)).toBeVisible()
  await expect(openPanel(page)).toHaveCount(0)
  await expect(rail(page).locator("[data-filter-count]")).toHaveText("3")
  await expect(rail(page).locator('[data-rail-facet="labels"]')).toHaveAttribute("data-active", "")
  await expect(rail(page).locator('[data-rail-facet="holder"]')).toHaveAttribute("data-active", "")
  await expect(rail(page).locator('[data-rail-facet="priority"]')).not.toHaveAttribute("data-active")
  // The filter still applies with the panel folded.
  await expectShown(boardCards(page), key, [16, 17])

  await caption(page, "⌘⇧F opens the panel again…")
  await page.keyboard.press("ControlOrMeta+Shift+F")
  await expect(openPanel(page)).toBeVisible()
  await expect(rail(page)).toHaveCount(0)
  await caption(page, "…and folds it back to the rail")
  await page.keyboard.press("ControlOrMeta+Shift+F")
  await expect(rail(page)).toBeVisible()
  await caption(page, "A click on any icon in the rail opens it too")
  await rail(page).locator('[data-rail-facet="labels"]').click()
  await expect(openPanel(page)).toBeVisible()

  await caption(page, "Fold Area and Working on it: each heading still says what's picked there")
  await fold(page, "Area")
  await fold(page, "Working on it")
  await expect(panel(page).locator('[data-fold="Area"] [data-fold-summary]')).toHaveText("agents")
  await expect(panel(page).locator('[data-fold="Working on it"] [data-fold-summary]')).toHaveText("Nobody")
  await expect(option(page, "label-agents")).toHaveCount(0)
  await expect(option(page, "who-nobody")).toHaveCount(0)
  await expect(option(page, "label-bug")).toBeVisible()

  await caption(page, "Fold the panel to the rail and reload: the rail, its count and the filter are kept")
  await page.keyboard.press("ControlOrMeta+Shift+F")
  await expect(rail(page)).toBeVisible()
  await page.reload()
  await expect(rail(page).locator("[data-filter-count]")).toHaveText("3")
  await expectShown(boardCards(page), key, [16, 17])

  await caption(page, "Open it: Area and Working on it are still folded")
  await rail(page).getByRole("button", { name: "Show filters" }).click()
  await expect(panel(page).locator('[data-fold="Area"]')).toHaveAttribute("aria-expanded", "false")
  await expect(panel(page).locator('[data-fold="Working on it"]')).toHaveAttribute("aria-expanded", "false")
  await expect(panel(page).locator('[data-fold="Kind"]')).toHaveAttribute("aria-expanded", "true")

  await caption(page, "Unfold Area: its labels are back, agents still ticked")
  await panel(page).locator('[data-fold="Area"]').click()
  await expect(option(page, "label-agents")).toHaveAttribute("aria-checked", "true")
  await expect(panel(page).locator('[data-fold="Area"] [data-fold-summary]')).toHaveCount(0)
})

test("CEL-113: filter by milestone: the Milestone section lists the open milestones in order and No milestone with counts; it filters the board and the list, combines with labels, and a reload keeps it", async ({ page, cello, baseURL, browser }) => {
  const { key } = await seed(cello, baseURL!, "MLF")
  const rows = panel(page).locator('[data-facet="milestones"] [data-facet-option]')
  await page.goto(`/${key}/issues`)
  await expectShown(boardCards(page), key, Array.from({ length: 30 }, (_, i) => i + 1))

  await caption(page, "The Milestone section, under Label: M2, M3, M4 in their order, then No milestone, each with how many tasks it would show")
  await panel(page).locator('[data-facet="milestones"]').evaluate((el) => el.scrollIntoView({ block: "center" }))
  await expect(rows).toHaveText(["M22", "M31", "M40", "No milestone27"])

  await caption(page, "Tick M2: only its two tasks stay, and the address carries the filter")
  await tick(page, "milestone-m2", "true")
  await expectShown(boardCards(page), key, [2, 18])
  await expect(panel(page).locator("[data-filter-result]")).toHaveText("2 of 30 tasks")
  await expect(page).toHaveURL(/milestone=m2/)

  await caption(page, "Tick M3 too: any picked milestone matches, so M2's and M3's tasks")
  await tick(page, "milestone-m3", "true")
  await expectShown(boardCards(page), key, [2, 18, 23])

  await caption(page, "Tick the feature label: milestones and labels combine, and M3 now counts 0 (its task is a chore)")
  await tick(page, "label-feature", "true")
  await expectShown(boardCards(page), key, [2, 18])
  await expect(option(page, "milestone-m3").locator("[data-facet-count]")).toHaveText("0")
  await expect(option(page, "milestone-none").locator("[data-facet-count]")).toHaveText("15")

  await caption(page, "Reload: the milestone filter stays, still ticked")
  await page.reload()
  await expectShown(boardCards(page), key, [2, 18])
  await expect(option(page, "milestone-m2")).toHaveAttribute("aria-checked", "true")
  await expect(option(page, "milestone-m3")).toHaveAttribute("aria-checked", "true")

  await caption(page, "Switch to the list: the same filter")
  await page.getByRole("button", { name: /^Display/ }).click()
  await page.getByRole("radio", { name: "List" }).click()
  await page.keyboard.press("Escape")
  await expectShown(listRows(page), key, [2, 18])

  await caption(page, "Clear all, then tick No milestone: the 27 tasks without a milestone")
  await panel(page).getByRole("button", { name: "Clear all" }).click()
  await expectShown(listRows(page), key, Array.from({ length: 30 }, (_, i) => i + 1))
  await tick(page, "milestone-none", "true")
  await expect(listRows(page)).toHaveCount(27)
  await expect(listRows(page).filter({ hasText: "Release management" })).toHaveCount(0)

  await caption(page, "Fold the Milestone section: its heading still names what's picked")
  await fold(page, "Milestone")
  await expect(panel(page).locator('[data-fold="Milestone"] [data-fold-summary]')).toHaveText("No milestone")

  // The panel with the Milestone section and M2 ticked, light and dark, in unrecorded windows.
  for (const colorScheme of ["light", "dark"] as const) {
    const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 }, colorScheme })
    await context.addInitScript(() => localStorage.setItem("cello:agent-cursors", "off"))
    const shotPage = await context.newPage()
    await shotPage.goto(`/${key}/issues?milestone=m2`)
    await expectShown(boardCards(shotPage), key, [2, 18])
    await panel(shotPage).locator('[data-facet="milestones"]').evaluate((el) => el.scrollIntoView({ block: "center" }))
    await shotPage.mouse.move(1430, 890)
    await shotPage.screenshot({ path: path.join(SHOTS, `cel-113-filter-milestone-${colorScheme}.png`) })
    await context.close()
  }
})

test("CEL-52: screenshots of the filter panel, light and dark", async ({ browser, cello, baseURL }) => {
  const { key } = await seed(cello, baseURL!, "SHOT")
  for (const colorScheme of ["light", "dark"] as const) {
    // Its own unrecorded window, so the screenshots show no test cursor or captions.
    const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 }, colorScheme })
    await context.addInitScript(() => localStorage.setItem("cello:agent-cursors", "off"))
    const page = await context.newPage()
    const shot = async (name: string) => {
      // No row left hovered by the last click.
      await page.mouse.move(1430, 890)
      await page.screenshot({ path: path.join(SHOTS, `cel-52-${name}-${colorScheme}.png`) })
    }

    await page.goto(`/${key}/issues`)
    await expectShown(boardCards(page), key, Array.from({ length: 30 }, (_, i) => i + 1))
    await shot("board")

    await page.goto(`/${key}/issues?label=bug,agents`)
    await expectShown(boardCards(page), key, [16, 17])
    await shot("bugs-in-agents")

    await page.goto(`/${key}/issues?label=desktop`)
    await panel(page).getByRole("button", { name: "Show all 15" }).click()
    await expect(panel(page).locator('[data-label-group="area"] [data-facet-option]')).toHaveCount(15)
    await shot("show-all-areas")

    await page.goto(`/${key}/issues?session=${await sessionId(cello, "8a41c9e2-filters")}`)
    await expectShown(boardCards(page), key, [26, 27])
    await expect(option(page, "session-8a41c9e2")).toHaveAttribute("aria-checked", "true")
    // Working on it at the top of the panel, so the sessions are in view.
    await panel(page).locator('[data-facet="holder"]').evaluate((el) => el.scrollIntoView({ block: "start" }))
    await shot("one-session")

    await page.goto(`/${key}/issues?layout=list&label=bug`)
    await expectShown(listRows(page), key, [12, 13, 14, 15, 16, 17])
    await shot("list-bugs")

    await page.goto(`/${key}/issues?label=bug,agents&who=nobody`)
    await expectShown(boardCards(page), key, [16, 17])
    await fold(page, "Area")
    await fold(page, "Working on it")
    await expect(panel(page).locator('[data-fold="Working on it"] [data-fold-summary]')).toHaveText("Nobody")
    await shot("folded-sections")
    await panel(page).getByRole("button", { name: "Hide filters" }).click()
    await expect(rail(page).locator("[data-filter-count]")).toHaveText("3")
    await shot("rail")
    await context.close()
  }
})

/** A session's id on the board, from its host's session id. */
async function sessionId(cello: PromiseClient, external: string) {
  const snapshot = await cello.run((c) => c["snapshot.get"]({}))
  return snapshot.sessions.find((s) => s.externalId === external)!.id
}
