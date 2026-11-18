// Settings: statuses, labels and workspaces, plus the board's hidden-columns strip.
// Status changes reach every project in a workspace, so those tests make a workspace of their own.
import type { Page } from "@playwright/test"
import {
  addTasks,
  caption,
  column,
  createProject,
  createProjectHere,
  expect,
  openNewWorkspace,
  projectLink,
  projectLinks,
  sidebarSettings,
  switchWorkspace,
  test,
  uniqueKey,
} from "./fixtures.ts"
import { expectLeftAligned } from "./packets.ts"

const statusRows = (page: Page) => page.getByRole("list", { name: "Statuses" }).locator("[data-status-row]")
const columnHeadings = (page: Page) => page.locator("section[data-column] h2")

test("settings: rename, reorder and hide a status; the board's columns follow", async ({ page }) => {
  const key = uniqueKey("STAT")
  await page.goto("/")
  await openNewWorkspace(page, `Statuses ${key}`)
  await createProjectHere(page, "Status test", key)
  await sidebarSettings(page).click()

  await caption(page, "Rename In Review to Reviewing")
  const name = page.getByLabel("In Review name")
  await name.fill("Reviewing")
  await name.press("Enter")
  await expect(statusRows(page).nth(4)).toHaveAttribute("data-status-row", "Reviewing")

  await caption(page, "Move Reviewing up twice, above In Progress")
  await page.getByRole("button", { name: "Move Reviewing up" }).click()
  await expect(statusRows(page).nth(3)).toHaveAttribute("data-status-row", "Reviewing")
  await page.getByRole("button", { name: "Move Reviewing up" }).click()
  const order = ["Backlog", "Todo", "Reviewing", "In Progress", "Needs input", "Done", "Canceled"]
  await expect(statusRows(page)).toHaveCount(order.length)
  for (const [i, status] of order.entries()) await expect(statusRows(page).nth(i)).toHaveAttribute("data-status-row", status)

  await caption(page, "Hide Todo")
  await page.getByRole("button", { name: "Hide Todo" }).click()
  await expect(page.locator('[data-status-row="Todo"]')).toContainText("Hidden")

  await caption(page, "The board shows Reviewing, In Progress and Done, in that order (Needs input is a column only when Display turns it on)")
  await projectLink(page, key).click()
  await expect(columnHeadings(page)).toHaveText(["Reviewing", "In Progress", "Done"])
})

test("hidden columns: hide a status in settings; it folds into the strip, and a click shows it again", async ({ page }) => {
  const key = uniqueKey("HIDE")
  await page.goto("/")
  await openNewWorkspace(page, `Hidden ${key}`)
  await createProjectHere(page, "Hidden columns test", key)
  await addTasks(page, "In Review", ["Check the release notes"])

  await caption(page, "Hide In Review in settings")
  await sidebarSettings(page).click()
  await page.getByRole("button", { name: "Hide In Review" }).click()
  await expect(page.locator('[data-status-row="In Review"]')).toContainText("Hidden")

  await caption(page, "In Review folds into the strip on the right, with its count")
  await projectLink(page, key).click()
  const strip = page.getByRole("complementary", { name: "Hidden columns" })
  await expect(column(page, "In Review")).toHaveCount(0)
  await expect(strip.getByRole("button", { name: /In Review/ })).toContainText("1")

  await caption(page, "Click it: the column opens with its card")
  await strip.getByRole("button", { name: /In Review/ }).click()
  await expect(column(page, "In Review").locator(`[data-task-key="${key}-1"]`)).toBeVisible()
  await expect(strip.getByRole("button", { name: /In Review/ })).toHaveCount(0)

  await caption(page, "Fold it again")
  await page.getByRole("button", { name: "Fold In Review" }).click()
  await expect(column(page, "In Review")).toHaveCount(0)
  await expect(strip.getByRole("button", { name: /In Review/ })).toBeVisible()
})

test("CEL-164: the main Settings has only global things", async ({ page }) => {
  await page.goto("/settings")
  await caption(page, "Statuses, Workspaces, Search and Builds: nothing per project")
  for (const name of ["Statuses", "Workspaces", "Search", "Builds"]) await expect(page.getByRole("region", { name, exact: true })).toBeVisible()
  // Each project's own, on its Settings tab (CEL-164).
  for (const name of ["Labels", "Testing", "Waking agents", "Merging"]) await expect(page.getByRole("region", { name, exact: true })).toHaveCount(0)
  await expect(page.getByRole("combobox", { name: /of project$/ })).toHaveCount(0)
})

test("CEL-164: the main Settings column starts at the left edge, at any width", async ({ page }) => {
  await page.goto("/settings")
  const scroller = page.locator("[data-settings-scroller]")
  const first = page.getByRole("region", { name: "Statuses", exact: true })
  for (const width of [1440, 1100, 900]) {
    await caption(page, `${width} px wide: Settings starts at the left edge`)
    await page.setViewportSize({ width, height: 900 })
    await expectLeftAligned(scroller, first)
  }
})

test("workspaces: create a second workspace and switch; each lists its own projects", async ({ page }) => {
  const key = uniqueKey("HOME")
  const side = uniqueKey("SIDE")
  await createProject(page, "Home project", key)

  await openNewWorkspace(page, `Side projects ${side}`)
  await caption(page, "The new workspace starts empty")
  await expect(page.getByText("No projects yet")).toBeVisible()
  await expect(projectLinks(page)).toHaveCount(0)
  await createProjectHere(page, "Side app", side)
  await expect(projectLinks(page)).toHaveText(["Side app"])
  await expect(column(page, "Todo")).toBeVisible()

  await caption(page, "Switch back to Personal")
  await switchWorkspace(page, "Personal")
  await expect(projectLink(page, key)).toBeVisible()
  await expect(projectLink(page, side)).toHaveCount(0)
  await projectLink(page, key).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/issues$`))
})
