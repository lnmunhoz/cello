// CEL-69: the agent mark on cards. Cello's teardrop agent stands in for the presence dot and says what
// its agent is doing: working (the tip spins) and thinking (it sways, eyes up) for as long as the agent
// is active, page load included; a hop when the task starts waiting in Needs input and a jump for joy
// when it reaches In Review or Done, never on page load. Once the agent ends, every mark rests, and
// reduced motion stills it all. Agents act through RPC as the CLI would, the session's process a child
// the test ends on cue; agent cursors are off, so cards change in place, and Needs input is its own
// column. The board is shown at 140% browser zoom with the sidebar hidden, so the 15 px mark reads in
// the video, and the caption sits bottom right, over empty column space; the stills come from a 3x
// page at 100%. Entries are caught by their own animationstart events, so slow motion (review videos)
// can't make a check miss one.
import { type ChildProcess, spawn } from "node:child_process"
import * as path from "node:path"
import type { Browser, Locator, Page } from "@playwright/test"
import { newCommandId } from "../packages/client/test/support/promiseClient.ts"
import { agentAs, caption, card, column, defaultWorkspace, expect, seedProject, test, uniqueKey } from "./fixtures.ts"
import { SHOTS } from "./packets.ts"

const ZOOM = "1.4"

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

/** An animation that started on a card's mark: its name, its iteration count, and whether the mark was leaving. */
interface Started {
  readonly name: string
  readonly iterations: string
  readonly leaving: boolean
}

/**
 * Listens on `page` for the entry animations `names` to start on `key`'s mark. The returned function
 * resolves, once every one has started, with all that started on that mark. (Chrome reports each
 * composited animation as the compositor starts it, so they don't all arrive in one frame.)
 */
async function watchEntry(page: Page, key: string, names: ReadonlyArray<string>) {
  await page.evaluate(
    ([k, ns]) => {
      const w = window as unknown as { __entry?: Promise<Started[]> }
      w.__entry = new Promise((resolve) => {
        const started: Started[] = []
        const on = (e: AnimationEvent) => {
          const el = e.target as Element
          const mark = el.closest(`[data-task-key="${k}"] .agent-mark`)
          if (!mark) return
          started.push({ name: e.animationName, iterations: getComputedStyle(el).animationIterationCount, leaving: mark.hasAttribute("data-leaving") })
          if (!ns.every((n) => started.some((a) => a.name === n))) return
          document.removeEventListener("animationstart", on)
          resolve(started)
        }
        document.addEventListener("animationstart", on)
      })
    },
    [key, names] as const,
  )
  return () => page.evaluate(() => (window as unknown as { __entry: Promise<Started[]> }).__entry)
}

/** Arms `lens`: the moment `name` starts on `key`'s mark, every animation in it is held `ms` in, for stills. */
async function freezeOnStart(lens: Page, key: string, name: string, ms: number) {
  await lens.evaluate(
    ([k, n, t]) => {
      const w = window as unknown as { __frozen?: Promise<void> }
      w.__frozen = new Promise((resolve) => {
        const on = (e: AnimationEvent) => {
          const mark = (e.target as Element).closest(`[data-task-key="${k}"] .agent-mark`)
          if (!mark || e.animationName !== n) return
          document.removeEventListener("animationstart", on)
          for (const a of mark.getAnimations({ subtree: true })) {
            a.pause()
            a.currentTime = t
          }
          resolve()
        }
        document.addEventListener("animationstart", on)
      })
    },
    [key, name, ms] as const,
  )
  return () => lens.evaluate(() => (window as unknown as { __frozen: Promise<void> }).__frozen)
}

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
  await context.addInitScript((zoom) => {
    localStorage.setItem("cello:agent-cursors", "off")
    localStorage.setItem("cello:sidebar", JSON.stringify({ mode: "hidden", collapsed: "hidden" }))
    // Display → Needs input column: the waiting card hops at the top of its own column, in the video.
    localStorage.setItem("cello:needs-input-column", "on")
    // Once the document has its root element (init scripts run before it exists): 140% browser zoom,
    // and the caption at its usual size in the bottom right corner, over the columns' empty space.
    addEventListener("DOMContentLoaded", () => {
      document.documentElement.style.zoom = zoom
      const style = document.createElement("style")
      style.textContent = `#e2e-caption { zoom: calc(1 / ${zoom}); left: auto; right: 24px; translate: none; max-width: 520px; }`
      document.head.append(style)
    })
  }, ZOOM)
})

/** Processes this spec started to stand for agent sessions: ended after it, whatever happened. */
const children: ChildProcess[] = []
test.afterEach(() => {
  for (const child of children.splice(0)) child.kill()
})

test("CEL-69: each card's agent shows what its agent is doing: spinning while it builds and swaying while it thinks, for as long as it's active; a hop for Needs input, a jump for Done; still once it ends", async ({ page, browser, cello, baseURL }) => {
  // The server's sweep notices the agent's process is gone within 30 s: this test waits for it once.
  test.setTimeout(Math.max(test.info().timeout, 120_000))
  const key = uniqueKey("MARK")
  const project = await seedProject(cello, "Agent states", key)
  const { statuses } = await defaultWorkspace(cello)
  const titles = ["Build the spinner", "Plan the states", "Pick the colours", "Ship the mark"]
  for (const title of titles) {
    await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title, statusId: statuses.Todo!.id }))
  }
  const [building, planning, asking, shipping] = titles.map((_, i) => `${key}-${i + 1}`) as [string, string, string, string]
  // The session's process is a child this test starts and ends, so the agent can end on cue.
  const agentProcess = spawn("sleep", ["600"], { stdio: "ignore" })
  children.push(agentProcess)
  const agent = await agentAs(baseURL!, "7c3e9a51-agent-mark", agentProcess.pid!)
  for (const [taskKey, stage] of [[building, "building"], [planning, null], [asking, "fixing"], [shipping, "merged"]] as const) {
    await agent.run((c) => c["task.claim"]({ commandId: newCommandId(), key: taskKey }))
    if (stage) await agent.run((c) => c["task.stage"]({ commandId: newCommandId(), key: taskKey, stage }))
  }
  await page.goto(`/${key}/issues`)
  await expect(column(page, "In Progress").locator("[data-task-key]")).toHaveCount(4)
  await showFrom(page, "In Progress")

  await caption(page, "Session 7c3e9a51 is at work on four tasks. Building: its agent spins its tip from the moment the board draws. No stage yet: it sways, thinking")
  await expect(markOf(page, building)).toHaveAttribute("data-agent-mood", "working")
  await expect(markOf(page, planning)).toHaveAttribute("data-agent-mood", "thinking")
  await expect(markOf(page, building)).toHaveAttribute("data-presence", "active")
  expect(await playing(markOf(page, building))).toEqual(
    expect.arrayContaining([{ name: "agent-spin", iterations: Infinity }, { name: "agent-follow", iterations: Infinity }]),
  )
  expect(await playing(markOf(page, planning))).toEqual(
    expect.arrayContaining([{ name: "agent-think-tilt", iterations: Infinity }, { name: "agent-think-face", iterations: Infinity }]),
  )

  await caption(page, "Fixing findings spins too; Merged has happy eyes and keeps still")
  await expect(markOf(page, asking)).toHaveAttribute("data-agent-mood", "working")
  await expect(markOf(page, shipping)).toHaveAttribute("data-agent-mood", "merged")
  expect(await playing(markOf(page, shipping))).toEqual([])

  // Stills: each state at real size (the column, light and dark), and close up from a 3x page.
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await page.evaluate(() => (document.documentElement.style.zoom = "1"))
    await column(page, "In Progress").screenshot({ path: path.join(SHOTS, `cel-69-column-${theme}.png`) })
  }
  await page.evaluate((zoom) => {
    document.documentElement.classList.remove("dark")
    document.documentElement.style.zoom = zoom
  }, ZOOM)
  await showFrom(page, "In Progress")
  const { lens, close } = await openLens(browser, baseURL!, key)
  await expect(markOf(lens, building)).toHaveAttribute("data-agent-mood", "working")
  // A quarter turn in: the tip points up and right, the eyes follow it.
  await freezeAt(markOf(lens, building), 350)
  await stills(lens, building, "working")
  // Leaning furthest back, the eyes up toward the tip.
  await freezeAt(markOf(lens, planning), 1260)
  await stills(lens, planning, "thinking")
  await stills(lens, shipping, "merged")

  await caption(page, "The agent starts building Plan the states: its agent stops swaying and spins")
  await agent.run((c) => c["task.stage"]({ commandId: newCommandId(), key: planning, stage: "building" }))
  await expect(markOf(page, planning)).toHaveAttribute("data-agent-mood", "working")
  expect((await playing(markOf(page, planning))).map((a) => a.name)).toEqual(expect.arrayContaining(["agent-spin", "agent-follow"]))

  await caption(page, "A builder subagent takes Plan the states: the card names it, and the mark spins in the subagent's colour")
  // Its own id each run: a stopped subagent is never revived by a launch.
  const builder = `a13bfb89${key.toLowerCase()}`
  await agent.run((c) =>
    c["agent.report"]({ agentId: builder, agentType: "cello-builder", state: "launched", description: `${planning} build the states`, prompt: "Build it" }))
  await expect(card(page, planning).locator(`[data-agent="${builder}"]`)).toContainText("cello-builder")
  expect((await playing(markOf(page, planning))).map((a) => a.name)).toContain("agent-spin")

  await caption(page, "The subagent finishes: the card goes back to the session, which is still at work, so it keeps spinning")
  await agent.run((c) => c["agent.report"]({ agentId: builder, agentType: "cello-builder", state: "stopped" }))
  await expect(card(page, planning).locator(`[data-agent="${builder}"]`)).toHaveCount(0)
  expect((await playing(markOf(page, planning))).map((a) => a.name)).toContain("agent-spin")

  await caption(page, "Build the spinner goes to Agent review: its agent stops spinning and sways, thinking")
  await agent.run((c) => c["task.stage"]({ commandId: newCommandId(), key: building, stage: "review" }))
  await expect(markOf(page, building)).toHaveAttribute("data-agent-mood", "thinking")
  expect((await playing(markOf(page, building))).map((a) => a.name)).toEqual(expect.arrayContaining(["agent-think-tilt", "agent-think-face"]))

  await caption(page, "The agent asks Lucas about Pick the colours: Needs input. Its agent looks up with big eyes, hops twice and a ring goes out, once")
  const hopped = await watchEntry(page, asking, ["agent-hop", "agent-hop-squash", "agent-ring"])
  // On the 3x page: held at the top of the first hop, the ring on its way out.
  const lensHopped = await freezeOnStart(lens, asking, "agent-ring", 230)
  await agent.run((c) =>
    c["ask.create"]({ commandId: newCommandId(), key: asking, title: "Which colours?", questions: [{ prompt: "Session colour for the body?" }], files: [], links: [] }),
  )
  await lensHopped()
  const hop = await hopped()
  expect(hop.every((a) => a.iterations === "1")).toBe(true)
  const waiting = markOf(page, asking)
  await expect(waiting).toHaveAttribute("data-agent-mood", "waiting")
  await stills(lens, asking, "needs-input-hop")
  await resume(markOf(lens, asking))
  await entryPlayed(waiting)
  expect(await playing(waiting)).toEqual([])
  // Played: the entry clears, so nothing can start it again.
  await expect(waiting).not.toHaveAttribute("data-play")
  await entryPlayed(markOf(lens, asking))
  await stills(lens, asking, "needs-input")

  await caption(page, "Then it rests, big eyes up: a card waiting on Lucas runs no animation")
  await expect(column(page, "Needs input").locator(`[data-task-key="${asking}"]`)).toBeVisible()
  await showFrom(page, "Needs input")

  await caption(page, "Session 7c3e9a51 submits Ship the mark: In Review. Its agent squashes flat, leaps with happy eyes, lands wobbling, blinks")
  const jumped = await watchEntry(page, shipping, ["agent-done-squash", "agent-done-rig", "agent-done-eyes", "agent-done-happy"])
  // On the 3x page: held as a pancake, then airborne with happy eyes, then the landing wobble.
  const lensJumped = await freezeOnStart(lens, shipping, "agent-done-rig", 380)
  await agent.run((c) =>
    c["review.submit"]({
      commandId: newCommandId(), key: shipping, summary: "The agent mark on cards.", steps: ["Open the board"], files: [],
      links: [{ url: "https://example.com/cel-69", caption: "The PR" }],
    }),
  )
  await lensJumped()
  const jump = await jumped()
  expect(jump.every((a) => a.iterations === "1" && !a.leaving)).toBe(true)
  const done = column(page, "In Review").locator(`[data-task-key="${shipping}"] .agent-mark`)
  await expect(done).toHaveAttribute("data-agent-mood", "done")
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
  await expect(rows.locator(`[data-task-key="${building}"] .agent-mark`)).toHaveAttribute("data-agent-mood", "thinking")
  await expect(rows.locator(`[data-task-key="${planning}"] .agent-mark`)).toHaveAttribute("data-agent-mood", "working")
  await expect(rows.locator(`[data-task-key="${asking}"] .agent-mark`)).toHaveAttribute("data-agent-mood", "waiting")
  await expect(rows.locator(`[data-task-key="${shipping}"] .agent-mark`)).toHaveAttribute("data-agent-mood", "done")
  for (const theme of ["light", "dark"] as const) {
    await lens.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await lens.screenshot({ path: path.join(SHOTS, `cel-69-list-${theme}.png`), clip: { x: 240, y: 0, width: 1200, height: 360 } })
  }
  await close()

  await caption(page, "Lucas approves it: the claim ends, so its agent jumps once more as the card lands in Done, then leaves the card")
  await showFrom(page, "In Review")
  const landed = await watchEntry(page, shipping, ["agent-done-squash", "agent-done-rig"])
  await cello.run((c) => c["review.approve"]({ commandId: newCommandId(), key: shipping }))
  const landing = await landed()
  // No holder any more: the mark that plays is the leaving one.
  expect(landing.every((a) => a.leaving)).toBe(true)
  await expect(column(page, "Done").locator(`[data-task-key="${shipping}"] [data-card-work]`)).toHaveCount(0)

  await caption(page, "Reload: no entry plays as the board draws (Needs input rests, big eyes up), and the agents at work keep moving")
  await page.reload()
  await showFrom(page, "In Progress")
  await expect(markOf(page, asking)).toHaveAttribute("data-agent-mood", "waiting")
  await expect(markOf(page, asking)).not.toHaveAttribute("data-play")
  expect(await playing(markOf(page, asking))).toEqual([])
  expect((await playing(markOf(page, building))).map((a) => a.name)).toContain("agent-think-tilt")
  expect((await playing(markOf(page, planning))).map((a) => a.name)).toContain("agent-spin")

  await caption(page, "With reduced motion, nothing moves: the agents keep their poses, still")
  await page.emulateMedia({ reducedMotion: "reduce" })
  for (const taskKey of [building, planning, asking]) {
    await entryPlayed(markOf(page, taskKey))
    expect(await playing(markOf(page, taskKey))).toEqual([])
  }
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.reload()
  await showFrom(page, "In Progress")
  expect((await playing(markOf(page, planning))).map((a) => a.name)).toContain("agent-spin")

  await caption(page, "The agent's session ends (its process exits). Within 30 s the server notices: every mark rests, and nothing on the board moves")
  agentProcess.kill()
  await expect(markOf(page, planning)).toHaveAttribute("data-presence", "ended", { timeout: 45_000 })
  await expect(markOf(page, planning)).toHaveAttribute("data-agent-mood", "still")
  await expect(markOf(page, building)).toHaveAttribute("data-agent-mood", "still")
  for (const taskKey of [building, planning, asking]) expect(await playing(markOf(page, taskKey))).toEqual([])

  // Cleanup (its next call resumes the session, out of the picture now).
  await agent.run((c) => c["ask.withdraw"]({ commandId: newCommandId(), key: asking }))
  for (const taskKey of [building, planning, asking]) await agent.run((c) => c["task.release"]({ commandId: newCommandId(), key: taskKey }))
  await agent.close()
})
