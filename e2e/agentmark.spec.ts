// CEL-69: the agent mark on cards. Cello's teardrop agent stands in for the presence dot and says what
// its agent is doing: working (the tip spins), thinking (leans back, eyes up), a hop when the task
// starts waiting in Needs input, a jump for joy when it reaches In Review or Done. Nothing plays as the
// board first draws, and reduced motion stills it all. Agents act through RPC as the CLI would; agent
// cursors are off, so cards change in place, and Needs input is its own column. The board is shown at
// 175% browser zoom with the sidebar hidden, so the 15 px mark reads in the video; the stills come
// from a 3x page at 100%.
import * as path from "node:path"
import type { Browser, Locator, Page } from "@playwright/test"
import { newCommandId } from "../packages/client/test/support/promiseClient.ts"
import { agentAs, caption, card, column, defaultWorkspace, expect, seedProject, test, uniqueKey } from "./fixtures.ts"
import { SHOTS } from "./packets.ts"

/** The animations playing in a mark (its layers included), by name, with how often each repeats. */
const playing = (mark: Locator) =>
  mark.evaluate((el) =>
    el
      .getAnimations({ subtree: true })
      .filter((a) => a.playState === "running")
      .map((a) => ({ name: (a as CSSAnimation).animationName, iterations: a.effect?.getTiming().iterations })),
  )

/** Resolves when the mark's one-off entry has played: its animations' own `finished` promises. */
const entryPlayed = (mark: Locator) =>
  mark.evaluate((el) =>
    Promise.all(
      el
        .getAnimations({ subtree: true })
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished),
    ).then(() => undefined),
  )

/** Holds every animation in a mark `ms` into it, for a still; `resume` lets them go on. */
const freezeAt = (mark: Locator, ms: number) =>
  mark.evaluate((el, t) => {
    for (const a of el.getAnimations({ subtree: true })) {
      a.pause()
      a.currentTime = t
    }
  }, ms)
const resume = (mark: Locator) => mark.evaluate((el) => el.getAnimations({ subtree: true }).forEach((a) => a.play()))

/** The card's agent mark. */
const markOf = (page: Page, key: string) => card(page, key).locator(".agent-mark")

/** Light and dark stills of a card, from the 3x page. */
async function stills(lens: Page, key: string, name: string) {
  for (const theme of ["light", "dark"] as const) {
    await lens.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await card(lens, key).screenshot({ path: path.join(SHOTS, `cel-69-${name}-${theme}.png`) })
  }
  await lens.evaluate(() => document.documentElement.classList.remove("dark"))
}

/** A second page at 3x, 100% zoom, showing the same board, for crisp stills. It records no video. */
async function openLens(browser: Browser, baseURL: string, key: string) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3 })
  await context.addInitScript(() => localStorage.setItem("cello:agent-cursors", "off"))
  const lens = await context.newPage()
  await lens.goto(`/${key}/issues`)
  return { lens, close: () => context.close() }
}

/** Scrolls the board sideways so `name` is its first column on screen. */
const showFrom = (page: Page, name: string) =>
  column(page, name).evaluate((el) => {
    const board = el.closest("[data-agent-board]")!
    board.scrollLeft = (el as HTMLElement).offsetLeft - (board as HTMLElement).offsetLeft - 12
  })

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem("cello:agent-cursors", "off")
    localStorage.setItem("cello:sidebar", JSON.stringify({ mode: "hidden", collapsed: "hidden" }))
    // Display → Needs input column: the waiting card hops at the top of its own column, in the video.
    localStorage.setItem("cello:needs-input-column", "on")
    // 175% browser zoom, like ⌘+ three times: the mark is 26 px on screen in the video. Once the
    // document has its root element: init scripts run before it exists.
    addEventListener("DOMContentLoaded", () => (document.documentElement.style.zoom = "1.75"))
  })
})

test("CEL-69: each card's agent shows what its agent is doing: working, thinking, a hop for Needs input, a jump for Done; nothing plays on load or with reduced motion", async ({ page, browser, cello, baseURL }) => {
  test.setTimeout(Math.max(test.info().timeout, 90_000))
  const key = uniqueKey("MARK")
  const project = await seedProject(cello, "Agent states", key)
  const { statuses } = await defaultWorkspace(cello)
  const titles = ["Build the spinner", "Plan the states", "Pick the colours", "Ship the mark"]
  for (const title of titles) {
    await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title, statusId: statuses.Todo!.id }))
  }
  const [building, planning, asking, shipping] = titles.map((_, i) => `${key}-${i + 1}`) as [string, string, string, string]
  const agent = await agentAs(baseURL!, "7c3e9a51-agent-mark", process.pid)
  for (const [taskKey, stage] of [[building, "building"], [planning, null], [asking, "fixing"], [shipping, "merged"]] as const) {
    await agent.run((c) => c["task.claim"]({ commandId: newCommandId(), key: taskKey }))
    if (stage) await agent.run((c) => c["task.stage"]({ commandId: newCommandId(), key: taskKey, stage }))
  }
  await page.goto(`/${key}/issues`)
  await expect(column(page, "In Progress").locator("[data-task-key]")).toHaveCount(4)
  await showFrom(page, "In Progress")

  await caption(page, "Session 7c3e9a51 holds four tasks. Building: its agent spins its tip. No stage yet: it leans back, thinking")
  await expect(markOf(page, building)).toHaveAttribute("data-agent-mood", "working")
  await expect(markOf(page, planning)).toHaveAttribute("data-agent-mood", "thinking")
  await expect(markOf(page, building)).toHaveAttribute("data-presence", "active")
  expect(await playing(markOf(page, building))).toEqual(
    expect.arrayContaining([{ name: "agent-spin", iterations: Infinity }, { name: "agent-follow", iterations: Infinity }]),
  )
  expect((await playing(markOf(page, planning))).map((a) => a.name)).toEqual(expect.arrayContaining(["agent-think-tilt", "agent-think-face"]))

  await caption(page, "Fixing findings works too; Merged has happy eyes and keeps still")
  await expect(markOf(page, asking)).toHaveAttribute("data-agent-mood", "working")
  await expect(markOf(page, shipping)).toHaveAttribute("data-agent-mood", "merged")
  expect(await playing(markOf(page, shipping))).toEqual([])

  // Stills: each state at real size (the column, light and dark), and close up from a 3x page.
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await page.evaluate(() => (document.documentElement.style.zoom = "1"))
    await column(page, "In Progress").screenshot({ path: path.join(SHOTS, `cel-69-column-${theme}.png`) })
  }
  await page.evaluate(() => {
    document.documentElement.classList.remove("dark")
    document.documentElement.style.zoom = "1.75"
  })
  await showFrom(page, "In Progress")
  const { lens, close } = await openLens(browser, baseURL!, key)
  await expect(markOf(lens, building)).toHaveAttribute("data-agent-mood", "working")
  // A quarter turn in: the tip points up and right, the eyes follow it.
  await freezeAt(markOf(lens, building), 350)
  await stills(lens, building, "working")
  await freezeAt(markOf(lens, planning), 1100)
  await stills(lens, planning, "thinking")
  await stills(lens, shipping, "merged")

  await caption(page, "The agent asks Lucas about Pick the colours: Needs input. Its agent looks up with big eyes, hops twice and a ring goes out, once")
  await agent.run((c) =>
    c["ask.create"]({ commandId: newCommandId(), key: asking, title: "Which colours?", questions: [{ prompt: "Session colour for the body?" }], files: [], links: [] }),
  )
  const waiting = markOf(page, asking)
  await expect(waiting).toHaveAttribute("data-agent-mood", "waiting")
  await expect(waiting).toHaveAttribute("data-play", "")
  expect((await playing(waiting)).every((a) => a.iterations === 1)).toBe(true)
  await expect(markOf(lens, asking)).toHaveAttribute("data-play", "")
  // At the top of the first hop, the ring on its way out.
  await freezeAt(markOf(lens, asking), 230)
  await stills(lens, asking, "needs-input-hop")
  await resume(markOf(lens, asking))
  await entryPlayed(waiting)
  expect(await playing(waiting)).toEqual([])
  await entryPlayed(markOf(lens, asking))
  await stills(lens, asking, "needs-input")

  await caption(page, "Then it rests, big eyes up: a card waiting on Lucas runs no animation")
  await expect(waiting).toHaveAttribute("data-agent-mood", "waiting")
  await expect(column(page, "Needs input").locator(`[data-task-key="${asking}"]`)).toBeVisible()
  await showFrom(page, "Needs input")

  await caption(page, "Session 7c3e9a51 submits Ship the mark: In Review. Its agent squashes flat, leaps with happy eyes, lands wobbling, blinks")
  await agent.run((c) =>
    c["review.submit"]({
      commandId: newCommandId(), key: shipping, summary: "The agent mark on cards.", steps: ["Open the board"], files: [],
      links: [{ url: "https://example.com/cel-69", caption: "The PR" }],
    }),
  )
  const done = column(page, "In Review").locator(`[data-task-key="${shipping}"] .agent-mark`)
  await expect(done).toHaveAttribute("data-agent-mood", "done")
  await expect(done).toHaveAttribute("data-play", "")
  expect((await playing(done)).map((a) => a.name)).toEqual(expect.arrayContaining(["agent-done-squash", "agent-done-rig", "agent-done-eyes", "agent-done-happy"]))
  await expect(markOf(lens, shipping)).toHaveAttribute("data-play", "")
  // The pancake, then airborne with happy eyes, then the landing wobble.
  for (const [ms, name] of [[380, "done-squash"], [760, "done-leap"], [1250, "done-wobble"]] as const) {
    await freezeAt(markOf(lens, shipping), ms)
    await stills(lens, shipping, name)
  }
  await resume(markOf(lens, shipping))
  await entryPlayed(done)
  expect(await playing(done)).toEqual([])
  await entryPlayed(markOf(lens, shipping))
  await stills(lens, shipping, "done")
  // The list draws the same mark in each row.
  await lens.goto(`/${key}/issues?layout=list`)
  const rows = lens.locator('[data-layout="list"]')
  await expect(rows.locator(`[data-task-key="${building}"] .agent-mark`)).toHaveAttribute("data-agent-mood", "working")
  await expect(rows.locator(`[data-task-key="${asking}"] .agent-mark`)).toHaveAttribute("data-agent-mood", "waiting")
  await expect(rows.locator(`[data-task-key="${shipping}"] .agent-mark`)).toHaveAttribute("data-agent-mood", "done")
  for (const theme of ["light", "dark"] as const) {
    await lens.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await lens.screenshot({ path: path.join(SHOTS, `cel-69-list-${theme}.png`), clip: { x: 240, y: 0, width: 1200, height: 360 } })
  }
  await close()

  await caption(page, "Lucas approves it: the claim ends, so its agent jumps once more as the card lands in Done, then leaves the card")
  await showFrom(page, "In Review")
  await cello.run((c) => c["review.approve"]({ commandId: newCommandId(), key: shipping }))
  const leaving = column(page, "Done").locator(`[data-task-key="${shipping}"] .agent-mark`)
  await expect(leaving).toHaveAttribute("data-leaving", "")
  await expect(leaving).toHaveAttribute("data-play", "")
  await entryPlayed(leaving)
  await expect(column(page, "Done").locator(`[data-task-key="${shipping}"] [data-card-work]`)).toHaveCount(0)

  await caption(page, "Reload: nothing plays as the board draws. Needs input rests with big eyes; only the agents at work move")
  await page.reload()
  await showFrom(page, "In Progress")
  await expect(markOf(page, asking)).toHaveAttribute("data-agent-mood", "waiting")
  await expect(markOf(page, asking)).not.toHaveAttribute("data-play")
  expect(await playing(markOf(page, asking))).toEqual([])
  expect((await playing(markOf(page, building))).map((a) => a.name)).toContain("agent-spin")

  await caption(page, "With reduced motion, nothing moves: the agents keep their poses, still")
  await page.emulateMedia({ reducedMotion: "reduce" })
  for (const taskKey of [building, planning, asking]) {
    await entryPlayed(markOf(page, taskKey))
    expect(await playing(markOf(page, taskKey))).toEqual([])
  }

  await agent.run((c) => c["ask.withdraw"]({ commandId: newCommandId(), key: asking }))
  for (const taskKey of [building, planning, asking]) await agent.run((c) => c["task.release"]({ commandId: newCommandId(), key: taskKey }))
  await agent.close()
})
