// CEL-52 scope (not merged as is): screenshots of the three ways to collapse the filter panel, picked
// with ?collapse=a|b|c|bc, light and dark, for evidence/cel-52-collapse/. Each option: open with
// filters on, collapsed with filters on (for C, two sections folded), and the whole board unfiltered.
import * as fs from "node:fs"
import * as path from "node:path"
import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { seedFilterBoard } from "./filterSeed.ts"
import { SHOTS, WEB_URL } from "./packets.ts"

const OUT = path.join(SHOTS, "cel-52-collapse")
/** Bugs in agents that nobody is working on: tasks 16 and 17. */
const FILTER = "label=bug,agents&who=nobody"

const panel = (page: Page) => page.getByRole("complementary", { name: "Filters" })
const cards = (page: Page) => page.locator("[data-agent-board] [data-task-key]")

test("CEL-52 scope: collapsing the filter panel, A rail, B button + chips, C folding sections, light and dark", async ({ browser, cello, baseURL }) => {
  test.setTimeout(240_000)
  fs.mkdirSync(OUT, { recursive: true })
  const { key } = await seedFilterBoard(cello, baseURL!, "FOLD")

  for (const scheme of ["light", "dark"] as const) {
    // Its own unrecorded window, so the stills show no test cursor or captions.
    const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 }, colorScheme: scheme })
    await context.addInitScript(() => localStorage.setItem("cello:agent-cursors", "off"))
    const page = await context.newPage()
    const shot = async (name: string) => {
      // No row left hovered, no tooltip left open by the last click.
      await page.mouse.move(1430, 890)
      await page.screenshot({ path: path.join(OUT, `${name}-${scheme}.png`) })
    }
    /** A fresh load with the panel open or closed, these sections folded, and no kept filter. */
    const go = async (search: string, shown: number, state: { open: boolean; folded?: ReadonlyArray<string> }) => {
      await page.goto(`/${key}/issues`)
      await page.evaluate(({ key, open, folded }) => {
        localStorage.removeItem(`cello:filter:${key}`)
        localStorage.setItem("cello:facets:open", open ? "open" : "closed")
        localStorage.setItem("cello:facets:folded", JSON.stringify(folded))
      }, { key, open: state.open, folded: state.folded ?? [] })
      await page.goto(`/${key}/issues?${search}`)
      await expect(cards(page)).toHaveCount(shown)
    }

    // ---------- A · Rail ----------
    await go(`collapse=a&${FILTER}`, 2, { open: true })
    await expect(panel(page).getByRole("button", { name: "Hide filters" })).toBeVisible()
    await shot("a-open")
    await panel(page).getByRole("button", { name: "Hide filters" }).click()
    await expect(page.locator('[data-facets="rail"] [data-filter-count="3"]')).toBeVisible()
    await page.reload()
    await expect(cards(page)).toHaveCount(2)
    await expect(page.locator('[data-rail-facet="labels"][data-active]')).toBeVisible()
    await shot("a-collapsed")
    await go("collapse=a", 30, { open: false })
    await expect(page.locator('[data-facets="rail"]')).toBeVisible()
    await shot("a-board")
    await page.locator('[data-facets="rail"]').getByRole("button", { name: "Show filters" }).click()
    await expect(page.locator("[data-facets]:not([data-facets=rail])")).toBeVisible()

    // ---------- B · Button + chips ----------
    await go(`collapse=b&${FILTER}`, 2, { open: true })
    await expect(page.locator("[data-filter-button]")).toHaveAttribute("aria-pressed", "true")
    await shot("b-open")
    await page.locator("[data-filter-button]").click()
    await expect(page.locator("[data-filter-chips]")).toBeVisible()
    await expect(panel(page)).toHaveCount(0)
    await page.reload()
    await expect(cards(page)).toHaveCount(2)
    await expect(page.locator("[data-filter-chips]")).toContainText("Nobody")
    await shot("b-collapsed")
    // A chip's × takes just that filter off.
    await page.getByRole("button", { name: "Remove Nobody" }).click()
    await expect(page.locator("[data-filter-button] [data-filter-count='2']")).toBeVisible()
    await go("collapse=b", 30, { open: false })
    await expect(page.locator("[data-filter-chips]")).toHaveCount(0)
    await shot("b-board")

    // ---------- C · Folding sections ----------
    await go(`collapse=c&${FILTER}`, 2, { open: true })
    await shot("c-open")
    await panel(page).locator('[data-fold="Area"]').click()
    await panel(page).locator('[data-fold="Working on it"]').click()
    await expect(panel(page).locator('[data-fold="Area"] [data-fold-summary]')).toHaveText("agents")
    await expect(panel(page).locator('[data-fold="Working on it"] [data-fold-summary]')).toHaveText("Nobody")
    await page.reload() // remembered
    await expect(cards(page)).toHaveCount(2)
    await expect(panel(page).locator('[data-fold="Area"]')).toHaveAttribute("aria-expanded", "false")
    await shot("c-collapsed")
    await go("collapse=c", 30, { open: true, folded: ["group-area", "holder", "maker", "due", "updated"] })
    await shot("c-board")

    // ---------- B with C ----------
    await go(`collapse=bc&${FILTER}`, 2, { open: true, folded: ["group-area", "holder"] })
    await expect(page.locator("[data-filter-button]")).toHaveAttribute("aria-pressed", "true")
    await shot("bc-open")
    await go(`collapse=bc&${FILTER}`, 2, { open: false, folded: ["group-area", "holder"] })
    await expect(page.locator("[data-filter-chips]")).toBeVisible()
    await shot("bc-collapsed")

    await context.close()
  }
})
