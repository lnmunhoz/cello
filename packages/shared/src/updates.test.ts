import { describe, expect, it } from "vitest"
import {
  afterLaunch,
  compareVersions,
  dmgFor,
  dmgName,
  initialUpdateState,
  isPrerelease,
  newestFor,
  offerFor,
  parseReleases,
  parseUpdateCommand,
  parseUpdateSettings,
  parseVersion,
  releaseMark,
  shouldNotify,
  updateLine,
  updateReducer,
  type Release,
  type UpdateState,
} from "./updates.ts"

const release = (version: string, overrides: Partial<Release> = {}): Release => ({
  version,
  tag: `v${version}`,
  name: `Cello v${version}`,
  notes: `### Features\n\n- the ${version} things`,
  prerelease: version.includes("-"),
  publishedAt: Date.parse("2026-11-17T10:00:00Z"),
  url: `https://github.com/lnmunhoz/cello/releases/tag/v${version}`,
  assets: ["arm64", "x64"].flatMap((arch) => [
    { name: `Cello-v${version}-mac-${arch}.dmg`, url: `https://example.test/Cello-v${version}-mac-${arch}.dmg`, size: 1000 },
    { name: `Cello-v${version}-mac-${arch}.zip`, url: `https://example.test/Cello-v${version}-mac-${arch}.zip`, size: 900 },
  ]),
  ...overrides,
})

/** A GitHub API release object, as `GET /repos/o/r/releases` lists them. */
const github = (tag: string, overrides: Record<string, unknown> = {}) => ({
  tag_name: tag,
  name: `Cello ${tag}`,
  body: `Notes for ${tag}`,
  draft: false,
  prerelease: tag.includes("-"),
  published_at: "2026-11-17T10:00:00Z",
  html_url: `https://github.com/lnmunhoz/cello/releases/tag/${tag}`,
  assets: [{ name: `Cello-${tag}-mac-arm64.dmg`, browser_download_url: `https://example.test/${tag}.dmg`, size: 1234 }],
  ...overrides,
})

describe("versions", () => {
  it("parses versions with or without the v, prereleases included", () => {
    expect(parseVersion("v0.5.1")).toEqual({ major: 0, minor: 5, patch: 1, pre: [] })
    expect(parseVersion("0.6.0-beta.2")).toEqual({ major: 0, minor: 6, patch: 0, pre: ["beta", 2] })
    expect(parseVersion("1.2.3+build.5")).toEqual({ major: 1, minor: 2, patch: 3, pre: [] })
    expect(parseVersion("0.5")).toBeNull()
    expect(parseVersion("latest")).toBeNull()
    expect(parseVersion("01.2.3")).toBeNull()
  })

  it("orders them as semver does: a prerelease comes before its release", () => {
    const sorted = ["0.6.0", "0.5.1", "0.6.0-beta.10", "0.6.0-beta.2", "0.6.0-alpha.1", "0.6.0-beta", "1.0.0", "0.10.0"].sort(compareVersions)
    expect(sorted).toEqual(["0.5.1", "0.6.0-alpha.1", "0.6.0-beta", "0.6.0-beta.2", "0.6.0-beta.10", "0.6.0", "0.10.0", "1.0.0"])
    expect(compareVersions("v0.5.0", "0.5.0")).toBe(0)
  })

  it("tells a prerelease", () => {
    expect(isPrerelease("0.6.0-beta.1")).toBe(true)
    expect(isPrerelease("0.6.0")).toBe(false)
  })
})

describe("parseReleases", () => {
  it("reads GitHub's list: drafts and tags that aren't versions are left out, newest version first", () => {
    const releases = parseReleases([
      github("v0.5.0"),
      github("v0.6.0-beta.1"),
      github("v0.7.0", { draft: true }),
      github("nightly"),
      github("v0.5.1", { body: null, published_at: null }),
      "garbage",
    ])
    expect(releases.map((r) => r.version)).toEqual(["0.6.0-beta.1", "0.5.1", "0.5.0"])
    expect(releases[0]).toMatchObject({ tag: "v0.6.0-beta.1", prerelease: true, name: "Cello v0.6.0-beta.1", notes: "Notes for v0.6.0-beta.1" })
    expect(releases[1]).toMatchObject({ notes: "", publishedAt: null })
    expect(releases[2]!.assets).toEqual([{ name: "Cello-v0.5.0-mac-arm64.dmg", url: "https://example.test/v0.5.0.dmg", size: 1234 }])
  })

  it("is empty for anything that isn't a list (an error body, a rate-limit message)", () => {
    expect(parseReleases({ message: "API rate limit exceeded" })).toEqual([])
    expect(parseReleases(null)).toEqual([])
  })

  it("never treats a release GitHub marks as a prerelease as stable, whatever its tag", () => {
    expect(parseReleases([github("v0.5.2", { prerelease: true })])[0]!.prerelease).toBe(true)
  })
})

describe("channels", () => {
  const releases = [release("0.6.0-beta.2"), release("0.6.0-beta.1"), release("0.5.1"), release("0.5.0")]

  it("Stable takes only releases, Preview takes prereleases too", () => {
    expect(newestFor(releases, "stable")?.version).toBe("0.5.1")
    expect(newestFor(releases, "preview")?.version).toBe("0.6.0-beta.2")
  })

  it("Preview takes a stable release that's newer than every prerelease", () => {
    expect(newestFor([release("0.6.0"), ...releases], "preview")?.version).toBe("0.6.0")
  })

  it("a release tagged like a prerelease isn't stable even if GitHub forgot to mark it", () => {
    expect(newestFor([release("0.7.0-rc.1", { prerelease: false }), ...releases], "stable")?.version).toBe("0.5.1")
  })

  it("offers only a newer version on the running one's channel", () => {
    expect(offerFor("0.5.0", "stable", releases)?.version).toBe("0.5.1")
    expect(offerFor("0.5.1", "stable", releases)).toBeNull()
    expect(offerFor("0.5.1", "preview", releases)?.version).toBe("0.6.0-beta.2")
    expect(offerFor("0.6.0-beta.2", "preview", releases)).toBeNull()
    expect(offerFor("0.5.0", "stable", [])).toBeNull()
  })

  it("moving a preview build back to Stable offers the newest stable, older or not: a downgrade on purpose", () => {
    expect(offerFor("0.6.0-beta.2", "stable", releases)?.version).toBe("0.5.1")
  })

  it("marks each release for the Releases page: the running one, and newer ones on the channel as available", () => {
    expect(releaseMark(release("0.5.1"), "0.5.1", "stable")).toBe("running")
    expect(releaseMark(release("0.6.0-beta.2"), "0.5.1", "stable")).toBeNull()
    expect(releaseMark(release("0.6.0-beta.2"), "0.5.1", "preview")).toBe("available")
    expect(releaseMark(release("0.5.1"), "0.5.0", "stable")).toBe("available")
    expect(releaseMark(release("0.5.0"), "0.5.1", "stable")).toBeNull()
  })
})

describe("the DMG for this Mac", () => {
  it("names it as the release workflow does, and picks this architecture's", () => {
    expect(dmgName("0.5.1", "arm64")).toBe("Cello-v0.5.1-mac-arm64.dmg")
    expect(dmgFor(release("0.5.1"), "x64")?.name).toBe("Cello-v0.5.1-mac-x64.dmg")
    expect(dmgFor(release("0.5.1", { assets: [] }), "arm64")).toBeNull()
    expect(dmgFor(release("0.5.1"), "ia32")).toBeNull()
  })
})

describe("the update state", () => {
  const releases = [release("0.6.0-beta.1"), release("0.5.1"), release("0.5.0")]
  const start = (overrides: Partial<Parameters<typeof initialUpdateState>[0]> = {}): UpdateState =>
    initialUpdateState({ current: "0.5.0", arch: "arm64", settings: parseUpdateSettings(null), ...overrides })
  const at = 1_000

  it("starts unchecked: no claim about being up to date", () => {
    const state = start()
    expect(state).toMatchObject({ current: "0.5.0", channel: "stable", status: "up-to-date", checking: false, checkedAt: null, latest: null })
    expect(updateLine(state)).toBe("Cello 0.5.0 · Stable")
  })

  it("a check that finds nothing newer: up to date", () => {
    const state = updateReducer(updateReducer(start({ current: "0.5.1" }), { type: "check-started" }), { type: "checked", releases, at })
    expect(state).toMatchObject({ status: "up-to-date", checking: false, checkedAt: at, latest: null, error: null })
    expect(state.releases.map((r) => r.version)).toEqual(["0.6.0-beta.1", "0.5.1", "0.5.0"])
    expect(updateLine(state)).toBe("Cello 0.5.1 · Stable · up to date")
  })

  it("a check that finds a newer release: available, with its notes and this Mac's DMG", () => {
    const state = updateReducer(start(), { type: "checked", releases, at })
    expect(state.status).toBe("available")
    expect(state.latest).toMatchObject({ version: "0.5.1", asset: { name: "Cello-v0.5.1-mac-arm64.dmg" }, downgrade: false })
    expect(state.notes).toBe(release("0.5.1").notes)
    expect(updateLine(state)).toBe("Update available: 0.5.1")
  })

  it("downloading, then downloaded; a download for another version doesn't count", () => {
    let state = updateReducer(start(), { type: "checked", releases, at })
    state = updateReducer(state, { type: "download-started", version: "0.5.1" })
    expect(state).toMatchObject({ status: "downloading", progress: 0 })
    state = updateReducer(state, { type: "download-progress", version: "0.5.1", progress: 0.5 })
    expect(state.progress).toBe(0.5)
    expect(updateReducer(state, { type: "downloaded", version: "0.4.9" }).status).toBe("downloading")
    state = updateReducer(state, { type: "downloaded", version: "0.5.1" })
    expect(state).toMatchObject({ status: "downloaded", progress: null })
    expect(updateLine(state)).toBe("Update available: 0.5.1")
  })

  it("a failed download goes back to available and says why", () => {
    let state = updateReducer(start(), { type: "checked", releases, at })
    state = updateReducer(state, { type: "download-started", version: "0.5.1" })
    state = updateReducer(state, { type: "download-failed", version: "0.5.1", message: "disk full" })
    expect(state).toMatchObject({ status: "available", error: "Couldn't download 0.5.1: disk full", progress: null })
  })

  it("offline: fails quietly, keeping what it knew", () => {
    const failed = updateReducer(updateReducer(start(), { type: "check-started" }), { type: "check-failed", message: "offline", at })
    expect(failed).toMatchObject({ status: "error", checking: false, checkedAt: null, error: "offline" })
    expect(updateLine(failed)).toBe("Cello 0.5.0 · Stable")
    const known = updateReducer(updateReducer(start(), { type: "checked", releases, at }), { type: "check-failed", message: "offline", at: at + 1 })
    expect(known).toMatchObject({ status: "available", latest: { version: "0.5.1" }, error: "offline", checkedAt: at })
  })

  it("switching to Preview offers the newer prerelease from the releases it already has; back to Stable doesn't", () => {
    const checked = updateReducer(start({ current: "0.5.1" }), { type: "checked", releases, at })
    expect(checked.status).toBe("up-to-date")
    const preview = updateReducer(checked, { type: "channel", channel: "preview" })
    expect(preview).toMatchObject({ channel: "preview", status: "available", latest: { version: "0.6.0-beta.1" } })
    expect(updateLine(preview)).toBe("Update available: 0.6.0-beta.1")
    expect(updateReducer(preview, { type: "channel", channel: "stable" })).toMatchObject({ status: "up-to-date", latest: null })
  })

  it("a preview build switched to Stable is offered the newest stable, marked as a downgrade", () => {
    const state = updateReducer(updateReducer(start({ current: "0.6.0-beta.1" }), { type: "checked", releases, at }), { type: "channel", channel: "stable" })
    expect(state.latest).toMatchObject({ version: "0.5.1", downgrade: true })
    expect(updateLine(state)).toBe("Stable release: 0.5.1")
  })

  it("keeps the settings it's told about", () => {
    expect(updateReducer(start(), { type: "auto-download", on: false }).autoDownload).toBe(false)
    expect(start({ settings: parseUpdateSettings(JSON.stringify({ channel: "preview", autoDownload: false })) })).toMatchObject({ channel: "preview", autoDownload: false })
  })
})

describe("notify once per version", () => {
  const releases = [release("0.5.2"), release("0.5.1")]
  const checked = (notified: string | null, list = releases) =>
    updateReducer(initialUpdateState({ current: "0.5.0", arch: "arm64", settings: { ...parseUpdateSettings(null), notified } }), {
      type: "checked",
      releases: list,
      at: 1,
    })

  it("toasts a version it hasn't toasted before, and not again once acknowledged", () => {
    const state = checked(null)
    expect(shouldNotify(state)).toBe("0.5.2")
    const acknowledged = updateReducer(state, { type: "acknowledged", what: "notify", version: "0.5.2" })
    expect(acknowledged.notified).toBe("0.5.2")
    expect(shouldNotify(acknowledged)).toBeNull()
    expect(shouldNotify(checked("0.5.2"))).toBeNull()
  })

  it("a newer release than the one it toasted toasts again", () => {
    expect(shouldNotify(checked("0.5.1"))).toBe("0.5.2")
  })

  it("never toasts while up to date", () => {
    expect(shouldNotify(checked(null, [release("0.4.0")]))).toBeNull()
  })
})

describe("updated to … once", () => {
  it("says so on the first launch of a newer version, and not on the first launch ever", () => {
    expect(afterLaunch(null, "0.5.1")).toEqual({ updatedFrom: null, lastRun: "0.5.1" })
    expect(afterLaunch("0.5.0", "0.5.1")).toEqual({ updatedFrom: "0.5.0", lastRun: "0.5.0" })
    expect(afterLaunch("0.5.1", "0.5.1")).toEqual({ updatedFrom: null, lastRun: "0.5.1" })
  })

  it("going back to an older version says nothing, and remembers the version now running", () => {
    expect(afterLaunch("0.6.0-beta.1", "0.5.1")).toEqual({ updatedFrom: null, lastRun: "0.5.1" })
  })

  it("the notice stays until acknowledged; acknowledging records the version now running", () => {
    const settings = { ...parseUpdateSettings(null), lastRun: "0.5.0" }
    const state = initialUpdateState({ current: "0.5.1", arch: "arm64", settings })
    expect(state.updatedFrom).toBe("0.5.0")
    const acknowledged = updateReducer(state, { type: "acknowledged", what: "updated", version: "0.5.1" })
    expect(acknowledged).toMatchObject({ updatedFrom: null, lastRun: "0.5.1" })
  })
})

describe("parseUpdateCommand", () => {
  it("takes the board's commands and nothing else", () => {
    expect(parseUpdateCommand({ kind: "check" })).toEqual({ kind: "check" })
    expect(parseUpdateCommand({ kind: "download", extra: 1 })).toEqual({ kind: "download" })
    expect(parseUpdateCommand({ kind: "channel", channel: "preview" })).toEqual({ kind: "channel", channel: "preview" })
    expect(parseUpdateCommand({ kind: "channel", channel: "nightly" })).toBeNull()
    expect(parseUpdateCommand({ kind: "auto-download", on: false })).toEqual({ kind: "auto-download", on: false })
    expect(parseUpdateCommand({ kind: "auto-download", on: "no" })).toBeNull()
    expect(parseUpdateCommand({ kind: "acknowledge", what: "notify", version: "0.5.1" })).toEqual({ kind: "acknowledge", what: "notify", version: "0.5.1" })
    expect(parseUpdateCommand({ kind: "acknowledge", what: "notify", version: "../x" })).toBeNull()
    expect(parseUpdateCommand({ kind: "quit" })).toBeNull()
    expect(parseUpdateCommand("check")).toBeNull()
  })
})

describe("parseUpdateSettings", () => {
  it("defaults to Stable with automatic downloads, and ignores what it can't read", () => {
    expect(parseUpdateSettings(null)).toEqual({ channel: "stable", autoDownload: true, notified: null, lastRun: null })
    expect(parseUpdateSettings("not json")).toEqual({ channel: "stable", autoDownload: true, notified: null, lastRun: null })
    expect(parseUpdateSettings(JSON.stringify({ channel: "nightly", autoDownload: "yes", notified: 3, lastRun: "0.5.0" }))).toEqual({
      channel: "stable",
      autoDownload: true,
      notified: null,
      lastRun: "0.5.0",
    })
  })
})
