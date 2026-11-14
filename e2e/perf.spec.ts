// M1 "Done when": a board with 200 tasks keeps 60 fps while dragging. Seeds 200 tasks through the RPC
// client, drags a card across the columns for about 2 seconds, and counts animation frames meanwhile.
import { card, caption, column, defaultWorkspace, expect, newCommandId, seedLabels, seedProject, test, uniqueKey } from "./fixtures.ts"

const COLUMNS = ["Todo", "In Progress", "In Review", "Done"]
const TITLES = ["Wire the SQLite store", "Draft the card drawer", "Fix due dates", "Polish theme tokens", "Add keyboard moves"]

/** Frame stats from requestAnimationFrame timestamps. */
interface Frames {
  readonly frames: number
  readonly durationMs: number
  readonly averageFps: number
  readonly worstFrameMs: number
  readonly slowFrames: number
}

test("performance: dragging a card across columns on a 200-task board stays near 60 fps", async ({ page, cello }, testInfo) => {
  const key = uniqueKey("PERF")
  const project = await seedProject(cello, "Performance test", key)
  const { statuses } = await defaultWorkspace(cello)
  const labels = await seedLabels(cello, [{ name: "Perf: backend", color: "#4ea7fc" }, { name: "Perf: ui", color: "#bb87fc" }])
  for (let i = 0; i < 200; i++) {
    await cello.run((c) =>
      c["task.create"]({
        commandId: newCommandId(),
        projectId: project.id,
        title: `${TITLES[i % TITLES.length]} (${i + 1})`,
        statusId: statuses[COLUMNS[i % COLUMNS.length]!]!.id,
        priority: (i % 5) as 0 | 1 | 2 | 3 | 4,
        labelIds: i % 3 === 0 ? [labels[i % 2]!.id] : [],
        dueDate: i % 4 === 1 ? "2026-12-01" : null,
      }))
  }

  await page.goto(`/${key}/issues`)
  await expect(page.locator("[data-task-key]")).toHaveCount(200)
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
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __recording: boolean }
    w.__frames = []
    w.__recording = true
    const tick = (t: number) => {
      if (!w.__recording) return
      w.__frames.push(t)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
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
  const stats = await page.evaluate((): Frames => {
    const w = window as unknown as { __frames: number[]; __recording: boolean }
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
    }
  })
  await page.mouse.up()
  await expect(card(page, `${key}-1`)).toHaveCount(1)
  await caption(page, `${stats.averageFps} fps on average, worst frame ${stats.worstFrameMs} ms`)

  console.log(`[perf] ${JSON.stringify(stats)}`)
  testInfo.annotations.push({ type: "perf", description: JSON.stringify(stats) })
  expect(stats.durationMs).toBeGreaterThan(1500)
  expect(stats.averageFps).toBeGreaterThanOrEqual(55)
})
