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
  seedLabels,
  seedProject,
  switchWorkspace,
  test,
  uniqueKey,
} from "./fixtures.ts"

const statusRows = (page: Page) => page.getByRole("list", { name: "Statuses" }).locator("[data-status-row]")
const columnHeadings = (page: Page) => page.locator("section[data-column] h2")

test("settings: rename, reorder and hide a status; the board's columns follow", async ({ page }) => {
  const key = uniqueKey("STAT")
  await page.goto("/")
  await openNewWorkspace(page, `Statuses ${key}`)
  await createProjectHere(page, "Status test", key)
  await page.getByRole("link", { name: "Settings" }).click()

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
  await page.getByRole("link", { name: "Settings" }).click()
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

test("settings: create, rename and archive a project's label; the changes survive a reload; another project's labels are its own (CEL-80)", async ({ page, cello }) => {
  const key = uniqueKey("LBST")
  const otherKey = uniqueKey("LBSO")
  await seedProject(cello, "Label owner A", key)
  const other = await seedProject(cello, "Label owner B", otherKey)
  await seedLabels(cello, other.id, [{ name: `Theirs ${key}`, color: "#8d7b68" }])
  const labels = page.getByRole("list", { name: "Labels" }).locator(`[data-label-row$="${key}"]`)
  await page.goto(`/settings?project=${key}`)
  await expect(page.getByRole("combobox", { name: "Labels of project" })).toContainText(`Label owner A (${key})`)
  await expect(page.locator(`[data-label-row="Theirs ${key}"]`)).toHaveCount(0)

  await caption(page, "Create the labels Design and Docs")
  for (const name of [`Design ${key}`, `Docs ${key}`]) {
    await page.getByLabel("New label name").fill(name)
    await page.getByRole("button", { name: "Add label" }).click()
    await expect(page.locator(`[data-label-row="${name}"]`)).toBeVisible()
  }

  await caption(page, "Rename Design to Design system")
  const name = page.getByLabel(`Design ${key} name`)
  await name.fill(`Design system ${key}`)
  await name.press("Enter")
  await expect(page.locator(`[data-label-row="Design system ${key}"]`)).toBeVisible()

  await caption(page, "Archive Docs")
  await page.getByRole("button", { name: `Archive Docs ${key}` }).click()
  await expect(page.locator(`[data-label-row="Docs ${key}"]`)).toHaveCount(0)

  await caption(page, "Reload: Design system is listed, Docs is gone")
  await page.reload()
  await expect(page.locator(`[data-label-row="Design system ${key}"]`)).toBeVisible()
  await expect(labels).toHaveCount(1)

  await caption(page, "The other project lists its own label, not this one's")
  await page.getByRole("combobox", { name: "Labels of project" }).click()
  await page.getByRole("option", { name: `Label owner B (${otherKey})` }).click()
  await expect(page).toHaveURL(new RegExp(`project=${otherKey}`))
  await expect(page.locator(`[data-label-row="Theirs ${key}"]`)).toBeVisible()
  await expect(labels).toHaveCount(1)
  await expect(page.locator(`[data-label-row="Design system ${key}"]`)).toHaveCount(0)
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
