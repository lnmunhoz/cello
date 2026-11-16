// CEL-76: Lucas sees whether his comment reached the agent, live, like a messenger's ticks: Sent, then
// ✓ Delivered to the session once it takes it (its hook, `cello inbox`, or a waiting `cello inbox --wait`),
// then ✓✓ Answered once it comments after it or reacts to it. Under his latest comment, until it's answered,
// a status row in the thread says where it stands, like a chat's typing indicator: gets it at its next step,
// got it and is working on it, idle, nobody (the line that used to sit under the comment box is gone). It
// works on the Review page too. And a card an agent works on shows a thin edge in its colour, with one
// flash and one turn of the status icon per check-in. Agents are real sessions over RPC, the waiter a real
// `cello inbox --wait` from the CLI. While the agent works on the comment it took, the row's mark thinks
// (CEL-69's loop); otherwise it keeps still. (A comment on a task nobody holds reopens it for the agent
// that last held it, CEL-110, so "nobody gets it" is shown on a task Lucas holds himself.) Stills go to e2e/videos/cel-76-*.
import { spawn } from "node:child_process"
import * as path from "node:path"
import type { Locator, Page } from "@playwright/test"
import { newCommandId, openClient } from "../packages/client/test/support/promiseClient.ts"
import { caption, card, defaultWorkspace, expect, seedProject, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { SHOTS, WEB_URL } from "./packets.ts"
import { isReview } from "./recording.ts"

const root = path.resolve(import.meta.dirname, "..")
const SERVER_PORT = Number(process.env.CELLO_E2E_SERVER_PORT ?? 4791)
const SESSION = "c76e2e01-receipts-session"
const BUILDER = "b1d2c3e4f5a6b7c8"

test.beforeEach(async ({ context }) => {
  if (isReview(process.env)) test.setTimeout(240_000)
  await context.addInitScript(() => {
    if (localStorage.getItem("cello:agent-cursors") === null) localStorage.setItem("cello:agent-cursors", "off")
  })
})

/** An agent session (and with `agent`, one of its subagents) over RPC, as the CLI calls. */
const as = (baseURL: string, session: string, agent?: { id: string; type: string }) =>
  openClient(`${baseURL.replace(/^http/, "ws")}/rpc`, {
    "x-cello-session": session,
    "x-cello-client": "Claude Code",
    "x-cello-pid": String(process.pid),
    ...(agent ? { "x-cello-agent": agent.id, "x-cello-agent-type": agent.type } : {}),
  })

/** A real `cello inbox --wait` for `session`, from source; resolves with what it printed once it exits. */
const startWaiter = (session: string): Promise<string> => {
  const child = spawn("bun", [path.join(root, "apps/cli/src/bin.ts"), "inbox", "--wait"], {
    cwd: root,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, CELLO_PORT: String(SERVER_PORT), CLAUDE_CODE_SESSION_ID: session, CLAUDE_PID: String(process.pid) },
  })
  let out = ""
  child.stdout.on("data", (d) => (out += String(d)))
  return new Promise((resolve) => child.on("exit", () => resolve(out)))
}

/** Light and dark stills (`take` saves one, given the theme), without the video's cursor and captions. */
async function stills(page: Page, take: (theme: "light" | "dark") => Promise<unknown>) {
  await page.mouse.move(5, 5)
  const overlay = (shown: boolean) => page.evaluate((v) => document.getElementById("e2e-layer")?.style.setProperty("visibility", v), shown ? "visible" : "hidden")
  await overlay(false)
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await take(theme)
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"))
  await overlay(true)
}

/** Light and dark stills of `target` (the page, or one part of it). */
const shoot = (page: Page, name: string, target: Page | Locator = page) =>
  stills(page, (theme) => target.screenshot({ path: path.join(SHOTS, `cel-76-${name}-${theme}.png`) }))

const comments = (page: Page, key: string) => taskPanel(page, key).getByRole("region", { name: "Comments" })
const receipt = (thread: Locator, n: number) => thread.locator("[data-comment-id]").nth(n).locator("[data-receipt]")
/** The status row, wherever it is in the thread (there's at most one). */
const statusRow = (thread: Locator) => thread.locator("[data-comment-status]")
/** The agent's mark in the status row, whose pose `data-agent-mood` names (thinking while it works on the comment). */
const statusMark = (thread: Locator) => statusRow(thread).locator("[data-status-mark]")
/** The status row right after comment `n`, if it's there. */
const statusAfter = (thread: Locator, n: number) =>
  thread.locator("[data-comment-id]").nth(n).locator("xpath=following-sibling::li[1][@data-comment-status]")

/** Lucas writes in the box and sends it. */
async function say(thread: Locator, text: string) {
  await thread.getByLabel("New comment").fill(text)
  await thread.getByRole("button", { name: "Comment", exact: true }).click()
  await expect(thread.getByLabel("New comment")).toHaveValue("")
}

test("CEL-76: Lucas's comments show Sent, Delivered and Answered live, and a status row under his latest says where it stands", async ({ page, cello, baseURL }) => {
  const key = uniqueKey("RCPT")
  const project = await seedProject(cello, "Receipts", key)
  const { statuses } = await defaultWorkspace(cello)
  await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Comments show whether they got there", statusId: statuses.Todo!.id }))
  const task = `${key}-1`
  const agent = await as(baseURL!, SESSION)
  const take = (via: "hook" | "inbox") => agent.run((c) => c["inbox.take"]({ unreadOnly: true, via }))
  await agent.run((c) => c["task.claim"]({ commandId: newCommandId(), key: task }))
  await agent.run((c) => c["task.stage"]({ commandId: newCommandId(), key: task, stage: "building" }))

  await page.goto(`/${key}/1`)
  const thread = comments(page, task)
  await caption(page, `Session c76e2e01 is working on ${task}: no comment yet, so no status row, and no line under the box`)
  await expect(thread.getByLabel("New comment")).toBeVisible()
  await expect(thread.locator("[data-next-comment]")).toHaveCount(0)
  await expect(statusRow(thread)).toHaveCount(0)

  await caption(page, "Lucas comments: Sent, and a row under it says the agent gets it at its next step")
  await say(thread, "Does the receipt show under my comment?")
  await expect(receipt(thread, 0)).toHaveText("Sent")
  await expect(statusAfter(thread, 0)).toHaveText("c76e2e01 gets this at its next step")
  await expect(statusAfter(thread, 0)).toHaveAttribute("data-comment-status", "ok")
  // Not taken yet: nothing to think about, so the mark keeps still.
  await expect(statusMark(thread)).toHaveAttribute("data-agent-mood", "still")

  await caption(page, "The agent's hook takes it on its next tool call: ✓ Delivered, the row says it's working on it, and its mark thinks")
  await take("hook")
  await expect(receipt(thread, 0)).toHaveAttribute("data-receipt", "delivered")
  await expect(receipt(thread, 0)).toContainText(/^Delivered to c76e2e01 · /)
  await expect(receipt(thread, 0)).toHaveAttribute("title", /through its hook$/)
  await expect(statusAfter(thread, 0)).toHaveText("c76e2e01 got your comment and is working on it…")
  await expect(statusMark(thread)).toHaveAttribute("data-agent-mood", "thinking")
  await shoot(page, "status-working", thread)

  await caption(page, "Its cello-builder answers on the card: ✓✓ Answered, and the row goes away")
  await agent.run((c) => c["agent.report"]({ agentId: BUILDER, agentType: "cello-builder", state: "launched", description: `${task} receipts`, prompt: "Build it" }))
  const builder = await as(baseURL!, SESSION, { id: BUILDER, type: "cello-builder" })
  await builder.run((c) => c["whoami"]({ project: {} }))
  const taskId = (await cello.run((c) => c["task.get"]({ key: task }))).task.id
  await builder.run((c) => c["comment.add"]({ commandId: newCommandId(), taskId, body: "Yes: it reads Delivered, and Answered now that I've replied." }))
  await expect(receipt(thread, 0)).toHaveText(/^Answered by cello-builder · b1d2c3e4 · /)
  await expect(statusRow(thread)).toHaveCount(0)

  await caption(page, "A second comment: the row moves under it; taken by cello inbox, answered with a 👍 from the session")
  await say(thread, "Good. Check it in dark mode too.")
  await expect(receipt(thread, 2)).toHaveAttribute("data-receipt", "sent")
  await expect(statusAfter(thread, 2)).toHaveText("c76e2e01 gets this at its next step")
  await take("inbox")
  await expect(receipt(thread, 2)).toHaveAttribute("data-receipt", "delivered")
  await expect(receipt(thread, 2)).toHaveAttribute("title", /through cello inbox$/)
  await expect(statusAfter(thread, 2)).toHaveText("c76e2e01 got your comment and is working on it…")
  const second = (await cello.run((c) => c["comment.list"]({ taskId })))[2]!
  await agent.run((c) => c["comment.react"]({ commandId: newCommandId(), commentId: second.id, emoji: "👍", on: true }))
  await expect(receipt(thread, 2)).toHaveAttribute("data-receipt", "answered")
  await expect(receipt(thread, 2)).toHaveAttribute("title", /reacted 👍/)
  await expect(statusRow(thread)).toHaveCount(0)

  await say(thread, "And on a phone width.")
  await expect(receipt(thread, 3)).toHaveAttribute("data-receipt", "sent")
  await caption(page, "The session writes on the card before it has taken that comment: not an answer to it, so it stays Sent, and the row stays under it")
  await agent.run((c) => c["comment.add"]({ commandId: newCommandId(), taskId, body: "Dark mode checked: it reads fine." }))
  await expect(thread.locator("[data-comment-id]")).toHaveCount(5)
  await expect(receipt(thread, 3)).toHaveAttribute("data-receipt", "sent")
  await expect(statusAfter(thread, 3)).toHaveText("c76e2e01 gets this at its next step")
  await expect(statusRow(thread)).toHaveCount(1)
  await shoot(page, "thread", thread)

  await caption(page, "The agent ends its turn with cello inbox --wait running, without answering: the row says so")
  await builder.run((c) => c["agent.report"]({ agentId: BUILDER, agentType: "cello-builder", state: "stopped" }))
  await take("hook") // the Stop hook takes the third comment
  await expect(receipt(thread, 3)).toHaveAttribute("data-receipt", "delivered")
  const waiter = startWaiter(SESSION)
  await expect(statusAfter(thread, 3)).toHaveText("c76e2e01 got your comment but hasn't answered yet")
  await expect(statusAfter(thread, 3)).toHaveAttribute("data-comment-status", "idle")
  // Waiting for Lucas: waiting's pose, which doesn't move.
  await expect(statusMark(thread)).toHaveAttribute("data-agent-mood", "waiting")
  await shoot(page, "waiting", thread)

  await caption(page, "Lucas comments: the waiter takes it at once, ✓ Delivered under a second; the session woke, so the row says it's on it and the mark thinks")
  await say(thread, "Are you there? This should wake you.")
  expect(await waiter).toContain("Are you there?")
  await expect(receipt(thread, 5)).toHaveText("Delivered to c76e2e01 · <1s")
  await expect(receipt(thread, 5)).toHaveAttribute("title", /through its waiting cello inbox --wait$/)
  // Taking it through the waiter woke the session, seen at that moment, in the same change as the delivery:
  // working on it right away, not waiting for its next check-in.
  await expect(statusAfter(thread, 5)).toHaveText("c76e2e01 got your comment and is working on it…")
  await expect(statusAfter(thread, 5)).toHaveAttribute("data-comment-status", "ok")
  await expect(statusMark(thread)).toHaveAttribute("data-agent-mood", "thinking")
  await shoot(page, "woken", thread)

  await caption(page, "The agent lets the task go and Lucas takes it himself: a comment goes to no agent, and the row under it warns")
  await agent.run((c) => c["task.release"]({ commandId: newCommandId(), key: task }))
  await expect(statusAfter(thread, 5)).toHaveText("c76e2e01 got your comment but hasn't answered yet")
  await expect(statusMark(thread)).toHaveAttribute("data-agent-mood", "still")
  // Nobody holding it, a comment would give it back to c76e2e01 (CEL-110): with Lucas holding it, it goes to no agent.
  await cello.run((c) => c["task.claim"]({ commandId: newCommandId(), key: task }))
  await say(thread, "Can someone pick this up?")
  await expect(receipt(thread, 6)).toHaveText("Not delivered: no agent held this task")
  // Agents worked on this task, so a comment nobody got is a warning, in red.
  await expect(receipt(thread, 6)).toHaveAttribute("data-tone", "warn")
  await expect(statusAfter(thread, 6)).toHaveText("No agent holds this task: nobody will get this")
  await expect(statusAfter(thread, 6)).toHaveAttribute("data-comment-status", "warn")
  await expect(statusRow(thread)).toHaveCount(1)
  await shoot(page, "nobody", thread)

  for (const client of [agent, builder]) await client.close()
})

test("CEL-76: an idle agent without a waiter gets the comment when it next works", async ({ browser, cello, baseURL }) => {
  const key = uniqueKey("IDLE")
  const project = await seedProject(cello, "Idle", key)
  const { statuses } = await defaultWorkspace(cello)
  await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "An idle agent gets it later", statusId: statuses.Todo!.id }))
  const task = `${key}-1`
  const agent = await as(baseURL!, "c76e2e02-idle-session")
  await agent.run((c) => c["task.claim"]({ commandId: newCommandId(), key: task }))
  await agent.run((c) => c["task.stage"]({ commandId: newCommandId(), key: task, stage: "building" }))
  const taskId = (await cello.run((c) => c["task.get"]({ key: task }))).task.id
  await cello.run((c) => c["comment.add"]({ commandId: newCommandId(), taskId, body: "When you're back: rename the flag to --wait." }))

  // The page's clock 20 minutes on: the session's last check-in is 20 minutes old, so it reads idle.
  const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 } })
  await context.addInitScript(() => localStorage.setItem("cello:agent-cursors", "off"))
  const page = await context.newPage()
  await page.clock.setFixedTime(Date.now() + 20 * 60_000)
  await page.goto(`/${key}/1`)
  const thread = comments(page, task)
  await expect(receipt(thread, 0)).toHaveText("Sent")
  await expect(statusAfter(thread, 0)).toHaveText("c76e2e02 is idle: it gets this when it next works")
  await expect(statusAfter(thread, 0)).toHaveAttribute("data-comment-status", "idle")
  await expect(statusMark(thread)).toHaveAttribute("data-agent-mood", "still")
  await shoot(page, "idle", thread)
  await context.close()
  await agent.close()
})

test("CEL-76: the Review page's comments carry their receipts too", async ({ page, cello, baseURL }) => {
  const key = uniqueKey("RVRC")
  const project = await seedProject(cello, "Review receipts", key)
  const { statuses } = await defaultWorkspace(cello)
  await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Receipts on the Review page", statusId: statuses.Todo!.id }))
  const task = `${key}-1`
  const agent = await as(baseURL!, "c76e2e03-review-session")
  await agent.run((c) => c["task.claim"]({ commandId: newCommandId(), key: task }))
  await agent.run((c) =>
    c["review.submit"]({
      commandId: newCommandId(), key: task, summary: "Receipts on the Review page", steps: ["Comment under the packet"], files: [],
      links: [{ url: "https://example.com/pr/76", caption: "The PR" }],
    }))

  await page.goto(`/review?open=${task}`)
  const article = page.getByRole("article", { name: new RegExp(`${task}\\b`) })
  const thread = article.getByRole("region", { name: "Comments" })
  await caption(page, "On the Review page, Lucas comments under the open packet: Sent, then Delivered once the agent takes it, with the status row under it")
  await expect(thread.getByLabel("New comment")).toBeVisible()
  await expect(thread.locator("[data-next-comment]")).toHaveCount(0)
  await say(thread, "One more thing before I approve: the empty state.")
  await expect(receipt(thread, 0)).toHaveAttribute("data-receipt", "sent")
  await expect(statusAfter(thread, 0)).toHaveText("c76e2e03 gets this at its next step")
  await agent.run((c) => c["inbox.take"]({ unreadOnly: true, via: "hook" }))
  await expect(receipt(thread, 0)).toHaveAttribute("data-receipt", "delivered")
  await expect(statusAfter(thread, 0)).toHaveText("c76e2e03 got your comment and is working on it…")
  await shoot(page, "review", article)
  await agent.close()
})

test("CEL-76: a card shows an edge in its agent's colour while it works; each check-in flashes it and turns the status icon once", async ({ page, cello, baseURL }) => {
  const key = uniqueKey("EDGE")
  const project = await seedProject(cello, "Edge", key)
  const { statuses } = await defaultWorkspace(cello)
  await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "The card shows the agent working", statusId: statuses.Todo!.id }))
  const task = `${key}-1`
  await page.goto(`/${key}/issues`)
  const theCard = card(page, task)
  await expect(theCard).toBeVisible()
  await expect(theCard.locator("[data-activity-edge]")).toHaveCount(0)

  await caption(page, "An agent claims it and starts thinking: the card gets a thin edge in its colour")
  const agent = await as(baseURL!, "c76e2e04-edge-session")
  await agent.run((c) => c["task.claim"]({ commandId: newCommandId(), key: task }))
  await expect(theCard.locator("[data-activity-edge]")).toBeVisible()

  await caption(page, "It starts building: the edge flashes once and the In Progress icon's half fill turns once")
  await agent.run((c) => c["task.stage"]({ commandId: newCommandId(), key: task, stage: "building" }))
  await expect(theCard.locator("[data-status-turn]")).toHaveAttribute("data-status-turn", /^[1-9]/)
  await expect(theCard.locator(".activity-edge-flash")).toHaveCount(1)
  // The card's motions, frozen mid-way for the still.
  await theCard.evaluate((el) =>
    el.getAnimations({ subtree: true }).forEach((a) => {
      a.pause()
      a.currentTime = 450
    }))
  const box = (await theCard.boundingBox())!
  const clip = { x: box.x - 14, y: box.y - 14, width: box.width + 28, height: box.height + 28 }
  await stills(page, (theme) => page.screenshot({ path: path.join(SHOTS, `cel-76-edge-moving-${theme}.png`), clip }))
  await theCard.evaluate((el) => el.getAnimations({ subtree: true }).forEach((a) => a.play()))

  await caption(page, "Then it rests: the edge stays while the agent works; the flash and the turn played once (the mark keeps its working loop, CEL-69)")
  // A finished animation leaves getAnimations(), so none of the two is left once they've played.
  await theCard.evaluate((el, names) =>
    Promise.all(el.getAnimations({ subtree: true }).filter((a) => names.includes((a as CSSAnimation).animationName)).map((a) => a.finished.catch(() => undefined))), ["activity-edge-flash", "status-turn"])
  expect(await theCard.evaluate((el, names) =>
    el.getAnimations({ subtree: true }).filter((a) => names.includes((a as CSSAnimation).animationName)).length, ["activity-edge-flash", "status-turn"])).toBe(0)
  await expect(theCard.locator("[data-activity-edge]")).toBeVisible()
  await stills(page, (theme) => page.screenshot({ path: path.join(SHOTS, `cel-76-edge-rest-${theme}.png`), clip }))

  await caption(page, "It lets the task go: the edge goes with it")
  await agent.run((c) => c["task.release"]({ commandId: newCommandId(), key: task }))
  await expect(theCard.locator("[data-activity-edge]")).toHaveCount(0)
  await agent.close()
})
