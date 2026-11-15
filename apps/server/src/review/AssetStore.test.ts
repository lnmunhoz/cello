import * as path from "node:path"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { isAlive } from "../process/isAlive.ts"
import { writeHungFfmpeg, writeText } from "../testing/media.ts"
import { tempDataDir } from "../testing/tempDir.ts"
import * as AssetStore from "./AssetStore.ts"

describe("AssetStore.poster", () => {
  // CEL-17: a stuck ffmpeg must never hold up a submit or a shutdown.
  it.live("kills an ffmpeg that runs past the timeout, and the video gets no poster", () =>
    Effect.gen(function* () {
      const dir = yield* tempDataDir
      const ffmpeg = writeHungFfmpeg(dir)
      const store = AssetStore.make({ dir: path.join(dir, "assets"), ffmpeg: ffmpeg.bin, posterTimeoutMs: 50 })
      // Nobody reads its FIFO here, so each of the two tries hangs until it's killed.
      expect(yield* Effect.scoped(store.poster(writeText(dir, "flow.mp4", "not a video")))).toBeNull()
    }))

  it.live("kills ffmpeg when interrupted", () =>
    Effect.gen(function* () {
      const dir = yield* tempDataDir
      const ffmpeg = writeHungFfmpeg(dir)
      const store = AssetStore.make({ dir: path.join(dir, "assets"), ffmpeg: ffmpeg.bin })
      const poster = yield* Effect.forkChild(Effect.scoped(store.poster(writeText(dir, "flow.mp4", "not a video"))))
      const pid = yield* Effect.promise(ffmpeg.started)
      yield* Fiber.interrupt(poster)
      expect(isAlive(pid)).toBe(false)
    }))
})
