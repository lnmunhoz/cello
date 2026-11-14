// Records the evidence videos and converts them to MP4 in ./videos.
import { chromium } from "@playwright/test"
import { execFileSync } from "node:child_process"
import { mkdirSync, rmSync } from "node:fs"
import path from "node:path"

const URL = process.env.URL ?? "http://localhost:5198/"
const OUT = path.resolve("videos")
const RAW = path.resolve("test-results/raw-videos")
mkdirSync(OUT, { recursive: true })
const size = { width: 1440, height: 1000 }
const browser = await chromium.launch()
const only = process.env.ONLY?.split(",")

const overlay = () => {
  const style = document.createElement("style")
  style.textContent = `
  #fake-mouse{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:22px;height:22px;margin:-3px 0 0 -3px}
  .ripple{position:fixed;z-index:2147483646;pointer-events:none;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:99px;border:3px solid #2563eb;animation:rip .5s ease-out forwards}
  @keyframes rip{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}
  #caption{position:fixed;right:20px;top:14px;z-index:2147483647;background:#111827;color:#fff;font:600 15px system-ui;padding:8px 14px;border-radius:10px;pointer-events:none;max-width:560px}
  #caption:empty{display:none}`
  const mouse = document.createElement("div")
  mouse.id = "fake-mouse"
  mouse.innerHTML = `<svg width="22" height="22" viewBox="0 0 18 20"><path d="M1 1 L1 16 L5.2 12.4 L8 19 L10.8 17.8 L8.1 11.4 L14 11.4 Z" fill="#111" stroke="white" stroke-width="1.4"/></svg>`
  mouse.style.display = "none"
  const cap = document.createElement("div")
  cap.id = "caption"
  addEventListener("DOMContentLoaded", () => document.body.append(style, mouse, cap))
  addEventListener("pointermove", (e) => { mouse.style.display = ""; mouse.style.transform = `translate(${e.clientX}px,${e.clientY}px)` }, true)
  addEventListener("pointerdown", (e) => { const r = document.createElement("div"); r.className = "ripple"; r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px"; document.body.append(r); setTimeout(() => r.remove(), 600) }, true)
}

async function record(name, opts, fn) {
  if (only && !only.includes(name)) return
  const ctx = await browser.newContext({ viewport: size, recordVideo: { dir: RAW, size }, ...opts })
  await ctx.addInitScript(overlay)
  const page = await ctx.newPage()
  await page.goto(URL)
  await page.waitForSelector("[data-card-id]")
  const caption = (t) => page.evaluate((t) => (document.getElementById("caption").textContent = t), t)
  await page.waitForTimeout(600)
  await fn(page, caption)
  await page.waitForTimeout(800)
  const raw = await page.video().path()
  await ctx.close()
  const mp4 = path.join(OUT, `${name}.mp4`)
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4])
  rmSync(raw)
  console.log("wrote", mp4)
}

const center = async (page, sel) => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
async function glide(page, from, to, ms, steps = Math.round(ms / 16)) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)
    await page.waitForTimeout(ms / steps)
  }
}

await record("01-mouse-drag-between-and-within-columns", {}, async (page, caption) => {
  await caption("Mouse drag: Backlog → In Progress → Done (UI SDK createTransfer)")
  const a = await center(page, '[data-card-id="c3"]')
  await page.mouse.move(a.x - 200, a.y + 200)
  await glide(page, { x: a.x - 200, y: a.y + 200 }, a, 400)
  await page.mouse.down()
  const doing = await center(page, '[data-card-id="c33"]')
  await glide(page, a, { x: a.x + 30, y: a.y + 230 }, 700) // within Backlog first
  await glide(page, { x: a.x + 30, y: a.y + 230 }, doing, 900)
  const done = await center(page, '[data-card-id="c44"]')
  await glide(page, doing, done, 900)
  await page.waitForTimeout(250)
  await page.mouse.up()
  await caption("Dropped in Done. Now reorder within Done")
  await page.waitForTimeout(700)
  const d1 = await center(page, '[data-card-id="c41"]')
  await glide(page, done, d1, 300)
  await page.mouse.down()
  const d2 = await center(page, '[data-card-id="c47"]')
  await glide(page, d1, { x: d2.x, y: d2.y + 10 }, 1100)
  await page.waitForTimeout(250)
  await page.mouse.up()
  await caption(`c3 is in ${await page.evaluate(() => window.__cello.store.columnOf("c3"))}; c41 moved down within Done`)
  await page.waitForTimeout(900)
})

await record("02-keyboard-move", {}, async (page, caption) => {
  const step = async (label, key) => { await caption(label); if (key) await page.keyboard.press(key); await page.waitForTimeout(650) }
  await caption("Keyboard: focus card c5 (Tab / roving focus)")
  await page.locator('[data-card-id="c5"]').focus()
  await page.waitForTimeout(800)
  await step("Space: pick up", "Space")
  await step("→ ArrowRight: to Todo", "ArrowRight")
  await step("→ ArrowRight: to In Progress", "ArrowRight")
  await step("↓ ArrowDown", "ArrowDown")
  await step("↓ ArrowDown", "ArrowDown")
  await step("Space: drop", "Space")
  await caption(`Store says c5 is in: ${await page.evaluate(() => window.__cello.store.columnOf("c5"))}`)
  await page.waitForTimeout(1200)
})

await record("03-agent-single-move", {}, async (page, caption) => {
  await caption("task.moved from Claude · thailookup: store updates now, cursor + ghost play on top")
  await page.evaluate(() => window.__cello.scenarios.single())
  await page.waitForTimeout(2200)
  await caption("Two agents at once: separate queues, animate in parallel")
  await page.evaluate(() => window.__cello.scenarios.parallel())
  await page.waitForTimeout(2400)
})

await record("04-two-agents-same-card", {}, async (page, caption) => {
  await caption("Claude moves card c3; 520 ms later Codex moves the same card. Newest wins mid-flight")
  await page.evaluate(() => window.__cello.scenarios.sameCard(520))
  await page.waitForTimeout(2600)
  await caption("Queued merge: both agents queue a move of c6 behind other work. Only Codex's (newest) plays")
  await page.evaluate(() => window.__cello.scenarios.queuedMerge())
  await page.waitForTimeout(3500)
})

await record("05-burst-20-events", {}, async (page, caption) => {
  await caption("Claude sends 20 task.moved events, 150 ms apart: moves speed up as the queue grows…")
  await page.evaluate(() => window.__cello.scenarios.burst("claude", 20, 150))
  await page.waitForTimeout(500)
  await caption("…past 8 waiting, the queue skips to the end and shows a toast")
  await page.waitForTimeout(3500)
})

await record("06-user-grab-cancels-ghost", {}, async (page, caption) => {
  await caption("Claude moves c4; the user grabs it mid-flight: ghost cancelled, user drags the real card")
  const card = await page.evaluate(() => window.__cello.scenarios.single())
  await page.waitForTimeout(450)
  const b = await page.locator(`[data-card-id="${card}"]`).boundingBox()
  const at = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  await page.mouse.move(at.x + 120, at.y + 80)
  await glide(page, { x: at.x + 120, y: at.y + 80 }, at, 150)
  await page.mouse.down()
  const dest = await center(page, '[data-card-id="c20"]')
  await glide(page, at, dest, 900)
  await page.mouse.up()
  await page.waitForTimeout(1200)
})

await record("07-reduced-motion", { reducedMotion: "reduce" }, async (page, caption) => {
  await caption("prefers-reduced-motion: no flight, the card fades out and fades in at its slot")
  await page.evaluate(() => window.__cello.scenarios.single())
  await page.waitForTimeout(1500)
  await page.evaluate(() => window.__cello.scenarios.parallel())
  await page.waitForTimeout(1500)
})

await browser.close()
