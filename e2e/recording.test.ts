import { describe, expect, it } from "vitest"
import { cropFor, holdMs, isReview, slowMo, testTimeoutMs, VIDEO_SIZE, videoSizeOf } from "./recording.ts"

describe("review recording switches", () => {
  it("is off unless CELLO_E2E_REVIEW=1, and then holds each state about 1.5 s", () => {
    expect(isReview({})).toBe(false)
    expect(holdMs({})).toBe(0)
    expect(isReview({ CELLO_E2E_REVIEW: "1" })).toBe(true)
    expect(holdMs({ CELLO_E2E_REVIEW: "1" })).toBe(1500)
    expect(holdMs({ CELLO_E2E_REVIEW: "0" })).toBe(0)
  })

  it("slows the browser down in review mode, and CELLO_E2E_SLOWMO still wins when set", () => {
    expect(slowMo({})).toBe(0)
    expect(slowMo({ CELLO_E2E_SLOWMO: "250" })).toBe(250)
    expect(slowMo({ CELLO_E2E_REVIEW: "1" })).toBe(400)
    expect(slowMo({ CELLO_E2E_REVIEW: "1", CELLO_E2E_SLOWMO: "600" })).toBe(600)
  })

  it("gives each test longer in review mode, where every caption holds 3 s and every action waits 400 ms", () => {
    expect(testTimeoutMs({})).toBe(30_000)
    expect(testTimeoutMs({ CELLO_E2E_REVIEW: "1" })).toBe(300_000)
  })
})

describe("cropFor", () => {
  it("leaves a video alone when the page filled it", () => {
    expect(cropFor([VIDEO_SIZE])).toBeNull()
    expect(cropFor([])).toBeNull()
    expect(cropFor([null])).toBeNull()
  })

  it("crops to a smaller viewport, so the MP4 has no grey padding around a phone-width page", () => {
    expect(cropFor([{ width: 390, height: 844 }])).toEqual({ width: 390, height: 844 })
    expect(cropFor([{ width: 1440, height: 600 }])).toEqual({ width: 1440, height: 600 })
  })

  it("keeps even sizes, which H.264 needs", () => {
    expect(cropFor([{ width: 375, height: 667 }])).toEqual({ width: 374, height: 666 })
  })

  it("keeps the largest size a test used, when it changed the viewport midway", () => {
    expect(cropFor([{ width: 1000, height: 700 }, { width: 390, height: 844 }])).toEqual({ width: 1000, height: 844 })
    expect(cropFor([VIDEO_SIZE, { width: 390, height: 844 }])).toBeNull()
  })

  it("follows Playwright's scaling when the page was bigger than the video", () => {
    // 1440×1560 is scaled by 900/1560 to fit the 900 px height: 830.8 px wide.
    expect(cropFor([{ width: 1440, height: 1560 }])).toEqual({ width: 830, height: 900 })
  })
})

describe("videoSizeOf", () => {
  it("is the size a spec gave its video, so a 1920×1080 spec isn't cropped as if it were 1440×900", () => {
    expect(videoSizeOf({ mode: "on", size: { width: 1920, height: 1080 } })).toEqual({ width: 1920, height: 1080 })
    expect(cropFor([{ width: 1920, height: 1080 }], videoSizeOf({ mode: "on", size: { width: 1920, height: 1080 } }))).toBeNull()
  })

  it("is the usual size when the spec gave none", () => {
    expect(videoSizeOf("on")).toEqual(VIDEO_SIZE)
    expect(videoSizeOf({ mode: "on" })).toEqual(VIDEO_SIZE)
  })
})
