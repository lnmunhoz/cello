import { addTasks, caption, card, createProject, expect, test, uniqueKey } from "./fixtures.ts"

test("18: create a task with a column's +, edit it in the panel, add a comment, reload: everything is still there", async ({ page }) => {
  const key = uniqueKey("TASK")
  await createProject(page, "Panel test", key)

  await caption(page, "Create a task with Todo's +")
  await addTasks(page, "Todo", ["Add dark mode toggle"])

  await caption(page, "Open it")
  await card(page, `${key}-1`).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/1$`))
  const panel = page.getByRole("complementary", { name: `${key}-1 details` })

  await caption(page, "Edit the title")
  const title = panel.getByLabel("Title")
  await title.fill("Add dark mode toggle in settings")
  await title.press("Enter")

  await caption(page, "Write a description in markdown, then preview it")
  await panel.getByLabel("Description", { exact: true }).fill("Users switch **light** and dark.\n\n- persists across sessions")
  await panel.getByRole("tab", { name: "Preview" }).click()
  await expect(panel.getByTestId("description-preview").locator("strong")).toHaveText("light")

  await caption(page, "Set priority and due date")
  await panel.getByRole("combobox", { name: "Priority" }).click()
  await page.getByRole("option", { name: "High" }).click()
  await expect(panel.getByRole("combobox", { name: "Priority" })).toContainText("High")
  await panel.getByLabel("Due date").fill("2026-12-01")

  await caption(page, "Add a comment")
  await panel.getByLabel("New comment").fill("Let's ship this with the **theme** tokens.")
  await panel.getByRole("button", { name: "Comment", exact: true }).click()
  await expect(panel.locator("[data-comment-id]")).toContainText("Let's ship this with the theme tokens.")
  await expect(card(page, `${key}-1`)).toContainText("Dec 1")

  await caption(page, "Reload")
  await page.reload()
  await expect(panel.getByLabel("Title")).toHaveValue("Add dark mode toggle in settings")
  await expect(panel.getByTestId("description-preview").locator("li")).toHaveText("persists across sessions")
  await expect(panel.getByRole("combobox", { name: "Priority" })).toContainText("High")
  await expect(panel.getByLabel("Due date")).toHaveValue("2026-12-01")
  await expect(panel.locator("[data-comment-id]")).toContainText("Let's ship this with the theme tokens.")
  await expect(panel.getByText(/created the task/)).toBeVisible()
  await caption(page, "Everything is still there after the reload")
})
