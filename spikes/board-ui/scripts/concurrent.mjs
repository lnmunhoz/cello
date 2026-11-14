// Agent events arriving while the user drags: store stays consistent, the drag survives.
import { chromium } from "@playwright/test"
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on("pageerror", (e) => console.log("pageerror:", e.message))
await page.goto(process.env.URL ?? "http://localhost:5198/")
await page.waitForSelector("[data-card-id]")
const b = await page.locator('[data-card-id="c2"]').boundingBox()
const done = await page.locator('[data-column="done"] .lane-cards').boundingBox()
await page.mouse.move(b.x + 50, b.y + 20)
await page.mouse.down()
await page.mouse.move(b.x + 300, b.y + 60, { steps: 10 })
// Agents move other cards, including into the column under the pointer, and try to move the dragged card.
await page.evaluate(() => {
  const { handleEvent, AGENTS } = window.__cello
  const e = (agent, card, to, index) => handleEvent({ type: "task.moved", agent: AGENTS[agent], card, to, index, at: Date.now() })
  e("claude", "c17", "done", 0); e("codex", "c30", "backlog", 0); e("claude", "c2", "doing", 0)
})
await page.waitForTimeout(300)
await page.mouse.move(done.x + 100, done.y + 40, { steps: 30 })
await page.waitForTimeout(100)
await page.mouse.up()
await page.waitForTimeout(1500)
const r = await page.evaluate(() => {
  const l = window.__cello.store.get(); const all = Object.values(l).flat()
  return { total: all.length, unique: new Set(all).size, c2: window.__cello.store.columnOf("c2"), c17: window.__cello.store.columnOf("c17"), c30: window.__cello.store.columnOf("c30"), ghosts: window.__cello.activeGhosts() }
})
console.log(JSON.stringify(r))
await browser.close()
