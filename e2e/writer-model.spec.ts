// CEL-119: who wrote it, main session or subagent, and which model. An orchestrator session (on Opus 5.5,
// high) launches a cello-builder (on Sonnet 5.5, medium) through the real `cello` CLI and its Claude Code
// hooks, which report the transcripts Claude Code would write under its projects folder (CLAUDE_CONFIG_DIR,
// a temp folder here, never ~/.claude); the transcripts are invented, in Claude Code's JSONL shape, with
// the model and effort on each reply. Both comment on the task: each comment, history line, the card's
// presence line and the Agents page say Main session or Subagent of it, and the model and effort. After a
// `/model` switch, the orchestrator's next comment says the new model and its first one keeps Opus.
// Stills in light and dark go to e2e/videos/ (cel-119-*.png).
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Page } from "@playwright/test"
import { animationsSettled, caption, captionWithUrl, card, defaultWorkspace, expect, newCommandId, seedProject, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { celloIn, claudeHooks } from "./claudeHooks.ts"
import { SHOTS } from "./packets.ts"

const ORCHESTRATOR = "d0d47d35-6b1a-4c2e-9f3d-1a2b3c4d5e6f"
const BUILDER = "b1d3e5f7a9c0e2f4a"

const work = fs.mkdtempSync(path.join(os.tmpdir(), "cel119-"))
const cwd = path.join(work, "pancakes")
fs.mkdirSync(cwd, { recursive: true })
const cli = celloIn(cwd)
const hooks = claudeHooks(cwd)

// Where Claude Code keeps this session's transcripts: the server reads from the same folder.
const projects = path.join(process.env.CELLO_E2E_DATA!, "claude", "projects", "-work-pancakes-cel119")
const sessionFile = path.join(projects, `${ORCHESTRATOR}.jsonl`)
const builderFile = path.join(projects, ORCHESTRATOR, "subagents", `agent-${BUILDER}.jsonl`)

let n = 0
/** A reply as Claude Code writes it: the model on the message, the effort beside it. */
const reply = (model: string, effort: string, text: string) =>
  `${JSON.stringify({ type: "assistant", uuid: `m${n++}`, timestamp: new Date().toISOString(), effort, message: { id: `msg${n}`, model, role: "assistant", content: [{ type: "text", text }] } })}\n`

async function shoot(page: Page, name: string, target: Page | ReturnType<Page["locator"]> = page) {
  await page.mouse.move(1430, 890)
  const hide = (shown: boolean) =>
    page.evaluate((shown) => document.getElementById("e2e-caption")?.style.setProperty("visibility", shown ? "" : "hidden"), shown)
  await hide(false)
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await animationsSettled(page)
    await target.screenshot({ path: path.join(SHOTS, `cel-119-${name}-${theme}.png`) })
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"))
  await hide(true)
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (localStorage.getItem("cello:agent-cursors") === null) localStorage.setItem("cello:agent-cursors", "off")
  })
})

test("CEL-119: each comment, history line and Agents row says main session or subagent, and the model and effort that wrote it", async ({ page, cello }) => {
  test.setTimeout(180_000)
  const key = uniqueKey("MDL")
  const project = await seedProject(cello, "Pancakes", key)
  const { statuses } = await defaultWorkspace(cello)
  await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "The pancake timer", priority: 2, statusId: statuses.Todo!.id }))
  const task = `${key}-1`

  // Claude Code has written both transcripts: the orchestrator on Opus 5.5, its builder on Sonnet 5.5.
  fs.mkdirSync(path.dirname(builderFile), { recursive: true })
  fs.writeFileSync(sessionFile, reply("claude-opus-5-5", "high", "Launching a builder."))
  fs.writeFileSync(builderFile, reply("claude-sonnet-5-5", "medium", "Building it, test first."))
  cli(ORCHESTRATOR)("task", "claim", task)
  hooks.hook("post-tool-use", {
    session_id: ORCHESTRATOR, transcript_path: sessionFile, hook_event_name: "PostToolUse", tool_name: "Agent",
    tool_input: { subagent_type: "cello-builder", description: `${task} build the pancake timer`, prompt: "Build it." },
    tool_response: { agentId: BUILDER, status: "async_launched" },
  })
  hooks.hook("subagent-start", { session_id: ORCHESTRATOR, transcript_path: sessionFile, agent_id: BUILDER, agent_type: "cello-builder", hook_event_name: "SubagentStart" })
  const builder = cli(ORCHESTRATOR, { agent: `cello-builder/${BUILDER}` })
  cli(ORCHESTRATOR)("task", "comment", task, "Plan: a timer that flips each pancake at 90 seconds. A builder is on it.")
  builder("task", "comment", task, "Built; the tests pass.")
  builder("task", "stage", task, "review")

  const sessionId = (await cello.run((c) => c["snapshot.get"]({}))).sessions.find((s) => s.externalId === ORCHESTRATOR)!.id
  await page.goto(`/${key}/issues`)
  await captionWithUrl(page, "The card: the builder on it, and the model it's on now")
  await expect(card(page, task).locator("[data-card-work]")).toContainText("cello-builder · b1d3e5f7 (Sonnet 5.5) active now")

  await caption(page, "Open the task: each comment says main session or subagent, and the model and effort that wrote it")
  await card(page, task).click()
  const panel = taskPanel(page, task)
  await expect(panel).toBeVisible()
  const authors = panel.locator("[data-comment-author]")
  await expect(authors).toHaveCount(2)
  await expect(authors.nth(0)).toHaveText("Claude Code · Main session · Opus 5.5 · high · d0d47d35")
  await expect(authors.nth(1)).toHaveText("cello-builder · Subagent of d0d47d35 · Sonnet 5.5 · medium")
  // The session id's hover names the session in full.
  await expect(authors.nth(1).locator('[data-author-part="session"]')).toHaveAttribute("title", "Claude Code session d0d47d35")

  await caption(page, "The history says it too: who, as what, on which model")
  const history = panel.locator('section[aria-labelledby="history-heading"]')
  await expect(history).toContainText("cello-builder (Sonnet 5.5), subagent of d0d47d35 set the stage to Agent review")
  await panel.locator('section[aria-labelledby="history-heading"]').scrollIntoViewIfNeeded()
  await shoot(page, "panel", panel)

  await caption(page, "The orchestrator switches to Sonnet (/model): its next comment says so, the first one keeps Opus")
  fs.appendFileSync(sessionFile, reply("claude-sonnet-5-5", "low", "Switched model."))
  cli(ORCHESTRATOR)("task", "comment", task, "Reviewed the builder's work: looks good.")
  await expect(authors).toHaveCount(3)
  await expect(authors.nth(2)).toHaveText("Claude Code · Main session · Sonnet 5.5 · low · d0d47d35")
  await expect(authors.nth(0)).toHaveText("Claude Code · Main session · Opus 5.5 · high · d0d47d35")
  await authors.nth(2).scrollIntoViewIfNeeded()
  await shoot(page, "switch", panel)

  await caption(page, "The Agents page: the main session and its subagent, each with its model and effort")
  await page.goto("/agents")
  const sessionRow = page.locator(`[data-agent-row="session:${sessionId}"]`)
  const builderRow = page.locator(`[data-agent-row="agent:${sessionId}/${BUILDER}"]`)
  await expect(sessionRow).toContainText("Claude Code · Main session · Sonnet 5.5 · low · d0d47d35")
  await expect(sessionRow).toContainText("1 subagent")
  await expect(builderRow).toContainText("cello-builder · b1d3e5f7 · Subagent of d0d47d35 · Sonnet 5.5 · medium")

  await caption(page, "Open the builder: its facts list the model and effort")
  await builderRow.getByRole("button").first().click()
  await expect(builderRow.locator("[data-agent-model]")).toHaveText("ModelSonnet 5.5 · medium effort")
  await shoot(page, "agents")
})
