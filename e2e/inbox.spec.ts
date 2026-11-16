// CEL-15: what Lucas writes in the browser reaches the agent session that claimed the task. A comment
// typed in the task panel shows up in that session's `cello inbox --new`, once; a Send back on the
// Review page comes back through the Claude Code Stop hook (`cello hook claude stop`), once. The
// agent's terminal output is drawn on the page so the video shows both sides; stills go to e2e/videos/.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { caption, card, column, createProject, expect, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { celloAs, SHOTS, showTerminal } from "./packets.ts"

const SESSION = "e2e0inbox-agent-session"

test("CEL-15: a comment typed in the task panel and a Send back on the Review page both reach the agent's session, once each", async ({ page }) => {
  const key = uniqueKey("INB")
  const task = `${key}-1`
  const agent = celloAs(SESSION)
  await createProject(page, "Inbox test", key)

  await caption(page, `An agent session claims ${task}`)
  agent("task", "create", "Comments reach agents", "--project", key)
  agent("task", "claim", task)
  await expect(column(page, "In Progress").locator(`[data-task-key="${task}"]`)).toBeVisible()

  await caption(page, "Lucas opens it and comments, with a link")
  await card(page, task).click()
  const panel = taskPanel(page, task)
  await panel.getByLabel("New comment").fill("Please also cover the empty state, as in https://example.com/spec")
  await panel.getByRole("button", { name: "Comment", exact: true }).click()
  const comment = panel.locator("[data-comment-id]").last()
  await expect(comment).toContainText("Please also cover the empty state")
  // CEL-12's linkify: the bare address in the comment is a link.
  await expect(comment.getByRole("link", { name: "https://example.com/spec" })).toHaveAttribute("href", "https://example.com/spec")

  await caption(page, "In the agent's session: `cello inbox --new` has it")
  const inbox = agent("inbox", "--new")
  await showTerminal(page, "cello inbox --new", inbox)
  // The human's name comes from the server's setup ("Lucas" here, or git's user.name).
  expect(inbox).toMatch(new RegExp(`${task}  Comments reach agents\n  .+ commented, just now\n    Please also cover the empty state, as in https://example\\.com/spec`))
  expect(inbox).toContain(`answer on the card: \`cello task comment ${task} "…"\``)
  await expect(page.getByLabel("Agent terminal")).toContainText("commented, just now")
  await page.screenshot({ path: path.join(SHOTS, "cel-15-comment-reaches-inbox.png") })

  await caption(page, "Asked again, it prints nothing: each comment arrives once")
  const again = agent("inbox", "--new")
  await showTerminal(page, "cello inbox --new", again)
  expect(again).toBe("")
  await expect(page.getByLabel("Agent terminal")).toContainText("(prints nothing)")

  await caption(page, "The agent answers on the card and hands the task in")
  agent("task", "comment", task, "Done: the empty state has its own screen now.")
  await expect(panel.locator("[data-comment-id]").last()).toContainText("the empty state has its own screen")
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-inbox-"))
  fs.writeFileSync(path.join(dir, "vitest.log"), "Test Files  76 passed (76)\n")
  agent("task", "submit", task, "--summary", "Empty state done", "--step", "Open an empty project", "--attach", path.join(dir, "vitest.log"))

  await caption(page, "Lucas sends it back from the Review page")
  // Rows are collapsed since CEL-22: open this one.
  await page.goto(`/review?open=${task}`)
  const item = page.getByRole("article", { name: new RegExp(task) })
  await item.getByRole("button", { name: "Send back" }).click()
  const dialog = page.getByRole("dialog", { name: `Send ${task} back` })
  await dialog.getByLabel("Note").fill("The empty state still shows a spinner first.")
  await dialog.getByRole("button", { name: "Send back" }).click()
  await expect(dialog).toBeHidden()
  await expect(item).toBeHidden()

  await caption(page, `${task} is back in In Progress`)
  await page.getByRole("link", { name: "Inbox test" }).click()
  await expect(column(page, "In Progress").locator(`[data-task-key="${task}"]`)).toBeVisible()

  await caption(page, "When the agent stops, its Stop hook hands the note back as feedback and keeps it working")
  const stdin = JSON.stringify({ session_id: SESSION, hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: "Submitted." })
  const hook = celloAs(null, { stdin })("hook", "claude", "stop")
  const { hookSpecificOutput: feedback } = JSON.parse(hook) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } }
  await showTerminal(
    page,
    "cello hook claude stop   # stdin: Claude Code's Stop JSON",
    `{"hookSpecificOutput": {"hookEventName": "${feedback.hookEventName}", "additionalContext": (below)}}\n\n${feedback.additionalContext}`,
  )
  expect(feedback.hookEventName).toBe("Stop")
  expect(feedback.additionalContext).toMatch(new RegExp(`${task}  Comments reach agents\n  .+ sent it back, just now\n    The empty state still shows a spinner first\\.`))
  expect(feedback.additionalContext).toContain(`hand it in again with \`cello task submit ${task}\``)
  await expect(page.getByLabel("Agent terminal")).toContainText("sent it back")

  await caption(page, "The next stop goes through: nothing new")
  // The stop Claude makes after the hook kept it going (with nothing new and no waiter, a first stop would ask for `cello inbox --wait`, CEL-74).
  const quiet = celloAs(null, { stdin: JSON.stringify({ ...JSON.parse(stdin), stop_hook_active: true }) })("hook", "claude", "stop")
  await showTerminal(page, "cello hook claude stop", quiet)
  expect(quiet).toBe("")
  await expect(page.getByLabel("Agent terminal")).toContainText("(prints nothing)")
  await caption(page, "Both reached the agent's session, once each")
  await page.screenshot({ path: path.join(SHOTS, "cel-15-send-back-through-stop-hook.png") })
  fs.rmSync(dir, { recursive: true, force: true })
})
