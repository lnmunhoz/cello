// CEL-6: agent cursors. When an agent session changes the board, a cursor in that session's colour,
// named after the agent and session, flies to the card and performs the change; the board's state is
// right underneath the whole time. Agents here are the real CLI run as a Claude Code session, and RPC
// clients sending the CLI's identity headers (for edits the CLI has no command for, and for bursts).
//
// A recorder in the page notes everything the animation layer draws (cursors, carried copies, holes,
// bubbles, titles typing out), so the tests check what appeared without racing the animation.
import * as path from "node:path"
import type { Page } from "@playwright/test"
import { openClient, type PromiseClient } from "../packages/client/test/support/promiseClient.ts"
import { caption, card, column, defaultWorkspace, expect, newCommandId, seedProject, test, uniqueKey } from "./fixtures.ts"
import { celloAs, SHOTS } from "./packets.ts"

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
  /**
   * While a card is carried: how far the cursor's tip (the teardrop's sharp corner) was from the spot
   * it holds the card by, at most, and how many times that was measured.
   */
  tipOff: number
  tipChecks: number
}

declare global {
  interface Window {
    __seen?: Seen
  }
}

/** Starts noting what the animation layer draws. */
const record = (page: Page) =>
  page.evaluate(() => {
    const seen: Seen = { labels: [], colors: [], maxCursors: 0, carried: [], waiting: [], holes: 0, bubbles: [], typed: [], tipOff: 0, tipChecks: 0 }
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
      // With one cursor carrying one card, its tip is on the spot it holds the card by: 30% across and
      // 55% down the card. The copy turns and grows about its centre, so that spot is measured from there.
      const ghosts = document.querySelectorAll<HTMLElement>("[data-agent-ghost]")
      const body = document.querySelector<SVGPathElement>("[data-agent-cursor] [data-agent-mark] path")
      const eyes = document.querySelector("[data-agent-cursor] [data-agent-mark] [data-agent-eyes]")
      if (ghosts.length === 1 && cursors.length === 1 && body && eyes) {
        const g = ghosts[0]!
        const r = g.getBoundingClientRect()
        const w = parseFloat(g.style.width)
        const h = parseFloat(g.style.height)
        const start = body.getPointAtLength(0)
        const tip = new DOMPoint(start.x, start.y).matrixTransform(body.getScreenCTM()!)
        const hold = { x: r.left + r.width / 2 - 0.2 * w, y: r.top + r.height / 2 + 0.05 * h }
        seen.tipOff = Math.max(seen.tipOff, Math.hypot(tip.x - hold.x, tip.y - hold.y))
        seen.tipChecks++
      }
      for (const w of document.querySelectorAll<HTMLElement>("[data-task-key]")) if (getComputedStyle(w).display === "none") add(seen.waiting, w.dataset.taskKey)
      seen.holes = Math.max(seen.holes, document.querySelectorAll("[data-agent-hole]").length)
      for (const b of document.querySelectorAll("[data-agent-bubble]")) add(seen.bubbles, b.textContent)
      for (const t of document.querySelectorAll<HTMLElement>("[data-card-title]")) if (t.style.clipPath) add(seen.typed, t.textContent)
    }
    // The whole document: the animator's style rules (which cards wait) live in <head>.
    new MutationObserver(look).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["style"] })
  })

const seen = (page: Page) => page.evaluate(() => window.__seen!)

/** Waits until the recorder has noted something. */
const until = (page: Page, check: (s: Seen) => boolean) =>
  page.waitForFunction(`(${check.toString()})(window.__seen)`)

/** The board is still: no cursor, copy, hole or bubble, no running animation and no frame loop. */
async function expectIdle(page: Page) {
  await expect(page.locator("[data-agent-cursor]")).toHaveCount(0)
  await expect(page.locator("[data-agent-ghost], [data-agent-hole], [data-agent-bubble]")).toHaveCount(0)
  // No card waits for a step: the animator's style rules are empty.
  expect(await page.evaluate(() => document.getElementById("agent-cursor-styles")?.textContent ?? "")).toBe("")
  // Whatever is still animating (a card settling, a notice fading) ends; then nothing is left.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))))
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0)
  // Nothing asks for animation frames, Motion's frame loop included: the spy was in place before the
  // app loaded, so every requestAnimationFrame the app or Motion makes is counted. Cards may still be
  // settling into a closed slot (a Motion spring); wait for ten frames in a row with no request, so a
  // loop that never stops fails the test by its timeout.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const spy = (window as unknown as { __raf: { raw: typeof requestAnimationFrame; calls: number } }).__raf
        let last = spy.calls
        let quiet = 0
        const tick = () => {
          quiet = spy.calls === last ? quiet + 1 : 0
          last = spy.calls
          if (quiet >= 10) resolve()
          else spy.raw(tick)
        }
        spy.raw(tick)
      }),
  )
  expect(await framesAskedOver10(page)).toBe(0)
}

/** Counts `requestAnimationFrame` calls from the page before any of its scripts run (Motion keeps its own reference). */
const rafSpy = () => {
  const raw = window.requestAnimationFrame.bind(window)
  const spy = { raw, calls: 0 }
  ;(window as unknown as { __raf: typeof spy }).__raf = spy
  window.requestAnimationFrame = (cb) => {
    spy.calls++
    return raw(cb)
  }
}

/** How many frames the page asked for over the next ten frames (counted with the unpatched function). */
const framesAskedOver10 = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const spy = (window as unknown as { __raf: { raw: typeof requestAnimationFrame; calls: number } }).__raf
        const before = spy.calls
        let frames = 0
        const tick = () => (++frames < 10 ? void spy.raw(tick) : resolve(spy.calls - before))
        spy.raw(tick)
      }),
  )

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
  await page.addInitScript(rafSpy)
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
  // The idle check's spy isn't blind: while the card flies, it counts Motion's frames.
  expect(await framesAskedOver10(page)).toBeGreaterThan(0)
  await expect(column(page, "In Progress").locator(`[data-task-key="${key}-1"]`)).toBeVisible()
  await expect(column(page, "Todo").locator(`[data-task-key="${key}-1"]`)).toHaveCount(0)
  expect((await seen(page)).carried).toContain(`${key}-1`)
  expect((await seen(page)).holes).toBeGreaterThan(0)
  // The cursor is the teardrop agent, and its tip holds the card through the lift, the carry and the landing.
  expect((await seen(page)).tipChecks).toBeGreaterThan(0)
  expect((await seen(page)).tipOff).toBeLessThan(1.5)
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
  // Both carry their card at once: a still of it, in light, then the next pair in dark.
  await expect(page.locator("[data-agent-ghost]")).toHaveCount(2)
  await page.screenshot({ path: path.join(SHOTS, "cel-6-two-agents-light.png") })
  await caption(page, "In dark: each session's next move plays in its own lane, in order")
  await page.evaluate(() => document.documentElement.classList.add("dark"))
  await Promise.all([move(a, ids[1]!, "In Progress"), move(b, ids[3]!, "Done")])
  await expect(page.locator("[data-agent-ghost]")).toHaveCount(2)
  await page.screenshot({ path: path.join(SHOTS, "cel-6-two-agents-dark.png") })
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

  await caption(page, `The agent moves ${key}-1, the card Lucas is holding, to Done: its cursor marks the card, which stays in his hand`)
  await agent.run((c) => c["task.move"]({ commandId: newCommandId(), id: held, statusId: statuses.Done!.id }))
  // The cursor element is only its point (no size); the teardrop drawn on it is what shows.
  await expect(page.locator("[data-agent-cursor] [data-agent-mark]")).toBeVisible()
  await expect(page.locator("[data-dragging]")).toHaveCount(1)
  // The next caption first holds this moment in a review video.
  await caption(page, "Lucas drops it on In Review")
  // Measured now: an agent's flight can scroll the board to show its column (Done sits past the window
  // since Needs input joined the board, CEL-47).
  const target = (await column(page, "In Review").locator('[role="list"]').boundingBox())!
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

test("CEL-6: Lucas picks up a card while an agent's moves are still flying out of its column: the card and those below it stay put until he lets go", async ({ page, cello, baseURL }) => {
  const { key, statuses } = await boardWith(page, cello, "PICK", ["Agent takes 1", "Agent takes 2", "Agent takes 3", "Lucas picks this up", "Below it"])
  const agent = await agentClient(baseURL!, SESSION)
  const ids = await Promise.all([1, 2, 3].map(async (n) => (await cello.run((c) => c["task.get"]({ key: `${key}-${n}` }))).task.id))

  await caption(page, `The agent moves the top three cards to Done; while the first flies, Lucas picks up ${key}-4 below them (Space)`)
  for (const id of ids) await agent.run((c) => c["task.move"]({ commandId: newCommandId(), id, statusId: statuses.Done!.id }))
  await until(page, (s) => s.carried.length > 0)
  // Where the cards sit in the column's layout (not where an animation draws them) just before and
  // just after the pickup, measured in the page in one go so the agent's own steps can't land between.
  const pickup = await page.evaluate(async ([picked, under]) => {
    const el = document.querySelector<HTMLElement>(`[data-task-key="${picked}"]`)!
    const below = document.querySelector<HTMLElement>(`[data-task-key="${under}"]`)!
    const before = { top: el.offsetTop, below: below.offsetTop, holes: document.querySelectorAll("[data-agent-hole]").length }
    el.focus()
    el.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true }))
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const after = { top: el.offsetTop, below: below.offsetTop, holes: document.querySelectorAll("[data-agent-hole]").length }
    return { before, after, moving: el.hasAttribute("data-moving") }
  }, [`${key}-4`, `${key}-5`] as const)
  expect(pickup.moving).toBe(true)
  expect(pickup.before.holes).toBeGreaterThan(0)
  expect(pickup.after).toEqual(pickup.before)

  await caption(page, "While he holds it, the agent's moves wait: their copies keep their places, nothing in the column moves")
  // The agent's lane gives up the steps it held, goes quiet and its cursor fades; the column stays as it was.
  await expect(page.locator("[data-agent-cursor]")).toHaveCount(0)
  const during = await page.evaluate(([picked, under]) => ({
    top: document.querySelector<HTMLElement>(`[data-task-key="${picked}"]`)!.offsetTop,
    below: document.querySelector<HTMLElement>(`[data-task-key="${under}"]`)!.offsetTop,
    holes: document.querySelectorAll("[data-agent-hole]").length,
  }), [`${key}-4`, `${key}-5`] as const)
  expect(during).toEqual(pickup.before)
  await expect(page.locator("[data-moving]")).toHaveCount(1)

  await caption(page, "He puts it back (Esc); then the agent's moves land")
  await page.keyboard.press("Escape")
  await expect(page.locator("[data-moving]")).toHaveCount(0)
  await expectIdle(page)
  await expect(column(page, "Done").locator("[data-card-title]")).toHaveText(["Agent takes 1", "Agent takes 2", "Agent takes 3"])
  await expect(column(page, "Todo").locator("[data-card-title]")).toHaveText(["Lucas picks this up", "Below it"])
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

// Close-ups of the cursor for the review packet, at 1× and 2×, in light and dark: the teardrop agent in
// the session's colour, over a card, with its pill. The page runs on Playwright's clock, so the still
// is taken with the cursor held in place (the clock paused mid-comment) instead of racing it.
for (const scale of [1, 2]) {
  test.describe(`at ${scale}×`, () => {
    test.use({ deviceScaleFactor: scale })

    test(`CEL-6: the cursor is Cello's teardrop agent, legible over a card in light and dark (close-ups at ${scale}×)`, async ({ page, cello, baseURL }) => {
      await page.clock.install()
      const { key } = await boardWith(page, cello, `MARK${scale}`, ["Wire the event stream", "Draft the cursor label", "Polish the landing"])
      const agent = await agentClient(baseURL!, SESSION)
      const idOf = async (n: number) => (await cello.run((c) => c["task.get"]({ key: `${key}-${n}` }))).task.id

      for (const theme of ["light", "dark"] as const) {
        await caption(page, `${theme === "light" ? "Light" : "Dark"}: the agent comments on a card; its cursor sits on the card while the bubble shows`)
        if (theme === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"))
        const id = await idOf(theme === "light" ? 1 : 2)
        await agent.run((c) => c["comment.add"]({ commandId: newCommandId(), taskId: id, body: "Picked this up: starting with the queue" }))
        await expect(page.locator("[data-agent-bubble]")).toHaveCount(1)
        await page.clock.pauseAt(Date.now() + 300)
        const mark = (await page.locator("[data-agent-cursor] [data-agent-mark]").boundingBox())!
        const clip = { x: Math.max(0, mark.x - 72), y: Math.max(0, mark.y - 36), width: 340, height: 104 }
        await page.screenshot({ path: path.join(SHOTS, `cel-6-cursor-closeup-${theme}@${scale}x.png`), clip })
        // The mark is drawn at its size, with the label beside it.
        expect(Math.round(mark.width)).toBeGreaterThanOrEqual(22)
        expect(Math.round(mark.width)).toBeLessThanOrEqual(28)
        await expect(page.locator("[data-agent-cursor] span")).toBeVisible()
        await page.clock.resume()
        await expect(page.locator("[data-agent-cursor]")).toHaveCount(0)
      }
      await agent.close()
    })
  })
}
