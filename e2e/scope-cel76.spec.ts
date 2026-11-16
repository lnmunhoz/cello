// CEL-76 scope (not merged as is): screenshots of the three receipt options (?receipts=a|b|c) and the
// two card activity treatments (?activity=sweep|edge), light and dark, for evidence/cel-76/. Everything
// on screen is real: agents claim, take comments (`inbox.take`, and a real `cello inbox --wait` from the
// CLI) and answer over RPC; the receipts come from the prototype read `scope.receipts`. Shots:
//   - delivered + answered + sent: three comments of Lucas's on a task an orchestrator holds while its
//     cello-builder works on it (the first answered by the builder, the second taken, the third not yet)
//   - waiting: a session with `cello inbox --wait` open, then Lucas's comment, taken by the waiter at once
//   - nobody: a comment on a task nobody holds, and the warning for the next one
//   - idle: a session that took nothing and isn't waiting, seen 20 minutes ago (the page's clock moved on)
//   - activity: the card while its agent starts working, frozen mid-motion, and at rest after
import { type ChildProcess, spawn, spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import type { Browser, BrowserContext, Page } from "@playwright/test"
import { newCommandId, openClient, type PromiseClient } from "../packages/client/test/support/promiseClient.ts"
import { defaultWorkspace, expect, seedProject, test, uniqueKey } from "./fixtures.ts"
import { SHOTS, WEB_URL } from "./packets.ts"

const OUT = path.join(SHOTS, "cel-76")
const root = path.resolve(import.meta.dirname, "..")
const SERVER_PORT = Number(process.env.CELLO_E2E_SERVER_PORT ?? 4791)

const ORCHESTRATOR = "2fd0505c-6b1e-4a8e-9c1d-cel76scope01"
const BUILDER = "a13bfb89c0de76aa"
const WAITER = "8a41c9e2-3f60-4d0b-8e57-cel76scope02"
const IDLE = "c3e7f210-91aa-4c2e-b5d4-cel76scope03"
const WORKER = "d94b1a07-5c88-4e19-a0f3-cel76scope04"

/** An agent session (and, with `agent`, one of its subagents) over RPC, as the CLI calls. */
const as = (baseURL: string, session: string, agent?: { id: string; type: string }) =>
  openClient(`${baseURL.replace(/^http/, "ws")}/rpc`, {
    "x-cello-session": session,
    "x-cello-client": "Claude Code",
    "x-cello-pid": String(process.pid),
    ...(agent ? { "x-cello-agent": agent.id, "x-cello-agent-type": agent.type } : {}),
  })

/** A real `cello inbox --wait` for `session`, from source, against the e2e server; resolves when it exits. */
const startWaiter = (session: string): { child: ChildProcess; exited: Promise<string> } => {
  const child = spawn("bun", [path.join(root, "apps/cli/src/bin.ts"), "inbox", "--wait"], {
    cwd: root,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, CELLO_PORT: String(SERVER_PORT), CLAUDE_CODE_SESSION_ID: session, CLAUDE_PID: String(process.pid) },
  })
  let out = ""
  child.stdout?.on("data", (d) => (out += String(d)))
  const exited = new Promise<string>((resolve) => child.on("exit", () => resolve(out)))
  return { child, exited }
}

const comments = (page: Page) => page.locator("section").filter({ has: page.getByRole("heading", { name: "Comments", exact: true }) })

test("CEL-76 scope: delivery receipts A ticks, B status line, C banner, and the card's activity, light and dark", async ({ browser, cello, baseURL }) => {
  test.setTimeout(300_000)
  fs.mkdirSync(OUT, { recursive: true })
  const key = uniqueKey("RCPT")
  const project = await seedProject(cello, "Receipts", key)
  const { statuses } = await defaultWorkspace(cello)
  const titles = [
    "Comments show whether the agent got them",
    "A waiting agent wakes on a comment",
    "Nobody holds this one",
    "An idle agent gets it later",
    "The card shows the agent working",
  ]
  const ids: string[] = []
  for (const title of titles) {
    const made = await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title, statusId: statuses.Todo!.id }))
    ids.push(made.result.id)
  }
  const [busy, waits, nobody, idle, working] = [1, 2, 3, 4, 5].map((n) => `${key}-${n}`)
  const say = (taskId: string, body: string) => cello.run((c) => c["comment.add"]({ commandId: newCommandId(), taskId, body }))
  const take = (agent: PromiseClient) => agent.run((c) => c["inbox.take"]({ unreadOnly: true }))

  // An orchestrator holds task 1 while its cello-builder works on it.
  const orchestrator = await as(baseURL!, ORCHESTRATOR)
  await orchestrator.run((c) => c["task.claim"]({ commandId: newCommandId(), key: busy! }))
  await orchestrator.run((c) => c["task.stage"]({ commandId: newCommandId(), key: busy!, stage: "building" }))
  await orchestrator.run((c) =>
    c["agent.report"]({ agentId: BUILDER, agentType: "cello-builder", state: "launched", description: `${busy} receipts`, prompt: `Build ${busy}` }))
  const builder = await as(baseURL!, ORCHESTRATOR, { id: BUILDER, type: "cello-builder" })
  await builder.run((c) => c["whoami"]({ project: {} }))
  await say(ids[0]!, "Does a receipt show under my comment now?")
  await take(orchestrator)
  await builder.run((c) => c["comment.add"]({ commandId: newCommandId(), taskId: ids[0]!, body: "Yes: it's under your comment, and it turns into Answered once I reply." }))
  await say(ids[0]!, "Good. Check it in dark mode too.")
  await take(orchestrator)
  await say(ids[0]!, "And on a phone width.")

  // Task 2: a session that ended its turn with `cello inbox --wait` running.
  const waiterSession = await as(baseURL!, WAITER)
  await waiterSession.run((c) => c["task.claim"]({ commandId: newCommandId(), key: waits! }))
  await waiterSession.run((c) => c["task.stage"]({ commandId: newCommandId(), key: waits!, stage: "building" }))
  const waiter = startWaiter(WAITER)
  const waiterId = (await waiterSession.run((c) => c["whoami"]({ project: {} }))).session!.id
  await expect.poll(async () => (await cello.run((c) => c["scope.receipts"]({ taskId: ids[1]! }))).waiting, { timeout: 15_000 }).toContain(waiterId)

  // Task 3: nobody holds it.
  await say(ids[2]!, "Can someone pick this up?")

  // Task 4: held, but the session isn't working and isn't waiting.
  const idleSession = await as(baseURL!, IDLE)
  await idleSession.run((c) => c["task.claim"]({ commandId: newCommandId(), key: idle! }))
  await idleSession.run((c) => c["task.stage"]({ commandId: newCommandId(), key: idle!, stage: "building" }))
  await say(ids[3]!, "When you're back: rename the flag to --wait.")

  // Task 5: a session on it, thinking (Agent review) until it starts building on screen.
  const worker = await as(baseURL!, WORKER)
  await worker.run((c) => c["task.claim"]({ commandId: newCommandId(), key: working! }))

  const open = async (context: BrowserContext) => {
    await context.addInitScript(() => localStorage.setItem("cello:agent-cursors", "off"))
    return context.newPage()
  }
  const newContext = (b: Browser, scheme: "light" | "dark", extra: Parameters<Browser["newContext"]>[0] = {}) =>
    b.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme, ...extra })
  const shotComments = async (page: Page, name: string) => {
    await page.mouse.move(1430, 890)
    await comments(page).screenshot({ path: path.join(OUT, `${name}.png`) })
  }
  const number = (k: string) => k.split("-")[1]

  for (const scheme of ["light", "dark"] as const) {
    const context = await newContext(browser, scheme)
    const page = await open(context)
    for (const style of ["a", "b", "c"] as const) {
      // Delivered, answered and sent, on the task the builder works on.
      await page.goto(`/${key}/${number(busy!)}?receipts=${style}`)
      await expect(comments(page).locator("[data-comment-id]")).toHaveCount(4)
      await expect(comments(page).locator('[data-receipt="answered"]')).toHaveCount(1)
      await shotComments(page, `${style}-delivered-${scheme}`)
      if (style === "a") await page.screenshot({ path: path.join(OUT, `${style}-panel-${scheme}.png`) })

      await page.goto(`/${key}/${number(waits!)}?receipts=${style}`)
      // A warns only when the comment won't arrive soon: nothing above the box here.
      if (style === "a") await expect(comments(page).getByRole("textbox", { name: "New comment" })).toBeVisible()
      else await expect(comments(page).getByText(/waiting for you/).first()).toBeVisible()
      await expect(comments(page).locator("[data-reach-warning]")).toHaveCount(0)
      await shotComments(page, `${style}-waiting-${scheme}`)

      await page.goto(`/${key}/${number(nobody!)}?receipts=${style}`)
      await expect(comments(page).locator('[data-receipt="unsent"]')).toHaveCount(1)
      await shotComments(page, `${style}-nobody-${scheme}`)
    }
    await context.close()

    // Idle: the page's clock 20 minutes on, so the session that took nothing reads "seen 20m ago".
    const later = await newContext(browser, scheme)
    const idlePage = await open(later)
    await idlePage.clock.setFixedTime(Date.now() + 20 * 60_000)
    for (const style of ["a", "b", "c"] as const) {
      await idlePage.goto(`/${key}/${number(idle!)}?receipts=${style}`)
      await expect(comments(idlePage).getByText(/is idle/).first()).toBeVisible()
      await shotComments(idlePage, `${style}-idle-${scheme}`)
    }
    await later.close()
  }

  // The waiter takes Lucas's comment the moment he sends it (typed in the box, option A).
  {
    const context = await newContext(browser, "light")
    const page = await open(context)
    await page.goto(`/${key}/${number(waits!)}?receipts=a`)
    await page.getByRole("textbox", { name: "New comment" }).fill("Are you there? The waiter should wake you.")
    await page.getByRole("button", { name: "Comment", exact: true }).click()
    expect(await waiter.exited).toContain("Are you there?")
    await page.reload()
    await expect(comments(page).locator('[data-receipt="delivered"]')).toHaveCount(1)
    await shotComments(page, "a-woken-light")
    for (const style of ["b", "c"] as const) {
      await page.goto(`/${key}/${number(waits!)}?receipts=${style}`)
      await expect(comments(page).locator('[data-receipt="delivered"]')).toHaveCount(1)
      await shotComments(page, `${style}-woken-light`)
    }
    await context.close()
  }

  // Activity on the card: each variant, light and dark, frozen mid-motion and at rest; plus a video.
  for (const style of ["sweep", "edge"] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await worker.run((c) => c["task.stage"]({ commandId: newCommandId(), key: working!, stage: "review" }))
      const video = scheme === "light" ? path.join(OUT, `video-${style}`) : undefined
      const context = await newContext(browser, scheme, video ? { recordVideo: { dir: video, size: { width: 1440, height: 900 } } } : {})
      const page = await open(context)
      await page.goto(`/${key}/issues?activity=${style}`)
      const card = page.locator(`[data-task-key="${working}"]`)
      await expect(card.locator("[data-card-work]")).toContainText("active now")
      const clip = async () => {
        const box = (await card.boundingBox())!
        return { x: box.x - 14, y: box.y - 14, width: box.width + 28, height: box.height + 28 }
      }
      await page.mouse.move(1430, 890)
      await worker.run((c) => c["task.stage"]({ commandId: newCommandId(), key: working!, stage: "building" }))
      await expect(card.locator('[data-activity-plays="1"]')).toBeVisible()
      await page.evaluate(() =>
        document.getAnimations().forEach((a) => {
          a.pause()
          a.currentTime = 450
        }))
      await page.screenshot({ path: path.join(OUT, `activity-${style}-moving-${scheme}.png`), clip: await clip() })
      await page.evaluate(() => document.getAnimations().forEach((a) => a.play()))
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))))
      await page.screenshot({ path: path.join(OUT, `activity-${style}-rest-${scheme}.png`), clip: await clip() })
      if (scheme === "light") await page.screenshot({ path: path.join(OUT, `activity-${style}-board-${scheme}.png`) })
      if (video) {
        // For the video, unfrozen: it thinks (Agent review), then starts building again; each plays once.
        for (const [stage, plays] of [["review", 2], ["building", 3]] as const) {
          await worker.run((c) => c["task.stage"]({ commandId: newCommandId(), key: working!, stage }))
          await expect(card.locator(`[data-activity-plays="${plays}"]`)).toBeVisible()
          await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))))
        }
      }
      await context.close()
      if (video) {
        const webm = fs.readdirSync(video).find((f) => f.endsWith(".webm"))
        if (webm) {
          spawnSync("ffmpeg", [
            "-y", "-loglevel", "error", "-i", path.join(video, webm), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
            path.join(OUT, `activity-${style}.mp4`),
          ])
        }
        fs.rmSync(video, { recursive: true, force: true })
      }
    }
  }

  waiter.child.kill()
  for (const client of [orchestrator, builder, waiterSession, idleSession, worker]) await client.close()
})
