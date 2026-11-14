// The task panel's labels, parent and comments, against the real server.
import { addTasks, caption, card, createProject, expect, seedLabels, taskPanel, test, uniqueKey } from "./fixtures.ts"

test("labels: add two labels in the task panel and remove one; the card shows the labels left", async ({ page, cello }) => {
  const key = uniqueKey("LABL")
  await seedLabels(cello, [{ name: "Frontend", color: "#4ea7fc" }, { name: "Bug", color: "#eb5757" }])
  await createProject(page, "Labels test", key)
  await addTasks(page, "Todo", ["Fix the login form"])
  await card(page, `${key}-1`).click()
  const panel = taskPanel(page, `${key}-1`)
  const chips = card(page, `${key}-1`).locator("[data-card-chips]")
  const labels = panel.getByRole("combobox", { name: "Labels", exact: true })

  await caption(page, "Add the labels Frontend and Bug")
  await labels.click()
  await page.getByRole("option", { name: "Frontend" }).click()
  await page.getByRole("option", { name: "Bug" }).click()
  await page.keyboard.press("Escape")
  await expect(labels).toContainText("Frontend")
  await expect(labels).toContainText("Bug")
  await expect(chips).toContainText("Frontend")
  await expect(chips).toContainText("Bug")

  await caption(page, "Remove Bug")
  await labels.click()
  await page.getByRole("option", { name: "Bug" }).click()
  await page.keyboard.press("Escape")
  await expect(chips).toContainText("Frontend")
  await expect(chips).not.toContainText("Bug")

  await caption(page, "Reload: the card still shows Frontend only")
  await page.reload()
  await expect(chips).toHaveText("Frontend")
  await expect(labels).toHaveText("Frontend")
})

test("parent: set a parent in the task panel; the card and the panel show the parent breadcrumb", async ({ page }) => {
  const key = uniqueKey("PRNT")
  await createProject(page, "Parent test", key)
  await addTasks(page, "Todo", ["Plan the release", "Write the changelog"])

  await caption(page, `Open ${key}-2 and make ${key}-1 its parent`)
  await card(page, `${key}-2`).click()
  const panel = taskPanel(page, `${key}-2`)
  await panel.getByRole("combobox", { name: "Parent", exact: true }).click()
  await page.getByRole("option", { name: `${key}-1 Plan the release` }).click()
  await expect(panel.getByRole("combobox", { name: "Parent", exact: true })).toContainText(`${key}-1 Plan the release`)

  await caption(page, "The card shows its parent after its key")
  await expect(card(page, `${key}-2`).locator("[data-card-parent]")).toHaveText("Plan the release")
  await expect(card(page, `${key}-1`).locator("[data-card-parent]")).toHaveCount(0)

  await caption(page, "Reload, then follow the panel's parent link")
  await page.reload()
  await expect(card(page, `${key}-2`).locator("[data-card-parent]")).toHaveText("Plan the release")
  await panel.getByRole("link", { name: `Parent: ${key}-1 Plan the release` }).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/1$`))
  await expect(taskPanel(page, `${key}-1`).getByLabel("Title")).toHaveValue("Plan the release")
})

test("comments: edit one comment and delete another; both changes survive a reload", async ({ page }) => {
  const key = uniqueKey("CMNT")
  await createProject(page, "Comments test", key)
  await addTasks(page, "Todo", ["Write the onboarding copy"])
  await card(page, `${key}-1`).click()
  const panel = taskPanel(page, `${key}-1`)
  const comments = panel.locator("[data-comment-id]")
  const comment = (text: string) => comments.filter({ hasText: text })

  await caption(page, "Add two comments")
  for (const body of ["First draft of the copy", "Ignore this one"]) {
    await panel.getByLabel("New comment").fill(body)
    await panel.getByRole("button", { name: "Comment", exact: true }).click()
    await expect(comment(body)).toBeVisible()
  }

  await caption(page, "Edit the first comment")
  await comment("First draft").getByRole("button", { name: "Comment actions" }).click()
  await page.getByRole("menuitem", { name: "Edit" }).click()
  await panel.getByLabel("Edit comment").fill("Final copy is in **Figma**")
  await panel.getByRole("button", { name: "Save" }).click()
  await expect(comment("Final copy is in Figma")).toContainText("edited")
  await expect(comment("Final copy is in Figma").locator("strong")).toHaveText("Figma")

  await caption(page, "Delete the second comment")
  await expect(page.getByRole("menu")).toHaveCount(0) // the first menu has finished closing
  await comment("Ignore this one").getByRole("button", { name: "Comment actions" }).click()
  await page.getByRole("menuitem", { name: "Delete" }).click()
  await expect(comment("Ignore this one")).toHaveCount(0)

  await caption(page, "Reload: one edited comment is left")
  await page.reload()
  await expect(comments).toHaveCount(1)
  await expect(comments).toContainText("Final copy is in Figma")
  await expect(comments).toContainText("edited")
})
