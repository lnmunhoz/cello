// CEL-164: a project's settings live on its own Settings tab, after Activity: its Labels, Testing,
// Waking agents and Merging, with no project picker (the page is the project's). The main Settings
// keeps only global things (e2e/settings.spec.ts). Stills go to e2e/videos/cel-164-*.
import * as path from "node:path"
import type { Page } from "@playwright/test"
import { caption, expect, seedLabels, seedProject, test, uniqueKey } from "./fixtures.ts"
import { SHOTS } from "./packets.ts"

/** Light and dark stills of the whole window, without the video's cursor and captions. */
async function stills(page: Page, name: string) {
  await page.mouse.move(5, 5)
  const overlay = (shown: boolean) => page.evaluate((v) => document.getElementById("e2e-layer")?.style.setProperty("visibility", v), shown ? "visible" : "hidden")
  await overlay(false)
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await page.screenshot({ path: path.join(SHOTS, `cel-164-${name}-${theme}.png`) })
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"))
  await overlay(true)
}

test("CEL-164: a project's Settings tab, after Activity, holds its Labels, Testing, Waking agents and Merging, with no project picker", async ({ page, cello }) => {
  const key = uniqueKey("PSA")
  const otherKey = uniqueKey("PSB")
  await seedProject(cello, "Project settings A", key)
  const other = await seedProject(cello, "Project settings B", otherKey)
  await seedLabels(cello, other.id, [{ name: `Theirs ${key}`, color: "#8d7b68" }])
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/${key}/issues`)

  await caption(page, "The project's tabs end with Settings, after Activity")
  const tab = page.getByRole("link", { name: "Settings", exact: true }).and(page.locator(`[href="/${key}/settings"]`))
  await expect(page.getByRole("link", { name: "Activity", exact: true }).and(page.locator(`[href="/${key}/activity"]`))).toBeVisible()
  await expect(tab).toBeVisible()
  expect(
    await page.locator(`a[href^="/${key}/"]`).evaluateAll((els) =>
      els.map((e) => e.textContent?.trim()).filter((t) => ["Overview", "Issues", "Milestones", "Docs", "Activity", "Settings"].includes(t ?? "")),
    ),
  ).toEqual(["Overview", "Issues", "Milestones", "Docs", "Activity", "Settings"])

  await caption(page, "Click Settings: this project's Labels, Testing, Waking agents and Merging, no project picker")
  await tab.click()
  await expect(page).toHaveURL(new RegExp(`/${key}/settings$`))
  await expect(tab).toHaveAttribute("data-status", "active")
  for (const name of ["Labels", "Testing", "Waking agents", "Merging"]) await expect(page.getByRole("region", { name, exact: true })).toBeVisible()
  await expect(page.getByRole("combobox", { name: /of project$/ })).toHaveCount(0)

  await caption(page, "Create the labels Design and Docs")
  const labels = page.getByRole("list", { name: "Labels" }).locator(`[data-label-row$="${key}"]`)
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

  await caption(page, "The other project's Settings lists its own label, not this one's")
  await page.goto(`/${otherKey}/settings`)
  await expect(page.locator(`[data-label-row="Theirs ${key}"]`)).toBeVisible()
  await expect(labels).toHaveCount(1)
  await expect(page.locator(`[data-label-row="Design system ${key}"]`)).toHaveCount(0)
})

test("CEL-164: a draft in one project's Settings doesn't carry to another's", async ({ page, cello }) => {
  const key = uniqueKey("PSC")
  const otherKey = uniqueKey("PSD")
  await seedProject(cello, "Draft A", key)
  await seedProject(cello, "Draft B", otherKey)
  await page.goto(`/${key}/settings`)
  await page.getByLabel("New label name").fill("Half typed")
  await page.goto(`/${otherKey}/issues`)
  await page.getByRole("link", { name: "Settings", exact: true }).and(page.locator(`[href="/${otherKey}/settings"]`)).click()
  await expect(page.getByLabel("New label name")).toHaveValue("")
})

test("CEL-164: screens of a project's Settings and the main Settings", async ({ page, cello }) => {
  const key = uniqueKey("PSE")
  const project = await seedProject(cello, "Project settings", key)
  await seedLabels(cello, project.id, [
    { name: "feature", color: "#5a8f5a" },
    { name: "bug", color: "#c0584a" },
    { name: "docs", color: "#8d7b68" },
  ])
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/${key}/issues`)
  await caption(page, "Settings is the last tab")
  await page.getByRole("link", { name: "Settings", exact: true }).and(page.locator(`[href="/${key}/settings"]`)).click()
  await expect(page.getByRole("region", { name: "Merging" })).toBeVisible()
  await expect(page.locator('[data-label-row="feature"]')).toBeVisible()

  await caption(page, "Add a label")
  await page.getByLabel("New label name").fill("release")
  await page.getByRole("button", { name: "Add label" }).click()
  await expect(page.locator('[data-label-row="release"]')).toBeVisible()
  await expect(page.getByRole("region", { name: "Testing" }).getByRole("list", { name: "Testing profile" })).toBeVisible()

  await stills(page, "project-settings-top")
  await page.getByRole("region", { name: "Merging" }).scrollIntoViewIfNeeded()
  await stills(page, "project-settings-bottom")
  // A project without a repository gets all four sections too (this one has none).
  await page.getByRole("region", { name: "Testing" }).scrollIntoViewIfNeeded()
  await stills(page, "project-settings-no-repo")

  await page.goto("/settings")
  await expect(page.getByRole("region", { name: "Statuses" })).toBeVisible()
  await stills(page, "main-settings")
})
