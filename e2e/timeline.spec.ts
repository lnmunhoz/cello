// CEL-160: a task's comments show what happened after each one. Comments stay cards, and between them, in
// time order, sit one-line events: stages, status moves, every subagent starting and finishing (with its
// model, and a reviewer's verdict read from its last reply), the merge, and the release that took it live.
// Runs of lines fold ("4 changes · show"); the scope shows two ways, `?fold=count` and `?fold=latest`.
//
// The story is CEL-147's: an orchestrator claims, a builder builds, the orchestrator comments "Now in agent
// review.", a reviewer says fix first, the builder fixes, the reviewer says merge, it merges and is submitted.
// It is seeded through the real `cello` CLI and its Claude Code hooks (the way Claude Code runs them), with
// the transcripts Claude Code would write invented in the e2e data folder. A second test serves two real
// builds in turn for the release line. Stills in light and dark go to e2e/videos/evidence/ (cel-160-*.png).
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Locator, Page } from "@playwright/test"
import { animationsSettled, caption, defaultWorkspace, expect, newCommandId, seedProject, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { celloIn, claudeHooks } from "./claudeHooks.ts"
import { buildWeb, freePort, seed, startCello, still, stop, stopAll } from "./servedBuilds.ts"
import { openClient } from "../packages/client/test/support/promiseClient.ts"

const SESSION = "c3e1a7f2-6d4b-4f8a-9c2e-1b0d5a7e9f31"
const BUILDER = "b0a1d2e3f4a5b6c7d"
const REVIEWER = "e5f4a3b2c1d0e9f8a"
const BUILDER_TYPE = "cello-builder"
const REVIEWER_TYPE = "cello-code-reviewer"

const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cel160-")))
const cwd = path.join(work, "timeline")
fs.mkdirSync(cwd, { recursive: true })
const cli = celloIn(cwd)(SESSION)
const hooks = claudeHooks(cwd)

// Where Claude Code keeps the transcripts: the server reads the models and efforts from the same folder.
const projects = path.join(process.env.CELLO_E2E_DATA!, "claude", "projects", "-work-timeline-cel160")
const sessionFile = path.join(projects, `${SESSION}.jsonl`)
const transcriptOf = (id: string) => path.join(projects, SESSION, "subagents", `agent-${id}.jsonl`)

let n = 0
/** A reply as Claude Code writes it: the model on the message, the effort beside it. */
const reply = (model: string, effort: string, text: string) =>
  `${JSON.stringify({ type: "assistant", uuid: `m${n++}`, timestamp: new Date().toISOString(), effort, message: { id: `msg${n}`, model, role: "assistant", content: [{ type: "text", text }] } })}\n`

/** The hooks Claude Code fires around a subagent, as the orchestrator's session. */
const subagent = (id: string, type: string) => {
  const common = { session_id: SESSION, transcript_path: sessionFile, agent_id: id, agent_type: type }
  return {
    /** The parent's Agent tool launched it for `description` (which names the task), and its first events. */
    launch: (description: string) => {
      hooks.hook("subagent-start", { ...common, hook_event_name: "SubagentStart" })
      hooks.hook("post-tool-use", {
        session_id: SESSION, transcript_path: sessionFile, hook_event_name: "PostToolUse", tool_name: "Agent",
        tool_input: { subagent_type: type, description, prompt: `${description}. Read AGENTS.md first.` },
        tool_response: { agentId: id, status: "async_launched" },
      })
    },
    /** A tool call of its own: it checks in, and a finished agent is working again. */
    toolCall: () => hooks.hook("post-tool-use", { ...common, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: {} }),
    /** SubagentStop, with the last reply Claude Code hands the hook. */
    stop: (lastMessage: string) => hooks.hook("subagent-stop", { ...common, hook_event_name: "SubagentStop", last_assistant_message: lastMessage }),
  }
}

const kindsOf = (page: Page | Locator) => page.locator("[data-timeline-line]").evaluateAll((els) => els.map((el) => el.getAttribute("data-timeline-line")))

/** The thread of `panel` in order: each item is a comment, a line or a fold. */
const threadOf = (root: Locator) =>
  root.locator("[data-comment-id], [data-timeline-line], [data-timeline-fold]").evaluateAll((els) =>
    els.map((el) =>
      el.hasAttribute("data-comment-id") ? "comment" : el.hasAttribute("data-timeline-fold") ? "fold" : `line:${el.getAttribute("data-timeline-line")}`
    ))

/** Stills of `page` in light and dark: e2e/videos/evidence/cel-160-<name>-light.png and -dark. */
async function shoot(page: Page, name: string) {
  await page.mouse.move(1430, 890)
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await animationsSettled(page)
    await still(page, `cel-160-${name}-${theme}`)
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"))
}

/** The thread in view in the open task: its Comments section at the top of the panel. */
const showThread = async (root: Locator) => {
  const heading = root.getByRole("region", { name: "Comments" })
  await heading.scrollIntoViewIfNeeded()
  await heading.evaluate((el) => el.scrollIntoView({ block: "start" }))
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (localStorage.getItem("cello:agent-cursors") === null) localStorage.setItem("cello:agent-cursors", "off")
  })
})

test.afterEach(stopAll)

test("CEL-160: comments, stages, status moves, every subagent's start and finish with a reviewer's verdict, the merge: one thread in time order; runs of lines fold", async ({ page, cello }) => {
  test.setTimeout(300_000)
  const key = uniqueKey("TLN")
  const project = await seedProject(cello, "Timeline", key)
  const { statuses } = await defaultWorkspace(cello)
  await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "One timeline of comments and events", priority: 2, statusId: statuses.Todo!.id }))
  const task = `${key}-1`
  const taskId = (await cello.run((c) => c["task.get"]({ key: task }))).task.id

  // Claude Code has written the transcripts: the orchestrator on Opus 5.5, the builder and the reviewer on Sonnet 5.5.
  fs.mkdirSync(path.dirname(transcriptOf(BUILDER)), { recursive: true })
  fs.writeFileSync(sessionFile, reply("claude-opus-5-5", "high", "Orchestrating."))
  fs.writeFileSync(transcriptOf(BUILDER), reply("claude-sonnet-5-5", "high", "Building it, test first."))
  fs.writeFileSync(transcriptOf(REVIEWER), reply("claude-sonnet-5-5", "medium", "Reading the diff."))
  const builder = subagent(BUILDER, BUILDER_TYPE)
  const reviewer = subagent(REVIEWER, REVIEWER_TYPE)

  // Before the page opens: Lucas's comment, the claim, the build stage, and a builder at work.
  await cello.run((c) => c["comment.add"]({ commandId: newCommandId(), taskId, body: "Show what happened after each comment, so I can tell when a review finished." }))
  cli("task", "claim", task)
  cli("task", "stage", task, "building")
  builder.launch(`${task} one timeline of comments and events`)
  builder.toolCall()

  // With one comment, the run after it is the newest and stays open: every line shows while it happens.
  await page.goto(`/${key}/1?fold=latest`)
  const panel = taskPanel(page, task)
  await expect(panel).toBeVisible()
  await showThread(panel)

  await caption(page, "A builder is on it: the thread says it started, and that it's working")
  await expect(panel.locator('[data-timeline-line="run_start"]')).toContainText("cello-builder started · Sonnet 5.5, high")
  await expect(panel.locator("[data-timeline-working]")).toHaveText("working")
  // Lucas's comment sits above what came after it: the stage, then the builder (a claim isn't a line).
  expect(await threadOf(panel)).toEqual(["comment", "line:stage", "line:run_start"])
  await shoot(page, "working")

  await caption(page, "The builder finishes: its line appears by itself, \"working\" goes")
  builder.stop("Built CEL-160 phase one; tests pass.")
  await expect(panel.locator('[data-timeline-line="run_end"]')).toContainText(/cello-builder finished in \d+ s/)
  await expect(panel.locator("[data-timeline-working]")).toHaveCount(0)

  await caption(page, "The orchestrator moves to agent review and comments; a reviewer says fix first")
  cli("task", "stage", task, "review")
  cli("task", "comment", task, "Now in agent review.")
  await expect(panel.locator("[data-comment-id]")).toHaveCount(2)
  reviewer.launch(`Review ${task}`)
  reviewer.toolCall()
  reviewer.stop("**Verdict: fix first** — two findings, both in the fold.")
  await expect(panel.locator('[data-verdict="fix_first"]')).toHaveText("Fix first")

  await caption(page, "The builder fixes it and the reviewer reads it again: each a second run")
  cli("task", "stage", task, "fixing")
  builder.toolCall()
  builder.stop("Fixed both.")
  reviewer.toolCall()
  reviewer.stop("Verdict: merge\n\nNo findings.")
  await expect(panel.locator('[data-verdict="merge"]')).toHaveText("Merge")

  await caption(page, "Merged, then submitted for review: the merge and the status move close the thread")
  cli("task", "stage", task, "merged")
  cli("task", "submit", task, "--summary", "One timeline of comments and events.", "--step", "Open the task and read the thread", "--link", "https://github.com/lnmunhoz/cello/pull/160", "--caption", "The PR")
  await expect(panel.locator('[data-timeline-line="status"]')).toHaveText(/In Progress → In Review/)

  // ?fold=count: runs of two or more fold; open them all and the whole thread reads in time order.
  await page.goto(`/${key}/1?fold=count`)
  await expect(panel).toBeVisible()
  await showThread(panel)
  await expect(panel.locator("[data-comment-id]")).toHaveCount(2)
  await expect(panel.locator("[data-timeline-fold]")).toHaveCount(2)
  expect(await threadOf(panel)).toEqual(["comment", "fold", "comment", "fold"])
  await caption(page, "?fold=count: each run between two comments is one row, \"4 changes · show\" and \"9 changes · show\"")
  await expect(panel.locator("[data-timeline-fold]").first()).toContainText("4 changes · show")
  await expect(panel.locator("[data-timeline-fold]").last()).toContainText("9 changes · show")
  await shoot(page, "fold-count-folded")

  await caption(page, "Show both: every line, in time order, between the comments")
  while ((await panel.locator("[data-timeline-fold]:not([data-open])").count()) > 0) {
    await panel.locator("[data-timeline-fold]:not([data-open])").first().getByRole("button").click()
  }
  expect(await threadOf(panel)).toEqual([
    "comment",
    "fold", "line:stage", "line:run_start", "line:run_end", "line:stage",
    "comment",
    "fold", "line:run_start", "line:run_end", "line:stage", "line:run_start", "line:run_end", "line:run_start", "line:run_end", "line:merge", "line:status",
  ])
  await expect(panel.locator('[data-timeline-line="stage"]')).toHaveText([
    /Stage: Building/, /Stage: Agent review/, /Stage: Fixing findings/,
  ])
  await expect(panel.locator('[data-timeline-line="merge"]')).toContainText("Merged into main")
  // Each run says its agent and when; the model rides on the start.
  await expect(panel.locator('[data-timeline-line="run_start"]')).toHaveText([
    /cello-builder started · Sonnet 5\.5, high/, /cello-code-reviewer started · Sonnet 5\.5, medium/, /cello-builder resumed/, /cello-code-reviewer resumed/,
  ])
  await expect(panel.locator("[data-verdict]")).toHaveCount(2)
  await shoot(page, "fold-count-open")

  // ?fold=latest: three or more fold and keep the newest line; the run after the newest comment stays open.
  await caption(page, "?fold=latest: the run before the last comment folds and keeps its newest line; the run after it stays open")
  await page.goto(`/${key}/1?fold=latest`)
  await expect(panel).toBeVisible()
  await showThread(panel)
  await expect(panel.locator("[data-comment-id]")).toHaveCount(2)
  await expect(panel.locator("[data-timeline-fold]")).toHaveCount(1)
  await expect(panel.locator("[data-timeline-fold]")).toContainText("3 earlier · show")
  expect(await threadOf(panel)).toEqual([
    "comment", "fold", "line:stage",
    "comment",
    "line:run_start", "line:run_end", "line:stage", "line:run_start", "line:run_end", "line:run_start", "line:run_end", "line:merge", "line:status",
  ])
  await shoot(page, "fold-latest-folded")
  await panel.locator("[data-timeline-fold]").getByRole("button").click()
  await expect(panel.locator("[data-timeline-fold]")).toHaveAttribute("data-open", "")
  await expect(panel.locator("[data-timeline-line]")).toHaveCount(13)
  await shoot(page, "fold-latest-open")

  // The thread is the same wherever Comments is: the full-page task view, and the Review page's packet.
  await caption(page, "The full-page task view has the same thread")
  await page.goto(`/${key}/1?view=full&fold=latest`)
  const comments = page.getByRole("region", { name: "Comments" })
  await expect(comments.locator("[data-comment-id]")).toHaveCount(2)
  await expect(comments.locator("[data-timeline-line]")).toHaveCount(10)
  await comments.evaluate((el) => el.scrollIntoView({ block: "start" }))
  await shoot(page, "full-page")

  await caption(page, "The Review page's packet has it under How to check")
  await page.goto(`/review?open=${task}&fold=latest`)
  const row = page.getByRole("article", { name: new RegExp(`${task}\\b`) })
  const thread = row.getByRole("region", { name: "Comments" })
  await expect(thread.locator("[data-comment-id]")).toHaveCount(2)
  await expect(thread.locator('[data-timeline-line="merge"]')).toBeVisible()
  await thread.evaluate((el) => el.scrollIntoView({ block: "start" }))
  await shoot(page, "review-page")
})

test("CEL-160: the release that took a task live is a line in its thread, linking to the Builds page; a fix that shipped later is another", async ({ page }) => {
  test.setTimeout(240_000)
  const dir = path.join(work, "builds")
  fs.mkdirSync(dir, { recursive: true })
  // Build A has nothing; build B's changes name CEL-1 (git isn't in the container, so the test writes them).
  const A = { commit: "aaaaaaa", dir: path.join(dir, "web-a") }
  const B = { commit: "bbbbbbb", dir: path.join(dir, "web-b") }
  buildWeb(A, [])
  buildWeb(B, ["merge: one timeline of comments and events (CEL-1)", "docs: what a build is"])
  const port = await freePort()
  const dataDir = fs.mkdtempSync(path.join(dir, "data-"))
  const a = await startCello(A, port, dataDir)
  await seed(port, "One timeline of comments and events")
  const client = await openClient(`ws://127.0.0.1:${port}/rpc`)
  const snapshot = await client.run((c) => c["snapshot.get"]({}))
  const taskId = snapshot.tasks.find((t) => t.key === "CEL-1")!.id
  await client.run((c) => c["comment.add"]({ commandId: newCommandId(), taskId, body: "Merged and deployed." }))
  await client.close()

  await caption(page, "Before the deploy, the thread has the comment and no release")
  await page.goto(`http://127.0.0.1:${port}/CEL/1`)
  const panel = taskPanel(page, "CEL-1")
  await expect(panel.locator("[data-comment-id]")).toHaveCount(1)
  await expect(panel.locator('[data-timeline-line="release"]')).toHaveCount(0)

  await caption(page, "Deploy build B, whose changes name CEL-1: the release is a line after the comment")
  await stop(a)
  await startCello(B, port, dataDir)
  // The page offers to reload into the new build; the thread's release line is there once it has.
  await expect(page.locator("[data-reload-bar]")).toBeVisible()
  await page.reload()
  await expect(panel).toBeVisible()
  const release = panel.locator('[data-timeline-line="release"]')
  await expect(release).toHaveCount(1)
  await expect(release).toContainText(/Released in v\S+ · build #2/)
  expect(await threadOf(panel)).toEqual(["comment", "line:release"])
  await shoot(page, "release")

  await caption(page, "The release links to the Builds page")
  await release.getByRole("link").click()
  await expect(page).toHaveURL(/\/builds$/)
})
