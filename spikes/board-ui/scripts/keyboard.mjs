// Gate (b2): keyboard move end to end.
import { chromium } from "@playwright/test"
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on("pageerror", (e) => console.log("pageerror:", e.message))
await page.goto(process.env.URL ?? "http://localhost:5199/")
await page.waitForSelector("[data-card-id]")
const col = (id) => page.evaluate((id) => window.__cello.store.columnOf(id), id)
const idx = (id) => page.evaluate((id) => { const s = window.__cello.store; return s.get()[s.columnOf(id)].indexOf(id) }, id)
const card = "c5"
const before = { col: await col(card), idx: await idx(card) }
await page.locator(`[data-card-id="${card}"]`).focus()
await page.keyboard.press("Space")
const picked = await page.locator(`[data-card-id="${card}"]`).getAttribute("data-moving")
await page.keyboard.press("ArrowRight")
await page.keyboard.press("ArrowRight")
await page.keyboard.press("ArrowDown")
const draftCol = await col(card) // store must not change before the drop
await page.keyboard.press("Space")
await page.waitForTimeout(300)
const after = { col: await col(card), idx: await idx(card) }
const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-card-id"))
// Escape cancels
await page.keyboard.press("Space")
await page.keyboard.press("ArrowLeft")
await page.keyboard.press("Escape")
await page.waitForTimeout(200)
const afterEscape = await col(card)
const res = { card, before, pickedUp: picked === "", storeDuringDraft: draftCol, after, focusFollows: focused === card, afterEscape,
  pass: before.col === "backlog" && after.col === "doing" && draftCol === "backlog" && afterEscape === "doing" }
console.log(JSON.stringify(res, null, 2))
await browser.close()
