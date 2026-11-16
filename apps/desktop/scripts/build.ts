// Bundles the app into dist-electron/: the main process and both preloads as single CommonJS files
// (sandboxed preloads can't load other modules), and the panel toolbar page.
import * as fs from "node:fs"
import * as path from "node:path"
import { STAMP_FILE } from "../src/update/appUpdate.ts"
import { desktopDir, electronBinary } from "./electron.ts"

const src = path.join(desktopDir, "src")
const out = path.join(desktopDir, "dist-electron")
fs.rmSync(out, { recursive: true, force: true })

const bundle = async (entry: string, name: string, target: "node" | "browser") => {
  const result = await Bun.build({
    entrypoints: [path.join(src, entry)],
    outdir: out,
    naming: name,
    target,
    format: target === "node" ? "cjs" : "iife",
    external: ["electron"],
    sourcemap: "linked",
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    process.exit(1)
  }
}

await bundle("main.ts", "main.cjs", "node")
await bundle("preload.ts", "preload.cjs", "node")
await bundle("panel/chrome-preload.ts", "chrome-preload.cjs", "node")
await bundle("panel/chrome.ts", "chrome.js", "browser")
fs.copyFileSync(path.join(src, "panel/chrome.html"), path.join(out, "chrome.html"))
// Tells this build from the next: a running app compares it with the one on disk and offers a restart
// when they differ (src/update/appUpdate.ts). electron-builder also copies it beside app.asar.
const commit = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: desktopDir, stderr: "ignore" }).stdout.toString().trim()
fs.writeFileSync(path.join(out, STAMP_FILE), `${JSON.stringify({ builtAt: new Date().toISOString(), commit: commit || null })}\n`)
electronBinary()
console.log(`Built ${path.relative(process.cwd(), out) || out}`)
