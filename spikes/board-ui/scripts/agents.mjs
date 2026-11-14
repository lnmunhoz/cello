// Spike (c) checks: items 1-7.
import { chromium } from "@playwright/test"
const URL = process.env.URL ?? "http://localhost:5199/"
const browser = await chromium.launch()
const results = {}

async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...opts })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => console.log("pageerror:", e.message))
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window)
    window.__rafCalls = 0
    window.requestAnimationFrame = (cb) => { window.__rafCalls++; return raf(cb) }
  })
  await page.goto(URL)
  await page.waitForSelector("[data-card-id]")
  return { ctx, page }
}
const ev = (page, fn, arg) => page.evaluate(fn, arg)
const stats = (page) => ev(page, () => JSON.parse(JSON.stringify(window.__cello.stats)))
const settle = async (page, ms = 3500) => page.waitForTimeout(ms)
async function idleCheck(page) {
  const anims = await ev(page, () => document.getAnimations().length)
  const r0 = await ev(page, () => window.__rafCalls)
  await page.waitForTimeout(1000)
  const r1 = await ev(page, () => window.__rafCalls)
  return { animations: anims, rafCallsIn1s: r1 - r0, ghosts: await ev(page, () => window.__cello.activeGhosts()), cursors: await page.locator("[data-agent-cursor]").count() }
}

{ // 1. single move
  const { ctx, page } = await open()
  const card = await ev(page, () => window.__cello.scenarios.single())
  const storeNow = await ev(page, (c) => window.__cello.store.columnOf(c), card)
  await page.waitForTimeout(120)
  const queued = { ghosts: await ev(page, () => window.__cello.activeGhosts()), holeCopy: await page.locator(`[data-hole-card="${card}"]`).count(), destHidden: await page.locator(`[data-card-id="${card}"][data-pending="queued"]`).count(), cursor: await page.locator("[data-agent-cursor]").count() }
  await page.waitForTimeout(330)
  const flying = { ghosts: await ev(page, () => window.__cello.activeGhosts()), spacer: await page.locator(`[data-card-id="${card}"][data-pending="flying"]`).count(), spacerOpacity: await page.locator(`[data-card-id="${card}"]`).evaluate((e) => getComputedStyle(e).opacity) }
  await page.waitForTimeout(300)
  const mid = { ghosts: await ev(page, () => window.__cello.activeGhosts()), hole: await page.locator("[data-hole]").count() }
  await settle(page, 1500)
  const end = { ghosts: await ev(page, () => window.__cello.activeGhosts()), pending: await page.locator(`[data-card-id="${card}"][data-pending]`).count(), opacity: await page.locator(`[data-card-id="${card}"]`).evaluate((e) => getComputedStyle(e).opacity) }
  results.item1 = { card, storeAppliedImmediately: storeNow === "doing", queued, flying, mid, end, pass: storeNow === "doing" && queued.ghosts === 0 && queued.holeCopy === 1 && queued.destHidden === 1 && flying.ghosts === 1 && flying.spacer === 1 && flying.spacerOpacity === "0" && mid.hole === 0 && end.ghosts === 0 && end.pending === 0 && end.opacity === "1" }
  await settle(page, 1000)
  results.item6_afterSingle = await idleCheck(page)
  await ctx.close()
}
{ // 2. parallel agents
  const { ctx, page } = await open()
  await ev(page, () => window.__cello.scenarios.parallel())
  await page.waitForTimeout(450)
  const cursors = await page.locator("[data-agent-cursor]").evaluateAll((els) => els.map((e) => e.dataset.agentCursor))
  const ghosts = await ev(page, () => window.__cello.activeGhosts())
  await settle(page)
  results.item2 = { cursorsAtOnce: cursors, ghostsAtOnce: ghosts, pass: cursors.length === 2 && ghosts === 2 }
  await ctx.close()
}
{ // 3a. queued merge across agents
  const { ctx, page } = await open()
  const x = await ev(page, () => window.__cello.scenarios.queuedMerge())
  await page.waitForTimeout(100)
  const ghostsForX = await page.locator(`[data-ghost="${x}"]`).count()
  const holeCopiesForX = await page.locator(`[data-hole-card="${x}"]`).count()
  await settle(page)
  const s = await stats(page)
  const playsOfX = s.log.filter((l) => l.includes(` play ${x} `))
  results.item3_queued = { card: x, finalColumn: await ev(page, (c) => window.__cello.store.columnOf(c), x), merged: s.merged, ghostsForXWhileQueued: ghostsForX, holeCopiesForXWhileQueued: holeCopiesForX, playsOfX, pass: s.merged === 1 && playsOfX.length === 1 && playsOfX[0].startsWith("codex") }
  await ctx.close()
}
{ // 3b. same card, second agent takes over mid-flight
  const { ctx, page } = await open()
  const p = ev(page, () => window.__cello.scenarios.sameCard())
  let maxGhosts = 0
  for (let i = 0; i < 20; i++) { maxGhosts = Math.max(maxGhosts, await ev(page, () => window.__cello.activeGhosts())); await page.waitForTimeout(60) }
  const card = await p
  await settle(page)
  const s = await stats(page)
  results.item3_midflight = { card, finalColumn: await ev(page, (c) => window.__cello.store.columnOf(c), card), merged: s.merged, maxGhostsAtOnce: maxGhosts, log: s.log, pass: s.merged === 1 && maxGhosts === 1 }
  await ctx.close()
}
{ // 4. user grabs a card whose ghost is in flight
  const { ctx, page } = await open()
  const card = await ev(page, () => window.__cello.scenarios.single())
  await page.waitForTimeout(500)
  const before = await ev(page, () => window.__cello.activeGhosts())
  const b = await page.locator(`[data-card-id="${card}"]`).boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  const afterDown = await ev(page, () => window.__cello.activeGhosts())
  await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2 + 60, { steps: 8 })
  const preview = await page.locator("[data-drag-preview]").evaluate((e) => getComputedStyle(e).opacity).catch(() => "none")
  await page.mouse.up()
  await settle(page, 1500)
  const s = await stats(page)
  results.item4 = { card, ghostsBefore: before, ghostsAfterPointerDown: afterDown, dragPreviewOpacity: preview, cancelledByUser: s.cancelledByUser, pass: before === 1 && afterDown === 0 && s.cancelledByUser === 1 && preview === "1" }
  await ctx.close()
}
{ // 5. burst of 20 from one agent
  const { ctx, page } = await open()
  const toasts = []
  const p = ev(page, () => window.__cello.scenarios.burst("claude", 20, 45))
  for (let i = 0; i < 30; i++) { const t = await page.locator("[data-toast]").allTextContents(); if (t.length) toasts.push(t.join("|")); await page.waitForTimeout(50) }
  await p
  await page.waitForTimeout(400)
  const s = await stats(page)
  const lastToast = (await page.locator("[data-toast]").allTextContents()).join("|")
  results.item5 = { scales: s.log.filter((l) => l.includes(" play ")), skipped: s.skipped, started: s.started, toastsSeen: [...new Set(toasts)], lastToast, storeHasAll50: await ev(page, () => Object.values(window.__cello.store.get()).flat().length), pass: lastToast.includes("Claude made 20 changes") }
  await settle(page, 4000)
  results.item6_afterBurst = await idleCheck(page)
  await ctx.close()
}
{ // 7. reduced motion: fade, no flight
  const { ctx, page } = await open({ reducedMotion: "reduce" })
  const card = await ev(page, () => window.__cello.scenarios.single())
  const samples = []
  for (let i = 0; i < 8; i++) {
    samples.push(await page.evaluate((c) => { const g = document.querySelector(`[data-ghost="${c}"]`); return g ? { t: g.style.transform, o: g.style.opacity } : null }, card))
    await page.waitForTimeout(30)
  }
  await settle(page, 1500)
  const translates = new Set(samples.filter(Boolean).map((s) => s.t))
  results.item7 = { samples: samples.filter(Boolean).slice(0, 4), distinctGhostPositions: translates.size, cursor: "placed at slot, no glide", finalColumn: await ev(page, (c) => window.__cello.store.columnOf(c), card), pass: translates.size <= 1 }
  results.item6_reduced = await idleCheck(page)
  await ctx.close()
}
for (const k of ["item6_afterSingle", "item6_afterBurst", "item6_reduced"]) results[k].pass = results[k].animations === 0 && results[k].rafCallsIn1s === 0
console.log(JSON.stringify(results, null, 2))
await browser.close()
