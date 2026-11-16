// M1 "Done when": a board with 200 tasks keeps 60 fps while dragging. Seeds 200 tasks through the RPC
// client, drags a card across the columns for about 2 seconds, and counts animation frames meanwhile.
// CEL-6 adds the same board with three agent sessions moving cards, so three cursors fly at once.
// CEL-69 has 40 agents start building at once: their marks spin together while the main thread stays idle.
import type { Page } from "@playwright/test"
import { openClient } from "../packages/client/test/support/promiseClient.ts"
import { agentAs, animationsSettled, card, caption, column, defaultWorkspace, expect, newCommandId, seedLabels, seedProject, test, uniqueKey } from "./fixtures.ts"

const COLUMNS = ["Todo", "In Progress", "In Review", "Done"]
const AGENT_COLUMNS = ["Todo", "In Progress", "Done"]
const TITLES = ["Wire the SQLite store", "Draft the card drawer", "Fix due dates", "Polish theme tokens", "Add keyboard moves"]

/** Frame stats from requestAnimationFrame timestamps. */
interface Frames {
  readonly frames: number
  readonly durationMs: number
  readonly averageFps: number
  readonly worstFrameMs: number
  readonly slowFrames: number
}

type Cello = Parameters<Parameters<typeof test>[2]>[0]["cello"]

/** A project with 200 tasks spread over the columns, with labels, priorities and dates; its board open. */
async function board200(page: Page, cello: Cello, prefix: string) {
  const key = uniqueKey(prefix)
  const project = await seedProject(cello, "Performance test", key)
  const { statuses } = await defaultWorkspace(cello)
  const labels = await seedLabels(cello, [{ name: "Perf: backend", color: "#4ea7fc" }, { name: "Perf: ui", color: "#bb87fc" }])
  const ids: string[] = []
  for (let i = 0; i < 200; i++) {
    const created = await cello.run((c) =>
      c["task.create"]({
        commandId: newCommandId(),
        projectId: project.id,
        title: `${TITLES[i % TITLES.length]} (${i + 1})`,
        statusId: statuses[COLUMNS[i % COLUMNS.length]!]!.id,
        priority: (i % 5) as 0 | 1 | 2 | 3 | 4,
        labelIds: i % 3 === 0 ? [labels[i % 2]!.id] : [],
        dueDate: i % 4 === 1 ? "2026-12-01" : null,
      }))
    ids.push(created.result.id)
  }
  await page.goto(`/${key}/issues`)
  await expect(page.locator("[data-task-key]")).toHaveCount(200)
  return { key, statuses, ids }
}

/** Starts counting animation frames (and the most agent cursors on screen in any frame). */
const startFrames = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __recording: boolean; __maxCursors: number }
    w.__frames = []
    w.__recording = true
    w.__maxCursors = 0
    const tick = (t: number) => {
      if (!w.__recording) return
      w.__frames.push(t)
      w.__maxCursors = Math.max(w.__maxCursors, document.querySelectorAll("[data-agent-cursor]").length)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

/** Stops counting and sums the frames up. */
const stopFrames = (page: Page) =>
  page.evaluate((): Frames & { maxCursors: number } => {
    const w = window as unknown as { __frames: number[]; __recording: boolean; __maxCursors: number }
    w.__recording = false
    const t = w.__frames
    const gaps = t.slice(1).map((x, i) => x - t[i]!)
    const durationMs = t.at(-1)! - t[0]!
    return {
      frames: gaps.length,
      durationMs: Math.round(durationMs),
      averageFps: Math.round((gaps.length / durationMs) * 1000 * 10) / 10,
      worstFrameMs: Math.round(Math.max(...gaps) * 10) / 10,
      slowFrames: gaps.filter((g) => g > 20).length,
      maxCursors: w.__maxCursors,
    }
  })

test("performance: dragging a card across columns on a 200-task board stays near 60 fps", async ({ page, cello }, testInfo) => {
  const { key } = await board200(page, cello, "PERF")
  await caption(page, `200 tasks. Drag ${key}-1 across the columns for 2 seconds, counting frames`)

  const from = (await card(page, `${key}-1`).boundingBox())!
  const centers = []
  for (const name of COLUMNS) {
    const box = (await column(page, name).boundingBox())!
    centers.push({ x: box.x + box.width / 2, y: box.y + 220 })
  }
  // Todo → In Progress → In Review → Done and back, over and over.
  const path = [...centers.slice(1), ...centers.slice(0, -1).reverse()]

  // Main-thread time from Chrome, to see the headroom. CELLO_PERF_THROTTLE=4 slows the CPU 4x, like a slower machine.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Performance.enable")
  if (process.env.CELLO_PERF_THROTTLE) await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.CELLO_PERF_THROTTLE) })
  const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]))

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await startFrames(page)
  const before = await metrics()
  const started = Date.now()
  let moves = 0
  for (let leg = 0; Date.now() - started < 2000; leg++) {
    const target = path[leg % path.length]!
    await page.mouse.move(target.x, target.y + (leg % 2) * 60, { steps: 24 })
    moves += 24
    if (leg === 0) await expect(page.locator("[data-dragging]")).toHaveCount(1)
  }
  const after = await metrics()
  const busy = Object.fromEntries(
    ["TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration"].map((m) => [m, Math.round((after[m]! - before[m]!) * 1000)]),
  )
  console.log(`[perf] ${moves} pointer moves; main thread busy (ms): ${JSON.stringify(busy)} over ${Date.now() - started} ms`)
  const stats = await stopFrames(page)
  await page.mouse.up()
  await expect(card(page, `${key}-1`)).toHaveCount(1)
  await caption(page, `${stats.averageFps} fps on average, worst frame ${stats.worstFrameMs} ms`)

  console.log(`[perf] ${JSON.stringify(stats)}`)
  testInfo.annotations.push({ type: "perf", description: JSON.stringify(stats) })
  expect(stats.durationMs).toBeGreaterThan(1500)
  expect(stats.averageFps).toBeGreaterThanOrEqual(55)
})

test("performance: a 200-task board with three agent cursors flying at once stays near 60 fps (CEL-6)", async ({ page, cello, baseURL }, testInfo) => {
  const { key, statuses, ids } = await board200(page, cello, "PERFC")
  await caption(page, `200 tasks. Three agent sessions move cards for 2.5 seconds, counting frames`)
  const url = `${baseURL!.replace(/^http/, "ws")}/rpc`
  const agents = await Promise.all(
    ["a1f0c3d2-perf-agent-one", "b2e1d4c3-perf-agent-two", "c3d2e5f4-perf-agent-three"].map((session) =>
      openClient(url, { "x-cello-session": session, "x-cello-client": "Claude Code" })),
  )

  // Notes every card a cursor carried (a copy flying over the board) and every "made N changes" notice,
  // so the frame rate below is measured with real flights, not skipped ones.
  await page.evaluate(() => {
    const w = window as unknown as { __carried: Set<string>; __notices: number }
    w.__carried = new Set()
    w.__notices = 0
    new MutationObserver((records) => {
      for (const r of records)
        for (const node of r.addedNodes) {
          if (!(node instanceof HTMLElement)) continue
          if (node.dataset.agentGhost) w.__carried.add(node.dataset.agentGhost)
          if (node.dataset.agentNotice) w.__notices++
        }
    }).observe(document.body, { subtree: true, childList: true })
  })

  // Each column's cards top to bottom, as seeded (card i is in column i % 4), kept up to date below.
  const columnOf = new Map(ids.map((id, i) => [id, COLUMNS[i % COLUMNS.length]!]))
  const tops = Object.fromEntries(COLUMNS.map((name) => [name, ids.filter((id) => columnOf.get(id) === name)]))
  // Each agent has two cards near the top of the board: Todo, In Progress and Done's first two rows.
  const own = [
    [ids[0]!, ids[4]!],
    [ids[1]!, ids[5]!],
    [ids[3]!, ids[7]!],
  ]

  await startFrames(page)
  const started = Date.now()
  // Each agent moves its cards in turn to the top of the next column (not In Review: agents get there
  // only by submitting) for 2.5 s, so every move is a flight on screen, from the top rows to the top
  // rows, and three cursors carry cards at the same time.
  await Promise.all(
    agents.map(async (agent, a) => {
      for (let n = 0; Date.now() - started < 2500; n++) {
        const id = own[a]![n % 2]!
        const from = columnOf.get(id)!
        const to = AGENT_COLUMNS[(AGENT_COLUMNS.indexOf(from) + 1) % AGENT_COLUMNS.length]!
        const after = tops[to]![0] ?? null
        tops[from] = tops[from]!.filter((x) => x !== id)
        tops[to] = [id, ...tops[to]!]
        columnOf.set(id, to)
        await agent.run((c) => c["task.move"]({ commandId: newCommandId(), id, statusId: statuses[to]!.id, before: null, after }))
        // 24 frames apart (~0.4 s): about as fast as a sped-up lane plays, so lanes stay busy without skipping.
        await page.evaluate(
          () =>
            new Promise<void>((resolve) => {
              let n = 0
              const tick = () => (++n >= 24 ? resolve() : requestAnimationFrame(tick))
              requestAnimationFrame(tick)
            }),
        )
      }
    }),
  )
  const stats = await stopFrames(page)
  await caption(page, `${stats.averageFps} fps on average with ${stats.maxCursors} cursors, worst frame ${stats.worstFrameMs} ms`)
  console.log(`[perf] cursors ${JSON.stringify(stats)}`)
  testInfo.annotations.push({ type: "perf", description: JSON.stringify(stats) })
  for (const agent of agents) await agent.close()

  const flights = await page.evaluate(() => {
    const w = window as unknown as { __carried: Set<string>; __notices: number }
    return { carried: w.__carried.size, notices: w.__notices }
  })
  console.log(`[perf] cursors flights ${JSON.stringify(flights)}`)
  expect(flights.carried).toBeGreaterThanOrEqual(3)
  expect(flights.notices, "no lane fell behind and skipped").toBe(0)
  expect(stats.maxCursors).toBe(3)
  expect(stats.durationMs).toBeGreaterThan(2000)
  expect(stats.averageFps).toBeGreaterThanOrEqual(55)
  // Every card is still there, once each, and the board settles.
  await expect(page.locator("[data-task-key]")).toHaveCount(200)
  await expect(page.locator("[data-agent-cursor]")).toHaveCount(0)
  await expect(page.locator("[data-agent-ghost], [data-agent-hole]")).toHaveCount(0)
  expect(await page.evaluate(() => document.getElementById("agent-cursor-styles")?.textContent ?? "")).toBe("")
})

test("performance: 40 agents spinning at once stay near 60 fps (at least 55), with no long tasks, no extra layout and little extra style work, then go still (CEL-69)", async ({ page, cello, baseURL }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 90_000))
  const key = uniqueKey("PERFA")
  const project = await seedProject(cello, "Agent marks", key)
  const { statuses } = await defaultWorkspace(cello)
  const agents = await Promise.all(
    ["4a1b2c3d-perf-mark-one", "5b2c3d4e-perf-mark-two", "6c3d4e5f-perf-mark-three", "7d4e5f60-perf-mark-four"].map((s) => agentAs(baseURL!, s, process.pid)),
  )
  const keys = Array.from({ length: 40 }, (_, i) => `${key}-${i + 1}`)
  for (const [i, taskKey] of keys.entries()) {
    await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title: `${TITLES[i % TITLES.length]} (${i + 1})`, statusId: statuses.Todo!.id }))
    const agent = agents[i % agents.length]!
    await agent.run((c) => c["task.claim"]({ commandId: newCommandId(), key: taskKey }))
    await agent.run((c) => c["task.stage"]({ commandId: newCommandId(), key: taskKey, stage: "review" }))
  }
  await page.goto(`/${key}/issues`)
  // Each agent reviewing: its mark rests in the thinking pose, nothing moving as the board draws.
  // (The sidebar's Agents working list shows the four sessions' marks too; these are the cards'.)
  await expect(page.locator('[data-task-key] [data-agent-mood="thinking"]')).toHaveCount(40)
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0)
  await caption(page, "40 agents move their tasks to Building at once: 40 marks spin together. Counting 150 frames, then again once they've gone still")

  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Performance.enable")
  const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]))

  /** 150 animation frames (2.5 s): their timing, long tasks meanwhile, and the main thread's busy time from Chrome. */
  const measure = async () => {
    const before = await metrics()
    const frames = await page.evaluate(
      () =>
        new Promise<{ gaps: number[]; longTasks: number; animations: number }>((resolve) => {
          let longTasks = 0
          const observer = new PerformanceObserver((list) => (longTasks += list.getEntries().length))
          observer.observe({ type: "longtask" })
          const times: number[] = []
          const tick = (t: number) => {
            times.push(t)
            if (times.length <= 150) return void requestAnimationFrame(tick)
            observer.disconnect()
            // The cards' marks: the sidebar's session entries burst with them.
            const onCard = (a: Animation) => ((a.effect as KeyframeEffect | null)?.target as Element | null)?.closest("[data-task-key]") != null
            const running = document.getAnimations().filter((a) => a.playState === "running" && onCard(a)).length
            resolve({ gaps: times.slice(1).map((x, i) => x - times[i]!), longTasks, animations: running })
          }
          requestAnimationFrame(tick)
        }),
    )
    const after = await metrics()
    const durationMs = frames.gaps.reduce((a, b) => a + b, 0)
    const sorted = [...frames.gaps].sort((a, b) => a - b)
    return {
      animations: frames.animations,
      averageFps: Math.round((frames.gaps.length / durationMs) * 1000 * 10) / 10,
      p95FrameMs: Math.round(sorted[Math.floor(sorted.length * 0.95)]! * 10) / 10,
      worstFrameMs: Math.round(sorted.at(-1)! * 10) / 10,
      slowFrames: frames.gaps.filter((g) => g > 20).length,
      longTasks: frames.longTasks,
      // Main-thread time per frame, in ms: all of it, then style recalculation and layout.
      taskMsPerFrame: Math.round(((after.TaskDuration! - before.TaskDuration!) * 1000 * 100) / frames.gaps.length) / 100,
      styleMsPerFrame: Math.round(((after.RecalcStyleDuration! - before.RecalcStyleDuration!) * 1000 * 100) / frames.gaps.length) / 100,
      layoutMsPerFrame: Math.round(((after.LayoutDuration! - before.LayoutDuration!) * 1000 * 100) / frames.gaps.length) / 100,
    }
  }

  // Counts the spins as they start (two layers per mark: the body and the face), event by event.
  await page.evaluate(() => {
    const w = window as unknown as { __spinning?: Promise<void> }
    w.__spinning = new Promise((resolve) => {
      let started = 0
      const on = (e: AnimationEvent) => {
        if (e.animationName !== "agent-spin" && e.animationName !== "agent-follow") return
        if (!(e.target as Element).closest("[data-task-key]")) return
        if (++started < 80) return
        document.removeEventListener("animationstart", on)
        resolve()
      }
      document.addEventListener("animationstart", on)
    })
  })
  // Each session moves its ten tasks to Building at once: a burst of three spins (4.2 s) on every card.
  await Promise.all(
    agents.map((agent, a) =>
      Promise.all(keys.filter((_, i) => i % agents.length === a).map((taskKey) => agent.run((c) => c["task.stage"]({ commandId: newCommandId(), key: taskKey, stage: "building" })))),
    ),
  )
  await page.evaluate(() => (window as unknown as { __spinning: Promise<void> }).__spinning)
  const spinning = await measure()
  // The bursts end by themselves: the board goes idle with no animation left.
  await animationsSettled(page)
  const still = await measure()
  console.log(`[perf] agent marks spinning ${JSON.stringify(spinning)}`)
  console.log(`[perf] agent marks still ${JSON.stringify(still)}`)
  testInfo.annotations.push({ type: "perf", description: JSON.stringify({ spinning, still }) })
  await caption(page, `Spinning: ${spinning.averageFps} fps, ${spinning.taskMsPerFrame} ms main thread a frame. Still: ${still.averageFps} fps, ${still.taskMsPerFrame} ms`)

  // Two layers spin in each working mark: the body and the face.
  expect(spinning.animations).toBe(80)
  expect(still.animations).toBe(0)
  expect(spinning.averageFps).toBeGreaterThanOrEqual(55)
  expect(spinning.longTasks).toBe(0)
  // The marks animate transform and opacity only, which the compositor runs: an animation of a layout
  // property (width, top, margin…) would show up as layout every frame, and as much more style work.
  expect(spinning.layoutMsPerFrame).toBeLessThanOrEqual(still.layoutMsPerFrame + 0.1)
  // Chrome still updates the animated elements' styles each frame: 0.6–0.7 ms for 80 animations here.
  expect(spinning.styleMsPerFrame).toBeLessThanOrEqual(still.styleMsPerFrame + 1.5)
  for (const agent of agents) await agent.close()
})
