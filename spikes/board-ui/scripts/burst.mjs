import { chromium } from "@playwright/test"
const browser = await chromium.launch()
for (const spacing of (process.env.SPACINGS ?? "45,150,250").split(",").map(Number)) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto(process.env.URL ?? "http://localhost:5199/")
  await page.waitForSelector("[data-card-id]")
  const t0 = Date.now()
  await page.evaluate((sp) => window.__cello.scenarios.burst("claude", 20, sp), spacing)
  let toastAt = null
  for (let i = 0; i < 200; i++) {
    if (!toastAt && (await page.locator("[data-toast]").count())) toastAt = Date.now() - t0
    const busy = await page.evaluate(() => window.__cello.activeGhosts())
    if (!busy && i > 5) break
    await page.waitForTimeout(50)
  }
  const done = Date.now() - t0
  const s = await page.evaluate(() => window.__cello.stats)
  const toast = (await page.locator("[data-toast]").allTextContents()).join("|")
  console.log(JSON.stringify({ spacing, animated: s.started, skipped: s.skipped, toastAtMs: toastAt, settledMs: done, toast, log: s.log }))
  await page.close()
}
await browser.close()
