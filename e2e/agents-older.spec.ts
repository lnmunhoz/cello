// CEL-156: the Agents page stops piling up. Through the real `cello` CLI and its Claude Code hooks:
// - an orchestrator launches three builders and two code reviewers, and they finish: no row of their
//   own, one line under the orchestrator ("3 builders, 2 code reviewers finished") that opens to list them,
//   each row opening its log, reachable by the keys;
// - Clear finished hides them on this device ("5 hidden · Show") and Show brings them back;
// - a session quiet for more than a day with nothing open (its subagent is on a Done task) moves to a
//   closed Older section that shows its count and opens, and that stays open after a reload, while a quiet
//   session holding an open task stays in Quiet. "More than a day" is the page's clock set forward.
// Stills in light and dark go to e2e/videos/ (cel-156-*.png). Agent cursors are off.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Locator, Page } from "@playwright/test"
import { animationsSettled, caption, defaultWorkspace, expect, newCommandId, seedProject, test, uniqueKey } from "./fixtures.ts"
import { celloIn, claudeHooks } from "./claudeHooks.ts"
import { SHOTS } from "./packets.ts"
import { isReview } from "./recording.ts"

const ORCHESTRATOR = "f1561a2b-3c4d-4e5f-8a9b-0c1d2e3f4a56"
const STALE = "f1562a2b-3c4d-4e5f-8a9b-0c1d2e3f4a56"
const BUILDERS = ["b1561aaaa0000001", "b1561aaaa0000002", "b1561aaaa0000003"]
const REVIEWERS = ["c1561bbbb0000001", "c1561bbbb0000002"]
const OLD_BUILDER = "d1561cccc0000001"

const work = fs.mkdtempSync(path.join(os.tmpdir(), "cel156-"))
const cwd = path.join(work, "cello")
fs.mkdirSync(cwd, { recursive: true })
const cli = celloIn(cwd)
const hooks = claudeHooks(cwd)

/** Stills in both themes, without the video's caption and with the pointer in a corner. */
async function shoot(page: Page, name: string, target: Page | Locator = page) {
  await page.mouse.move(1430, 890)
  const hide = (shown: boolean) =>
    page.evaluate((shown) => document.getElementById("e2e-caption")?.style.setProperty("visibility", shown ? "" : "hidden"), shown)
  await hide(false)
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await animationsSettled(page)
    await target.screenshot({ path: path.join(SHOTS, `cel-156-${name}-${theme}.png`) })
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"))
  await hide(true)
}

const sessionId = async (cello: Parameters<typeof defaultWorkspace>[0], external: string) =>
  (await cello.run((c) => c["snapshot.get"]({}))).sessions.find((s) => s.externalId === external)!.id

test.beforeEach(async ({ context }) => {
  // Review videos hold every step (e2e/recording.ts), which takes this flow past the default timeout, as on agents-page.spec.ts.
  if (isReview(process.env)) test.setTimeout(180_000)
  await context.addInitScript(() => {
    if (localStorage.getItem("cello:agent-cursors") === null) localStorage.setItem("cello:agent-cursors", "off")
  })
})

test("CEL-156: finished subagents fold into their session's row, Clear finished hides them with a Show, and a session quiet for a day with nothing open goes to Older", async ({ page, cello }) => {
  const key = uniqueKey("FLD")
  const project = await seedProject(cello, "Fold", key)
  const { statuses } = await defaultWorkspace(cello)
  for (const [title, status] of [["Build the fold", statuses.Todo!], ["Review the fold", statuses.Todo!], ["Old work, done", statuses.Done!], ["Still open", statuses.Todo!]] as const) {
    await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title, statusId: status.id }))
  }
  const [build, review, done, open] = [1, 2, 3, 4].map((n) => `${key}-${n}`)

  // The orchestrator holds two tasks, with three builders and two reviewers on them.
  cli(ORCHESTRATOR)("task", "claim", build!)
  cli(ORCHESTRATOR)("task", "claim", review!)
  for (const id of BUILDERS) hooks.launch(ORCHESTRATOR, id, "cello-builder", `${build} build the fold, part ${id.slice(-1)}`)
  for (const id of REVIEWERS) hooks.launch(ORCHESTRATOR, id, "cello-code-reviewer", `${review} review the fold, part ${id.slice(-1)}`)
  const orchestrator = await sessionId(cello, ORCHESTRATOR)
  const orchestratorRow = page.locator(`[data-agent-row="session:${orchestrator}"]`)
  const subagentRow = (id: string) => page.locator(`[data-agent-row="agent:${orchestrator}/${id}"]`)
  const fold = page.locator(`[data-agents-fold="session:${orchestrator}"]`)

  await page.goto("/agents")
  await caption(page, "An orchestrator with three builders and two reviewers: a row each, while they work")
  await expect(orchestratorRow).toContainText("5 subagents")
  for (const id of [...BUILDERS, ...REVIEWERS]) await expect(subagentRow(id)).toHaveAttribute("data-agent-group", "working")
  await expect(fold).toHaveCount(0)
  await shoot(page, "working")

  await caption(page, "They finish: no row of their own, one line under the orchestrator")
  for (const id of BUILDERS) hooks.stop(ORCHESTRATOR, id, "cello-builder")
  for (const id of REVIEWERS) hooks.stop(ORCHESTRATOR, id, "cello-code-reviewer")
  await expect(fold).toHaveText("3 builders, 2 code reviewers finished")
  await expect(fold).toHaveAttribute("aria-expanded", "false")
  for (const id of [...BUILDERS, ...REVIEWERS]) await expect(subagentRow(id)).toHaveCount(0)
  await expect(page.locator('section[data-agents-group="finished"]').locator(`[data-agent-row^="agent:${orchestrator}/"]`)).toHaveCount(0)
  await shoot(page, "folded")

  await caption(page, "The line opens to list them; each row opens its log")
  await fold.click()
  await expect(fold).toHaveAttribute("aria-expanded", "true")
  for (const id of [...BUILDERS, ...REVIEWERS]) await expect(subagentRow(id)).toBeVisible()
  await shoot(page, "opened")
  await subagentRow(BUILDERS[0]!).getByRole("button").first().click()
  await expect(subagentRow(BUILDERS[0]!).locator("[data-agent-log]")).toBeVisible()
  await page.keyboard.press("Escape")

  await caption(page, "The keys reach them: from the orchestrator, ↓ lands on the first folded row")
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await orchestratorRow.getByRole("button").first().focus()
  await page.keyboard.press("ArrowDown")
  await expect(subagentRow(BUILDERS[0]!).getByRole("button").first()).toBeFocused()
  await fold.click()
  await expect(subagentRow(BUILDERS[0]!)).toHaveCount(0)

  await caption(page, "Clear finished hides them on this device, and says how many")
  await page.getByRole("button", { name: "Clear finished" }).click()
  // Other specs' agents finished today on the shared server count too: at least our five.
  const hidden = page.locator("[data-agents-hidden]")
  await expect(hidden).toContainText(/\d+ hidden/)
  expect(Number(await hidden.getAttribute("data-agents-hidden"))).toBeGreaterThanOrEqual(5)
  await expect(fold).toHaveCount(0)
  await expect(orchestratorRow).toBeVisible()
  await shoot(page, "cleared", page.locator("[data-agents-clear]"))
  await page.reload()
  await expect(hidden).toContainText(/\d+ hidden/)
  await expect(fold).toHaveCount(0)

  await caption(page, "Show brings them back: nothing was deleted")
  await page.getByRole("button", { name: "Show", exact: true }).click()
  await expect(fold).toHaveText("3 builders, 2 code reviewers finished")
  await expect(page.locator("[data-agents-hidden]")).toHaveCount(0)

  // A stale session: it holds nothing, and its builder is on a Done task. The orchestrator holds open tasks.
  cli(STALE)("task", "claim", open!)
  cli(STALE)("task", "release", open!)
  hooks.launch(STALE, OLD_BUILDER, "cello-builder", `${done} the old work`)
  const stale = await sessionId(cello, STALE)
  await page.clock.setFixedTime(Date.now() + 30 * 3_600_000)
  await page.goto("/agents")
  await caption(page, "A day and a half later: the session with nothing open is in Older, closed, with its count")
  const older = page.locator('section[data-agents-group="older"]')
  const toggle = older.locator("[data-agents-older-toggle]")
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await expect(older.locator("[data-agent-row]")).toHaveCount(0)
  await expect(page.locator(`[data-agent-row="session:${stale}"]`)).toHaveCount(0)
  await shoot(page, "older-closed", older)

  await caption(page, "Quiet, but holding an open task: it stays in Quiet, never folded away")
  await expect(page.locator(`[data-agent-row="session:${orchestrator}"]`)).toHaveAttribute("data-agent-group", "quiet")

  await caption(page, "Open Older: nothing disappeared")
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await expect(page.locator(`[data-agent-row="session:${stale}"]`)).toHaveAttribute("data-agent-group", "quiet")
  await expect(page.locator(`[data-agent-row="session:${stale}"] [data-agent-presence]`).first()).toContainText("seen 30h ago")
  await shoot(page, "older-open")

  await caption(page, "It stays open after a reload, remembered on this device")
  await page.reload()
  await expect(older.locator("[data-agents-older-toggle]")).toHaveAttribute("aria-expanded", "true")
  await older.locator("[data-agents-older-toggle]").click()
  await expect(older.locator("[data-agent-row]")).toHaveCount(0)
})
