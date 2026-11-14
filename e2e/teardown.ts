// After the run: convert the videos the tests saved (e2e/videos/raw) to MP4 in e2e/videos/, which play on phones, and
// remove the temp data folder.
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"

const root = path.resolve(import.meta.dirname, "..")

export default function teardown() {
  const raw = path.join(root, "e2e", "videos", "raw")
  if (fs.existsSync(raw)) {
    for (const file of fs.readdirSync(raw).filter((f) => f.endsWith(".webm"))) {
      const out = path.join(root, "e2e", "videos", file.replace(/\.webm$/, ".mp4"))
      try {
        execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(raw, file), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", out])
      } catch (error) {
        console.warn(`Couldn't convert ${file}: ${String(error)}`)
      }
    }
    fs.rmSync(raw, { recursive: true, force: true })
  }
  const data = process.env.CELLO_E2E_DATA
  if (data && data.includes("cello-e2e-")) fs.rmSync(data, { recursive: true, force: true })
}
