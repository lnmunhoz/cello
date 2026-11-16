// CEL-65 phase 1, design scope: the Agents page's three prototype layouts (`/agents?agents=a|b|c`),
// with real agents seeded through the real `cello` CLI and its Claude Code hooks: an orchestrator
// session holding two tasks, its cello-builder and cello-code-reviewer subagents (launched and checked
// in by the hooks), a session waiting on Lucas in Needs input (`cello task ask`), and a quiet one. Stills
// in light and dark go to e2e/videos/ (cel-65-*.png) for the scope. Agent cursors are off.
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Locator, Page } from "@playwright/test"
import { animationsSettled, defaultWorkspace, expect, newCommandId, seedLabels, seedProject, test } from "./fixtures.ts"
import { SHOTS } from "./packets.ts"

const root = path.resolve(import.meta.dirname, "..")
const SERVER_PORT = Number(process.env.CELLO_E2E_SERVER_PORT ?? 4791)

const ORCHESTRATOR = "2fd0505c-417a-4167-acfe-2d66080fcae0"
const ASKER = "8a41c9e2-5b1d-4c7e-9a0f-3e2b1c4d5e6f"
const QUIET = "5c07e1aa-77b2-4f3c-8d21-0a9b8c7d6e5f"
const BUILDER = "a13bfb89c0de1234f"
const REVIEWER = "b77d0e11aa22bb33c"

// Each session works from a folder named like the repo it's in, as Claude Code's sessions do.
const work = fs.mkdtempSync(path.join(os.tmpdir(), "cel65-"))
const folder = (name: string) => {
  const dir = path.join(work, name)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * The real `cello` CLI from source against the e2e server, as Claude Code session `session` (the
 * Playwright worker's pid stands in for Claude Code's, so the session stays alive), with `agent` as
 * CELLO_AGENT and `stdin` piped in (a hook's JSON).
 */
const cli = (session: string | null, cwd: string, options: { agent?: string; stdin?: string } = {}) => (...args: string[]) => {
  const result = spawnSync("bun", [path.join(root, "apps/cli/src/bin.ts"), ...args], {
    cwd,
    encoding: "utf8",
    input: options.stdin ?? "",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      CELLO_PORT: String(SERVER_PORT),
      CLAUDE_PID: String(process.pid),
      ...(session ? { CLAUDE_CODE_SESSION_ID: session } : {}),
      ...(options.agent ? { CELLO_AGENT: options.agent } : {}),
    },
  })
  if (result.status !== 0) throw new Error(`cello ${args.join(" ")} failed: ${result.stderr}`)
  return result.stdout.trim()
}

/** A Claude Code hook firing: `cello hook claude <event>` with the hook's JSON on stdin, as Claude Code runs it. */
const hook = (event: string, input: Record<string, unknown>) => cli(null, String(input.cwd), { stdin: JSON.stringify(input) })("hook", "claude", event)

async function shoot(page: Page, name: string, target: Page | Locator = page) {
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await animationsSettled(page)
    await target.screenshot({ path: path.join(SHOTS, `cel-65-${name}-${theme}.png`) })
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"))
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (localStorage.getItem("cello:agent-cursors") === null) localStorage.setItem("cello:agent-cursors", "off")
    // The prototype switch: this device has opened the Agents page, so the sidebar links to it.
    if (localStorage.getItem("cello:agents-page") === null) localStorage.setItem("cello:agents-page", "a")
  })
})

test("CEL-65 scope: the Agents page in three layouts, with an orchestrator, its builder and reviewer, an agent waiting on Lucas and a quiet one", async ({ page, cello }) => {
  test.setTimeout(180_000)
  const project = await seedProject(cello, "Cello", "CEL")
  const { statuses } = await defaultWorkspace(cello)
  const [ui, agents, comments] = await seedLabels(cello, [
    { name: "ui", color: "#5e6ad2" },
    { name: "agents", color: "#10b981" },
    { name: "comments", color: "#f59e0b" },
  ])
  const tasks = [
    { title: "Agents working: a page of every working agent", priority: 2, labels: [ui!.id, agents!.id] },
    { title: "Images in comments: paste and drop screenshots", priority: 3, labels: [comments!.id] },
    { title: "Reactions on comments", priority: 0, labels: [comments!.id, ui!.id] },
    { title: "Comment receipts: who has read a comment", priority: 4, labels: [comments!.id] },
  ] as const
  for (const t of tasks) {
    await cello.run((c) =>
      c["task.create"]({ commandId: newCommandId(), projectId: project.id, title: t.title, priority: t.priority, labelIds: [...t.labels], statusId: statuses.Todo!.id })
    )
  }

  // The quiet one goes first: it claims CEL-4 and builds, then goes quiet (the clock moves past it below).
  const quiet = cli(QUIET, folder("cello"))
  quiet("task", "claim", "CEL-4")
  quiet("task", "stage", "CEL-4", "building")
  const quietLast = Date.now()

  // The orchestrator claims two tasks and launches a builder and a reviewer through the Agent tool:
  // SubagentStart, then PostToolUse on Agent (the launch's description names the task).
  const cwd = folder("cello")
  const firstActive = Date.now()
  const orchestrator = cli(ORCHESTRATOR, cwd)
  orchestrator("task", "claim", "CEL-1")
  orchestrator("task", "claim", "CEL-2")
  for (const [id, type, description] of [
    [BUILDER, "cello-builder", "CEL-1 build the Agents page, phase 1"],
    [REVIEWER, "cello-code-reviewer", "CEL-2 review the images-in-comments branch"],
  ] as const) {
    hook("subagent-start", { session_id: ORCHESTRATOR, cwd, agent_id: id, agent_type: type, hook_event_name: "SubagentStart" })
    hook("post-tool-use", {
      session_id: ORCHESTRATOR, cwd, hook_event_name: "PostToolUse", tool_name: "Agent",
      tool_input: { subagent_type: type, description, prompt: `${description}. Read AGENTS.md first.` },
      tool_response: { agentId: id, status: "async_launched" },
    })
    // Its first tool call checks it in under the session.
    hook("post-tool-use", { session_id: ORCHESTRATOR, cwd, agent_id: id, agent_type: type, hook_event_name: "PostToolUse", tool_name: "Read", tool_input: {} })
  }
  cli(ORCHESTRATOR, cwd, { agent: `cello-builder/${BUILDER}` })("task", "stage", "CEL-1", "building")
  cli(ORCHESTRATOR, cwd, { agent: `cello-code-reviewer/${REVIEWER}` })("task", "stage", "CEL-2", "review")

  // Another session claims CEL-3 and asks Lucas which emoji set: Needs input.
  const askerCwd = folder("cello")
  const asker = cli(ASKER, askerCwd)
  asker("task", "claim", "CEL-3")
  const askFile = path.join(askerCwd, "ask.yaml")
  fs.writeFileSync(askFile, [
    "title: Which reactions",
    "questions:",
    "  - prompt: Which emoji set?",
    "    options:",
    "      - label: Six fixed",
    "        recommended: true",
    "        because: Fast to pick, and enough for a one-person board",
    "      - label: Any emoji",
  ].join("\n"))
  asker("task", "ask", "CEL-3", "--file", askFile)

  // Move the page's clock past the quiet session's last check-in (5 min makes a session quiet), but
  // not past the others': it's quiet, they're active now.
  await page.clock.setFixedTime(quietLast + 5 * 60_000 + Math.max(1, (firstActive - quietLast) / 2))

  for (const layout of ["a", "b", "c"] as const) {
    await page.goto(`/agents?agents=${layout}`)
    const pageRoot = page.locator(`[data-agents-layout="${layout}"]`)
    await expect(pageRoot).toBeVisible()
    await expect(pageRoot.locator(`[data-agent-row="agent:${await sessionId(cello, ORCHESTRATOR)}/${BUILDER}"]`)).toBeVisible()
    await expect(page.locator(`[data-agent-row="session:${await sessionId(cello, QUIET)}"]`)).toContainText("seen 5m ago")
    await shoot(page, `${layout}-page`)
    if (layout !== "c") {
      // Open the builder's row: its card and facts, and where its live log will go.
      const builderRow = pageRoot.locator(`[data-agent-row="agent:${await sessionId(cello, ORCHESTRATOR)}/${BUILDER}"]`)
      await builderRow.getByRole("button").first().click()
      await expect(builderRow.locator("[data-log-placeholder]")).toBeVisible()
      await page.mouse.move(1400, 880)
      await shoot(page, `${layout}-open`)
    }
  }

  // The sidebar's Agents working, a link now, highlighted on its page.
  const sidebar = page.locator('aside[data-sidebar="expanded"] nav[aria-label="Inbox"]')
  await expect(sidebar.locator("a[data-agents-working]")).toHaveAttribute("data-status", "active")
  await shoot(page, "sidebar", sidebar)
})

/** The board's id of the session Claude Code knows as `external`. */
async function sessionId(cello: Parameters<typeof defaultWorkspace>[0], external: string) {
  const snapshot = await cello.run((c) => c["snapshot.get"]({}))
  return snapshot.sessions.find((s) => s.externalId === external)!.id
}
