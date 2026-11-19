// CEL-107: the task panel's Working on it row links the agent's log on the Agents page, and an agent
// that finished folds into "Finished today" at the bottom of that page, its log still a click away. An
// orchestrator launches a builder through the real `cello` CLI and its Claude Code hooks, which report the
// transcripts Claude Code would write under its projects folder (the e2e data folder's, never ~/.claude);
// the builder's transcript is invented. Stills in light and dark go to e2e/videos/ (cel-107-*.png).
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Locator, Page } from "@playwright/test"
import { animationsSettled, caption, captionWithUrl, defaultWorkspace, expect, newCommandId, seedProject, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { celloIn, claudeHooks } from "./claudeHooks.ts"
import { SHOTS } from "./packets.ts"

const ORCHESTRATOR = "3b9d0c4e-6a1f-4e2b-8c7d-5f4e3d2c1b0a"
const BUILDER = "b5e11a2d3c4f5a6b7"

const work = fs.mkdtempSync(path.join(os.tmpdir(), "cel107-"))
const cwd = path.join(work, "waffles")
fs.mkdirSync(cwd, { recursive: true })
const cli = celloIn(cwd)
const hooks = claudeHooks(cwd)

const projects = path.join(process.env.CELLO_E2E_DATA!, "claude", "projects", "-work-waffles")
const sessionFile = path.join(projects, `${ORCHESTRATOR}.jsonl`)
const builderFile = path.join(projects, ORCHESTRATOR, "subagents", `agent-${BUILDER}.jsonl`)

let clock = Date.parse("2026-11-16T10:00:00.000Z")
const at = (seconds = 1) => new Date((clock += seconds * 1000)).toISOString()
let n = 0
const line = (value: object) => `${JSON.stringify(value)}\n`
const prompt = (text: string) => line({ type: "user", uuid: `u${n++}`, timestamp: at(), message: { role: "user", content: text } })
const said = (text: string) => line({ type: "assistant", uuid: `m${n++}`, timestamp: at(), message: { id: `msg${n}`, content: [{ type: "text", text }] } })
const call = (id: string, name: string, input: object) =>
  line({ type: "assistant", uuid: `m${n++}`, timestamp: at(), message: { id: `msg${n}`, content: [{ type: "tool_use", id, name, input }] } })
const result = (id: string, content: string, seconds: number, isError = false) =>
  line({ type: "user", uuid: `u${n++}`, timestamp: at(seconds), message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } })

async function shoot(page: Page, name: string, target: Page | Locator = page) {
  await page.mouse.move(1430, 890)
  const hide = (shown: boolean) =>
    page.evaluate((shown) => document.getElementById("e2e-caption")?.style.setProperty("visibility", shown ? "" : "hidden"), shown)
  await hide(false)
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await animationsSettled(page)
    await target.screenshot({ path: path.join(SHOTS, `cel-107-${name}-${theme}.png`) })
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"))
  await hide(true)
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (localStorage.getItem("cello:agent-cursors") === null) localStorage.setItem("cello:agent-cursors", "off")
  })
})

test("CEL-107: the task panel's Log opens the builder's log on the Agents page; once it finishes, it folds into Finished today with its log", async ({ page, cello }) => {
  test.setTimeout(240_000)
  const key = uniqueKey("WAF")
  const project = await seedProject(cello, "Waffles", key)
  const { statuses } = await defaultWorkspace(cello)
  await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "The waffle iron timer", priority: 2, statusId: statuses.Todo!.id }))
  const task = `${key}-1`

  // Claude Code has written the session's transcript and the builder's; the hooks say where.
  fs.mkdirSync(path.dirname(builderFile), { recursive: true })
  fs.writeFileSync(sessionFile, prompt(`Build ${task} with a builder.`))
  fs.writeFileSync(builderFile, [
    prompt(`${task} build the waffle iron timer. Test first.`),
    said("Writing the failing test first."),
    call("toolu_test", "Bash", { command: "bun run test" }),
    result("toolu_test", "FAIL src/iron.test.ts\n  beeps after 4 minutes", 2.1, true),
    call("toolu_edit", "Edit", { file_path: `${cwd}/src/iron.ts`, old_string: "{}", new_string: "{ beepAfter: 240 }" }),
    result("toolu_edit", "The file has been updated.", 0.1),
  ].join(""))
  cli(ORCHESTRATOR)("task", "claim", task)
  cli(ORCHESTRATOR)("task", "stage", task, "building")
  hooks.hook("subagent-start", { session_id: ORCHESTRATOR, transcript_path: sessionFile, agent_id: BUILDER, agent_type: "cello-builder", hook_event_name: "SubagentStart" })
  hooks.hook("post-tool-use", {
    session_id: ORCHESTRATOR, transcript_path: sessionFile, hook_event_name: "PostToolUse", tool_name: "Agent",
    tool_input: { subagent_type: "cello-builder", description: `${task} build the waffle iron timer`, prompt: "Build it." },
    tool_response: { agentId: BUILDER, status: "async_launched" },
  })
  hooks.hook("post-tool-use", {
    session_id: ORCHESTRATOR, transcript_path: sessionFile, agent_id: BUILDER, agent_type: "cello-builder", hook_event_name: "PostToolUse",
    tool_name: "Edit", tool_input: { file_path: `${cwd}/src/iron.ts` },
  })

  const sessionId = (await cello.run((c) => c["snapshot.get"]({}))).sessions.find((s) => s.externalId === ORCHESTRATOR)!.id
  const rowId = `agent:${sessionId}/${BUILDER}`
  const row = page.locator(`[data-agent-row="${rowId}"]`)
  const log = row.locator("[data-agent-log]")

  await page.goto(`/${key}/1`)
  const panel = taskPanel(page, task)
  await captionWithUrl(page, "The task panel: Working on it names the builder, with a Log link")
  await expect(panel.locator("[data-working-on-it]")).toContainText("cello-builder · b5e11a2d active now")
  const logLink = panel.locator("[data-working-log] a")
  await expect(logLink).toHaveText("Log")
  await shoot(page, "panel-log", panel)

  await caption(page, "Log opens the Agents page with the builder's row open, on its live log")
  await logLink.click()
  await expect(page).toHaveURL(new RegExp(`/agents\\?open=${encodeURIComponent(rowId)}`))
  await expect(row).toHaveAttribute("data-agent-group", "working")
  // The log opens on Story (CEL-170): the builder's two calls are one row, the failed one counted.
  const group = log.locator("[data-log-group]")
  const turn = log.locator("[data-log-turn]")
  await expect(group).toHaveAttribute("data-log-status", "error")
  await expect(group.locator("[data-log-summary]")).toHaveText("Ran 1 command, edited 1 file")
  await expect(turn).toHaveCount(0)

  await caption(page, "The builder writes its last step and finishes")
  fs.appendFileSync(builderFile, said("The timer beeps after 4 minutes. Done."))
  await expect(log.locator('[data-log-kind="message"]').last()).toHaveText(/Done\./)
  hooks.stop(ORCHESTRATOR, BUILDER, "cello-builder")

  await caption(page, "It folds into its session's row: one line, the fold open because its log is, the log still there (CEL-156)")
  const fold = page.locator(`[data-agents-fold="session:${sessionId}"]`)
  const finished = page.locator('section[data-agents-group="finished"]')
  await expect(fold).toHaveText("1 builder finished")
  await expect(fold).toHaveAttribute("aria-expanded", "true")
  await expect(page.locator(`[data-agents-folded="session:${sessionId}"]`).locator(`[data-agent-row="${rowId}"]`)).toBeVisible()
  // No row of its own in Finished today any more.
  await expect(finished.locator(`[data-agent-row="${rowId}"]`)).toHaveCount(0)
  await expect(row).toHaveAttribute("data-agent-group", "finished")
  await expect(row.locator("[data-agent-presence]").first()).toHaveText(/finished (just now|\d+m ago)/)
  await expect(log.locator('[data-log-kind="message"]').last()).toHaveText(/Done\./)
  // Its turn is over: the work folds under "Worked for…", and the last message stays open (CEL-170).
  await expect(turn).toBeVisible()
  await expect(turn.locator("[data-log-toggle]").first()).toContainText("Worked for")
  await expect(group).toHaveCount(0)
  // The orchestrator is still working, in its group above.
  await expect(page.locator(`[data-agent-row="session:${sessionId}"]`)).not.toHaveAttribute("data-agent-group", "finished")
  await shoot(page, "finished")

  await caption(page, "After a reload the fold is closed: open it, and its log is a click away")
  await page.goto("/agents")
  await expect(fold).toHaveText("1 builder finished")
  await expect(row).toHaveCount(0)
  await fold.click()
  await expect(row).toBeVisible()
  await row.getByRole("button").first().click()
  await expect(turn).toBeVisible()
  await expect(log.locator('[data-log-kind="message"]').last()).toHaveText(/Done\./)
  await turn.locator("[data-log-toggle]").first().click()
  await expect(group).toBeVisible()

  await caption(page, "Back on the task: the builder finished, so Working on it is the session again, and Log opens its log")
  await page.goto(`/${key}/1`)
  // The builder finished: Working on it is the session holding the claim again, and its Log opens the session's row.
  await expect(panel.locator("[data-working-on-it]")).toContainText("Claude Code session 3b9d0c4e")
  await panel.locator("[data-working-log] a").click()
  await expect(page.locator(`[data-agent-row="session:${sessionId}"] [data-agent-log]`)).toBeVisible()
})
