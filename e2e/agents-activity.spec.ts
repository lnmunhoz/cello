// CEL-133 and CEL-134: what an agent is doing between tool calls. Through the real `cello` CLI and its
// Claude Code hooks, in the order Claude Code fires them:
// - CEL-133: a builder ends its turn while its own Monitor still runs. It isn't finished: the Agents page
//   keeps it under Working, waiting on that work by name; its next tool call has it working; the stop
//   after its work ended folds it into Finished today.
// - CEL-134: a builder starts a Docker e2e run in the background; the runner's `cello test progress`
//   reports move it along live: the Agents page row ("Running tests · web e2e 7 of 13 · 1 failed"), the
//   card's stage line ("7/13 · 1 failed") and the task panel ("running web e2e 7/13"), each failure as it happens, then the
//   last run and its summary once it's done.
// Stills in light and dark go to e2e/videos/ (cel-133-*.png, cel-134-*.png). Agent cursors are off.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Locator, Page } from "@playwright/test"
import { animationsSettled, caption, column, defaultWorkspace, expect, newCommandId, seedProject, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { celloIn, claudeHooks } from "./claudeHooks.ts"
import { SHOTS } from "./packets.ts"

const work = fs.mkdtempSync(path.join(os.tmpdir(), "cel134-"))
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
    await target.screenshot({ path: path.join(SHOTS, `${name}-${theme}.png`) })
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"))
  await hide(true)
}

const sessionId = async (cello: Parameters<typeof defaultWorkspace>[0], external: string) =>
  (await cello.run((c) => c["snapshot.get"]({}))).sessions.find((s) => s.externalId === external)!.id

/** A project with one task, claimed by `session`, with a cello-builder launched on it. */
async function setup(cello: Parameters<typeof defaultWorkspace>[0], session: string, builder: string, title: string) {
  const key = uniqueKey("ACT")
  const project = await seedProject(cello, "Activity", key)
  const { statuses } = await defaultWorkspace(cello)
  await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title, statusId: statuses.Todo!.id }))
  cli(session)("task", "claim", `${key}-1`)
  hooks.launch(session, builder, "cello-builder", `${key}-1 ${title.toLowerCase()}`)
  cli(session, { agent: `cello-builder/${builder}` })("task", "stage", `${key}-1`, "building")
  return { key, task: `${key}-1` }
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (localStorage.getItem("cello:agent-cursors") === null) localStorage.setItem("cello:agent-cursors", "off")
  })
})

test("CEL-133: a builder that ends its turn while its own Monitor runs is waiting on it, not finished; its next call has it working; the stop after finishes it", async ({ page, cello }) => {
  test.setTimeout(180_000)
  const SESSION = "6e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b"
  const BUILDER = "a825620e5afc9ebac"
  const as = { session_id: SESSION, agent_id: BUILDER, agent_type: "cello-builder" }
  await setup(cello, SESSION, BUILDER, "Milestones page")
  const row = page.locator(`[data-agent-row="agent:${await sessionId(cello, SESSION)}/${BUILDER}"]`)

  await page.goto("/agents")
  await caption(page, "A cello-builder is working on its task")
  await expect(row).toHaveAttribute("data-agent-group", "working")

  await caption(page, "It starts a Monitor on its review-mode e2e run, then ends its turn while that runs")
  hooks.hook("post-tool-use", {
    ...as, hook_event_name: "PostToolUse", tool_name: "Monitor", tool_use_id: "toolu_monitor",
    tool_input: { description: "review-mode e2e run finishing", command: "until grep -q PASS e2e-review.txt; do sleep 5; done" },
    tool_response: { taskId: "bpz2edzeb", timeoutMs: 1800000, persistent: false },
  })
  // background_tasks lists the whole session's work: the parent's waiter is there too.
  const waiter = { id: "bwait0001", type: "shell", status: "running", description: "wait", command: "cello inbox --wait" }
  hooks.hook("subagent-stop", {
    ...as, hook_event_name: "SubagentStop",
    background_tasks: [{ id: "bpz2edzeb", type: "monitor", status: "running", description: "review-mode e2e run finishing" }, waiter],
  })

  await caption(page, "SubagentStop came, but its own Monitor still runs: it stays under Working, waiting on it")
  await expect(row).toHaveAttribute("data-agent-group", "working")
  await expect(row.locator("[data-agent-waiting-on]")).toHaveText("Waiting on background workMonitor · review-mode e2e run finishing")
  // Not under Finished today (other specs' agents on the shared server may be there).
  await expect(page.locator('section[data-agents-group="finished"]').locator(`[data-agent-row="${await row.getAttribute("data-agent-row")}"]`)).toHaveCount(0)
  await shoot(page, "cel-133-waiting", row)

  await caption(page, "The run ends; Claude Code resumes it and it reads the results: working again, at once")
  hooks.hook("post-tool-use", { ...as, hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: `${cwd}/summary.txt` }, tool_response: {} })
  await expect(row.locator("[data-agent-waiting-on]")).toHaveCount(0)
  await expect(row.locator("[data-agent-step]")).toHaveText("Read · summary.txt")

  await caption(page, "It writes its report and stops with its work done: now it's finished")
  hooks.hook("subagent-stop", { ...as, hook_event_name: "SubagentStop", background_tasks: [waiter] })
  // It folds into its session's row (CEL-156): open the fold to see it.
  const fold = page.locator(`[data-agents-fold="session:${await sessionId(cello, SESSION)}"]`)
  await expect(fold).toHaveText("1 builder finished")
  await fold.click()
  await expect(row).toHaveAttribute("data-agent-group", "finished")
  await expect(row.locator("[data-agent-presence]")).toContainText("finished")
})

test("CEL-134: a builder's background e2e run shows live: Running tests on the Agents page, the card and the task panel, failures as they happen, then the last run and its summary", async ({ page, cello }) => {
  test.setTimeout(180_000)
  const SESSION = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a"
  const BUILDER = "c0de4b1d2e3f4a5b6"
  const as = { session_id: SESSION, agent_id: BUILDER, agent_type: "cello-builder" }
  const { key, task } = await setup(cello, SESSION, BUILDER, "Agents page")
  const row = page.locator(`[data-agent-row="agent:${await sessionId(cello, SESSION)}/${BUILDER}"]`)
  const progressFile = path.join(work, "progress.json")
  const report = (progress: Record<string, unknown>) => {
    fs.writeFileSync(progressFile, JSON.stringify({
      stage: "web-e2e", passed: 0, failed: 0, skipped: 0, total: 13, current: null, failures: [], done: false, outcome: null, folder: null, ...progress,
    }))
    // As scripts/test-in-docker.ts runs it: in the builder's folder, as the session (its shell can't name the agent).
    cli(SESSION)("test", "progress", "--file", progressFile)
  }

  await page.goto("/agents")
  await caption(page, "The builder runs its e2e specs in Docker, in the background")
  const call = { ...as, tool_name: "Bash", tool_use_id: "toolu_e2e", tool_input: { command: "CELLO_E2E_REVIEW=1 bun run test:docker:e2e -- e2e/agents-page.spec.ts", run_in_background: true } }
  hooks.hook("pre-tool-use", { ...call, hook_event_name: "PreToolUse" })
  hooks.hook("post-tool-use", { ...call, hook_event_name: "PostToolUse", tool_response: { stdout: "", backgroundTaskId: "blo3xolgq" } })
  await expect(row.locator("[data-agent-tests]")).toContainText("Running tests")
  await expect(row.locator("[data-agent-tests]")).toContainText("web e2e")

  await caption(page, "The runner reports as it goes: 3 of 13")
  report({ passed: 3, current: "e2e/agents-page.spec.ts" })
  await expect(row.locator("[data-agent-tests]")).toContainText("web e2e 3 of 13")

  await caption(page, "A spec fails: it shows at once, in red")
  report({ passed: 6, failed: 1, current: "e2e/agents-page.spec.ts", failures: ["e2e/agents-page.spec.ts:40 › keys move between rows"] })
  await expect(row.locator("[data-agent-tests]")).toContainText("web e2e 7 of 13")
  await expect(row.locator("[data-tests-failed]")).toHaveText("1 failed")
  await row.getByRole("button").first().click()
  await expect(row.locator("[data-agent-tests-facts]")).toContainText("✘ e2e/agents-page.spec.ts:40 › keys move between rows")
  await shoot(page, "cel-134-agents-row", row)

  await caption(page, "On the board, the card's stage line: Building · 7/13 · 1 failed")
  await page.goto(`/${key}/issues`)
  const card = column(page, "In Progress").locator(`[data-task-key="${task}"]`)
  await expect(card.locator("[data-card-work] [data-tests-word]")).toContainText("7/13")
  await expect(card.locator("[data-card-work] [data-tests-word]")).toContainText("1 failed")
  await shoot(page, "cel-134-card", card)

  await caption(page, "And in the task panel's top bar")
  await card.click()
  const panel = taskPanel(page, task)
  await expect(panel.locator("[data-panel-work] [data-tests-word]")).toContainText("running web e2e 7/13")
  await shoot(page, "cel-134-panel", panel.locator("[data-panel-work]"))

  await caption(page, "The run ends: the card's stage line is back to Building")
  report({ passed: 12, failed: 1, done: true, outcome: "failed", folder: path.join(cwd, "test-results/docker/2026-11-17_020000-e2e-1"), failures: ["e2e/agents-page.spec.ts:40 › keys move between rows"] })
  await expect(panel.locator("[data-panel-work] [data-tests-word]")).toHaveCount(0)
  await expect(card.locator("[data-card-work] [data-tests-word]")).toHaveCount(0)

  await caption(page, "On the Agents page, the open row keeps the last run, its failure and its summary")
  await page.goto("/agents")
  await row.getByRole("button").first().click()
  await expect(row.locator("[data-agent-tests]")).toHaveCount(0)
  const facts = row.locator("[data-agent-tests-facts]")
  await expect(facts).toContainText("Last run: web e2e failed · 1 failed of 13")
  await expect(facts.locator("[data-tests-folder]")).toHaveText("test-results/docker/2026-11-17_020000-e2e-1/summary.txt")
  await shoot(page, "cel-134-last-run", row)
})
