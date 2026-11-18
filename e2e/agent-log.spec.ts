// CEL-106: the Agents page shows an agent's live log. An orchestrator session launches a builder through
// the real `cello` CLI and its Claude Code hooks, which report the transcripts (transcript_path) Claude
// Code would write under its projects folder (CLAUDE_CONFIG_DIR, a temp folder here, never ~/.claude).
// The builder's transcript is invented, in Claude Code's JSONL shape. Opening the builder shows its log:
// prompt, messages and tool calls folded to one line with ✓ / ✗ and durations, newest at the bottom; a
// new step arrives live; scrolling up pauses following and "Jump to live" brings it back; the filters
// and the Thinking switch; a folded result opens, first 200 lines, then Show all; a masked key, shown on
// request. CEL-107: messages render as markdown, like comments, and a step that arrives live fades in
// (one that only gets its result doesn't). CEL-170: the log opens on Story (calls grouped, the call running
// now on its own row, a finished turn folded under "Worked for…"); Everything lists every call, Bash ones
// by Claude's description with the command in the opened call; the Thinking switch says when Claude Code
// saved the thinking without its words. Stills in light and dark go to e2e/videos/ (cel-106-*.png,
// cel-107-*.png, cel-170-*.png).
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Page } from "@playwright/test"
import { animationsSettled, caption, captionWithUrl, defaultWorkspace, expect, newCommandId, seedProject, test, uniqueKey } from "./fixtures.ts"
import { celloIn, claudeHooks } from "./claudeHooks.ts"
import { SHOTS } from "./packets.ts"

const ORCHESTRATOR = "7e3c1d2a-5b4f-4a69-9d1e-2f3a4b5c6d7e"
const BUILDER = "a5f00d1e2c3b4a596"
const STORY_ORCHESTRATOR = "4d8a6c1e-9b3f-4c27-a5d0-7e1f2a3b4c5d"
const STORY_BUILDER = "e2c4a6b8d0f1a3c57"
const KEY = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"

const work = fs.mkdtempSync(path.join(os.tmpdir(), "cel106-"))
const cwd = path.join(work, "pancakes")
fs.mkdirSync(cwd, { recursive: true })
const cli = celloIn(cwd)
const hooks = claudeHooks(cwd)
// CEL-170's builder works in its own repo folder, with its own transcripts.
const storyCwd = path.join(work, "syrup")
fs.mkdirSync(storyCwd, { recursive: true })
const storyCli = celloIn(storyCwd)
const storyHooks = claudeHooks(storyCwd)

// Where Claude Code keeps this session's transcripts: the server reads from the same folder.
const projects = path.join(process.env.CELLO_E2E_DATA!, "claude", "projects", "-work-pancakes")
const sessionFile = path.join(projects, `${ORCHESTRATOR}.jsonl`)
const builderFile = path.join(projects, ORCHESTRATOR, "subagents", `agent-${BUILDER}.jsonl`)
const storyProjects = path.join(process.env.CELLO_E2E_DATA!, "claude", "projects", "-work-syrup")
const storySessionFile = path.join(storyProjects, `${STORY_ORCHESTRATOR}.jsonl`)
const storyBuilderFile = path.join(storyProjects, STORY_ORCHESTRATOR, "subagents", `agent-${STORY_BUILDER}.jsonl`)

let clock = Date.parse("2026-11-16T09:00:00.000Z")
const at = (seconds = 1) => new Date((clock += seconds * 1000)).toISOString()
let n = 0
const line = (value: object) => `${JSON.stringify(value)}\n`
const prompt = (text: string) => line({ type: "user", uuid: `u${n++}`, timestamp: at(), message: { role: "user", content: text } })
const thought = (text: string) =>
  line({ type: "assistant", uuid: `m${n++}`, timestamp: at(), message: { id: `msg${n}`, content: [{ type: "thinking", thinking: text, signature: "c2ln" }] } })
const said = (text: string) => line({ type: "assistant", uuid: `m${n++}`, timestamp: at(), message: { id: `msg${n}`, content: [{ type: "text", text }] } })
/** The message that ends the agent's turn: Claude Code writes `stop_reason: "end_turn"` on it (CEL-170). */
const finalSaid = (text: string) =>
  line({ type: "assistant", uuid: `m${n++}`, timestamp: at(), message: { id: `msg${n}`, stop_reason: "end_turn", content: [{ type: "text", text }] } })
/** A thought Claude Code saved without its words: only a signature, since `showThinkingSummaries` was off (CEL-170). */
const unsavedThought = () =>
  line({ type: "assistant", uuid: `m${n++}`, timestamp: at(), message: { id: `msg${n}`, content: [{ type: "thinking", thinking: "", signature: "c2ln" }] } })
const call = (id: string, name: string, input: object) =>
  line({ type: "assistant", uuid: `m${n++}`, timestamp: at(), message: { id: `msg${n}`, content: [{ type: "tool_use", id, name, input }] } })
const result = (id: string, content: string, seconds: number, isError = false) =>
  line({ type: "user", uuid: `u${n++}`, timestamp: at(seconds), message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } })

/** A builder at work: its brief, what it says, a few files read and edited, a failing test run with a key in its output. */
const builderTranscript = () => {
  const testOutput = [
    "FAIL src/timer.test.ts",
    "  flips after 90 seconds",
    ...Array.from({ length: 236 }, (_, i) => `    at step ${i + 1} (src/timer.ts:${i + 10})`),
    `export GITHUB_TOKEN=${KEY}`,
  ].join("\n")
  const parts = [
    prompt("PAN-1 build the pancake timer. Read AGENTS.md first, then write the failing test."),
    thought("The timer needs a failing test before any code. Start with the flip interval."),
    said("Reading the project rules first."),
    call("toolu_agents", "Read", { file_path: `${cwd}/AGENTS.md` }),
    result("toolu_agents", "# Pancakes\nTest first. One timer per pan.", 0.2),
  ]
  for (const file of ["timer.ts", "pan.ts", "flip.ts", "batter.ts", "stove.ts", "plate.ts"]) {
    parts.push(call(`toolu_read_${file}`, "Read", { file_path: `${cwd}/src/${file}` }))
    parts.push(result(`toolu_read_${file}`, `export const ${file.replace(".ts", "")} = {}`, 0.1))
  }
  for (const word of ["flip", "batter", "heat", "pan", "serve", "stack", "syrup", "butter", "timer", "plate", "spatula", "stove"]) {
    parts.push(call(`toolu_grep_${word}`, "Grep", { pattern: word, path: cwd }))
    parts.push(result(`toolu_grep_${word}`, `src/${word}.ts:1:export const ${word} = {}`, 0.3))
  }
  parts.push(
    said("Writing the failing test for the flip interval."),
    call("toolu_write", "Write", { file_path: `${cwd}/src/timer.test.ts`, content: "…" }),
    result("toolu_write", "File created successfully", 0.1),
    call("toolu_test", "Bash", { command: "bun run test", description: "Run the tests" }),
    result("toolu_test", testOutput, 2.5, true),
    said("The test fails as it should. **Next:** the timer itself.\n\n- flip after 90 seconds\n- keep `servings` at 4"),
    call("toolu_edit", "Edit", { file_path: `${cwd}/src/timer.ts`, old_string: "{}", new_string: "{ flipAfter: 90 }" }),
    result("toolu_edit", "The file has been updated.", 0.1),
  )
  return parts.join("")
}

async function shoot(page: Page, name: string) {
  await shootAs(page, `cel-106-${name}`)
}

async function shootAs(page: Page, name: string) {
  await page.mouse.move(1430, 890)
  const hide = (shown: boolean) =>
    page.evaluate((shown) => document.getElementById("e2e-caption")?.style.setProperty("visibility", shown ? "" : "hidden"), shown)
  await hide(false)
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await animationsSettled(page)
    await page.screenshot({ path: path.join(SHOTS, `${name}-${theme}.png`) })
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"))
  await hide(true)
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (localStorage.getItem("cello:agent-cursors") === null) localStorage.setItem("cello:agent-cursors", "off")
  })
})

test("CEL-106: open an agent on the Agents page and follow its live log: steps, a new one live, scroll pauses following, views, thinking, a folded result, masked keys", async ({ page, cello }) => {
  test.setTimeout(240_000)
  const project = await seedProject(cello, "Pancakes", "PAN")
  const { statuses } = await defaultWorkspace(cello)
  await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "The pancake timer", priority: 2, statusId: statuses.Todo!.id }))

  // Claude Code has written the session's transcript and the builder's; the hooks say where.
  fs.mkdirSync(path.dirname(builderFile), { recursive: true })
  fs.writeFileSync(sessionFile, prompt("Build PAN-1 with a builder."))
  fs.writeFileSync(builderFile, builderTranscript())
  cli(ORCHESTRATOR)("task", "claim", "PAN-1")
  hooks.hook("subagent-start", { session_id: ORCHESTRATOR, transcript_path: sessionFile, agent_id: BUILDER, agent_type: "cello-builder", hook_event_name: "SubagentStart" })
  hooks.hook("post-tool-use", {
    session_id: ORCHESTRATOR, transcript_path: sessionFile, hook_event_name: "PostToolUse", tool_name: "Agent",
    tool_input: { subagent_type: "cello-builder", description: "PAN-1 build the pancake timer", prompt: "Build it." },
    tool_response: { agentId: BUILDER, status: "async_launched" },
  })
  hooks.hook("post-tool-use", {
    session_id: ORCHESTRATOR, transcript_path: sessionFile, agent_id: BUILDER, agent_type: "cello-builder", hook_event_name: "PostToolUse",
    tool_name: "Edit", tool_input: { file_path: `${cwd}/src/timer.ts` },
  })

  const sessionId = (await cello.run((c) => c["snapshot.get"]({}))).sessions.find((s) => s.externalId === ORCHESTRATOR)!.id
  const row = page.locator(`[data-agent-row="agent:${sessionId}/${BUILDER}"]`)
  const log = row.locator("[data-agent-log]")
  const step = (id: string) => log.locator(`[data-log-step="${id}"]`)
  const steps = log.locator("[data-log-step]")

  await page.goto("/agents")
  await captionWithUrl(page, "The Agents page: the builder's row says what it's doing right now")
  await expect(row.locator("[data-agent-step]")).toHaveText("Edit · timer.ts")

  await caption(page, "Open the builder: its live log, on Story by default (CEL-170)")
  await row.getByRole("button").first().click()
  await expect(log).toHaveAttribute("data-log-show", "story")
  await expect(step("toolu_edit")).toBeVisible()
  // The calls before it are folded into groups, not listed one by one.
  await expect(log.locator("[data-log-summary]")).toHaveText(["Read 7 files, searched 12 times", "Edited 1 file, ran 1 command"])
  await expect(step("toolu_test")).toHaveCount(0)

  await caption(page, "Everything: every call, a Bash one by Claude's description (CEL-170)")
  await log.locator('[data-log-view="everything"]').click()
  await expect(log).toHaveAttribute("data-log-show", "everything")
  await expect(step("toolu_test")).toHaveAttribute("data-log-status", "error")
  await expect(step("toolu_test")).toContainText("Bash · Run the tests")
  await expect(step("toolu_test")).toContainText("2.5 s")
  await expect(step("toolu_edit")).toHaveAttribute("data-log-status", "ok")
  // Rendered like a comment: the task key is a live link to the task.
  await expect(log.locator('[data-log-kind="user"]')).toContainText("build the pancake timer. Read AGENTS.md first")
  await expect(log.locator('[data-log-kind="user"] [data-task-link="PAN-1"]')).toBeVisible()
  // Messages are markdown, rendered like a comment (CEL-107): bold, a list, inline code.
  const plan = log.locator('[data-log-kind="message"]').filter({ hasText: "The test fails as it should" })
  await expect(plan.locator("strong")).toHaveText("Next:")
  await expect(plan.locator("li")).toHaveCount(2)
  await expect(plan.locator("code")).toHaveText("servings")
  await expect(plan).not.toContainText("**")
  // What was there on opening doesn't fade in.
  await expect(log.locator("[data-log-arrived]")).toHaveCount(0)
  // Thinking stays hidden until its switch is on.
  await expect(log.locator('[data-log-kind="thinking"]')).toHaveCount(0)
  await expect(log).toHaveAttribute("data-log-follow", "on")
  const scroller = log.locator("[data-log-scroller]")
  // Following: scrolled to the newest step.
  await expect(step("toolu_edit")).toBeInViewport()
  await expect(step("toolu_agents")).not.toBeInViewport()
  await shoot(page, "log")
  await plan.scrollIntoViewIfNeeded()
  await shootAs(page, "cel-107-markdown")
  await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight))

  await caption(page, "The builder runs the tests again: the new step arrives live, and the log follows it")
  fs.appendFileSync(builderFile, call("toolu_test2", "Bash", { command: "bun run test src/timer.test.ts" }))
  await expect(step("toolu_test2")).toHaveAttribute("data-log-status", "running")
  // It arrived live: it fades in (CEL-107).
  await expect(step("toolu_test2")).toHaveAttribute("data-log-arrived", "")
  await step("toolu_test2").evaluate((el) => el.setAttribute("data-e2e-mounted", ""))
  fs.appendFileSync(builderFile, result("toolu_test2", "1 passed", 1.2))
  await expect(step("toolu_test2")).toHaveAttribute("data-log-status", "ok")
  // Its result only updates it in place: the same row, so its fade doesn't play again.
  await expect(step("toolu_test2")).toHaveAttribute("data-e2e-mounted", "")
  await expect(step("toolu_test2")).toContainText("1.2 s")
  await expect(step("toolu_test2")).toBeInViewport()

  await caption(page, "Scroll up: following pauses, and Jump to live appears")
  await scroller.hover()
  await page.mouse.wheel(0, -600)
  await expect(log).toHaveAttribute("data-log-follow", "off")
  const jump = log.locator("[data-log-jump]")
  await expect(jump).toBeVisible()
  fs.appendFileSync(builderFile, said("Both tests pass. Committing."))
  const newest = log.locator('[data-log-kind="message"]').last()
  await expect(newest).toHaveText(/Both tests pass/)
  await expect(newest).toHaveAttribute("data-log-arrived", "")
  // It kept its place: the new step is below, not scrolled to.
  await expect(newest).not.toBeInViewport()
  await expect(log).toHaveAttribute("data-log-follow", "off")
  await caption(page, "Jump to live: back to the newest step, following again")
  await jump.click()
  await expect(log).toHaveAttribute("data-log-follow", "on")
  await expect(newest).toBeInViewport()

  await caption(page, "Errors: only the failed call")
  await log.locator('[data-log-view="errors"]').click()
  await expect(steps).toHaveCount(1)
  await expect(step("toolu_test")).toBeVisible()
  // Back to Everything: the newest message is put on screen again, and doesn't fade in a second time.
  await log.locator('[data-log-view="everything"]').click()
  await expect(newest).toHaveText(/Both tests pass/)
  await expect(log.locator("[data-log-arrived]")).toHaveCount(0)
  await log.locator('[data-log-view="errors"]').click()
  await expect(steps).toHaveCount(1)

  await caption(page, "Open the failed run: its output, the key in it masked")
  await step("toolu_test").locator("[data-log-toggle]").click()
  const output = step("toolu_test").locator("[data-log-output] pre:not([data-log-command])")
  await expect(output).toContainText("FAIL src/timer.test.ts")
  // Its command sits above the result (CEL-170), apart from it.
  await expect(step("toolu_test").locator("[data-log-command]")).toHaveText("$ bun run test")
  // The first 200 lines, then Show all.
  expect((await output.textContent())!.split("\n")).toHaveLength(200)
  await shoot(page, "result")
  await caption(page, "Show all: every line, down to the masked key")
  await step("toolu_test").locator("[data-log-show-all]").click()
  await expect(output).toContainText("GITHUB_TOKEN=ghp_••••••••")
  await expect(output).not.toContainText(KEY)
  await caption(page, "Show secrets: the key as it was")
  await log.locator("[data-log-reveal]").click()
  await step("toolu_test").locator("[data-log-toggle]").click()
  await step("toolu_test").locator("[data-log-show-all]").click()
  await expect(step("toolu_test").locator("[data-log-output] pre:not([data-log-command])")).toContainText(KEY)
  await log.locator("[data-log-reveal]").click()

  await caption(page, "Thinking: off by default; its switch shows it, folded like a result")
  await log.locator('[data-log-view="everything"]').click()
  await log.locator("[data-log-thinking]").click()
  const thinking = log.locator('[data-log-kind="thinking"]')
  await expect(thinking).toHaveCount(1)
  await thinking.locator("[data-log-toggle]").click()
  await expect(thinking.locator("[data-log-output]")).toContainText("The timer needs a failing test before any code.")
  await shoot(page, "thinking")

  await caption(page, "With reduced motion on, a new step appears without the fade")
  await page.emulateMedia({ reducedMotion: "reduce" })
  fs.appendFileSync(builderFile, said("Committed."))
  const committed = log.locator('[data-log-kind="message"]').filter({ hasText: "Committed." })
  await expect(committed).toHaveAttribute("data-log-arrived", "")
  expect(await committed.evaluate((el) => getComputedStyle(el).animationName)).toBe("none")
  await page.emulateMedia({ reducedMotion: "no-preference" })
})

test("CEL-170: the log tells the story: calls fold into a group, the running call is its own row, a finished turn folds under Worked for, Bash reads by description, the thinking note", async ({ page, cello }) => {
  test.setTimeout(240_000)
  const key = uniqueKey("SYR")
  const project = await seedProject(cello, "Syrup", key)
  const { statuses } = await defaultWorkspace(cello)
  await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "The syrup timer", priority: 2, statusId: statuses.Todo!.id }))
  const task = `${key}-1`

  // The builder has run a command, read two files, run the tests (one failed: a key in its output) and checked git;
  // its thoughts were saved without their words. Claude Code gave each Bash call a description.
  fs.mkdirSync(path.dirname(storyBuilderFile), { recursive: true })
  fs.writeFileSync(storySessionFile, prompt(`Build ${task} with a builder.`))
  fs.writeFileSync(storyBuilderFile, [
    prompt(`${task} add the syrup timer. Test first.`),
    unsavedThought(),
    said("Looking at the code, then running the tests."),
    call("toolu_s1", "Bash", { command: `cd ${storyCwd} && grep -rn "syrup" src | head -20`, description: "Search the code for syrup" }),
    result("toolu_s1", "src/syrup.ts:1:export const syrup = {}", 0.4),
    call("toolu_s2", "Read", { file_path: `${storyCwd}/src/syrup.ts` }),
    result("toolu_s2", "export const syrup = {}", 0.1),
    call("toolu_s3", "Read", { file_path: `${storyCwd}/src/pan.ts` }),
    result("toolu_s3", "export const pan = {}", 0.1),
    call("toolu_s4", "Bash", { command: "bun run test", description: "Run the tests" }),
    result("toolu_s4", ["FAIL src/syrup.test.ts", "  pours for 3 seconds", `export GITHUB_TOKEN=${KEY}`].join("\n"), 2.5, true),
    call("toolu_s5", "Bash", { command: "git status --short", description: "Show working tree status" }),
    result("toolu_s5", " M src/syrup.ts", 0.3),
  ].join(""))
  storyCli(STORY_ORCHESTRATOR)("task", "claim", task)
  storyHooks.hook("subagent-start", { session_id: STORY_ORCHESTRATOR, transcript_path: storySessionFile, agent_id: STORY_BUILDER, agent_type: "cello-builder", hook_event_name: "SubagentStart" })
  storyHooks.hook("post-tool-use", {
    session_id: STORY_ORCHESTRATOR, transcript_path: storySessionFile, hook_event_name: "PostToolUse", tool_name: "Agent",
    tool_input: { subagent_type: "cello-builder", description: `${task} add the syrup timer`, prompt: "Build it." },
    tool_response: { agentId: STORY_BUILDER, status: "async_launched" },
  })
  // Its last call, as the hook reports it: Claude's description of the command, not the command.
  storyHooks.hook("post-tool-use", {
    session_id: STORY_ORCHESTRATOR, transcript_path: storySessionFile, agent_id: STORY_BUILDER, agent_type: "cello-builder", hook_event_name: "PostToolUse",
    tool_name: "Bash", tool_input: { command: "bun run test", description: "Run the tests" },
  })

  const sessionId = (await cello.run((c) => c["snapshot.get"]({}))).sessions.find((s) => s.externalId === STORY_ORCHESTRATOR)!.id
  const row = page.locator(`[data-agent-row="agent:${sessionId}/${STORY_BUILDER}"]`)
  const log = row.locator("[data-agent-log]")
  const step = (id: string) => log.locator(`[data-log-step="${id}"]`)
  const group = log.locator("[data-log-group]")
  const summary = group.locator("[data-log-summary]")
  const live = log.locator("[data-log-live]")
  const turn = log.locator("[data-log-turn]")
  const toggle = (item: ReturnType<typeof log.locator>) => item.locator("[data-log-toggle]").first()

  await page.goto("/agents")
  await captionWithUrl(page, "The builder's row: its current step reads Claude's description of the command")
  await expect(row.locator("[data-agent-step]")).toHaveText("Bash · Run the tests")

  await caption(page, "Open the builder: Story, the calls between its messages folded into one row")
  await row.getByRole("button").first().click()
  await expect(log).toHaveAttribute("data-log-show", "story")
  await expect(log.locator('[data-log-kind="user"]')).toContainText("add the syrup timer")
  await expect(log.locator('[data-log-kind="message"]')).toHaveText(/Looking at the code/)
  await expect(group).toHaveCount(1)
  await expect(group).toHaveAttribute("data-log-status", "error")
  await expect(summary).toHaveText("Ran 3 commands, read 2 files")
  await expect(group.locator("[data-log-failed]")).toContainText("1 failed")
  // Its calls aren't listed until it's opened.
  await expect(step("toolu_s4")).toHaveCount(0)
  await shootAs(page, "cel-170-story")

  await caption(page, "Open the group: its calls, each by Claude's description")
  await toggle(group).click()
  await expect(step("toolu_s1")).toContainText("Bash · Search the code for syrup")
  await expect(step("toolu_s2")).toContainText("Read · syrup.ts")
  await expect(step("toolu_s4")).toContainText("Bash · Run the tests")
  await expect(step("toolu_s5")).toContainText("Bash · Show working tree status")
  await shootAs(page, "cel-170-group-open")

  await caption(page, "Open the failed run: its command first, then its output, the key masked")
  await toggle(step("toolu_s4")).click()
  await expect(step("toolu_s4").locator("[data-log-command]")).toHaveText("$ bun run test")
  const output = step("toolu_s4").locator("[data-log-output] pre:not([data-log-command])")
  await expect(output).toContainText("pours for 3 seconds")
  await expect(output).toContainText("GITHUB_TOKEN=ghp_••••••••")
  await expect(output).not.toContainText(KEY)
  await shootAs(page, "cel-170-call-command")

  await caption(page, "The agent starts another command: it shows as its own live row")
  fs.appendFileSync(storyBuilderFile, call("toolu_s6", "Bash", { command: "bun run test src/syrup.test.ts", description: "Run the syrup test" }))
  await expect(live).toHaveCount(1)
  await expect(live).toContainText("Bash · Run the syrup test")
  await expect(live).toHaveAttribute("data-log-status", "running")
  await expect(summary).toHaveText("Ran 3 commands, read 2 files")
  await shootAs(page, "cel-170-live")

  await caption(page, "Its result lands: the row joins the group, which stays open")
  fs.appendFileSync(storyBuilderFile, result("toolu_s6", "1 passed", 1.5))
  await expect(live).toHaveCount(0)
  await expect(summary).toHaveText("Ran 4 commands, read 2 files")
  await expect(step("toolu_s6")).toContainText("Bash · Run the syrup test")

  await caption(page, "The agent answers and its turn ends: the work folds under Worked for, the answer stays open")
  fs.appendFileSync(storyBuilderFile, finalSaid("The syrup timer pours for 3 seconds. The tests pass."))
  await expect(turn).toHaveCount(1)
  await expect(toggle(turn)).toContainText("Worked for")
  await expect(log.locator('[data-log-kind="message"]').last()).toHaveText(/The tests pass/)
  await expect(group).toHaveCount(0)
  await shootAs(page, "cel-170-turn-folded")
  await caption(page, "Open the fold: the work is there, grouped as before")
  await toggle(turn).click()
  await expect(group).toHaveCount(1)
  await expect(summary).toHaveText("Ran 4 commands, read 2 files")

  await caption(page, "Thinking on: Claude Code saved these thoughts without their words, and the log says how to change that")
  await log.locator("[data-log-thinking]").click()
  const note = log.locator("[data-log-thinking-note]")
  await expect(note).toContainText("showThinkingSummaries")
  await expect(log.locator('[data-log-kind="thinking"]')).toHaveCount(0)
  await shootAs(page, "cel-170-thinking-note")
  await log.locator("[data-log-thinking]").click()
  await expect(note).toHaveCount(0)

  await caption(page, "Everything lists every call, Errors only the failed one")
  await log.locator('[data-log-view="everything"]').click()
  await expect(log.locator('[data-log-kind="tool"]')).toHaveCount(6)
  await expect(step("toolu_s1")).toContainText("Bash · Search the code for syrup")
  await expect(group).toHaveCount(0)
  await expect(turn).toHaveCount(0)
  await shootAs(page, "cel-170-everything")
  await log.locator('[data-log-view="errors"]').click()
  await expect(log.locator("[data-log-step]")).toHaveCount(1)
  await expect(step("toolu_s4")).toBeVisible()
})
