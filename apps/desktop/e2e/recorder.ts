// Videos and screenshots of the whole main window. Playwright records one page at a time, but the
// window is three web contents side by side (board, panel toolbar, panel page), so each frame is
// put together in the main process: every visible view's capture is copied in at its bounds.
// Frames are JPEGs with timestamps; ffmpeg turns them into an MP4 with captions burned in.
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { ElectronApplication } from "@playwright/test"

/** Composes the window at `scale` (1 for video frames, 2 for sharp screenshots); runs in the main process. */
const composeWindow = async (
  { BaseWindow, nativeImage }: typeof Electron.CrossProcessExports,
  { scale, format }: { scale: number; format: "jpeg" | "png" },
): Promise<string | null> => {
  const window = BaseWindow.getAllWindows()[0]
  if (!window || window.isDestroyed()) return null
  const content = window.getContentBounds()
  const width = content.width * scale
  const height = content.height * scale
  const frame = Buffer.alloc(width * height * 4)
  for (const view of window.contentView.children) {
    const contents = (view as Electron.WebContentsView).webContents
    const bounds = view.getBounds()
    if (!contents || contents.isDestroyed() || !view.getVisible() || bounds.width <= 0 || bounds.height <= 0) continue
    const image = (await contents.capturePage()).resize({ width: bounds.width * scale, height: bounds.height * scale })
    const size = image.getSize()
    const bitmap = image.toBitmap()
    const x = bounds.x * scale
    const y = bounds.y * scale
    const copyWidth = Math.min(size.width, width - x)
    for (let row = 0; row < size.height && y + row < height; row++) {
      bitmap.copy(frame, ((y + row) * width + x) * 4, row * size.width * 4, (row * size.width + copyWidth) * 4)
    }
  }
  const image = nativeImage.createFromBitmap(frame, { width, height })
  return (format === "png" ? image.toPNG() : image.toJPEG(82)).toString("base64")
}

/** Saves a PNG of the whole window (at 2x, as the screen shows it). */
export const screenshotWindow = async (app: ElectronApplication, file: string) => {
  const png = await app.evaluate(composeWindow, { scale: 2, format: "png" as const })
  if (!png) throw new Error("No window to capture")
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, Buffer.from(png, "base64"))
}

export interface Recording {
  /** Captures the window as it is (the previous step's result), then shows `text` until the next caption. */
  readonly caption: (text: string) => Promise<void>
  /** Captures the final state, stops, and writes the MP4. */
  readonly stop: () => Promise<void>
}

/** The captions' font: San Francisco on macOS (it has the ⌘ glyph), DejaVu Sans in the Docker image. */
const FONT = process.platform === "darwin" ? "/System/Library/Fonts/SFNS.ttf" : "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

/** Each step's result stays on screen this long in the video, so a fast test is still watchable. */
const HOLD_SECONDS = 1.2

/**
 * Records the main window until `stop`. A frame is taken at every caption (so each step's result
 * is in the video however fast the test runs), and others in between as fast as they compose.
 * Time runs as in the test, except that each step's last frame is held for HOLD_SECONDS.
 */
export const recordWindow = (app: ElectronApplication, out: string): Recording => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-desktop-frames-"))
  const started = Date.now()
  const now = () => (Date.now() - started) / 1000
  const frames: Array<{ file: string; at: number }> = []
  const captions: Array<{ text: string; at: number }> = []
  let running = true
  let closed = false
  app.once("close", () => (closed = true))

  // A frame can fail while a view navigates or before the window exists; it's skipped.
  let taken = 0
  const capture = async () => {
    const file = path.join(dir, `${String(taken++).padStart(5, "0")}.jpg`)
    const jpeg = await app.evaluate(composeWindow, { scale: 1, format: "jpeg" as const }).catch(() => null)
    if (!jpeg) return
    fs.writeFileSync(file, Buffer.from(jpeg, "base64"))
    frames.push({ file, at: now() })
  }
  const loop = (async () => {
    while (running && !closed) await capture()
  })()

  const encode = (end: number) => {
    if (frames.length === 0) return
    frames.sort((a, b) => a.at - b.at)
    const offset = frames[0]!.at
    // A hold at each new caption (showing the step before it) and one at the end.
    const holds = [...captions.slice(1).map((caption) => caption.at), end]
    const videoTime = (t: number) => Math.max(0, t - offset + holds.filter((hold) => hold <= t).length * HOLD_SECONDS)
    const list = frames.flatMap((frame, i) => {
      const next = frames[i + 1]?.at
      const held = holds.filter((hold) => hold >= frame.at && (next === undefined || hold < next)).length * HOLD_SECONDS
      return [`file '${frame.file}'`, `duration ${((next ?? end) - frame.at + held).toFixed(3)}`]
    })
    list.push(`file '${frames.at(-1)!.file}'`)
    fs.writeFileSync(path.join(dir, "frames.txt"), `ffconcat version 1.0\n${list.join("\n")}\n`)
    const text = captions.map((caption, i) => {
      const file = path.join(dir, `caption-${i}.txt`)
      fs.writeFileSync(file, caption.text)
      const from = videoTime(caption.at)
      const to = videoTime(captions[i + 1]?.at ?? end)
      return `drawtext=fontfile=${FONT}:textfile=${file}:expansion=none:fontsize=24:fontcolor=white:box=1:boxcolor=0x141418@0.88:boxborderw=12:x=(w-text_w)/2:y=h-text_h-40:enable='between(t,${from.toFixed(2)},${to.toFixed(2)})'`
    })
    const filters = [...text, "scale=trunc(iw/2)*2:trunc(ih/2)*2", "format=yuv420p"].join(",")
    fs.mkdirSync(path.dirname(out), { recursive: true })
    execFileSync("ffmpeg", [
      "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(dir, "frames.txt"),
      "-vf", filters, "-r", "25", "-c:v", "libx264", "-crf", "23", "-movflags", "+faststart", "-an", out,
    ])
  }

  return {
    caption: async (text) => {
      if (!closed) await capture()
      captions.push({ text, at: now() })
    },
    stop: async () => {
      running = false
      await loop
      if (!closed) await capture()
      try {
        encode(now())
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    },
  }
}
