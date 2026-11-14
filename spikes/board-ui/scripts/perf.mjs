// Gate (b1): fps while mouse-dragging a card across columns with 50 cards.
// Counts requestAnimationFrame callbacks in the page during a ~2 s drag.
import { chromium } from "@playwright/test"

const URL = process.env.URL ?? "http://localhost:5199/"
const throttle = Number(process.env.THROTTLE ?? 1)
const STEP_WAIT = Number(process.env.STEP_WAIT ?? 0)

const browser = await chromium.launch({ args: ["--disable-gpu-vsync=false"] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on("pageerror", (e) => console.log("pageerror:", e.message))
await page.addInitScript(() => {
  const perf = { times: [], running: false, long: [] }
  perf.start = () => {
    perf.times = []; perf.long = []; perf.running = true
    const loop = (t) => { if (!perf.running) return; perf.times.push(t); requestAnimationFrame(loop) }
    requestAnimationFrame(loop)
  }
  perf.stop = () => {
    perf.running = false
    const iv = perf.times.slice(1).map((t, i) => t - perf.times[i])
    const sorted = [...iv].sort((a, b) => a - b)
    const span = perf.times.at(-1) - perf.times[0]
    return {
      frames: perf.times.length, spanMs: Math.round(span),
      fps: +(iv.length / (span / 1000)).toFixed(1),
      avgMs: +(iv.reduce((a, b) => a + b, 0) / iv.length).toFixed(2),
      p95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
      worstMs: +sorted.at(-1).toFixed(2),
      over20ms: iv.filter((x) => x > 20).length,
      longTasks: perf.long.length,
      slowFrames: iv.map((x, i) => [i, +x.toFixed(1)]).filter(([, x]) => x > 20),
    }
  }
  new PerformanceObserver((l) => perf.long.push(...l.getEntries().map((e) => e.duration))).observe({ type: "longtask", buffered: false })
  window.__perf = perf
})
await page.goto(URL)
await page.waitForSelector("[data-card-id]")
if (throttle > 1) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle })
}
await page.waitForTimeout(500)

// Baseline: nothing happening.
await page.evaluate(() => window.__perf.start())
await page.waitForTimeout(2000)
const idle = await page.evaluate(() => window.__perf.stop())

async function center(sel) {
  const b = await page.locator(sel).boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}
const columnOf = (id) => page.evaluate((id) => window.__cello.store.columnOf(id), id)

const card = "c3"
const start = await center(`[data-card-id="${card}"]`)
const lanes = await Promise.all(["todo", "doing", "done"].map((c) => center(`[data-column="${c}"] .lane-cards`)))
// Path: across Todo and In Progress, weaving up and down through cards, end in Done.
const pts = []
const N = 120
for (let i = 0; i <= N; i++) {
  const t = i / N
  const x = start.x + (lanes[2].x - start.x) * t
  const y = start.y + 200 * Math.sin(t * Math.PI * 3) + 120 * t
  pts.push({ x, y })
}
await page.mouse.move(start.x, start.y)
await page.mouse.down()
await page.evaluate(() => window.__perf.start())
// Optional stress: agents animate other cards while the user drags.
if (process.env.AGENTS) await page.evaluate(() => { const c = window.__cello.scenarios; c.burst("codex", 6, 250); c.burst("gemini", 6, 300); c.parallel() })
const t0 = Date.now()
for (const p of pts) {
  await page.mouse.move(p.x, p.y)
  if (STEP_WAIT) await page.waitForTimeout(STEP_WAIT)
}
const dragMs = Date.now() - t0
const drag = await page.evaluate(() => window.__perf.stop())
await page.mouse.up()
await page.waitForTimeout(400)
const landed = await columnOf(card)

console.log(JSON.stringify({ throttle, idle, drag: { ...drag, dragMs, moves: pts.length }, card, landedIn: landed, pass: landed === "done" }, null, 2))
await browser.close()
