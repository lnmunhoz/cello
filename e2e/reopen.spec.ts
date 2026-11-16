// CEL-110: Lucas comments on a task nobody holds (approved and Done, or released) and the comment goes to
// the agent session that last worked on it, reopening the task for it. Before he sends it the comment box
// says so ("Commenting reopens KEY-1 and sends it to Claude Code session c110e2e0"); once sent, the card
// moves back to In Progress, claimed by that session again, the receipt goes Sent then Delivered as for
// any comment, and the history shows the reopen. The agent is a real session over RPC. Stills go to
// e2e/videos/cel-110-*.
import * as path from "node:path"
import type { Locator, Page } from "@playwright/test"
import { newCommandId, openClient } from "../packages/client/test/support/promiseClient.ts"
import { caption, card, column, defaultWorkspace, expect, seedProject, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { SHOTS } from "./packets.ts"
import { isReview } from "./recording.ts"

const SESSION = "c110e2e0-reopen-session"

test.beforeEach(async ({ context }) => {
  if (isReview(process.env)) test.setTimeout(240_000)
  await context.addInitScript(() => {
    if (localStorage.getItem("cello:agent-cursors") === null) localStorage.setItem("cello:agent-cursors", "off")
  })
})

/** An agent session over RPC, as the CLI calls, its process this one (alive). */
const as = (baseURL: string, session: string) =>
  openClient(`${baseURL.replace(/^http/, "ws")}/rpc`, { "x-cello-session": session, "x-cello-client": "Claude Code", "x-cello-pid": String(process.pid) })

/** Light and dark stills of `target`, without the video's cursor and captions. */
async function shoot(page: Page, name: string, target: Locator) {
  await page.mouse.move(5, 5)
  const overlay = (shown: boolean) => page.evaluate((v) => document.getElementById("e2e-layer")?.style.setProperty("visibility", v), shown ? "visible" : "hidden")
  await overlay(false)
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await target.screenshot({ path: path.join(SHOTS, `cel-110-${name}-${theme}.png`) })
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"))
  await overlay(true)
}

const comments = (page: Page, key: string) => taskPanel(page, key).getByRole("region", { name: "Comments" })
const receipt = (thread: Locator, n: number) => thread.locator("[data-comment-id]").nth(n).locator("[data-receipt]")
const hint = (thread: Locator) => thread.locator("[data-reopen-hint]")

async function say(thread: Locator, text: string) {
  await thread.getByLabel("New comment").fill(text)
  await thread.getByRole("button", { name: "Comment", exact: true }).click()
  await expect(thread.getByLabel("New comment")).toHaveValue("")
}

test("CEL-110: a comment on a Done task says beforehand it reopens it, then sends it to the session that built it and moves the card to In Progress", async ({ page, cello, baseURL }) => {
  const key = uniqueKey("REOP")
  const project = await seedProject(cello, "Reopen", key)
  const { statuses } = await defaultWorkspace(cello)
  await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "The setup video", statusId: statuses.Todo!.id }))
  const task = `${key}-1`
  const agent = await as(baseURL!, SESSION)
  await agent.run((c) => c["task.claim"]({ commandId: newCommandId(), key: task }))
  await agent.run((c) =>
    c["review.submit"]({
      commandId: newCommandId(), key: task, summary: "The setup video", steps: ["Watch it"], files: [],
      links: [{ url: "https://example.com/pr/94", caption: "The PR" }],
    }))
  await cello.run((c) => c["review.approve"]({ commandId: newCommandId(), key: task }))

  await page.goto(`/${key}/1`)
  const thread = comments(page, task)
  await caption(page, `${task} is Done: session c110e2e0 built it and Lucas approved it, so nobody holds it now`)
  await expect(column(page, "Done").locator(`[data-task-key="${task}"]`)).toBeAttached()
  await caption(page, "The comment box says what a comment will do: reopen the task and send it to the session that built it")
  await expect(hint(thread)).toHaveText(`Commenting reopens ${task} and sends it to Claude Code session c110e2e0`)
  await expect(hint(thread)).toHaveAttribute("data-reopen-hint", "reopens")
  await shoot(page, "hint", thread)

  await caption(page, "Lucas comments: the card moves back to In Progress, claimed by c110e2e0, and the comment is Sent to it")
  await say(thread, "Let's add the instructional video to the repo readme")
  await expect(column(page, "In Progress").locator(`[data-task-key="${task}"]`)).toBeAttached()
  await expect(card(page, task)).toHaveCount(1)
  await expect(receipt(thread, 0)).toHaveText("Sent")
  // The session holds it again: no hint, and the status row says when it gets the comment.
  await expect(hint(thread)).toHaveCount(0)
  await expect(thread.locator("[data-comment-status]")).toHaveText("c110e2e0 gets this at its next step")
  const history = taskPanel(page, task).getByRole("region", { name: "History" })
  await history.scrollIntoViewIfNeeded()
  await expect(history).toContainText("comment reopened it for Claude Code session c110e2e0")
  await expect(history).toContainText("moved it from Done to In Progress")
  await shoot(page, "reopened", taskPanel(page, task))

  await caption(page, "The session's hook takes it on its next tool call: ✓ Delivered, as for any comment")
  const taken = await agent.run((c) => c["inbox.take"]({ unreadOnly: true, via: "hook" }))
  expect(taken.items.map((i) => (i.kind === "comment" ? [i.comment.body, i.reopened] : i.kind))).toEqual([
    ["Let's add the instructional video to the repo readme", { from: "Done", to: "In Progress" }],
  ])
  expect(taken.claimed).toEqual([task])
  await expect(receipt(thread, 0)).toHaveAttribute("data-receipt", "delivered")
  await expect(receipt(thread, 0)).toContainText(/^Delivered to c110e2e0 · /)
  await thread.scrollIntoViewIfNeeded()
  await shoot(page, "delivered", thread)

  await caption(page, "The session lets the task go while it's In Progress: the box says a comment gives it back, not reopens it")
  await agent.run((c) => c["task.release"]({ commandId: newCommandId(), key: task }))
  await expect(hint(thread)).toHaveText(`Commenting gives ${task} back to Claude Code session c110e2e0 and sends it your comment`)
  await expect(hint(thread)).toHaveAttribute("data-reopen-hint", "gives-back")
  await shoot(page, "gives-back", thread)
  await agent.close()
})
