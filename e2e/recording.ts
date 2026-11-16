// How the web e2e videos are recorded: their size, and the review mode (CELLO_E2E_REVIEW=1) that
// makes them slow enough to follow. Review mode is a recording aid, off by default: tests never wait
// on it, and with it off nothing here adds a single millisecond to a run.

type Env = Readonly<Record<string, string | undefined>>

/** Every test's video is this size (playwright.config.ts); a smaller page is cropped to fit in teardown. */
export const VIDEO_SIZE = { width: 1440, height: 900 } as const

const REVIEW_SLOWMO_MS = 400
const REVIEW_HOLD_MS = 1500

export const isReview = (env: Env): boolean => env.CELLO_E2E_REVIEW === "1"

/** Playwright's slowMo: CELLO_E2E_SLOWMO when set, else 400 ms in review mode, else none. */
export const slowMo = (env: Env): number =>
  env.CELLO_E2E_SLOWMO ? Number(env.CELLO_E2E_SLOWMO) : isReview(env) ? REVIEW_SLOWMO_MS : 0

/** How long a review video holds each state: after a step's caption shows, around reloads, and at the end. */
export const holdMs = (env: Env): number => (isReview(env) ? REVIEW_HOLD_MS : 0)

/**
 * Playwright's per-test timeout: the usual 30 s, or 5 minutes in review mode, where every caption
 * holds the screen twice and every action waits, so a long walkthrough runs minutes by design.
 */
export const testTimeoutMs = (env: Env): number => (isReview(env) ? 300_000 : 30_000)

interface Size {
  readonly width: number
  readonly height: number
}

const even = (n: number) => n - (n % 2)

/**
 * The part of the video a page filled, or null when it filled all of it. Playwright draws a page
 * smaller than the video in its top-left corner with grey around it, and scales a bigger one down
 * to fit. A test that changed the viewport midway keeps the largest size it used. Sizes are even,
 * as H.264 needs.
 */
export const cropFor = (viewports: ReadonlyArray<Size | null>, video: Size = VIDEO_SIZE): Size | null => {
  const sizes = viewports.filter((size): size is Size => size !== null)
  if (sizes.length === 0) return null
  const width = Math.max(...sizes.map((size) => size.width))
  const height = Math.max(...sizes.map((size) => size.height))
  const scale = Math.min(1, video.width / width, video.height / height)
  const crop = { width: even(Math.round(width * scale)), height: even(Math.round(height * scale)) }
  return crop.width >= video.width && crop.height >= video.height ? null : crop
}

/** Playwright's `video` option, as a spec or the config sets it. */
type VideoOption = string | { readonly mode: string; readonly size?: Size }

/** The size of the video Playwright records for `video`: the spec's own when it gave one, else VIDEO_SIZE. */
export const videoSizeOf = (video: VideoOption): Size => (typeof video === "object" && video.size ? video.size : VIDEO_SIZE)
