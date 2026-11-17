// CEL-135: a tab on an older web build opens a task whose history holds an event type a newer server
// added. The page's /rpc socket goes through the test, which adds such an event to the server's
// task.history reply (this build's server can't write one). The History section still lists the task's
// changes, with one line saying a change happened that this version can't show, where the whole
// section used to fail to decode and show nothing.
import * as path from "node:path"
import type { Page } from "@playwright/test"
import { animationsSettled, caption, expect, newCommandId, seedProject, taskPanel, test, uniqueKey } from "./fixtures.ts"

/** A still for the review, in e2e/videos/evidence/, light and dark, without the video's caption and cursor. */
const stills = async (page: Page, name: string, target: ReturnType<Page["locator"]>) => {
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await animationsSettled(page)
    await target.screenshot({
      path: path.join(import.meta.dirname, "videos", "evidence", `cel-135-${name}-${theme}.png`),
      animations: "disabled",
      style: "#e2e-caption, #e2e-cursor, .e2e-ripple { display: none !important; }",
    })
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"))
}

type Message = { readonly _tag?: string; readonly id?: string; readonly tag?: string; readonly requestId?: string; readonly exit?: { _tag?: string; value?: unknown } }

/** Each frame carries one protocol message or a batch of them. */
const messagesIn = (frame: string | Buffer): Message[] => {
  const parsed = JSON.parse(typeof frame === "string" ? frame : frame.toString("utf8")) as Message | Message[]
  return Array.isArray(parsed) ? parsed : [parsed]
}

test("CEL-135: a task's history with an event type a newer server added still shows, with a line for the change this version can't show", async ({ page, cello }) => {
  const key = uniqueKey("HIS")
  const project = await seedProject(cello, "History test", key)
  const task = (await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Read a newer servers history" }))).result
  await cello.run((c) => c["task.update"]({ commandId: newCommandId(), id: task.id, expectedVersion: task.version, title: "Read a newer server's history" }))

  // The newer server: its task.history reply ends with an event of a type this build doesn't know.
  const historyRequests = new Set<string>()
  let added = 0
  await page.routeWebSocket(/\/rpc$/, (ws) => {
    const server = ws.connectToServer()
    ws.onMessage((frame) => {
      for (const m of messagesIn(frame)) if (m._tag === "Request" && m.tag === "task.history" && m.id !== undefined) historyRequests.add(m.id)
      server.send(frame)
    })
    server.onMessage((frame) => {
      const messages = messagesIn(frame).map((m) => {
        if (m._tag !== "Exit" || m.requestId === undefined || !historyRequests.has(m.requestId) || m.exit?._tag !== "Success" || !Array.isArray(m.exit.value)) return m
        const events = m.exit.value as Array<Record<string, unknown>>
        const last = events.at(-1)!
        added++
        return {
          ...m,
          exit: { ...m.exit, value: [...events, { ...last, seq: Number(last.seq) + 1000, ts: Date.now(), type: "test.from-a-newer-build", note: "only a newer build reads this" }] },
        }
      })
      ws.send(JSON.stringify(messages.length === 1 ? messages[0] : messages))
    })
  })

  await caption(page, "A newer server added a change of a type this version of Cello doesn't know to the task's history")
  await page.goto(`/${key}/1`)
  const panel = taskPanel(page, `${key}-1`)
  const history = panel.locator('section[aria-labelledby="history-heading"]')

  await caption(page, "The History section still lists the task's changes, and says one happened that this version can't show")
  await expect(history.locator('[data-history-event="unreadable"]')).toHaveText("A change this version of Cello can't show")
  await expect(history.locator('[data-history-event="task.created"]')).toContainText("created the task")
  await expect(history.locator('[data-history-event="task.updated"]')).toContainText("changed the title")
  expect(added, "the history reply went through the newer server").toBeGreaterThan(0)
  await history.scrollIntoViewIfNeeded()
  await stills(page, "history", history)
  await caption(page, "The rest of the history reads as before")
})
