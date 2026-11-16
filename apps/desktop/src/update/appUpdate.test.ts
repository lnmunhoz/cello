import { describe, expect, it } from "vitest"
import { INSTALLED_APP } from "../install/plan.ts"
import { appNotice, boardNotice, bundleOf, relaunchOptions, restartTarget, stampFile, type UpdateFacts } from "./appUpdate.ts"

const INSTALLED_EXEC = "/Applications/Cello.app/Contents/MacOS/Cello"
const DIST = "/Users/me/projects/cello/apps/desktop/dist/mac-arm64/Cello.app"

const facts = (overrides: Partial<UpdateFacts> = {}): UpdateFacts => ({
  execPath: INSTALLED_EXEC,
  bundle: INSTALLED_APP,
  loaded: '{"builtAt":"2026-11-15T10:54:00.000Z"}',
  onDisk: '{"builtAt":"2026-11-15T10:54:00.000Z"}',
  installed: INSTALLED_APP,
  installedExists: true,
  ...overrides,
})

describe("bundleOf", () => {
  it("is the app bundle a packaged app's executable sits in, and null for a bare Electron (dev, tests)", () => {
    expect(bundleOf(INSTALLED_EXEC)).toBe(INSTALLED_APP)
    expect(bundleOf(`${DIST}/Contents/MacOS/Cello`)).toBe(DIST)
    expect(bundleOf("/repo/node_modules/electron/dist/electron")).toBeNull()
  })
})

describe("stampFile", () => {
  it("reads the packaged app's stamp beside app.asar, never inside it (Electron keeps the old archive open)", () => {
    expect(stampFile({ isPackaged: true, resourcesPath: `${INSTALLED_APP}/Contents/Resources`, appPath: "ignored" })).toBe(
      `${INSTALLED_APP}/Contents/Resources/build.json`,
    )
  })

  it("reads dev's stamp from dist-electron, which a rebuild rewrites", () => {
    expect(stampFile({ isPackaged: false, resourcesPath: "ignored", appPath: "/repo/apps/desktop" })).toBe("/repo/apps/desktop/dist-electron/build.json")
  })
})

describe("appNotice", () => {
  it("says nothing while the app runs the build on disk, from /Applications", () => {
    expect(appNotice(facts())).toBeNull()
  })

  it("offers a restart when another build replaced the one the app loaded", () => {
    expect(appNotice(facts({ onDisk: '{"builtAt":"2026-11-16T05:00:00.000Z"}' }))).toEqual({
      kind: "updated",
      key: 'updated:{"builtAt":"2026-11-16T05:00:00.000Z"}',
      restartInto: INSTALLED_EXEC,
    })
  })

  it("waits while the bundle is being replaced (no stamp on disk yet), and can't tell without a stamp at launch", () => {
    expect(appNotice(facts({ onDisk: null }))).toBeNull()
    expect(appNotice(facts({ loaded: null, onDisk: '{"builtAt":"x"}' }))).toBeNull()
  })

  it("offers a restart from /Applications when the app runs from a build folder and an installed copy exists", () => {
    const running = facts({ execPath: `${DIST}/Contents/MacOS/Cello`, bundle: DIST })
    expect(appNotice(running)).toEqual({ kind: "elsewhere", key: `elsewhere:${DIST}`, running: DIST, restartInto: INSTALLED_EXEC })
  })

  it("restarts a build-folder copy that was rebuilt into /Applications' copy, not into itself", () => {
    const running = facts({ execPath: `${DIST}/Contents/MacOS/Cello`, bundle: DIST, onDisk: '{"builtAt":"new"}' })
    expect(appNotice(running)).toEqual({ kind: "updated", key: 'updated:{"builtAt":"new"}', restartInto: INSTALLED_EXEC })
  })

  it("leaves a build-folder copy alone when nothing is installed, and dev (no bundle) alone always", () => {
    expect(appNotice(facts({ execPath: `${DIST}/Contents/MacOS/Cello`, bundle: DIST, installedExists: false }))).toBeNull()
    expect(appNotice(facts({ execPath: "/repo/node_modules/electron/dist/electron", bundle: null }))).toBeNull()
  })

  it("restarts dev into itself when its build changed", () => {
    const dev = facts({ execPath: "/repo/node_modules/electron/dist/electron", bundle: null, onDisk: '{"builtAt":"new"}' })
    expect(appNotice(dev)?.restartInto).toBe("/repo/node_modules/electron/dist/electron")
  })
})

describe("boardNotice", () => {
  it("tells the board what to show, not which executable main will start", () => {
    expect(boardNotice({ kind: "updated", key: "updated:x", restartInto: INSTALLED_EXEC })).toEqual({ kind: "updated", key: "updated:x" })
    expect(boardNotice({ kind: "elsewhere", key: `elsewhere:${DIST}`, running: DIST, restartInto: INSTALLED_EXEC })).toEqual({
      kind: "elsewhere",
      key: `elsewhere:${DIST}`,
      running: DIST,
    })
  })
})

describe("restartTarget", () => {
  const exists = (present: readonly string[]) => (file: string) => present.includes(file)

  it("is the notice's executable, or the running one without a notice", () => {
    const notice = appNotice(facts({ execPath: `${DIST}/Contents/MacOS/Cello`, bundle: DIST }))
    expect(restartTarget(notice, `${DIST}/Contents/MacOS/Cello`, exists([INSTALLED_EXEC]))).toBe(INSTALLED_EXEC)
    expect(restartTarget(null, INSTALLED_EXEC, exists([INSTALLED_EXEC]))).toBe(INSTALLED_EXEC)
  })

  it("is null while that executable is missing (an install halfway through replacing it): don't quit into nothing", () => {
    expect(restartTarget(null, INSTALLED_EXEC, exists([]))).toBeNull()
  })
})

describe("relaunchOptions", () => {
  it("keeps the launch arguments when restarting the same executable (dev runs electron with the app folder), not a link it was launched with", () => {
    // argv[0] is the path as launched (a symlink in node_modules); execPath is where it really is.
    const execPath = "/repo/node_modules/.bun/electron@44/node_modules/electron/dist/electron"
    const argv = ["/repo/node_modules/electron/dist/electron", "--no-sandbox", "/repo/apps/desktop", "cello://CEL-3"]
    expect(relaunchOptions(execPath, { execPath, argv })).toEqual({ execPath, args: ["--no-sandbox", "/repo/apps/desktop"] })
  })

  it("starts /Applications' copy bare, without the arguments another copy was started with", () => {
    const execPath = `${DIST}/Contents/MacOS/Cello`
    expect(relaunchOptions(INSTALLED_EXEC, { execPath, argv: [execPath, "cello://CEL-3"] })).toEqual({ execPath: INSTALLED_EXEC, args: [] })
  })
})
