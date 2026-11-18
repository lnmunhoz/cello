// CEL-65 phase 1: the sidebar's "Agents working" opens the Agents page, laid out like Review. Agents are
// real, seeded through the real `cello` CLI and its Claude Code hooks: an orchestrator session holding
// two tasks with its cello-builder and cello-code-reviewer subagents (launched and checked in by the
// hooks), a session waiting on Lucas in Needs input (`cello task ask`), and a quiet one. The page groups
// them (Waiting on you, Working, Quiet), puts subagents under their session, opens one row at a time to
// show its card, links a waiting agent to answering on Review, works from the keyboard, and follows the
// agents live. Stills in light and dark go to e2e/videos/ (cel-65-*.png). Agent cursors are off.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Locator, Page } from "@playwright/test"
import {
  agentAs,
  animationsSettled,
  caption,
  captionWithUrl,
  contentAnimations,
  defaultWorkspace,
  expect,
  newCommandId,
  seedLabels,
  seedProject,
  test,
} from "./fixtures.ts"
import { celloIn, claudeHooks } from "./claudeHooks.ts"
import { expectLeftAligned, SHOTS } from "./packets.ts"
import { isReview } from "./recording.ts"
import { openClient } from "../packages/client/test/support/promiseClient.ts"

const ORCHESTRATOR = "2fd0505c-417a-4167-acfe-2d66080fcae0"
const ASKER = "8a41c9e2-5b1d-4c7e-9a0f-3e2b1c4d5e6f"
const QUIET = "5c07e1aa-77b2-4f3c-8d21-0a9b8c7d6e5f"
const BUILDER = "a13bfb89c0de1234f"
const REVIEWER = "b77d0e11aa22bb33c"
const VISUAL = "c4e2f9a0bb11cc22d"

// Each session works from a folder named like its repo, as Claude Code's sessions do.
const work = fs.mkdtempSync(path.join(os.tmpdir(), "cel65-"))
const cwd = path.join(work, "cello")
fs.mkdirSync(cwd, { recursive: true })

const cli = celloIn(cwd)
const hooks = claudeHooks(cwd)
const hook = hooks.hook

/** The orchestrator launches a subagent with the Agent tool. */
const launch = (id: string, type: string, description: string) => hooks.launch(ORCHESTRATOR, id, type, description)

const askFile = (title: string, prompt: string) => {
  const file = path.join(work, `${title.replace(/\W+/g, "-")}.yaml`)
  fs.writeFileSync(file, [
    `title: ${title}`,
    "questions:",
    `  - prompt: ${prompt}`,
    "    options:",
    "      - label: The first",
    "        recommended: true",
    "        because: It's simpler",
    "      - label: The second",
  ].join("\n"))
  return file
}

/** Stills in both themes, without the video's caption and with the pointer in a corner. */
async function shoot(page: Page, name: string, target: Page | Locator = page) {
  await page.mouse.move(1430, 890)
  const caption = (shown: boolean) =>
    page.evaluate((shown) => document.getElementById("e2e-caption")?.style.setProperty("visibility", shown ? "" : "hidden"), shown)
  await caption(false)
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await animationsSettled(page)
    await target.screenshot({ path: path.join(SHOTS, `cel-65-${name}-${theme}.png`) })
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"))
  await caption(true)
}

/** The board's id of the session Claude Code knows as `external`. */
const sessionId = async (cello: Parameters<typeof defaultWorkspace>[0], external: string) =>
  (await cello.run((c) => c["snapshot.get"]({}))).sessions.find((s) => s.externalId === external)!.id

const group = (page: Page, id: "waiting" | "working" | "quiet" | "finished") => page.locator(`section[data-agents-group="${id}"]`)
const rowsIn = (page: Page, id: "waiting" | "working" | "quiet") => group(page, id).locator("[data-agent-row]")

test.beforeEach(async ({ context }) => {
  // Review videos hold every step (e2e/recording.ts), which takes these flows past the default timeout, as on review.spec.ts.
  if (isReview(process.env)) test.setTimeout(180_000)
  await context.addInitScript(() => {
    if (localStorage.getItem("cello:agent-cursors") === null) localStorage.setItem("cello:agent-cursors", "off")
  })
})

test("CEL-65: Agents working opens the Agents page: agents in groups, subagents under their session, a row opens its card, the keys, Answer on Review, and it follows the agents live", async ({ page, cello }) => {
  test.setTimeout(240_000)
  const project = await seedProject(cello, "Cello", "CLO")
  const { statuses } = await defaultWorkspace(cello)
  const [ui, agents, comments] = await seedLabels(cello, project.id, [
    { name: "ui", color: "#5e6ad2" },
    { name: "agents", color: "#10b981" },
    { name: "comments", color: "#f59e0b" },
  ])
  for (const t of [
    { title: "Agents working: a page of every working agent", priority: 2, labels: [ui!.id, agents!.id] },
    { title: "Images in comments: paste and drop screenshots", priority: 3, labels: [comments!.id] },
    { title: "Reactions on comments", priority: 0, labels: [comments!.id, ui!.id] },
    { title: "Comment receipts: who has read a comment", priority: 4, labels: [comments!.id] },
  ] as const) {
    await cello.run((c) =>
      c["task.create"]({ commandId: newCommandId(), projectId: project.id, title: t.title, priority: t.priority, labelIds: [...t.labels], statusId: statuses.Todo!.id })
    )
  }

  // The quiet one first: it claims CLO-4 and builds, then goes quiet (the page's clock moves past it below).
  cli(QUIET)("task", "claim", "CLO-4")
  cli(QUIET)("task", "stage", "CLO-4", "building")
  const quietLast = Date.now()

  // The orchestrator claims CLO-1 and CLO-2 and launches a builder and a reviewer; they set their stages.
  const firstActive = Date.now()
  cli(ORCHESTRATOR)("task", "claim", "CLO-1")
  cli(ORCHESTRATOR)("task", "claim", "CLO-2")
  launch(BUILDER, "cello-builder", "CLO-1 build the Agents page, phase 1")
  launch(REVIEWER, "cello-code-reviewer", "CLO-2 review the images-in-comments branch")
  cli(ORCHESTRATOR, { agent: `cello-builder/${BUILDER}` })("task", "stage", "CLO-1", "building")
  cli(ORCHESTRATOR, { agent: `cello-code-reviewer/${REVIEWER}` })("task", "stage", "CLO-2", "review")

  // Another session claims CLO-3 and asks Lucas: Needs input.
  cli(ASKER)("task", "claim", "CLO-3")
  cli(ASKER)("task", "ask", "CLO-3", "--file", askFile("Which reactions", "Which emoji set?"))

  // The page's clock goes past the quiet session's last check-in (5 min makes one quiet) but not past
  // the others': it's quiet, they're active.
  await page.clock.setFixedTime(quietLast + 5 * 60_000 + Math.max(1, (firstActive - quietLast) / 2))
  const [orchestrator, asker, quiet] = [await sessionId(cello, ORCHESTRATOR), await sessionId(cello, ASKER), await sessionId(cello, QUIET)]
  const builderRow = page.locator(`[data-agent-row="agent:${orchestrator}/${BUILDER}"]`)
  const reviewerRow = page.locator(`[data-agent-row="agent:${orchestrator}/${REVIEWER}"]`)
  const orchestratorRow = page.locator(`[data-agent-row="session:${orchestrator}"]`)
  const askerRow = page.locator(`[data-agent-row="session:${asker}"]`)

  await page.goto("/CLO/issues")
  const sidebarLink = page.locator('aside[data-sidebar="expanded"] a[data-agents-working]')
  await caption(page, "Agents working in the sidebar is a link now: click it")
  await expect(sidebarLink).toHaveAttribute("data-agents-working", "4")
  // Just the link and its count: the agents are listed on the Agents page, not under it (Lucas, Nov 16).
  await expect(page.locator('aside[data-sidebar="expanded"] [data-agents-list]')).toHaveCount(0)
  await sidebarLink.click()
  await expect(page).toHaveURL(/\/agents$/)
  await expect(sidebarLink).toHaveAttribute("data-status", "active")

  await caption(page, "The Agents page: waiting on you first, then working, then quiet")
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Agents working 4")
  await expect(rowsIn(page, "waiting")).toHaveCount(1)
  await expect(askerRow).toHaveAttribute("data-agent-group", "waiting")
  await expect(askerRow.locator("[data-agent-task-state]")).toHaveText("Needs input")
  await expect(rowsIn(page, "working")).toHaveCount(3)
  await expect(page.locator(`[data-agent-row="session:${quiet}"]`)).toHaveAttribute("data-agent-group", "quiet")
  await expect(page.locator(`[data-agent-row="session:${quiet}"] [data-agent-presence]`)).toHaveText("seen 5m ago")

  await caption(page, "The orchestrator, its two subagents under it, each on its task with its stage")
  await expect(orchestratorRow).toContainText("2fd0505c")
  await expect(orchestratorRow).toContainText("Main session")
  await expect(orchestratorRow).toContainText("2 subagents")
  await expect(orchestratorRow).toContainText("holds CLO-1, CLO-2")
  // CEL-104: the orchestrator shows its task's state on the right, like any session, not a blank.
  await expect(orchestratorRow.locator("[data-agent-task-state]").first()).toHaveText("Building")
  // Under it, in order, indented.
  const working = await rowsIn(page, "working").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-agent-row")))
  expect(working[0]).toBe(`session:${orchestrator}`)
  expect(working.slice(1).sort()).toEqual([`agent:${orchestrator}/${BUILDER}`, `agent:${orchestrator}/${REVIEWER}`].sort())
  await expect(builderRow.locator("xpath=..")).toHaveClass(/pl-6/)
  await expect(builderRow).toContainText("cello-builder · a13bfb89")
  await expect(builderRow).toContainText("Subagent of 2fd0505c")
  await expect(builderRow).toContainText("on CLO-1 Agents working: a page of every working agent")
  await expect(builderRow.locator("[data-agent-task-state]")).toHaveText("Building")
  await expect(reviewerRow.locator("[data-agent-task-state]")).toHaveText("Agent review")
  await expect(builderRow.locator(".agent-mark")).toHaveAttribute("data-agent-mood", "working")
  await expect(askerRow.locator(".agent-mark")).toHaveAttribute("data-agent-mood", "waiting")
  await shoot(page, "page")
  await shoot(page, "sidebar", page.locator('aside[data-sidebar="expanded"] nav[aria-label="Inbox"]'))

  await captionWithUrl(page, "Open the builder: what it was asked, its card (no repeat of its name), and its live log")
  await builderRow.getByRole("button").first().click()
  await expect(page).toHaveURL((url) => url.searchParams.get("open") === `agent:${orchestrator}/${BUILDER}`)
  await expect(builderRow.locator("[data-agent-facts]")).toContainText("Asked toCLO-1 build the Agents page, phase 1")
  await expect(builderRow.locator("[data-agent-facts]")).toContainText("SessionClaude Code session 2fd0505c")
  const builderCard = builderRow.locator('[data-agents-card="CLO-1"]')
  await expect(builderCard).toContainText("Agents working: a page of every working agent")
  await expect(builderCard.locator("[data-card-work]")).toHaveCount(0)
  // The edge of the agent at work on it (CEL-76) sits on this card, not somewhere up the page.
  const [cardBox, edgeBox] = [await builderCard.boundingBox(), await builderCard.locator("[data-activity-edge]").boundingBox()]
  expect(edgeBox!.y).toBeGreaterThanOrEqual(cardBox!.y)
  expect(edgeBox!.y + edgeBox!.height).toBeLessThanOrEqual(cardBox!.y + cardBox!.height)
  expect(Math.abs(edgeBox!.x - cardBox!.x)).toBeLessThan(4)
  // No hook reported a transcript for it here: the log says so (CEL-106 follows a real one in agent-log.spec.ts).
  await expect(builderRow.locator("[data-agent-log] [data-log-unavailable]")).toHaveAttribute("data-log-unavailable", "none")
  await shoot(page, "open")

  await caption(page, "Click its card: the task opens in the side panel, and the Agents page stays (CEL-141)")
  await builderCard.click()
  await expect(page).toHaveURL((url) => url.pathname === "/agents" && url.searchParams.get("viewer") === "/CLO/1")
  await expect(page.getByRole("complementary", { name: "Viewer" }).getByRole("heading", { name: /CLO-1/ })).toBeVisible()
  await page.getByRole("complementary", { name: "Viewer" }).getByRole("button", { name: "Close viewer" }).click()
  await expect(builderRow.locator("[data-agent-facts]")).toBeVisible()
  // A fresh page, as a reload or a link to it: the keys start from the open row, not the card last clicked.
  await page.reload()
  await expect(builderRow.locator("[data-agent-facts]")).toBeVisible()

  await caption(page, "The keys: Esc closes, ↓ and j move between rows, Enter opens")
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press("Escape")
  await expect(page.locator("[data-agent-facts]")).toHaveCount(0)
  await page.keyboard.press("j")
  await expect(askerRow.getByRole("button").first()).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await expect(orchestratorRow.getByRole("button").first()).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(orchestratorRow.locator("[data-agent-facts]")).toBeVisible()
  await expect(orchestratorRow.locator('[data-agents-card="CLO-1"]')).toBeVisible()
  await expect(orchestratorRow.locator('[data-agents-card="CLO-2"]')).toBeVisible()
  await page.keyboard.press("k")
  await expect(askerRow.getByRole("button").first()).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(orchestratorRow.locator("[data-agent-facts]")).toHaveCount(0)

  await caption(page, "The agent waiting on you: Answer on Review opens its question there")
  const waiting = askerRow.locator("[data-agent-waiting]")
  await expect(waiting).toContainText("Waiting for your answer on CLO-3.")
  await shoot(page, "waiting")
  await waiting.getByRole("link", { name: "Answer on Review" }).click()
  await expect(page).toHaveURL(/\/review\?open=CLO-3/)
  await expect(page.locator('[data-review-task="CLO-3"]')).toHaveAttribute("data-open", "")
  await page.goBack()
  await expect(page).toHaveURL(/\/agents/)

  await caption(page, "Live: the orchestrator launches a visual reviewer on CLO-1, and its row appears under it")
  await page.keyboard.press("Escape")
  launch(VISUAL, "cello-visual-reviewer", "CLO-1 check the Agents page screenshots")
  const visualRow = page.locator(`[data-agent-row="agent:${orchestrator}/${VISUAL}"]`)
  await expect(visualRow).toHaveAttribute("data-agent-group", "working")
  await expect(visualRow).toContainText("cello-visual-reviewer · c4e2f9a0")
  await expect(orchestratorRow).toContainText("Main session")
  await expect(orchestratorRow).toContainText("3 subagents")

  await caption(page, "The code reviewer finishes (SubagentStop): its row folds into Finished today (CEL-107)")
  hook("subagent-stop", { session_id: ORCHESTRATOR, agent_id: REVIEWER, agent_type: "cello-code-reviewer", hook_event_name: "SubagentStop" })
  await expect(reviewerRow).toHaveAttribute("data-agent-group", "finished")
  await expect(group(page, "finished").locator(`[data-agent-row="agent:${orchestrator}/${REVIEWER}"]`)).toHaveCount(1)
  await expect(orchestratorRow).toContainText("Main session")
  await expect(orchestratorRow).toContainText("2 subagents")

  await caption(page, "The orchestrator asks you about CLO-2: it moves up to Waiting on you, its working subagents still under it")
  cli(ORCHESTRATOR)("task", "ask", "CLO-2", "--file", askFile("Which drop zone", "Where can screenshots be dropped?"))
  await expect(orchestratorRow).toHaveAttribute("data-agent-group", "waiting")
  // CEL-104: subagents stay under their session, so the builder and the visual reviewer move up with it,
  // each still saying it's working (its own group), not waiting.
  await expect(rowsIn(page, "waiting")).toHaveCount(4)
  await expect(group(page, "waiting").locator(`[data-agent-row="agent:${orchestrator}/${BUILDER}"]`)).toHaveCount(1)
  await expect(builderRow).toHaveAttribute("data-agent-group", "working")
  await expect(builderRow.locator("xpath=..")).toHaveClass(/pl-6/)
  await expect(builderRow).toContainText("Subagent of 2fd0505c")
  // It waits on CLO-2, not its first task: that's what its row says and its link opens.
  await expect(orchestratorRow.locator("[data-agent-task-state]")).toHaveText("Needs input")
  await orchestratorRow.getByRole("button").first().click()
  await expect(orchestratorRow.locator("[data-agent-waiting]")).toContainText("Waiting for your answer on CLO-2.")
  await expect(orchestratorRow.getByRole("link", { name: "Answer on Review" })).toHaveAttribute("href", "/review?open=CLO-2")
  await shoot(page, "live")

  cli(ORCHESTRATOR)("task", "ask", "CLO-2", "--withdraw")
  cli(ASKER)("task", "ask", "CLO-3", "--withdraw")
  for (const [id, type] of [[BUILDER, "cello-builder"], [VISUAL, "cello-visual-reviewer"]] as const) {
    hook("subagent-stop", { session_id: ORCHESTRATOR, agent_id: id, agent_type: type, hook_event_name: "SubagentStop" })
  }
  for (const [session, key] of [[ORCHESTRATOR, "CLO-1"], [ORCHESTRATOR, "CLO-2"], [ASKER, "CLO-3"], [QUIET, "CLO-4"]] as const) cli(session)("task", "release", key)
})

test("CEL-65: an open row's card is not one big link: its evidence badge opens the evidence, the card's title link opens the task", async ({ page, cello }) => {
  const SUBMITTER = "d1e2f3a4-0b1c-4d2e-8f3a-4b5c6d7e8f90"
  const project = await seedProject(cello, "Packets", "PKT")
  const { statuses } = await defaultWorkspace(cello)
  await cello.run((c) =>
    c["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Review packets on the Agents page", priority: 2, labelIds: [], statusId: statuses.Todo!.id })
  )
  // A session claims it and hands it in with a real screenshot: it still holds the task, now with open evidence.
  await page.goto("/PKT/issues")
  const shot = path.join(work, "pkt-board.png")
  await page.screenshot({ path: shot })
  cli(SUBMITTER)("task", "claim", "PKT-1")
  cli(SUBMITTER)("task", "submit", "PKT-1", "--summary", "The packet.", "--step", "Open it", "--attach", shot, "--caption", "The board")
  const row = page.locator(`[data-agent-row="session:${await sessionId(cello, SUBMITTER)}"]`)

  await page.goto("/agents")
  await caption(page, "Open the agent: its card has the packet's evidence badge")
  await row.getByRole("button").first().click()
  const card = row.locator('[data-agents-card="PKT-1"]')
  const badge = card.locator("[data-evidence-badge]")
  await expect(badge).toContainText("1")
  // The card is a container, not a link around the badge: no button inside a link.
  await expect(card).not.toHaveAttribute("href")
  expect(await badge.evaluate((el) => el.closest("a") === null)).toBe(true)
  await expect(card.getByRole("link", { name: "Review packets on the Agents page" })).toHaveAttribute("href", "/PKT/1")

  await caption(page, "Click the evidence badge: the screenshot opens, the task doesn't")
  await badge.click()
  const modal = page.locator("[data-image-modal]")
  await expect(modal).toBeVisible()
  await expect(page).toHaveURL(/\/agents/)
  await page.keyboard.press("Escape")
  await expect(modal).toHaveCount(0)
  await expect(page).toHaveURL(/\/agents/)

  await caption(page, "Click elsewhere on the card: the task opens, in the side panel")
  const box = (await card.boundingBox())!
  await page.mouse.click(box.x + box.width - 12, box.y + box.height - 8)
  await expect(page).toHaveURL((url) => url.pathname === "/agents" && url.searchParams.get("viewer") === "/PKT/1")

  cli(SUBMITTER)("task", "release", "PKT-1")
})

test("CEL-137: each session's row says where it runs: Terminal · WezTerm, Claude desktop, Agent SDK app; open, Runs in", async ({ page, cello, baseURL }) => {
  const project = await seedProject(cello, "Origins", "ORG")
  const { statuses } = await defaultWorkspace(cello)
  // Three sessions, as each one's `cello` calls report it: Claude Code's entrypoint, and the terminal app.
  const sessions: ReadonlyArray<{ id: string; headers: Record<string, string>; label: string; title: string }> = [
    { id: "c137e2e1-term-session", headers: { "x-cello-entrypoint": "cli", "x-cello-terminal": "WezTerm" }, label: "Terminal · WezTerm", title: "Make the timer louder" },
    { id: "c137e2e2-desk-session", headers: { "x-cello-entrypoint": "claude-desktop" }, label: "Claude desktop", title: "Add a dark icon" },
    { id: "c137e2e3-sdk0-session", headers: { "x-cello-entrypoint": "sdk-ts" }, label: "Agent SDK app", title: "Sync the presets" },
  ]
  const agents = []
  for (const [i, s] of sessions.entries()) {
    await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title: s.title, statusId: statuses.Todo!.id }))
    const agent = await openClient(`${baseURL!.replace(/^http/, "ws")}/rpc`, {
      "x-cello-session": s.id,
      "x-cello-client": "Claude Code",
      // This test's own process: alive, so the session stays working.
      "x-cello-pid": String(process.pid),
      "x-cello-cwd": cwd,
      ...s.headers,
    })
    await agent.run((c) => c["task.claim"]({ commandId: newCommandId(), key: `ORG-${i + 1}` }))
    agents.push(agent)
  }

  await page.goto("/agents")
  await caption(page, "Each session's row says where it runs: a terminal (and which app), the Claude desktop app, an app built on the Agent SDK")
  for (const s of sessions) {
    await expect(page.locator("[data-agent-row]", { hasText: s.id.slice(0, 8) }).locator("[data-origin]")).toHaveText(s.label)
  }
  const term = page.locator("[data-agent-row]", { hasText: "c137e2e1" })
  await shoot(page, "origin-rows", page.locator("section[data-agents-group='working']"))

  await caption(page, "Open one: its details say where it runs too")
  await term.getByRole("button").first().click()
  await expect(term.locator("[data-agent-origin]")).toHaveText("Runs inTerminal · WezTerm")
  await shoot(page, "origin-open", term)

  await caption(page, "The task panel's Working on it line says it as well")
  await page.goto("/ORG/2")
  await expect(page.locator("[data-working-on-it] [data-origin]")).toHaveText("Claude desktop")

  for (const [i, agent] of agents.entries()) await agent.run((c) => c["task.release"]({ commandId: newCommandId(), key: `ORG-${i + 1}` }))
})

test("CEL-65: on the rail, the bot opens the Agents page too", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Collapse sidebar" }).click()
  const rail = page.locator('aside[data-sidebar="rail"] a[data-agents-working]')
  await caption(page, "The rail's bot opens the Agents page, and is marked while it's open")
  await rail.click()
  await expect(page).toHaveURL(/\/agents$/)
  await expect(rail).toHaveAttribute("data-status", "active")
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Agents working")
})

test("CEL-163: the Agents page keeps its content aligned left at a wide, a mid and a narrow width, not centred", async ({ page, cello }) => {
  const project = await seedProject(cello, "Aligned", "ALN")
  const { statuses } = await defaultWorkspace(cello)
  await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Keep the column on the left", statusId: statuses.Todo!.id }))
  cli(QUIET)("task", "claim", "ALN-1")

  await page.goto("/agents")
  const row = page.locator("[data-agent-row]").first()
  await expect(row).toBeVisible()
  const scroller = page.locator("[data-agents-scroller]")
  const heading = page.getByRole("heading", { level: 1 })
  // The page's scroll area is 240 px narrower than the window (the sidebar): 1440 is wide (1152+), 1100 and 900 are not.
  for (const width of [1440, 1100, 900]) {
    await captionWithUrl(page, `${width} px wide: the heading and the rows start at the left edge, the same as at any width`)
    await page.setViewportSize({ width, height: 900 })
    await expectLeftAligned(scroller, heading)
    await expectLeftAligned(scroller, row)
  }
  await shoot(page, "left-aligned-mid")
  cli(QUIET)("task", "release", "ALN-1")
})

for (const theme of ["light", "dark"] as const) {
  test(`CEL-186 (${theme}): rows keep their place while agents work: a check-in pulses its row instead of moving it, an idle page runs nothing, a row that leaves or changes group moves there`, async ({ page, cello, baseURL }) => {
    const key = theme === "light" ? "STD" : "STK"
    const project = await seedProject(cello, `Steady ${theme}`, key)
    const { statuses } = await defaultWorkspace(cello)
    for (const title of ["Make the timer louder", "Add a dark icon", "Sync the presets"]) {
      await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title, statusId: statuses.Todo!.id }))
    }
    // Three agents start one after another (this test's process is alive, so they stay working).
    const externals = [`c186${theme}1-first-session`, `c186${theme}2-second-session`, `c186${theme}3-third-session`] as const
    const agents: Array<Awaited<ReturnType<typeof agentAs>>> = []
    for (const [i, external] of externals.entries()) {
      const agent = await agentAs(baseURL!, external, process.pid)
      await agent.run((c) => c["task.claim"]({ commandId: newCommandId(), key: `${key}-${i + 1}` }))
      agents.push(agent)
    }
    const [first, second, third] = [await sessionId(cello, externals[0]), await sessionId(cello, externals[1]), await sessionId(cello, externals[2])]
    const mine = [first, second, third].map((id) => `session:${id}`)
    /** Our rows in a group, in the order the page shows them, `ids` exactly (another test's agents may share the workspace). */
    const expectOrder = async (id: "waiting" | "working", ids: ReadonlyArray<string>) => {
      const ours = group(page, id).locator(mine.map((m) => `[data-agent-row="${m}"]`).join(", "))
      await expect(ours).toHaveCount(ids.length)
      for (const [i, row] of ids.entries()) await expect(ours.nth(i)).toHaveAttribute("data-agent-row", row)
    }
    const rowOf = (id: string) => page.locator(`li:has([data-agent-row="session:${id}"])`)
    /** Nothing on the page is running but the working agents' marks (they loop by design, CEL-69), and no row is mid-move. */
    const expectIdle = async () => {
      expect(await contentAnimations(page, ".agent-mark")).toBe(0)
      await expect(page.locator("main li[style*='transform']:not([style*='none'])")).toHaveCount(0)
    }
    /** A pulse that shows: its wash and ring come up past half (a span left at opacity 0 fails this). */
    const expectPulse = (id: string) => expect(rowOf(id).locator("[data-agent-pulse]")).toHaveCSS("opacity", /^(0\.[5-9]\d*|1)$/)

    // The theme is in place before the first paint (index.html reads it), so the video doesn't open white.
    await page.addInitScript((t) => localStorage.setItem("cello:theme", t), theme)
    await page.goto("/agents")
    await caption(page, "Three agents working, in the order they started: first, second, third")
    await expectOrder("working", mine)
    await expect(page.locator("[data-agent-pulse]")).toHaveCount(0)

    // A board hears an agent check in at most once a minute while it makes calls (PRESENCE_EVERY_MS); a
    // wait that hands it a comment is heard at once: that's the check-in this test can make happen now.
    const checkIn = async (i: 0 | 2, body: string) => {
      const wait = agents[i]!.run((c) => c["inbox.wait"]({}))
      const task = (await cello.run((c) => c["snapshot.get"]({}))).tasks.find((t) => t.key === `${key}-${i + 1}`)!
      await cello.run((c) => c["comment.add"]({ commandId: newCommandId(), taskId: task.id, body }))
      await wait
    }
    await caption(page, "The third agent checks in: its row pulses where it is, and nothing moves")
    await agents[2]!.run((c) => c["task.stage"]({ commandId: newCommandId(), key: `${key}-3`, stage: "building" }))
    await checkIn(2, "Louder, please.")
    await expectPulse(third)
    await expectOrder("working", mine)
    await caption(page, "Then the first one checks in: the same, at the top")
    await checkIn(0, "Ship it when green.")
    await expectPulse(first)
    await expectOrder("working", mine)

    await caption(page, "Once the pulses end, they rest invisible: only the working agents' marks keep moving")
    await animationsSettled(page)
    await expect(rowOf(first).locator("[data-agent-pulse]")).toHaveCSS("opacity", "0")
    await expectIdle()

    await caption(page, "The second agent lets its task go: its row folds away, and the others close the gap")
    await agents[1]!.run((c) => c["task.release"]({ commandId: newCommandId(), key: `${key}-2` }))
    await expect(rowOf(second)).toHaveCount(0)
    await expectOrder("working", [mine[0]!, mine[2]!])

    await caption(page, "The third agent asks you something: its row slides up to Waiting on you")
    cli(externals[2])("task", "ask", `${key}-3`, "--file", askFile(`How loud ${theme}`, "Which volume?"))
    await expectOrder("waiting", [mine[2]!])
    await expectOrder("working", [mine[0]!])
    await animationsSettled(page)
    await expectIdle()

    // The video ends on the last state it shows, not under a caption over an emptied page.
    await page.evaluate(() => document.getElementById("e2e-caption")?.remove())
    await agents[0]!.run((c) => c["task.release"]({ commandId: newCommandId(), key: `${key}-1` }))
    await agents[2]!.run((c) => c["task.release"]({ commandId: newCommandId(), key: `${key}-3` }))
  })
}

for (const theme of ["light", "dark"] as const) {
  test(`CEL-188 (${theme}): the Agents page narrows to a project: chips with counts, ↓ and j walk only the shown rows, the pick survives a reload, All brings everything back`, async ({ page, cello, baseURL }) => {
    const [keyA, keyB] = theme === "light" ? ["CAL", "CBL"] : ["CAD", "CBD"]
    const nameA = `Chips Alpha ${theme}`
    const nameB = `Chips Beta ${theme}`
    const [projectA, projectB] = [await seedProject(cello, nameA, keyA), await seedProject(cello, nameB, keyB)]
    const { statuses } = await defaultWorkspace(cello)
    for (const [project, titles] of [
      [projectA, ["Make the timer louder", "Add a dark icon"]],
      [projectB, ["Sync the presets"]],
    ] as const) {
      for (const title of titles) {
        await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title, statusId: statuses.Todo!.id }))
      }
    }
    // Three agents, one after another (this test's process is alive, so they stay working): two on Alpha, one on Beta.
    const externals = [`c188${theme}1-first-session`, `c188${theme}2-second-session`, `c188${theme}3-third-session`] as const
    const claims = [`${keyA}-1`, `${keyA}-2`, `${keyB}-1`] as const
    for (const [i, external] of externals.entries()) {
      const agent = await agentAs(baseURL!, external, process.pid)
      await agent.run((c) => c["task.claim"]({ commandId: newCommandId(), key: claims[i]! }))
    }
    const [first, second, third] = (await Promise.all(externals.map((e) => sessionId(cello, e)))).map((id) => page.locator(`[data-agent-row="session:${id}"]`)) as [Locator, Locator, Locator]
    // Every row the page shows: with a pick, only that project's (another test's agents are on other projects).
    const mine = page.locator("[data-agent-row]")
    const chip = (name: string, count: number) => page.getByRole("radio", { name: `${name} ${count}` })

    await page.addInitScript((t) => localStorage.setItem("cello:theme", t), theme)
    await page.goto("/agents")
    await caption(page, "Agents on All: three agents, on two projects")
    await expect(first).toBeVisible()
    await expect(second).toBeVisible()
    await expect(third).toBeVisible()
    await expect(chip(nameA, 2)).toBeVisible()
    await expect(chip(nameB, 1)).toBeVisible()
    await expect(page.getByRole("radio", { name: /^All \d+$/ })).toHaveAttribute("aria-checked", "true")

    await caption(page, `Pick ${nameA}: only its two agents stay, and the page count follows`)
    await chip(nameA, 2).click()
    await expect(mine).toHaveCount(2)
    await expect(first).toBeVisible()
    await expect(second).toBeVisible()
    await expect(third).toHaveCount(0)
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Agents working 2")

    await caption(page, "↓ and j move between the shown rows only, and stop at the last one")
    await first.getByRole("button").first().focus()
    await page.keyboard.press("ArrowDown")
    await expect(second.getByRole("button").first()).toBeFocused()
    await page.keyboard.press("j")
    await expect(second.getByRole("button").first()).toBeFocused()
    await page.keyboard.press("k")
    await expect(first.getByRole("button").first()).toBeFocused()

    await captionWithUrl(page, "Reload: the pick stays on this device")
    await page.reload()
    await expect(chip(nameA, 2)).toHaveAttribute("aria-checked", "true")
    await expect(mine).toHaveCount(2)

    // A pick snaps the rows: from here on, watch for any row that is mid-move (motion gives it a transform while it glides).
    await page.evaluate(() => {
      const moved: string[] = []
      Object.assign(window, { rowMoved: moved })
      new MutationObserver(() => {
        for (const li of document.querySelectorAll("main li[style*='transform']:not([style*='none'])")) moved.push(`${li.querySelector("[data-agent-row]")?.getAttribute("data-agent-row")}: ${li.getAttribute("style")}`)
      }).observe(document.querySelector("main")!, { subtree: true, attributes: true, attributeFilter: ["style"] })
    })
    await caption(page, `Pick ${nameB}: the other agent shows alone, and takes the top place at once`)
    await chip(nameB, 1).click()
    await expect(mine).toHaveCount(1)
    await expect(third).toBeVisible()
    await expect(first).toHaveCount(0)

    await caption(page, "All: everything is back")
    await page.getByRole("radio", { name: /^All \d+$/ }).click()
    await expect(first).toBeVisible()
    await expect(second).toBeVisible()
    await expect(third).toBeVisible()
    await expect(page.getByRole("radio", { name: /^All \d+$/ })).toHaveAttribute("aria-checked", "true")
    expect(await page.evaluate(() => (window as unknown as { rowMoved: string[] }).rowMoved)).toEqual([])
  })
}

const SORT_BUILDER = "c188sortbuilder01"

test("CEL-188: the Agents page's Display menu sorts the rows: Project goes by the project's name, Started brings the order back; the trigger names the sort, and it is kept after a reload", async ({ page, cello, baseURL }) => {
  const keys = ["SRZ", "SRA", "SRM"] as const
  const names = ["Sort Zeta", "Sort Alpha", "Sort Mid"] as const
  const { statuses } = await defaultWorkspace(cello)
  for (const [i, key] of keys.entries()) {
    const project = await seedProject(cello, names[i]!, key)
    await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title: `Task in ${names[i]}`, statusId: statuses.Todo!.id }))
  }
  // Three agents start one after another, each on a task of a different project: Zeta, Alpha, Mid.
  const externals = ["c188sort1-first-session", "c188sort2-second-session", "c188sort3-third-session"] as const
  for (const [i, external] of externals.entries()) {
    const agent = await agentAs(baseURL!, external, process.pid)
    await agent.run((c) => c["task.claim"]({ commandId: newCommandId(), key: `${keys[i]}-1` }))
  }
  // The first session (Zeta) is an orchestrator: a builder under it stays with it under every sort.
  hooks.launch(externals[0], SORT_BUILDER, "cello-builder", `${keys[0]}-1 build the Zeta task`)
  const sessions = await Promise.all(externals.map((e) => sessionId(cello, e)))
  const ids = [...sessions.map((id) => `session:${id}`), `agent:${sessions[0]}/${SORT_BUILDER}`]
  const mine = page.locator(ids.map((id) => `[data-agent-row="${id}"]`).join(", "))
  /** Our rows, in the order the page shows them. */
  const expectOrder = async (order: ReadonlyArray<number>) => {
    await expect(mine).toHaveCount(order.length)
    for (const [i, n] of order.entries()) await expect(mine.nth(i)).toHaveAttribute("data-agent-row", ids[n]!)
  }
  const display = page.getByRole("button", { name: /^Display/ })
  const pickSort = async (label: string) => {
    await display.click()
    await caption(page, `The Display menu is open: Sort by ${label}`)
    const sort = page.getByRole("combobox", { name: "Sort", exact: true })
    await sort.click()
    await page.getByRole("option", { name: label, exact: true }).click()
    await expect(sort).toContainText(label)
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog", { name: "Display options" })).toBeHidden()
  }

  await page.goto("/agents")
  await caption(page, "Three agents, in the order they started: Zeta (with its builder), Alpha, Mid")
  await expectOrder([0, 3, 1, 2])
  await expect(display).toHaveText("Display")

  await caption(page, "Sort by Project: Alpha, Mid, then Zeta, its builder still under it")
  await pickSort("Project")
  await expectOrder([1, 2, 0, 3])
  await expect(display).toContainText(/Display\s*· Project/)

  await captionWithUrl(page, "Reload: the sort stays on this device")
  await page.reload()
  await expectOrder([1, 2, 0, 3])
  await expect(display).toContainText(/Display\s*· Project/)

  await caption(page, "Sort by Started: the order they began is back")
  await pickSort("Started")
  await expectOrder([0, 3, 1, 2])
  await expect(display).toHaveText("Display")
})
