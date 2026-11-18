// CEL-160: a task's comments show what happened after each one. Comments stay cards, and between them, in
// time order, sit one-line events: stages, status moves, every subagent starting and finishing (with its
// model, and a reviewer's verdict read from its last reply), the merge, and the release that took it live.
// Three or more lines in a row fold ("3 earlier · show") and keep the newest; the run after the newest comment
// stays open (Lucas picked this fold, Nov 18).
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
import { animationsSettled, caption, defaultWorkspace, hold, expect, newCommandId, seedProject, taskPanel, test, uniqueKey } from "./fixtures.ts"
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

/** Stills of `page` in light and dark: e2e/videos/evidence/<prefix>-<name>-light.png and -dark (CEL-160's by default). */
async function shoot(page: Page, name: string, prefix = "cel-160") {
  await page.mouse.move(1430, 890)
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await animationsSettled(page)
    await still(page, `${prefix}-${name}-${theme}`)
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

// After the test, not after each: the review video holds the last screen while its context closes, and the served build must still be up.
test.afterAll(stopAll)

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

  // The panel stays open for the whole story: the lines arrive by themselves. With one comment, the run after
  // it is the newest and stays open: every line shows while it happens.
  await page.goto(`/${key}/1`)
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

  // The run before "Now in agent review." folded the moment that comment arrived, keeping its newest line;
  // everything after the comment stayed open as it came in.
  await caption(page, "Everything after \"Now in agent review.\" stayed open as it happened; the run before it folded, keeping its newest line")
  await expect(panel.locator("[data-comment-id]")).toHaveCount(2)
  await expect(panel.locator("[data-timeline-fold]")).toHaveCount(1)
  await expect(panel.locator("[data-timeline-fold]")).toContainText("3 earlier · show")
  expect(await threadOf(panel)).toEqual([
    "comment", "fold", "line:stage",
    "comment",
    "line:run_start", "line:run_end", "line:stage", "line:run_start", "line:run_end", "line:run_start", "line:run_end", "line:merge", "line:status",
  ])
  await showThread(panel)
  await shoot(page, "fold-folded")

  await caption(page, "Show the three earlier lines: every line, in time order, between the comments")
  await panel.locator("[data-timeline-fold]").getByRole("button").click()
  await expect(panel.locator("[data-timeline-fold]")).toHaveAttribute("data-open", "")
  expect(await threadOf(panel)).toEqual([
    "comment",
    "fold", "line:stage", "line:run_start", "line:run_end", "line:stage",
    "comment",
    "line:run_start", "line:run_end", "line:stage", "line:run_start", "line:run_end", "line:run_start", "line:run_end", "line:merge", "line:status",
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
  await shoot(page, "fold-open")

  await caption(page, "Hide them again")
  await panel.locator("[data-timeline-fold]").getByRole("button").click()
  await expect(panel.locator("[data-timeline-fold]")).not.toHaveAttribute("data-open", "")

  // The thread is the same wherever Comments is: the full-page task view, and the Review page's packet.
  await caption(page, "The full-page task view has the same thread")
  await page.goto(`/${key}/1?view=full`)
  const comments = page.getByRole("region", { name: "Comments" })
  await expect(comments.locator("[data-comment-id]")).toHaveCount(2)
  await expect(comments.locator("[data-timeline-line]")).toHaveCount(10)
  await comments.evaluate((el) => el.scrollIntoView({ block: "start" }))
  await shoot(page, "full-page")

  await caption(page, "The Review page's packet has it under How to check")
  await page.goto(`/review?open=${task}`)
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

  // The connection line ("Connecting…", "Reconnecting to the Cello server…") is gone before anything is shown.
  const connecting = page.getByRole("status").filter({ hasText: /connecting|reconnecting/i })
  await page.goto(`http://127.0.0.1:${port}/CEL/1`)
  const panel = taskPanel(page, "CEL-1")
  await expect(panel.locator("[data-comment-id]")).toHaveCount(1)
  await expect(connecting).toHaveCount(0)
  await caption(page, "Before the deploy, the thread has the comment and no release")
  await expect(panel.locator('[data-timeline-line="release"]')).toHaveCount(0)

  await caption(page, "Deploy build B, whose changes name CEL-1: the release is a line after the comment")
  await stop(a)
  await startCello(B, port, dataDir)
  // The tab reconnects to the new server and offers to reload; the release line shows without reloading.
  await expect(page.locator("[data-reload-bar]")).toBeVisible()
  await expect(connecting).toHaveCount(0)
  const release = panel.locator('[data-timeline-line="release"]')
  await expect(release).toHaveCount(1)
  await expect(release).toContainText(/Released in v\S+ · build #2/)
  expect(await threadOf(panel)).toEqual(["comment", "line:release"])
  await shoot(page, "release")

  await caption(page, "The release links to the Builds page")
  await release.getByRole("link").click()
  await expect(page).toHaveURL(/\/builds$/)
  // The Builds page has loaded, with build #2 (the release the line named) on it.
  const build = page.locator('[data-build-row="2"]')
  await expect(build).toBeVisible()
  await expect(build).toContainText("one timeline of comments and events")
  await expect(page.getByText("Loading builds…")).toHaveCount(0)
  await expect(connecting).toHaveCount(0)
  // The video ends on the loaded page: the caption holds it on screen before and after (review mode).
  await caption(page, "The Builds page has build #2, with what changed in it")
  await hold(page)
})

// CEL-181: the thread says how a test run turned out. An agent comments "Running the spec in Docker now.";
// the run shows live right under it, and when it ends the same row turns into its outcome. Seeded through the
// real `cello` CLI and its Claude Code hooks, as a builder and an orchestrator run them: a background Docker
// run reporting through `cello test progress`, and foreground unit runs ending with their call. Stills in light
// and dark go to e2e/videos/evidence/ (cel-181-*.png).
const SESSION2 = "7a1c9e30-2b4d-4f61-8e5a-3d9b0c7f1e24"
const BUILDER2 = "d4e5f6a7b8c9d0e1f"

test("CEL-181: a test run shows live under the comment that announced it, then how it ended; repeated runs collapse, a failed run is red, a fold keeps the results", async ({ page, cello }) => {
  test.setTimeout(300_000)
  const key = uniqueKey("TST")
  const project = await seedProject(cello, "Test outcomes", key)
  const { statuses } = await defaultWorkspace(cello)
  for (const title of ["A test run shows live, then how it ended", "Repeated runs, a failed run, and a fold"]) {
    await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title, priority: 2, statusId: statuses.Todo!.id }))
  }
  const [one, two] = [`${key}-1`, `${key}-2`]
  const orchestrator = celloIn(cwd)(SESSION2)
  const progressFile = path.join(work, "progress-181.json")
  /** The runner's report, as scripts/test-in-docker.ts sends it: in the repo, as the session. */
  const report = (extra: Record<string, unknown>) => {
    fs.writeFileSync(progressFile, JSON.stringify({
      stage: "web-e2e", passed: 0, failed: 0, skipped: 0, total: 3, current: null, failures: [], done: false, outcome: null, folder: null, ...extra,
    }))
    orchestrator("test", "progress", "--file", progressFile)
  }
  /** A Bash call of the orchestrator (or, with `agent`, of the builder): the hook's input for it. */
  const call = (id: string, command: string, options: { background?: boolean; agent?: boolean } = {}) => ({
    session_id: SESSION2, tool_name: "Bash", tool_use_id: id,
    ...(options.agent ? { agent_id: BUILDER2, agent_type: BUILDER_TYPE } : {}),
    tool_input: { command, ...(options.background ? { run_in_background: true } : {}) },
  })
  /** A foreground run of the builder: it starts, and ends with its call. */
  const foreground = (id: string, command: string, outcome: "passed" | "failed") => ({
    start: () => hooks.hook("pre-tool-use", { ...call(id, command, { agent: true }), hook_event_name: "PreToolUse" }),
    end: () =>
      outcome === "passed"
        ? hooks.hook("post-tool-use", { ...call(id, command, { agent: true }), hook_event_name: "PostToolUse", tool_response: { stdout: "ok" } })
        : hooks.hook("post-tool-use-failure", { ...call(id, command, { agent: true }), hook_event_name: "PostToolUseFailure", error: "Exit code 1" }),
  })

  // ── 1. The announced run, live, then its outcome in the same row ─────────────────────────────────
  orchestrator("task", "claim", one)
  await page.goto(`/${key}/1`)
  const panel = taskPanel(page, one)
  await expect(panel).toBeVisible()
  await showThread(panel)

  await caption(page, "The orchestrator says it's running the spec in Docker")
  orchestrator("task", "comment", one, "Running the spec in Docker now.")
  await expect(panel.locator("[data-comment-id]")).toHaveCount(1)

  await caption(page, "It starts the run in the background: a live row appears right under the comment")
  const docker = call("toolu_d1", "bun run test:docker:e2e -- e2e/pages.spec.ts", { background: true })
  hooks.hook("pre-tool-use", { ...docker, hook_event_name: "PreToolUse" })
  hooks.hook("post-tool-use", { ...docker, hook_event_name: "PostToolUse", tool_response: { stdout: "", backgroundTaskId: "bdock0001" } })
  const live = panel.locator('[data-timeline-line="tests_live"]')
  await expect(live).toHaveCount(1)
  await expect(live).toContainText("Running web e2e · e2e/pages.spec.ts")
  expect(await threadOf(panel)).toEqual(["comment", "line:tests_live"])
  const id = (await live.getAttribute("data-timeline-id"))!

  await caption(page, "The runner reports as it goes: 1 of 3")
  report({ passed: 1, current: "e2e/pages.spec.ts" })
  await expect(live).toContainText("1 of 3")
  await shoot(page, "live", "cel-181")

  // From here, a page-side record of the row: its <li> must never be removed or doubled while it turns into its outcome.
  await page.evaluate((rowId) => {
    const li = document.querySelector(`[data-timeline-id="${rowId}"]`)!
    const record = { removed: 0, duplicates: 0, li }
    ;(window as unknown as { __swap: typeof record }).__swap = record
    new MutationObserver((changes) => {
      for (const change of changes) {
        change.removedNodes.forEach((node) => { if (node === li) record.removed++ })
        change.addedNodes.forEach((node) => { if (node !== li && node instanceof Element && node.getAttribute("data-timeline-id") === rowId) record.duplicates++ })
      }
      if (document.querySelectorAll(`[data-timeline-id="${rowId}"]`).length > 1) record.duplicates++
    }).observe(li.parentElement!, { childList: true, subtree: true })
  }, id)

  await caption(page, "The run ends, passed 3 of 3: the same row turns into its outcome")
  report({ passed: 3, done: true, outcome: "passed", folder: path.join(cwd, "test-results/docker/2026-11-18_100000-e2e-1") })
  const row = panel.locator(`[data-timeline-id="${id}"]`)
  await expect(row).toHaveAttribute("data-timeline-line", "tests")
  await expect(row).toContainText("web e2e passed · e2e/pages.spec.ts · 3 of 3")
  // The history has it too (a refetch after the board heard the run end): the row didn't flash or double on the way.
  await expect(panel.locator('[data-history-event="tests.finished"]')).toContainText("ran web e2e: passed · e2e/pages.spec.ts · 3 of 3")
  await expect(row).toHaveCount(1)
  expect(await page.evaluate(() => {
    const swap = (window as unknown as { __swap: { removed: number; duplicates: number; li: Element } }).__swap
    return { removed: swap.removed, duplicates: swap.duplicates, sameElement: document.querySelector(`[data-timeline-line="tests"]`) === swap.li }
  })).toEqual({ removed: 0, duplicates: 0, sameElement: true })
  await shoot(page, "passed", "cel-181")

  await caption(page, "Submitted for review: the thread reads comment, how the run went, then the status move")
  orchestrator("task", "submit", one, "--summary", "The run's outcome is in the thread.", "--step", "Open the task and read the thread", "--link", "https://github.com/lnmunhoz/cello/pull/181", "--caption", "The PR")
  await expect(panel.locator('[data-timeline-line="status"]')).toHaveText(/In Progress → In Review/)
  expect(await threadOf(panel)).toEqual(["comment", "line:tests", "line:status"])
  await shoot(page, "submitted", "cel-181")

  // ── 2. Two runs at once, repeated runs, a failed run, and a fold ─────────────────────────────────
  orchestrator("task", "claim", two)
  hooks.launch(SESSION2, BUILDER2, BUILDER_TYPE, `${two} repeated runs and a fold`)
  await page.goto(`/${key}/2`)
  const panel2 = taskPanel(page, two)
  await expect(panel2).toBeVisible()
  await showThread(panel2)
  await caption(page, "A second task: the orchestrator announces the Docker run, and the builder runs unit tests meanwhile")
  orchestrator("task", "comment", two, "Running the spec in Docker, and the builder's unit tests.")
  await expect(panel2.locator("[data-comment-id]")).toHaveCount(1)
  const docker2 = call("toolu_d2", "bun run test:docker:e2e -- e2e/pages.spec.ts", { background: true })
  hooks.hook("pre-tool-use", { ...docker2, hook_event_name: "PreToolUse" })
  hooks.hook("post-tool-use", { ...docker2, hook_event_name: "PostToolUse", tool_response: { stdout: "", backgroundTaskId: "bdock0002" } })
  const first = foreground("toolu_u1", "bun run test -- apps/server", "failed")
  first.start()
  const lives = panel2.locator('[data-timeline-line="tests_live"]')
  await expect(lives).toHaveCount(2)
  await expect(lives.nth(0)).toContainText("Running web e2e")
  await expect(lives.nth(1)).toContainText("Running unit tests · apps/server")
  await shoot(page, "two-live", "cel-181")

  await caption(page, "The builder's unit runs fail twice and pass: they collapse into one line, the Docker run still live")
  first.end()
  for (const [id2, outcome] of [["toolu_u2", "failed"], ["toolu_u3", "passed"]] as const) {
    const next = foreground(id2, "bun run test -- apps/server", outcome)
    next.start()
    next.end()
  }
  const collapsed = panel2.locator('[data-timeline-line="tests"]')
  await expect(collapsed).toHaveCount(1)
  await expect(collapsed).toContainText(/unit tests passed · apps\/server · \d+s · 3 runs/)
  await expect(collapsed).toHaveAttribute("title", /Earlier: unit tests failed/)
  await expect(lives).toHaveCount(1)
  await shoot(page, "collapsed", "cel-181")

  await caption(page, "The Docker run fails: its row turns red, the failure in its hover")
  report({ passed: 2, failed: 1, failures: ["e2e/pages.spec.ts:40 › opens the page"], done: true, outcome: "failed", folder: path.join(cwd, "test-results/docker/2026-11-18_100500-e2e-2") })
  const failed = panel2.locator('[data-timeline-line="tests"][data-outcome="failed"]')
  await expect(failed).toHaveCount(1)
  await expect(failed).toContainText("web e2e failed · e2e/pages.spec.ts · 1 failed of 3")
  await expect(failed).toHaveAttribute("title", /✘ e2e\/pages\.spec\.ts:40 › opens the page/)
  await expect(lives).toHaveCount(0)
  await shoot(page, "failed", "cel-181")

  await caption(page, "A later comment folds the stretch before it, and the results stay visible")
  orchestrator("task", "stage", two, "fixing")
  hooks.stop(SESSION2, BUILDER2, BUILDER_TYPE)
  await expect(panel2.locator('[data-timeline-line="run_end"]')).toHaveCount(1)
  orchestrator("task", "comment", two, "Fixing the failing spec.")
  await expect(panel2.locator("[data-comment-id]")).toHaveCount(2)
  const fold = panel2.locator("[data-timeline-fold]")
  await expect(fold).toHaveCount(1)
  await expect(fold).toContainText(/\d+ earlier · show/)
  // Closed, both results still show beside the button; the hidden lines are the ones that aren't results.
  await expect(panel2.locator('[data-timeline-line="tests"]')).toHaveCount(2)
  await shoot(page, "folded", "cel-181")
  await fold.getByRole("button").click()
  await expect(fold).toHaveAttribute("data-open", "")
  await expect(panel2.locator('[data-timeline-line="tests"]')).toHaveCount(2)
  await hold(page)
})
