// After the run: convert the videos the tests saved (e2e/videos/raw) to MP4 in e2e/videos/, which play on phones, and
// remove the temp data folder. A video whose page was smaller than the video (a phone width) has a `.crop.json`
// beside it from the fixture, and is cropped to the page, so the MP4 has no grey padding.
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"

const root = path.resolve(import.meta.dirname, "..")

export default function teardown() {
  const raw = path.join(root, "e2e", "videos", "raw")
  if (fs.existsSync(raw)) {
    for (const file of fs.readdirSync(raw).filter((f) => f.endsWith(".webm"))) {
      const out = path.join(root, "e2e", "videos", file.replace(/\.webm$/, ".mp4"))
      const cropFile = path.join(raw, file.replace(/\.webm$/, ".crop.json"))
      const crop = fs.existsSync(cropFile) ? (JSON.parse(fs.readFileSync(cropFile, "utf8")) as { width: number; height: number }) : null
      const filter = crop ? ["-vf", `crop=${crop.width}:${crop.height}:0:0`] : []
      try {
        execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(raw, file), ...filter, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", out])
      } catch (error) {
        console.warn(`Couldn't convert ${file}: ${String(error)}`)
      }
    }
    fs.rmSync(raw, { recursive: true, force: true })
  }
  const data = process.env.CELLO_E2E_DATA
  if (data && data.includes("cello-e2e-")) fs.rmSync(data, { recursive: true, force: true })
}
