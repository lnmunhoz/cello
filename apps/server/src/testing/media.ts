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

/**
 * An `ffmpeg` in `dir` that never finishes, for shutdown tests (CEL-17). `started()` resolves with its
 * pid once it runs: the script writes its pid into a FIFO, which blocks until the test reads it.
 */
export const writeHungFfmpeg = (dir: string) => {
  const fifo = path.join(dir, "ffmpeg-started")
  const mkfifo = Bun.spawnSync(["mkfifo", fifo])
  if (mkfifo.exitCode !== 0) throw new Error(`mkfifo failed: ${mkfifo.stderr.toString()}`)
  const bin = path.join(dir, "ffmpeg")
  fs.writeFileSync(bin, `#!/bin/sh\necho $$ > '${fifo}'\nexec sleep 600\n`, { mode: 0o755 })
  return { bin, started: () => fs.promises.readFile(fifo, "utf8").then((pid) => Number(pid.trim())) }
}
