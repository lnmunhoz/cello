// The updater (CEL-140) against a real HTTP feed shaped like GitHub's, with real downloads into a temp
// folder: available → downloading → downloaded → Download hands the DMG to the installer.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { downloadFile } from "../../src/update/download.ts"
import { feedFor, githubFeed } from "../../src/update/feed.ts"
import { Updater } from "../../src/update/Updater.ts"
import { startFakeReleaseFeed, type FakeReleaseFeed } from "../fakeReleaseFeed.ts"

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const run of cleanups.splice(0).reverse()) await run()
})

const feedWith = async (...args: Parameters<typeof startFakeReleaseFeed>): Promise<FakeReleaseFeed> => {
  const feed = await startFakeReleaseFeed(...args)
  cleanups.push(feed.close)
  return feed
}

const setup = (feed: FakeReleaseFeed, options: { current: string; settings?: string }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-updater-it-"))
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  const downloads = path.join(dir, "Downloads")
  const settingsFile = path.join(dir, "updates.json")
  if (options.settings) fs.writeFileSync(settingsFile, options.settings)
  const installed: string[] = []
  const updater = new Updater({
    current: options.current,
    arch: "arm64",
    // As main.ts wires a dev build pointed at a test feed: the feed's own origin is trusted for its DMGs.
    feed: githubFeed(feed.url),
    trusted: feedFor({ CELLO_UPDATE_FEED: feed.url }, false, true)!.trusted,
    settings: { read: () => (fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, "utf8") : null), write: (text) => fs.writeFileSync(settingsFile, text) },
    downloadsDir: downloads,
    fetchFile: downloadFile,
    installer: { action: "Download", install: async (file) => void installed.push(file) },
    openExternal: () => {},
    now: Date.now,
  })
  /** Resolves once the state's status is `status`. */
  const reaches = (status: string) =>
    new Promise<void>((resolve) => {
      if (updater.state.status === status) return resolve()
      const off = updater.onChange((state) => {
        if (state.status !== status) return
        off()
        resolve()
      })
    })
  return { updater, downloads, installed, settingsFile, reaches }
}

describe("Updater with a GitHub-shaped feed", () => {
  it("finds the newer release, downloads its DMG into Downloads in the background, and Download opens that file", async () => {
    const dmg = "a DMG's bytes ".repeat(5000)
    const feed = await feedWith([
      { version: "0.5.1", notes: "### Fixes\n\n- the footer", dmg },
      { version: "0.5.0", notes: "older", dmg: "old" },
    ])
    const { updater, downloads, installed, reaches } = setup(feed, { current: "0.5.0" })
    const progress: number[] = []
    updater.onChange((state) => state.progress !== null && progress.push(state.progress))

    const downloaded = reaches("downloaded")
    await updater.check()
    expect(updater.state).toMatchObject({ latest: { version: "0.5.1", notes: "### Fixes\n\n- the footer" } })
    await downloaded

    const file = path.join(downloads, "Cello-v0.5.1-mac-arm64.dmg")
    expect(fs.readFileSync(file, "utf8")).toBe(dmg)
    expect(fs.readdirSync(downloads)).toEqual(["Cello-v0.5.1-mac-arm64.dmg"])
    expect(feed.downloads).toEqual(["/download/Cello-v0.5.1-mac-arm64.dmg"])
    expect(progress.at(-1)).toBe(1)

    await updater.command({ kind: "download" })
    expect(installed).toEqual([file])
    // Opening it again doesn't download it again.
    await updater.command({ kind: "download" })
    expect(feed.downloads).toHaveLength(1)
  })

  it("a download that 404s leaves nothing in Downloads and says why", async () => {
    const feed = await feedWith([{ version: "0.5.1", notes: "", dmg: "x" }])
    const { updater, downloads, reaches } = setup(feed, { current: "0.5.0", settings: JSON.stringify({ autoDownload: false }) })
    await updater.check()
    feed.set([{ version: "0.5.1", notes: "" }])
    const available = reaches("available")
    await updater.command({ kind: "download" })
    await available
    expect(updater.state.error).toBe("Couldn't download 0.5.1: the server answered 404")
    expect(fs.existsSync(downloads) ? fs.readdirSync(downloads) : []).toEqual([])
  })

  it("Preview finds the prerelease Stable leaves out, and the choice is kept in updates.json", async () => {
    const feed = await feedWith([
      { version: "0.6.0-beta.1", notes: "the beta", dmg: "beta" },
      { version: "0.5.1", notes: "", dmg: "stable" },
    ])
    const { updater, settingsFile } = setup(feed, { current: "0.5.1", settings: JSON.stringify({ autoDownload: false }) })
    await updater.check()
    expect(updater.state.status).toBe("up-to-date")
    await updater.command({ kind: "channel", channel: "preview" })
    expect(updater.state).toMatchObject({ status: "available", latest: { version: "0.6.0-beta.1", notes: "the beta" } })
    expect(JSON.parse(fs.readFileSync(settingsFile, "utf8"))).toMatchObject({ channel: "preview" })
  })
})
