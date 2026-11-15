// CEL-6: agent cursors. When an agent session changes the board, a cursor in that session's colour,
// named after the agent and session, flies to the card and performs the change; the board's state is
// right underneath the whole time. Agents here are the real CLI run as a Claude Code session, and RPC
// clients sending the CLI's identity headers (for edits the CLI has no command for, and for bursts).
//
// A recorder in the page notes everything the animation layer draws (cursors, carried copies, holes,
// bubbles, titles typing out), so the tests check what appeared without racing the animation.
import type { Page } from "@playwright/test"
import { openClient, type PromiseClient } from "../packages/client/test/support/promiseClient.ts"
import { caption, card, column, defaultWorkspace, expect, newCommandId, seedProject, test, uniqueKey } from "./fixtures.ts"
import { celloAs } from "./packets.ts"

interface Seen {
  /** Every cursor label seen, and the most cursors on screen at once. */
  labels: string[]
  colors: string[]
  maxCursors: number
  /** Task keys of the cards seen being carried (a copy flying over the board). */
  carried: string[]
  /** Task keys of cards seen waiting for a step (hidden at their new slot). */
  waiting: string[]
  holes: number
  bubbles: string[]
  /** Titles seen typing out. */
  typed: string[]
}

declare global {
  interface Window {
    __seen?: Seen
  }
}

/** Starts noting what the animation layer draws. */
const record = (page: Page) =>
  page.evaluate(() => {
    const seen: Seen = { labels: [], colors: [], maxCursors: 0, carried: [], waiting: [], holes: 0, bubbles: [], typed: [] }
    window.__seen = seen
    const add = (list: string[], value: string | null | undefined) => {
      if (value && !list.includes(value)) list.push(value)
    }
    const look = () => {
      const cursors = document.querySelectorAll<HTMLElement>("[data-agent-cursor]")
      seen.maxCursors = Math.max(seen.maxCursors, cursors.length)
      for (const c of cursors) {
        add(seen.labels, c.textContent)
        add(seen.colors, c.style.getPropertyValue("--agent"))
      }
      for (const g of document.querySelectorAll<HTMLElement>("[data-agent-ghost]")) {
        const key = document.querySelector(`[data-card-id="${g.dataset.agentGhost}"]`)?.getAttribute("data-task-key")
        add(seen.carried, key)
      }
      for (const w of document.querySelectorAll('[data-agent-pending="queued"]')) add(seen.waiting, w.getAttribute("data-task-key"))
      seen.holes = Math.max(seen.holes, document.querySelectorAll("[data-agent-hole]").length)
      for (const b of document.querySelectorAll("[data-agent-bubble]")) add(seen.bubbles, b.textContent)
      for (const t of document.querySelectorAll<HTMLElement>("[data-card-title]")) if (t.style.clipPath) add(seen.typed, t.textContent)
    }
    new MutationObserver(look).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "data-agent-pending"] })
  })

const seen = (page: Page) => page.evaluate(() => window.__seen!)

/** Waits until the recorder has noted something. */
const until = (page: Page, check: (s: Seen) => boolean) =>
  page.waitForFunction(`(${check.toString()})(window.__seen)`)

/** The board is still: no cursor, copy, hole or bubble, no running animation and no frame loop. */
async function expectIdle(page: Page) {
  await expect(page.locator("[data-agent-cursor]")).toHaveCount(0)
  await expect(page.locator("[data-agent-ghost], [data-agent-hole], [data-agent-bubble], [data-agent-pending]")).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0)
  // Nothing asks for animation frames: counted over ten frames of the test's own.
  const calls = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const original = window.requestAnimationFrame.bind(window)
        let calls = 0
        let frames = 0
        window.requestAnimationFrame = (cb) => {
          calls++
          return original(cb)
        }
        const tick = () => {
          if (++frames < 10) return void original(tick)
          window.requestAnimationFrame = original
          resolve(calls)
        }
        original(tick)
      }),
  )
  expect(calls).toBe(0)
}

/** An agent session talking RPC with the CLI's identity headers. */
const agentClient = (baseURL: string, session: string) =>
  openClient(`${baseURL.replace(/^http/, "ws")}/rpc`, { "x-cello-session": session, "x-cello-client": "Claude Code" })

/** A project with tasks in Todo, made by Lucas (no cursor), and its board open. */
async function boardWith(page: Page, cello: PromiseClient, prefix: string, titles: ReadonlyArray<string>) {
  const key = uniqueKey(prefix)
  const project = await seedProject(cello, "Agent cursors", key)
  const { statuses } = await defaultWorkspace(cello)
  for (const title of titles) {
    await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title, statusId: statuses.Todo!.id }))
  }
  await page.goto(`/${key}/issues`)
  await expect(column(page, "Todo").locator("[data-task-key]")).toHaveCount(titles.length)
  await record(page)
  return { key, project, statuses }
}

const SESSION = "4f1c2a9e-0b7d-4e21-9c3a-5d8e7f6a1b2c"
const SESSION_B = "b7e3d915-2c4a-4f68-8d01-9e6c3b5a7f40"

test("CEL-6: an agent moves, creates, comments, claims and renames cards while the board is open: its cursor does each on screen and the board ends right", async ({ page, cello, baseURL }) => {
  const { key } = await boardWith(page, cello, "CUR", ["Wire the event stream", "Draft the cursor label", "Polish the landing"])
  const agent = celloAs(SESSION)

  await caption(page, `The agent runs \`cello task move ${key}-1 "In Progress"\`: its cursor picks the card up and carries it`)
  agent("task", "move", `${key}-1`, "In Progress")
  await until(page, (s) => s.carried.length > 0)
  await expect(column(page, "In Progress").locator(`[data-task-key="${key}-1"]`)).toBeVisible()
  await expect(column(page, "Todo").locator(`[data-task-key="${key}-1"]`)).toHaveCount(0)
  expect((await seen(page)).carried).toContain(`${key}-1`)
  expect((await seen(page)).holes).toBeGreaterThan(0)
  // The cursor names the agent and its session (the first 8 characters of CLAUDE_CODE_SESSION_ID).
  await until(page, (s) => s.labels.some((l) => l.includes("·")))
  expect((await seen(page)).labels).toContain("Claude Code · 4f1c2a9e")

  await caption(page, "`cello task create`: the cursor goes to the column's +, and the new card grows in as its title types out")
  agent("task", "create", "Cursor demo: a card made by the agent", "--project", key)
  await expect(column(page, "Todo").locator(`[data-task-key="${key}-4"]`)).toBeVisible()
  await until(page, (s) => s.typed.includes("Cursor demo: a card made by the agent"))
  expect((await seen(page)).waiting).toContain(`${key}-4`)

  await caption(page, "`cello task comment`: a speech bubble pops from the card")
  agent("task", "comment", `${key}-4`, "Picked this up: starting with the queue")
  await until(page, (s) => s.bubbles.includes("Picked this up: starting with the queue"))

  await caption(page, "`cello task claim`: the claim moves the card to In Progress, with a Claimed bubble")
  agent("task", "claim", `${key}-2`)
  await expect(column(page, "In Progress").locator(`[data-task-key="${key}-2"]`)).toBeVisible()
  await until(page, (s) => s.bubbles.includes("Claimed"))
  expect((await seen(page)).carried).toContain(`${key}-2`)

  await caption(page, "A rename from the agent: the new title types out on the card")
  const rpc = await agentClient(baseURL!, SESSION)
  const detail = await rpc.run((c) => c["task.get"]({ key: `${key}-3` }))
  await rpc.run((c) => c["task.update"]({ commandId: newCommandId(), id: detail.task.id, expectedVersion: detail.task.version, title: "Polish the landing page" }))
  await until(page, (s) => s.typed.includes("Polish the landing page"))
  await rpc.close()

  await caption(page, "The cursor fades after a moment of quiet; the board is right and nothing keeps animating")
  await expectIdle(page)
  await expect(column(page, "In Progress").locator("[data-task-key]")).toHaveText([/Wire the event stream/, /Draft the cursor label/])
  await expect(column(page, "Todo").locator("[data-card-title]")).toHaveText(["Polish the landing page", "Cursor demo: a card made by the agent"])
  await page.reload()
  await expect(column(page, "In Progress").locator("[data-task-key]")).toHaveCount(2)
  await expect(column(page, "Todo").locator("[data-task-key]")).toHaveCount(2)
})

test("CEL-6: two agents at once: each has its own cursor, name and colour, both play at the same time, and the board ends right", async ({ page, cello, baseURL }) => {
  const { key, statuses } = await boardWith(page, cello, "TWO", ["Alpha one", "Alpha two", "Bravo one", "Bravo two"])
  const a = await agentClient(baseURL!, SESSION)
  const b = await agentClient(baseURL!, SESSION_B)
  const idOf = async (n: number) => (await cello.run((c) => c["task.get"]({ key: `${key}-${n}` }))).task.id
  const ids = await Promise.all([1, 2, 3, 4].map(idOf))
  const move = (client: PromiseClient, id: string, status: string) =>
    client.run((c) => c["task.move"]({ commandId: newCommandId(), id, statusId: statuses[status]!.id }))

  await caption(page, "Two agent sessions move cards at the same moment: two cursors, two colours")
  await Promise.all([move(a, ids[0]!, "In Progress"), move(b, ids[2]!, "Done")])
  await until(page, (s) => s.maxCursors >= 2)
  await caption(page, "Each session's next move plays in its own lane, in order")
  await Promise.all([move(a, ids[1]!, "In Progress"), move(b, ids[3]!, "Done")])
  await until(page, (s) => s.carried.length >= 4)

  await expectIdle(page)
  const s = await seen(page)
  expect(s.maxCursors).toBe(2)
  expect(new Set(s.colors).size).toBe(2)
  expect(s.labels).toEqual(expect.arrayContaining(["Claude Code · 4f1c2a9e", "Claude Code · b7e3d915"]))
  await expect(column(page, "In Progress").locator("[data-card-title]")).toHaveText(["Alpha one", "Alpha two"])
  await expect(column(page, "Done").locator("[data-card-title]")).toHaveText(["Bravo one", "Bravo two"])
  await a.close()
  await b.close()
})

test("CEL-6: Lucas drags a card while an agent moves another: nothing shifts under his hand, and when the agent moves the card he holds, his drop wins", async ({ page, cello, baseURL }) => {
  const { key, statuses } = await boardWith(page, cello, "HAND", ["Lucas holds this", "The agent moves this", "Filler"])
  const agent = await agentClient(baseURL!, SESSION)
  const idOf = async (n: number) => (await cello.run((c) => c["task.get"]({ key: `${key}-${n}` }))).task.id
  const [held, other] = [await idOf(1), await idOf(2)]

  await caption(page, `Lucas picks up ${key}-1 and starts dragging it`)
  const from = (await card(page, `${key}-1`).boundingBox())!
  const target = (await column(page, "In Review").locator('[role="list"]').boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + 200, from.y + 40, { steps: 12 })
  await expect(page.locator("[data-dragging]")).toHaveCount(1)

  await caption(page, `Meanwhile the agent moves ${key}-2 to Done: it only gets a highlight, no flight, no hole`)
  await agent.run((c) => c["task.move"]({ commandId: newCommandId(), id: other, statusId: statuses.Done!.id }))
  await expect(column(page, "Done").locator(`[data-task-key="${key}-2"]`)).toBeVisible()
  await until(page, (s) => s.maxCursors >= 1)
  expect((await seen(page)).carried).toEqual([])
  expect((await seen(page)).holes).toBe(0)
  await expect(page.locator("[data-dragging]")).toHaveCount(1)

  await caption(page, `The agent moves the card Lucas is holding to Done; Lucas drops it on In Review`)
  await agent.run((c) => c["task.move"]({ commandId: newCommandId(), id: held, statusId: statuses.Done!.id }))
  await page.mouse.move(target.x + target.width / 2, target.y + 30, { steps: 20 })
  await page.mouse.up()

  await caption(page, "His drop wins: the card is in In Review, and stays there after a reload")
  await expect(column(page, "In Review").locator(`[data-task-key="${key}-1"]`)).toBeVisible()
  await expectIdle(page)
  await expect(column(page, "In Review").locator(`[data-task-key="${key}-1"]`)).toBeVisible()
  await page.reload()
  await expect(column(page, "In Review").locator(`[data-task-key="${key}-1"]`)).toBeVisible()
  await expect(column(page, "Done").locator(`[data-task-key="${key}-2"]`)).toBeVisible()
  await agent.close()
})

test("CEL-6: a burst of agent changes catches up: it speeds up, then skips to the end with 'made N changes', and the board is right", async ({ page, cello, baseURL }) => {
  const titles = Array.from({ length: 12 }, (_, i) => `Burst ${i + 1}`)
  const { key, statuses } = await boardWith(page, cello, "BURST", titles)
  const agent = await agentClient(baseURL!, SESSION)
  const ids = await Promise.all(titles.map(async (_, i) => (await cello.run((c) => c["task.get"]({ key: `${key}-${i + 1}` }))).task.id))

  await caption(page, "The agent moves 12 cards in a burst")
  for (const id of ids) await agent.run((c) => c["task.move"]({ commandId: newCommandId(), id, statusId: statuses.Done!.id }))
  await expect(page.getByText(/Claude Code made \d+ changes/)).toBeVisible()
  await expect(column(page, "Done").locator("[data-task-key]")).toHaveCount(12)
  await expect(column(page, "Done").locator("[data-task-key]:visible")).toHaveCount(12)
  await expectIdle(page)
  await agent.close()
})

test("CEL-6: with reduced motion nothing flies, only a highlight; Display → Show agent cursors off shows no cursor at all, and stays off after a reload", async ({ page, cello, baseURL }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  const { key, statuses } = await boardWith(page, cello, "CALM", ["Reduced motion", "Cursors off"])
  const agent = await agentClient(baseURL!, SESSION)
  const idOf = async (n: number) => (await cello.run((c) => c["task.get"]({ key: `${key}-${n}` }))).task.id

  await caption(page, "Reduced motion: the agent's move shows the cursor at the card and a ring, nothing flies")
  const first = await idOf(1)
  await agent.run((c) => c["task.move"]({ commandId: newCommandId(), id: first, statusId: statuses.Done!.id }))
  await expect(column(page, "Done").locator(`[data-task-key="${key}-1"]`)).toBeVisible()
  await until(page, (s) => s.maxCursors >= 1)
  await expectIdle(page)
  expect((await seen(page)).carried).toEqual([])
  expect((await seen(page)).holes).toBe(0)

  await caption(page, "Display → Show agent cursors, off")
  await page.getByRole("button", { name: "Display" }).click()
  const toggle = page.getByRole("switch", { name: "Show agent cursors" })
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await page.keyboard.press("Escape")
  await page.reload()
  await expect(column(page, "Todo").locator("[data-task-key]")).toHaveCount(1)
  await record(page)

  await caption(page, "The agent moves a card: it just moves, no cursor")
  const second = await idOf(2)
  await agent.run((c) => c["task.move"]({ commandId: newCommandId(), id: second, statusId: statuses.Done!.id }))
  await expect(column(page, "Done").locator(`[data-task-key="${key}-2"]`)).toBeVisible()
  await expectIdle(page)
  expect((await seen(page)).maxCursors).toBe(0)

  await page.getByRole("button", { name: "Display" }).click()
  await page.getByRole("switch", { name: "Show agent cursors" }).click()
  await expect(page.getByRole("switch", { name: "Show agent cursors" })).toBeChecked()
  await agent.close()
})
