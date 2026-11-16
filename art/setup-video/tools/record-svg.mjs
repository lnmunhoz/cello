// Records the README's animated SVGs as 1920x1080 video, headless (no window).
// Usage: bun art/setup-video/tools/record-svg.mjs
import { chromium } from "@playwright/test";
import { readFileSync, renameSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
const root = new URL("../../../", import.meta.url).pathname;
const out = root + "art/setup-video/footage/";
const tmp = out + ".raw/"; mkdirSync(tmp, { recursive: true });
const shots = [
  { name: "banner", svg: "docs/readme/banner.svg", secs: 9 },
  { name: "architecture", svg: "docs/readme/architecture-light.svg", secs: 12 },
  { name: "loop", svg: "docs/readme/loop-light.svg", secs: 12 },
];
const browser = await chromium.launch();
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: tmp, size: { width: 1920, height: 1080 } } });
  const page = await ctx.newPage();
  const svg = readFileSync(root + s.svg, "utf8");
  await page.setContent(`<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#fbf8f3">
    <div style="width:${s.name === "banner" ? 1800 : 1500}px;max-height:1020px;display:grid;place-items:center">${svg.replace(/<svg /, '<svg style="width:100%;height:auto;max-height:1020px" ')}</div></body></html>`);
  await page.waitForTimeout(s.secs * 1000);
  const v = page.video(); await ctx.close();
  const webm = await v.path();
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", "0.5", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", "-crf", "18", "-an", out + s.name + ".mp4"]);
  console.log("wrote", s.name);
}
await browser.close();
