// Renders an asciinema v2 cast to a 1920x1080 MP4 with xterm.js in headless Chromium, at the cast's own timing.
// node render-cast.mjs <in.cast> <out.webm-dir> [fontSize]
import { chromium } from "playwright"
import { readFileSync, copyFileSync } from "node:fs"
const [cast, out, fontSize = "26"] = process.argv.slice(2)
const lines = readFileSync(cast, "utf8").trim().split("\n")
const header = JSON.parse(lines[0])
const events = lines.slice(1).map((l) => JSON.parse(l)).filter((e) => e[1] === "o")
const css = readFileSync("/opt/recorder/node_modules/@xterm/xterm/css/xterm.css", "utf8")
const js = readFileSync("/opt/recorder/node_modules/@xterm/xterm/lib/xterm.js", "utf8")
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: "/tmp/cast-rec", size: { width: 1920, height: 1080 } } })
const page = await ctx.newPage()
await page.setContent(`<!doctype html><html><head><style>${css}
  body{margin:0;background:#fbf8f3;height:100vh;display:grid;place-items:center;font-family:Inter,sans-serif}
  .win{background:#16161a;border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.25);padding:18px 26px 26px;}
  .bar{display:flex;gap:9px;margin:0 0 16px} .bar i{width:14px;height:14px;border-radius:50%;background:#3a3a40;display:block}
  .bar span{color:#8a8a92;font-size:17px;margin-left:14px}
</style></head><body><div class="win"><div class="bar"><i></i><i></i><i></i><span>~/acme-shop</span></div><div id="t"></div></div>
<script>${js}</script></body></html>`)
await page.evaluate(({ cols, rows, fontSize }) => {
  window.term = new Terminal({ cols, rows, fontSize, fontFamily: "DejaVu Sans Mono, monospace", lineHeight: 1.15,
    theme: { background: "#16161a", foreground: "#e8e6e3", cursor: "#ff7a2e" }, cursorBlink: false })
  window.term.open(document.getElementById("t"))
}, { cols: header.width, rows: header.height, fontSize: Number(fontSize) })
await page.evaluate((events) => new Promise((done) => {
  const start = performance.now()
  let i = 0
  const tick = () => {
    const t = (performance.now() - start) / 1000
    while (i < events.length && events[i][0] <= t) window.term.write(events[i++][2])
    if (i < events.length) requestAnimationFrame(tick); else setTimeout(done, 1500)
  }
  tick()
}), events)
const v = page.video(); await ctx.close(); copyFileSync(await v.path(), out); await browser.close()
console.log("rendered", out, events.at(-1)?.[0], "s")
