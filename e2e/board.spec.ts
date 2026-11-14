import { addTasks, caption, card, column, createProject, dragCard, expect, test, uniqueKey } from "./fixtures.ts"

test("17: drag a card in tab 1; it moves in tab 2", async ({ context, page }) => {
  const key = uniqueKey("DRAG")
  await createProject(page, "Drag test", key)
  await addTasks(page, "Todo", ["Wire the SQLite store", "Draft the card drawer"])

  const other = await context.newPage()
  await other.goto(`/${key}/issues`)
  await expect(card(other, `${key}-1`)).toBeVisible()

  await caption(page, `Tab 1: drag ${key}-1 to In Progress`)
  await caption(other, "Tab 2: watching")
  await dragCard(page, `${key}-1`, "In Progress")
  await expect(column(page, "In Progress").locator(`[data-task-key="${key}-1"]`)).toBeVisible()

  await caption(other, `Tab 2: ${key}-1 moved without a reload`)
  await expect(column(other, "In Progress").locator(`[data-task-key="${key}-1"]`)).toBeVisible()
  await expect(column(other, "Todo").locator(`[data-task-key="${key}-1"]`)).toHaveCount(0)
  await expect(column(other, "In Progress").getByLabel("1 tasks")).toBeVisible()
})

test("19: move a card with the keyboard; the move survives a reload", async ({ page }) => {
  const key = uniqueKey("KEYS")
  await createProject(page, "Keyboard test", key)
  await addTasks(page, "Todo", ["Fix due dates", "Polish theme tokens"])

  await caption(page, `Focus ${key}-1, Space to pick up, → to In Progress, Space to drop`)
  await card(page, `${key}-1`).focus()
  await page.keyboard.press("Space")
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("Space")
  await expect(column(page, "In Progress").locator(`[data-task-key="${key}-1"]`)).toBeVisible()
  await expect(card(page, `${key}-1`)).toBeFocused()

  await caption(page, "Reload")
  await page.reload()
  await expect(column(page, "In Progress").locator(`[data-task-key="${key}-1"]`)).toBeVisible()
  await expect(column(page, "Todo").locator(`[data-task-key="${key}-2"]`)).toBeVisible()
  // An idle board runs no animations.
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0)
  await caption(page, `${key}-1 is still in In Progress after the reload`)
})
