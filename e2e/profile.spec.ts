// CEL-89: a project's testing profile on its Settings tab. `cello init` detected some fields and an agent fixed
// one; Lucas sees where each value came from, edits fields (his source wins), switches where UI tests
// run and adds an e2e surface; an agent trying to change a field he set is refused and told to ask on
// the card; everything survives a reload. Stills (light and dark) go to e2e/videos/cel-89-*.png.
import * as fs from "node:fs"
import * as path from "node:path"
import type { Browser, Page } from "@playwright/test"
import { hideTerminal, showTerminal } from "./agentScreen.ts"
import { agentAs, caption, expect, newCommandId, seedProject, test, uniqueKey } from "./fixtures.ts"
import { celloAs, celloRun, SHOTS, WEB_URL } from "./packets.ts"
import { isReview } from "./recording.ts"

const SESSION = "e2e0profile-agent-session"

test.beforeEach(() => {
  if (isReview(process.env)) test.setTimeout(240_000)
})

const row = (page: Page, field: string) => page.locator(`[data-profile-row="${field}"]`)
const section = (page: Page) => page.getByRole("region", { name: "Testing" })

/** Saves a field the way Lucas does: type, then Enter. */
async function edit(page: Page, label: string, value: string) {
  const input = section(page).getByRole("textbox", { name: label, exact: true })
  await input.fill(value)
  await input.press("Enter")
}

/** The Testing section, light and dark: e2e/videos/cel-89-testing-*.png. */
async function screenshots(browser: Browser, key: string) {
  fs.mkdirSync(SHOTS, { recursive: true })
  for (const colorScheme of ["light", "dark"] as const) {
    const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 1400 }, colorScheme })
    const page = await context.newPage()
    await page.goto(`/${key}/settings`)
    await expect(row(page, "e2e.desktop.run")).toContainText("You")
    await section(page).scrollIntoViewIfNeeded()
    await section(page).screenshot({ path: path.join(SHOTS, `cel-89-testing-${colorScheme}.png`), animations: "disabled" })
    await context.close()
  }
}

test("CEL-89: the testing profile in Settings shows where each field came from; Lucas edits it, an agent can't overwrite what he set", async ({ page, browser, cello, baseURL }) => {
  const key = uniqueKey("PRF")
  await seedProject(cello, "Shop", key)
  const agentClient = await agentAs(baseURL!, SESSION, process.pid)
  // What `cello init` writes from detection, as the agent session that ran it.
  await agentClient.run((c) =>
    c["profile.set"]({
      commandId: newCommandId(),
      project: { key },
      detected: true,
      set: [
        { field: "install", value: "bun install" },
        { field: "unit", value: "bun run test" },
        { field: "app.start", value: "bun run dev" },
        { field: "app.url", value: "http://localhost:5173" },
        { field: "e2e.web.run", value: "bun run test:e2e" },
        { field: "e2e.web.videos", value: "test-results" },
        { field: "evidence.ui", value: "MP4 video of the e2e run of the flow, plus screenshots (light and dark when it matters)" },
      ],
    })
  )
  const agent = celloAs(SESSION)

  await caption(page, "The project's Settings tab shows its testing profile: each field with where it came from")
  await page.goto(`/${key}/settings`)
  await section(page).scrollIntoViewIfNeeded()
  await expect(row(page, "install")).toContainText("Detected")
  await expect(row(page, "install").getByRole("textbox")).toHaveValue("bun install")
  await expect(row(page, "typecheck").getByRole("textbox")).toHaveValue("")
  await expect(row(page, "ui.runsIn")).toContainText("Default")

  await caption(page, "The dev server moved to 5199: the agent fixes app.url from its session, and the row follows live")
  const fixed = agent("profile", "set", "app.url", "http://localhost:5199", "--project", key)
  await showTerminal(page, `cello profile set app.url http://localhost:5199 --project ${key}`, fixed, { narrow: true })
  await expect(row(page, "app.url").getByRole("textbox")).toHaveValue("http://localhost:5199")
  await expect(row(page, "app.url")).toContainText("Agent")

  await caption(page, "Lucas sets the unit command himself: the field becomes his", { beforeShowing: () => hideTerminal(page) })
  await edit(page, "Unit tests", "bun run test:unit")
  await expect(row(page, "unit")).toContainText("You")

  await caption(page, "He switches UI tests to Docker")
  await row(page, "ui.runsIn").getByRole("radio", { name: "Docker" }).click()
  await expect(row(page, "ui.runsIn")).toContainText("You")

  await caption(page, "An agent tries to change the unit command Lucas set: refused, and told to ask on the card")
  const refused = celloRun(SESSION)("profile", "set", "unit", "npm test", "--project", key)
  expect(refused.status).not.toBe(0)
  expect(refused.stderr).toContain("set unit (`bun run test:unit`), so an agent can't change it")
  await showTerminal(page, `cello profile set unit "npm test" --project ${key}`, refused.stderr, { narrow: true })
  await expect(row(page, "unit").getByRole("textbox")).toHaveValue("bun run test:unit")

  await caption(page, "He adds a desktop e2e surface and fills in how to run it", { beforeShowing: () => hideTerminal(page) })
  await section(page).getByRole("textbox", { name: "New e2e surface" }).fill("desktop")
  await section(page).getByRole("button", { name: "Add surface" }).click()
  await edit(page, "desktop e2e: run", "bun run test:docker:desktop")
  await expect(row(page, "e2e.desktop.run")).toContainText("You")

  await caption(page, "Reload: every value and its source is still there")
  await page.reload()
  await section(page).scrollIntoViewIfNeeded()
  await expect(row(page, "unit").getByRole("textbox")).toHaveValue("bun run test:unit")
  await expect(row(page, "app.url")).toContainText("Agent")
  await expect(row(page, "ui.runsIn").getByRole("radio", { name: "Docker" })).toBeChecked()
  await expect(row(page, "e2e.desktop.run").getByRole("textbox")).toHaveValue("bun run test:docker:desktop")
  await expect(row(page, "install")).toContainText("Detected")

  await caption(page, "The agent's `cello profile` shows the same, with who set each field")
  await showTerminal(page, `cello profile --project ${key}`, agent("profile", "--project", key), { narrow: true })

  await agentClient.close()
  await screenshots(browser, key)
})
