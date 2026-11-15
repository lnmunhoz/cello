// CEL-21: the Display popover's Ordering row sorts board columns and list groups; the board keeps
// its unfolded hidden columns through a reload.
import * as path from "node:path"
import type { Locator, Page } from "@playwright/test"
import type { PromiseClient } from "../packages/client/test/support/promiseClient.ts"
import { caption, card, column, defaultWorkspace, dragCard, expect, newCommandId, seedProject, test, uniqueKey } from "./fixtures.ts"
import { SHOTS, WEB_URL } from "./packets.ts"

const display = (page: Page) => page.getByRole("button", { name: /^Display/ })

/** Picks an ordering in the Display popover, then closes it. */
async function pickOrdering(page: Page, ordering: string) {
  await display(page).click()
  await page.getByRole("combobox", { name: "Ordering", exact: true }).click()
  await page.getByRole("option", { name: ordering, exact: true }).click()
  await expect(page.getByRole("combobox", { name: "Ordering", exact: true })).toContainText(ordering)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Display options" })).toBeHidden()
}

/** Picks a layout in the Display popover, then closes it. */
async function pickLayout(page: Page, layout: "List" | "Board") {
  await display(page).click()
  await page.getByRole("radio", { name: layout }).click()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Display options" })).toBeHidden()
}

/** Expects exactly these cards or rows, top to bottom. */
async function expectKeys(items: Locator, keys: ReadonlyArray<string>) {
  await expect(items).toHaveCount(keys.length)
  for (const [i, key] of keys.entries()) await expect(items.nth(i)).toHaveAttribute("data-task-key", key)
}

/** The cards in a board column. */
const cardsIn = (page: Page, status: string) => column(page, status).locator("[data-task-key]")

/** The rows in a list group. */
const rowsIn = (page: Page, status: string) => page.locator(`[data-layout="list"] section[data-group="${status}"] [data-task-key]`)

/** Three Todo tasks, made one after another: the oldest is low priority and due last, the middle one urgent with no due date, the newest has no priority and is due first. */
async function seedTodo(cello: PromiseClient, key: string) {
  const project = await seedProject(cello, "Ordering test", key)
  const { statuses } = await defaultWorkspace(cello)
  const make = (title: string, statusId: string, fields: { priority?: 0 | 1 | 2 | 3 | 4; dueDate?: string }) =>
    cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title, statusId, ...fields }))
  await make("Oldest · low · due Dec 20", statuses["Todo"]!.id, { priority: 4, dueDate: "2026-12-20" })
  await make("Middle · urgent · no due date", statuses["Todo"]!.id, { priority: 1 })
  await make("Newest · no priority · due Nov 30", statuses["Todo"]!.id, { dueDate: "2026-11-30" })
  return { project, statuses, make }
}

test("ordering: Display sorts each column by newest, priority or due date; board and list keep their own after a reload", async ({ page, cello }) => {
  const key = uniqueKey("SORT")
  await seedTodo(cello, key)
  await page.goto(`/${key}/issues`)
  await expect(column(page, "Todo").locator("[data-task-key]")).toHaveCount(3)

  await caption(page, "Manual: the drag order, oldest at the top")
  await expectKeys(cardsIn(page, "Todo"), [`${key}-1`, `${key}-2`, `${key}-3`])

  await caption(page, "Display → Ordering → Newest first", { url: true })
  await pickOrdering(page, "Newest first")
  await expect(page).toHaveURL(new RegExp(`/${key}/issues\\?order=newest$`))
  await expect(display(page)).toContainText("Newest first")
  await expectKeys(cardsIn(page, "Todo"), [`${key}-3`, `${key}-2`, `${key}-1`])

  await caption(page, "Priority: urgent first, no priority last")
  await pickOrdering(page, "Priority")
  await expect(display(page)).toContainText("Priority")
  await expectKeys(cardsIn(page, "Todo"), [`${key}-2`, `${key}-1`, `${key}-3`])

  await caption(page, "Due date: the soonest first, no due date last")
  await pickOrdering(page, "Due date")
  await expectKeys(cardsIn(page, "Todo"), [`${key}-3`, `${key}-1`, `${key}-2`])

  await caption(page, "Newest first, then add a task with Todo's +: it lands at the top")
  await pickOrdering(page, "Newest first")
  await page.getByRole("button", { name: "New task in Todo" }).click()
  const input = page.getByLabel("New task title in Todo")
  await input.fill("Brand new task")
  await input.press("Enter")
  await expect(card(page, `${key}-4`)).toBeVisible()
  await input.press("Escape")
  await expectKeys(cardsIn(page, "Todo"), [`${key}-4`, `${key}-3`, `${key}-2`, `${key}-1`])

  await caption(page, "Open the project from a plain link: this device remembers Newest first", { url: true })
  await page.goto(`/${key}/issues`)
  await expect(display(page)).toContainText("Newest first")
  await expectKeys(cardsIn(page, "Todo"), [`${key}-4`, `${key}-3`, `${key}-2`, `${key}-1`])

  await caption(page, "The list has its own ordering: still Manual")
  await pickLayout(page, "List")
  await expect(page).toHaveURL(new RegExp(`/${key}/issues\\?layout=list$`))
  await expect(display(page)).not.toContainText("Newest first")
  await expectKeys(rowsIn(page, "Todo"), [`${key}-1`, `${key}-2`, `${key}-3`, `${key}-4`])

  await caption(page, "List → Priority")
  await pickOrdering(page, "Priority")
  await expectKeys(rowsIn(page, "Todo"), [`${key}-2`, `${key}-1`, `${key}-3`, `${key}-4`])

  await caption(page, "Reload: the list keeps Priority", { url: true })
  await page.reload()
  await expect(display(page)).toContainText("Priority")
  await expectKeys(rowsIn(page, "Todo"), [`${key}-2`, `${key}-1`, `${key}-3`, `${key}-4`])

  await caption(page, "Back to the board: Newest first again")
  await pickLayout(page, "Board")
  await expect(display(page)).toContainText("Newest first")
  await expectKeys(cardsIn(page, "Todo"), [`${key}-4`, `${key}-3`, `${key}-2`, `${key}-1`])

  await caption(page, "Manual: the drag order is back, untouched")
  await pickOrdering(page, "Manual")
  await expect(page).toHaveURL(new RegExp(`/${key}/issues$`))
  await expect(display(page)).toHaveText("Display")
  await expectKeys(cardsIn(page, "Todo"), [`${key}-1`, `${key}-2`, `${key}-3`, `${key}-4`])
})

test("ordering: under a sorted order a drag changes the status only, and the card lands where the order puts it", async ({ page, cello }) => {
  const key = uniqueKey("SDRG")
  const { statuses, make } = await seedTodo(cello, key)
  await make("Already started · urgent", statuses["In Progress"]!.id, { priority: 1 })
  await make("Already started · no priority", statuses["In Progress"]!.id, {})
  await page.goto(`/${key}/issues`)
  await expect(column(page, "In Progress").locator("[data-task-key]")).toHaveCount(2)

  await caption(page, "Display → Ordering → Priority")
  await pickOrdering(page, "Priority")
  await expectKeys(cardsIn(page, "Todo"), [`${key}-2`, `${key}-1`, `${key}-3`])
  await expect(column(page, "Todo").locator('[role="list"]')).toHaveAttribute("title", /Sorted by Priority\. Dragging changes the status only/)

  await caption(page, `Drag ${key}-3 to the top of Todo: the order keeps it last`)
  await dragCard(page, `${key}-3`, "Todo")
  await expectKeys(cardsIn(page, "Todo"), [`${key}-2`, `${key}-1`, `${key}-3`])

  await caption(page, `Drag ${key}-1 (low) to the top of In Progress: it moves, and sorts between urgent and no priority`)
  await dragCard(page, `${key}-1`, "In Progress")
  await expect(column(page, "In Progress").locator(`[data-task-key="${key}-1"]`)).toBeVisible()
  await expectKeys(cardsIn(page, "In Progress"), [`${key}-4`, `${key}-1`, `${key}-5`])
  await expectKeys(cardsIn(page, "Todo"), [`${key}-2`, `${key}-3`])

  await caption(page, "Reload, then Manual: the drop changed the status, not the drag order")
  await page.reload()
  await expectKeys(cardsIn(page, "In Progress"), [`${key}-4`, `${key}-1`, `${key}-5`])
  await pickOrdering(page, "Manual")
  await expectKeys(cardsIn(page, "Todo"), [`${key}-2`, `${key}-3`])
  // Moved under a sorted order, it went to the end of In Progress's drag order.
  await expectKeys(cardsIn(page, "In Progress"), [`${key}-4`, `${key}-5`, `${key}-1`])
})

test("board: an unfolded hidden column stays unfolded after a reload", async ({ page, cello }) => {
  const key = uniqueKey("FOLD")
  await seedProject(cello, "Fold test", key)
  await page.goto(`/${key}/issues`)
  const hidden = page.getByRole("complementary", { name: "Hidden columns" })

  await caption(page, "Unfold Backlog from the hidden columns")
  await hidden.getByRole("button", { name: /Backlog/ }).click()
  await expect(column(page, "Backlog")).toBeVisible()

  await caption(page, "Reload: Backlog is still unfolded")
  await page.reload()
  await expect(column(page, "Backlog")).toBeVisible()
  await expect(hidden.getByRole("button", { name: /Backlog/ })).toHaveCount(0)

  await caption(page, "Fold it again; a reload keeps it folded")
  await page.getByRole("button", { name: "Fold Backlog" }).click()
  await page.reload()
  await expect(hidden.getByRole("button", { name: /Backlog/ })).toBeVisible()
  await expect(column(page, "Backlog")).toHaveCount(0)
})

test("ordering: screenshots of the Display popover over a board sorted by priority, light and dark", async ({ browser, cello }) => {
  const key = uniqueKey("SHOT")
  await seedTodo(cello, key)
  for (const colorScheme of ["light", "dark"] as const) {
    // Its own unrecorded window, so the screenshots show no test cursor or captions.
    const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 }, colorScheme })
    const page = await context.newPage()
    await page.goto(`/${key}/issues?order=priority`)
    await expectKeys(cardsIn(page, "Todo"), [`${key}-2`, `${key}-1`, `${key}-3`])
    await display(page).click()
    const ordering = page.getByRole("combobox", { name: "Ordering", exact: true })
    await expect(ordering).toContainText("Priority")
    await page.screenshot({ path: path.join(SHOTS, `display-ordering-${colorScheme}.png`) })
    await ordering.click()
    await expect(page.getByRole("option", { name: "Last updated", exact: true })).toBeVisible()
    await page.screenshot({ path: path.join(SHOTS, `display-ordering-options-${colorScheme}.png`) })
    await context.close()
  }
})
