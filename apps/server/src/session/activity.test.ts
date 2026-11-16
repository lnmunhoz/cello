// What an agent is doing besides its last tool call (CEL-133): the background work it started, and
// whether a stop finishes it or leaves it waiting on that work.
import { describe, expect, it } from "vitest"
import { type BackgroundWork, MAX_BACKGROUND, parseBackground, parseWaiting, stopOutcome, withBackground } from "./activity.ts"

const e2e = { id: "blo3xolgq", label: "Bash · bun run test:e2e -- e2e/agents-page.spec.ts", toolUseId: "toolu_1" }
const monitor = { id: "bpz2edzeb", label: "Monitor · review-mode e2e run finishing", toolUseId: "toolu_2" }

describe("withBackground", () => {
  it("adds background work once, by its id, newest last, keeping the latest MAX_BACKGROUND", () => {
    expect(withBackground([e2e], monitor)).toEqual([e2e, monitor])
    expect(withBackground([e2e, monitor], { ...e2e, label: "again" })).toEqual([monitor, { ...e2e, label: "again" }])
    const many = Array.from({ length: MAX_BACKGROUND + 3 }, (_, i) => ({ id: `b${i}`, label: `Bash · ${i}`, toolUseId: null }))
    const kept = many.reduce<ReadonlyArray<BackgroundWork>>((list, work) => withBackground(list, work), [])
    expect(kept).toHaveLength(MAX_BACKGROUND)
    expect(kept.at(-1)?.id).toBe(`b${MAX_BACKGROUND + 2}`)
  })
})

describe("stopOutcome: does a stop finish the agent?", () => {
  it("leaves it waiting while work it started itself is still running, naming that work", () => {
    expect(stopOutcome([e2e, monitor], ["bpz2edzeb", "other-agents-shell"])).toEqual({
      finished: false,
      background: [monitor],
      waitingOn: ["Monitor · review-mode e2e run finishing"],
    })
  })

  it("finishes it when none of its own work is still running, whatever else the session runs", () => {
    expect(stopOutcome([e2e], ["the-parents-inbox-wait"])).toEqual({ finished: true, background: [], waitingOn: null })
    expect(stopOutcome([], [])).toEqual({ finished: true, background: [], waitingOn: null })
  })

  it("finishes it when Claude Code didn't say what runs (an older version): as before", () => {
    expect(stopOutcome([e2e], undefined)).toEqual({ finished: true, background: [], waitingOn: null })
  })
})

describe("parseBackground and parseWaiting", () => {
  it("read the stored lists, and anything they can't read as none", () => {
    expect(parseBackground(JSON.stringify([e2e, monitor]))).toEqual([e2e, monitor])
    expect(parseBackground(null)).toEqual([])
    expect(parseBackground("not json")).toEqual([])
    expect(parseBackground(JSON.stringify([{ id: 3 }, e2e, "x"]))).toEqual([e2e])
    expect(parseWaiting(JSON.stringify(["Bash · x"]))).toEqual(["Bash · x"])
    expect(parseWaiting(JSON.stringify([]))).toBeNull()
    expect(parseWaiting("{")).toBeNull()
  })
})
