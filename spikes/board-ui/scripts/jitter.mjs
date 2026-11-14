// Does motion's layout animation fight UI SDK's drop-index math? Move the pointer
// monotonically down a column in small steps and record the placeholder index.
import { chromium } from "@playwright/test"
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
await page.goto(process.env.URL ?? "http://localhost:5198/")
await page.waitForSelector("[data-card-id]")
await page.evaluate(() => {
  window.__seq = []
  new MutationObserver(() => {
    const el = document.querySelector(".lane-cards [data-dragging]")
    if (!el) return
    const i = [...el.parentElement.children].indexOf(el)
    const col = el.closest("[data-column]").dataset.column
    const key = `${col}:${i}`
    if (window.__seq.at(-1) !== key) window.__seq.push(key)
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-dragging"] })
})
const b = await page.locator('[data-card-id="c2"]').boundingBox()
const x = b.x + b.width / 2
await page.mouse.move(x, b.y + b.height / 2)
await page.mouse.down()
for (let y = b.y + b.height / 2; y < b.y + 600; y += 3) {
  await page.mouse.move(x, y)
}
await page.mouse.up()
const seq = await page.evaluate(() => window.__seq)
const idx = seq.map((s) => +s.split(":")[1])
const reversals = idx.slice(1).filter((v, i) => v < idx[i]).length
console.log(JSON.stringify({ steps: seq.length, seq: seq.join(" "), reversals }))
await browser.close()
