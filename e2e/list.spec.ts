import type { Page } from "@playwright/test"
import { caption, contentAnimations, createProject, expect, test, uniqueKey } from "./fixtures.ts"

const list = (page: Page) => page.locator('[data-layout="list"]')
const group = (page: Page, name: string) => list(page).locator(`section[data-group="${name}"]`)
const row = (page: Page, key: string) => list(page).locator(`[data-task-key="${key}"]`)

/** Picks a layout in the Display popover, then closes it. */
async function pickLayout(page: Page, layout: "List" | "Board") {
  await page.getByRole("button", { name: "Display" }).click()
  await page.getByRole("radio", { name: layout }).click()
  await expect(page.getByRole("radio", { name: layout })).toBeChecked()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Display options" })).toBeHidden()
}

/** Adds a task with a group's `+`, typing the title and pressing Enter. */
async function addTask(page: Page, status: string, title: string) {
  await page.getByRole("button", { name: `New task in ${status}` }).click()
  const input = page.getByLabel(`New task title in ${status}`)
  await input.fill(title)
  await input.press("Enter")
  await expect(group(page, status).getByText(title, { exact: true })).toBeVisible()
  await input.press("Escape")
}

test("list: switch to List, add tasks from a group's +, open a row's panel, use the arrow keys, reload: the list stays", async ({ page }) => {
  const key = uniqueKey("LIST")
  await createProject(page, "List test", key)

  await caption(page, "Display → List")
  await pickLayout(page, "List")
  await expect(page).toHaveURL(new RegExp(`/${key}/issues\\?layout=list$`))
  await expect(list(page)).toBeVisible()

  await caption(page, "Groups follow the status order; hidden statuses fold at the end")
  const groups = await list(page).locator("section[data-group]").evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset["group"]))
  // Needs input folds into In Progress unless Display turns its column on (CEL-47).
  expect(groups).toEqual(["Todo", "In Progress", "In Review", "Done", "Backlog", "Canceled"])
  await expect(group(page, "Todo").getByRole("button", { name: "Todo", exact: true })).toHaveAttribute("aria-expanded", "true")
  await expect(group(page, "Backlog").getByRole("button", { name: "Backlog", exact: true })).toHaveAttribute("aria-expanded", "false")

  await caption(page, "Add a task with Todo's +")
  await addTask(page, "Todo", "Sketch the list rows")
  await expect(group(page, "Todo").getByLabel("1 tasks")).toBeVisible()
  await caption(page, "And one with In Progress's +")
  await addTask(page, "In Progress", "Wire the Display popover")

  await caption(page, `Click ${key}-1: its panel opens beside the list`)
  await row(page, `${key}-1`).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/1\\?layout=list$`))
  const panel1 = page.getByRole("complementary", { name: `${key}-1 details` })
  await expect(panel1.getByLabel("Title")).toHaveValue("Sketch the list rows")
  await expect(list(page)).toBeVisible()
  await expect(row(page, `${key}-1`)).toHaveAttribute("aria-current", "page")

  await caption(page, `↓ moves the focus to ${key}-2, Enter opens it`)
  await expect(row(page, `${key}-1`)).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await expect(row(page, `${key}-2`)).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(new RegExp(`/${key}/2\\?layout=list$`))
  const panel2 = page.getByRole("complementary", { name: `${key}-2 details` })
  await expect(panel2.getByLabel("Title")).toHaveValue("Wire the Display popover")
  await caption(page, "↑ goes back up")
  await page.keyboard.press("ArrowUp")
  await expect(row(page, `${key}-1`)).toBeFocused()

  await caption(page, "Reload: still the list, with the panel open")
  await page.reload()
  await expect(list(page)).toBeVisible()
  await expect(panel2.getByLabel("Title")).toHaveValue("Wire the Display popover")
  await expect(row(page, `${key}-2`)).toBeVisible()
  // An idle list runs no animations.
  expect(await contentAnimations(page)).toBe(0)
  await page.getByRole("button", { name: "Display" }).click()
  await expect(page.getByRole("radio", { name: "List" })).toBeChecked()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Display options" })).toBeHidden()

  await caption(page, "Closing the panel keeps the list")
  await panel2.getByRole("button", { name: "Close task" }).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/issues\\?layout=list$`))
  await expect(list(page)).toBeVisible()

  await caption(page, "Display → Board")
  await pickLayout(page, "Board")
  await expect(page).toHaveURL(new RegExp(`/${key}/issues$`))
  await expect(page.locator('section[data-column="Todo"]').locator(`[data-task-key="${key}-1"]`)).toBeVisible()
  await caption(page, "Back on the board")
})

test("list: a task added in tab 1 shows in tab 2's list, and a status change moves its row there", async ({ context, page }) => {
  const key = uniqueKey("LSYNC")
  await createProject(page, "List sync test", key)
  await page.goto(`/${key}/issues?layout=list`)
  await expect(list(page)).toBeVisible()

  const other = await context.newPage()
  await other.goto(`/${key}/issues?layout=list`)
  await expect(list(other)).toBeVisible()
  await caption(other, "Tab 2: watching the list")

  await caption(page, "Tab 1: add a task with Todo's +")
  await addTask(page, "Todo", "Group rows by status")
  await expect(group(other, "Todo").locator(`[data-task-key="${key}-1"]`)).toBeVisible()
  await caption(other, `Tab 2: ${key}-1 arrived without a reload`)

  await caption(page, "Tab 1: set its status to In Review in the panel")
  await row(page, `${key}-1`).click()
  const panel = page.getByRole("complementary", { name: `${key}-1 details` })
  await panel.getByRole("combobox", { name: "Status" }).click()
  await page.getByRole("option", { name: "In Review" }).click()
  await expect(group(page, "In Review").locator(`[data-task-key="${key}-1"]`)).toBeVisible()

  await expect(group(other, "In Review").locator(`[data-task-key="${key}-1"]`)).toBeVisible()
  await expect(group(other, "Todo").locator(`[data-task-key="${key}-1"]`)).toHaveCount(0)
  await expect(group(other, "In Review").getByLabel("1 tasks")).toBeVisible()
  await caption(other, `Tab 2: ${key}-1 moved to In Review`)
})
