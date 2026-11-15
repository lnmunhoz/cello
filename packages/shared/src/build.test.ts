import { describe, expect, it } from "vitest"
import { buildKey, buildLine, liveSince, reloadAction, sameBuild, shortCommit, type BuildStamp } from "./build.ts"

const A: BuildStamp = { version: "0.2.0", commit: "c602f25", builtAt: 1_000 }
const B: BuildStamp = { version: "0.2.0", commit: "9afd602", builtAt: 2_000 }

describe("whether two web builds are the same", () => {
  it("compares version, commit and build time", () => {
    expect(sameBuild(A, { ...A })).toBe(true)
    expect(sameBuild(A, B)).toBe(false)
    // Rebuilt at the same commit (uncommitted changes, a new dependency): a different bundle.
    expect(sameBuild(A, { ...A, builtAt: 1_001 })).toBe(false)
    expect(sameBuild(A, { ...A, version: "0.3.0" })).toBe(false)
    expect(sameBuild({ ...A, commit: null }, { ...A, commit: null })).toBe(true)
  })

  it("keys a build by all three, for remembering one", () => {
    expect(buildKey(A)).toBe("0.2.0+c602f25.1000")
    expect(buildKey({ ...A, commit: null })).toBe("0.2.0+dev.1000")
  })
})

describe("what a tab does when it hears the server's build", () => {
  const idle = { editing: false, reloadedFor: null }

  it("nothing while the server serves the build the tab loaded", () => {
    expect(reloadAction({ loaded: A, served: { ...A }, ...idle })).toBe("none")
  })

  it("nothing when the server serves no web app (dev: Vite serves it and reloads by itself) or the tab has no stamp", () => {
    expect(reloadAction({ loaded: A, served: null, ...idle })).toBe("none")
    expect(reloadAction({ loaded: null, served: B, ...idle })).toBe("none")
  })

  it("reloads by itself when the build differs and nothing is being edited", () => {
    expect(reloadAction({ loaded: A, served: B, ...idle })).toBe("reload")
  })

  it("only offers the reload while something is being edited", () => {
    expect(reloadAction({ loaded: A, served: B, editing: true, reloadedFor: null })).toBe("offer")
  })

  it("only offers it when a reload for this build already happened and didn't bring it in, so it never loops", () => {
    expect(reloadAction({ loaded: A, served: B, editing: false, reloadedFor: buildKey(B) })).toBe("offer")
    // An older reload, for another build, doesn't count.
    expect(reloadAction({ loaded: A, served: B, editing: false, reloadedFor: buildKey({ ...B, builtAt: 1_500 }) })).toBe("reload")
  })
})

describe("the running build as one line", () => {
  const at = (day: number, hours: number, minutes: number) => new Date(2026, 10, day, hours, minutes).getTime()

  it("names the version, the short commit and when the server started, in local time", () => {
    expect(buildLine({ version: "0.2.0", commit: "c602f25a1b2", startedAt: at(15, 18, 19) }, at(15, 21, 0))).toBe(
      "Cello 0.2.0 · build c602f25 · live since 18:19",
    )
  })

  it("adds the day when the server started on another day", () => {
    expect(liveSince(at(14, 9, 5), at(15, 8, 0))).toBe("Nov 14, 09:05")
    expect(liveSince(at(15, 9, 5), at(15, 8, 0))).toBe("09:05")
  })

  it("says dev for a build without a commit (outside a git checkout)", () => {
    expect(shortCommit(null)).toBe("dev")
    expect(shortCommit("9afd6021234")).toBe("9afd602")
  })
})
