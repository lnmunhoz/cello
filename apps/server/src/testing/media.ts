// Real evidence files for tests: a PNG, an MP4 made with ffmpeg, a text file, and a sparse file of
// any size.
import * as fs from "node:fs"
import * as path from "node:path"

/** A 2×2 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAEklEQVR4nGOMzrzAwMDAwgAGABKzAZrvMEpfAAAAAElFTkSuQmCC",
  "base64",
)

export const writePng = (dir: string, name = "screenshot.png") => {
  const file = path.join(dir, name)
  fs.writeFileSync(file, PNG)
  return file
}

export const writeText = (dir: string, name: string, text: string) => {
  const file = path.join(dir, name)
  fs.writeFileSync(file, text)
  return file
}

/** A file of `bytes` that takes no disk space, for size limits. */
export const writeSparse = (dir: string, name: string, bytes: number) => {
  const file = path.join(dir, name)
  fs.writeFileSync(file, "")
  fs.truncateSync(file, bytes)
  return file
}

/**
 * A real MP4 (a test pattern), made with ffmpeg. VP9 in MP4 plays in Playwright's Chromium, which has
 * no H.264; `codec: "h264"` makes the kind screen recorders write.
 */
export const writeMp4 = (dir: string, name = "demo.mp4", options: { readonly seconds?: number; readonly codec?: "vp9" | "h264" } = {}) => {
  const file = path.join(dir, name)
  const codec = options.codec === "h264"
    ? ["-c:v", "libx264", "-pix_fmt", "yuv420p"]
    : ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-b:v", "0", "-crf", "45", "-pix_fmt", "yuv420p"]
  const result = Bun.spawnSync([
    "ffmpeg", "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", `testsrc=duration=${options.seconds ?? 2}:size=320x180:rate=25`,
    ...codec, "-movflags", "+faststart", file,
  ])
  if (result.exitCode !== 0) throw new Error(`ffmpeg couldn't make ${name}: ${result.stderr.toString()}`)
  return file
}
