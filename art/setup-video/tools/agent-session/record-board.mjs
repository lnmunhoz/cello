// Records the board and the Agents page while the session runs, headless, at 1920x1080.
// Waits for Cello to come up on 4747 (the agent starts it during setup), stops on SIGTERM.
import { chromium } from "playwright"
import { copyFileSync, appendFileSync } from "node:fs"
const base = "http://127.0.0.1:4747"
const log = (m) => appendFileSync("/out/times.txt", `${new Date().toISOString()} ${m}\n`)
const up = async () => { try { return (await fetch(base + "/")).ok } catch { return false } }
while (!(await up())) await new Promise((r) => setTimeout(r, 2000))
log("cello up")
const browser = await chromium.launch({ handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false })
const pages = {}
for (const [name, path] of [["board", "/"], ["agents", "/agents"]]) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: "/tmp/rec", size: { width: 1920, height: 1080 } } })
  const page = await ctx.newPage()
  await page.goto(base + path)
  pages[name] = { ctx, page }
  log(`recording ${name}`)
}
// The home page shows a project once setup creates one: look again until it does.
const home = setInterval(async () => {
  const p = pages.board.page
  if (new URL(p.url()).pathname === "/") await p.reload().catch(() => {})
}, 4000)
const stop = async () => {
  clearInterval(home)
  for (const [name, { ctx, page }] of Object.entries(pages)) {
    const v = page.video(); await ctx.close(); copyFileSync(await v.path(), `/out/${name}.webm`); log(`saved ${name}`)
  }
  await browser.close(); process.exit(0)
}
process.on("SIGTERM", stop); process.on("SIGINT", stop)
