// CEL-55: subagents work under their orchestrator's session (Claude Code gives them its session id).
// The orchestrator claims two tasks and launches a builder and a reviewer, one per task; each card names
// the subagent working on it, the sidebar counts both with the session (the Agents page lists them, CEL-65),
// comments and history name the agent, and a stopped subagent leaves the card to its session. The task
// panel shows the card's agent mark (CEL-69) in the same mood: thinking, working, waiting. Agents act through RPC with the
// CLI's identity headers, as the hooks and CELLO_AGENT do. Agent cursors are off, so cards change in place.
import * as path from "node:path"
import type { Page } from "@playwright/test"
import { newCommandId, openClient } from "../packages/client/test/support/promiseClient.ts"
import { caption, card, column, defaultWorkspace, expect, seedProject, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { SHOTS } from "./packets.ts"

const SESSION = "7d3a9e51-agents-e2e"
const BUILDER = "a13bfb89c0de1234f"
const REVIEWER = "b77d0e11aa22bb33c"

/** A call as the CLI makes it: the session, its pid, and (CELLO_AGENT) the subagent. */
const as = (baseURL: string, agent?: { id: string; type: string }) =>
  openClient(`${baseURL.replace(/^http/, "ws")}/rpc`, {
    "x-cello-session": SESSION,
    "x-cello-client": "Claude Code",
    "x-cello-pid": String(process.pid),
    ...(agent ? { "x-cello-agent": agent.id, "x-cello-agent-type": agent.type } : {}),
  })

/** "Agents working" in the sidebar: its count is in `data-agents-working`; no list under it (CEL-65). */
const agentsWorking = (page: Page) => page.locator('aside[data-sidebar="expanded"] a[data-agents-working]')
const agentsList = (page: Page) => page.locator('aside[data-sidebar="expanded"] [data-agents-list]')

async function shoot(page: Page, name: string, target: Page | ReturnType<Page["locator"]> = page) {
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await target.screenshot({ path: path.join(SHOTS, `cel-55-${name}-${theme}.png`) })
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"))
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (localStorage.getItem("cello:agent-cursors") === null) localStorage.setItem("cello:agent-cursors", "off")
  })
})

test("CEL-55: two subagents of one session on two cards: each card names its agent, the sidebar counts both with the session", async ({ page, cello, baseURL }) => {
  const key = uniqueKey("SUB")
  const project = await seedProject(cello, "Subagents", key)
  const { statuses } = await defaultWorkspace(cello)
  for (const title of ["Agents on cards", "Sidebar lists subagents"]) {
    await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title, statusId: statuses.Todo!.id }))
  }
  const [first, second] = [`${key}-1`, `${key}-2`]
  await page.goto(`/${key}/issues`)
  await expect(column(page, "Todo").locator("[data-task-key]")).toHaveCount(2)
  const before = Number(await agentsWorking(page).getAttribute("data-agents-working"))

  await caption(page, "The orchestrator session claims both tasks: each card shows the session, 7d3a9e51")
  const orchestrator = await as(baseURL!)
  for (const k of [first, second]) await orchestrator.run((c) => c["task.claim"]({ commandId: newCommandId(), key: k }))
  const firstCard = column(page, "In Progress").locator(`[data-task-key="${first}"]`)
  const secondCard = column(page, "In Progress").locator(`[data-task-key="${second}"]`)
  await expect(firstCard.locator("[data-card-work]")).toContainText("7d3a9e51 active now")
  await expect(secondCard.locator("[data-card-work]")).toContainText("7d3a9e51 active now")

  await caption(page, `It launches a cello-builder on ${first} and a cello-code-reviewer on ${second}: the launch's description names the task`)
  await orchestrator.run((c) =>
    c["agent.report"]({ agentId: BUILDER, agentType: "cello-builder", state: "launched", description: `${first} agents on cards`, prompt: `Build ${first}` }))
  await orchestrator.run((c) =>
    c["agent.report"]({ agentId: REVIEWER, agentType: "cello-code-reviewer", state: "launched", description: `${second} review the branch`, prompt: "Review it" }))

  await caption(page, "Their tool calls check them in under the session: each card names the subagent working on it")
  const builder = await as(baseURL!, { id: BUILDER, type: "cello-builder" })
  const reviewer = await as(baseURL!, { id: REVIEWER, type: "cello-code-reviewer" })
  await builder.run((c) => c["whoami"]({ project: {} }))
  await reviewer.run((c) => c["whoami"]({ project: {} }))
  await expect(firstCard.locator("[data-card-work]")).toContainText("cello-builder · a13bfb89 active now")
  await expect(secondCard.locator("[data-card-work]")).toContainText("cello-code-reviewer · b77d0e11 active now")
  // The session is the parent, in the hover.
  await expect(firstCard.locator("[data-card-work] [data-agent]")).toHaveAttribute("title", "cello-builder · a13bfb89, under Claude Code session 7d3a9e51")

  await caption(page, "Agents working counts the session and both subagents; the Agents page lists them, not the sidebar")
  await expect(agentsWorking(page)).toHaveAttribute("data-agents-working", String(before + 3))
  await expect(agentsList(page)).toHaveCount(0)
  // Each card shows its agent's mark (CEL-69): no stage yet, so the builder thinks.
  await expect(firstCard.locator(".agent-mark")).toHaveAttribute("data-agent-mood", "thinking")
  await expect(firstCard.locator(".agent-mark")).toHaveAttribute("data-presence", "active")
  await shoot(page, "board")
  await shoot(page, "sidebar", page.locator('aside[data-sidebar="expanded"] nav[aria-label="Inbox"]'))

  await caption(page, "The builder comments and sets the stage with CELLO_AGENT: both are credited to it, under the session")
  const firstTask = (await cello.run((c) => c["task.get"]({ key: first }))).task
  await builder.run((c) => c["comment.add"]({ commandId: newCommandId(), taskId: firstTask.id, body: "Built; the tests pass." }))
  await builder.run((c) => c["task.stage"]({ commandId: newCommandId(), key: first, stage: "building" }))
  await expect(firstCard.locator("[data-provenance]")).toContainText("cello-builder · a13bfb89 changed just now")
  await caption(page, "Building: the builder's card shows the working mark")
  await expect(firstCard.locator(".agent-mark")).toHaveAttribute("data-agent-mood", "working")

  await firstCard.click()
  const panel = taskPanel(page, first)
  await expect(panel).toBeVisible()
  await caption(page, "The panel: the subagent working on it with its session, the comment and the history name it")
  await expect(panel.locator("[data-working-on-it]")).toContainText("cello-builder · a13bfb89 active now · under 7d3a9e51")
  await expect(panel.locator("[data-last-changed]")).toContainText("cello-builder · a13bfb89 · under 7d3a9e51")
  await expect(panel.locator("[data-comment-author]")).toContainText("cello-builder · a13bfb89 · under 7d3a9e51")
  await expect(panel.locator('section[aria-labelledby="history-heading"]')).toContainText("cello-builder · a13bfb89 set the stage to Building")
  // Working on it and the top bar show the card's mark too, in the builder's colour and mood.
  for (const where of ["[data-working-on-it]", "[data-panel-work]"]) {
    await expect(panel.locator(`${where} .agent-mark`)).toHaveAttribute("data-agent-mood", "working")
    await expect(panel.locator(`${where} .agent-mark`)).toHaveAttribute("data-presence", "active")
  }
  await shoot(page, "panel")
  await shoot(page, "panel-marks", panel)
  await caption(page, "Back to the board")
  await panel.getByRole("button", { name: "Close task" }).click()

  await caption(page, "The reviewer finishes (SubagentStop): its card goes back to the session, and the count drops")
  await orchestrator.run((c) => c["agent.report"]({ agentId: REVIEWER, agentType: "cello-code-reviewer", state: "stopped" }))
  await expect(secondCard.locator("[data-card-work]")).toContainText("7d3a9e51 active now")
  await expect(agentsWorking(page)).toHaveAttribute("data-agents-working", String(before + 2))
  // Claims stayed with the session all along.
  expect((await cello.run((c) => c["task.get"]({ key: second }))).task.assigneeSessionId).toBe(
    (await orchestrator.run((c) => c["whoami"]({ project: {} }))).session!.id,
  )

  await caption(page, `The session asks Lucas about ${second}: Needs input. Its card looks up with big eyes, the builder's still working`)
  await orchestrator.run((c) =>
    c["ask.create"]({ commandId: newCommandId(), key: second, title: "Which wording?", questions: [{ prompt: "Agent or subagent?" }], files: [], links: [] }))
  await expect(card(page, second).locator(".agent-mark")).toHaveAttribute("data-agent-mood", "waiting")
  await expect(card(page, first).locator(".agent-mark")).toHaveAttribute("data-agent-mood", "working")
  await orchestrator.run((c) => c["ask.withdraw"]({ commandId: newCommandId(), key: second }))

  await orchestrator.run((c) => c["agent.report"]({ agentId: BUILDER, agentType: "cello-builder", state: "stopped" }))
  for (const k of [first, second]) await orchestrator.run((c) => c["task.release"]({ commandId: newCommandId(), key: k }))
  await Promise.all([orchestrator.close(), builder.close(), reviewer.close()])
})

