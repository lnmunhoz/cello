import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { parseUpdateSettings, type UpdateState } from "@cello/shared/updates"
import { afterEach, describe, expect, it } from "vitest"
import type { ReleaseFeed } from "./feed.ts"
import { CHECK_EVERY_MS, openDmg, Updater, type FetchFile, type Installer } from "./Updater.ts"

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-updater-"))
  dirs.push(dir)
  return dir
}

const github = (tag: string, size = 5) => ({
  tag_name: tag,
  name: `Cello ${tag}`,
  body: `Notes for ${tag}`,
  draft: false,
  prerelease: tag.includes("-"),
  published_at: "2026-11-17T10:00:00Z",
  html_url: `https://github.com/lnmunhoz/cello/releases/tag/${tag}`,
  assets: ["arm64", "x64"].map((arch) => ({ name: `Cello-${tag}-mac-${arch}.dmg`, browser_download_url: `https://example.test/Cello-${tag}-mac-${arch}.dmg`, size })),
})

/** A feed answering with `list`, or failing with `error`, changeable between checks. */
const fakeFeed = (list: unknown[]) => {
  const feed = { list, error: null as string | null, reads: 0 }
  const reader: ReleaseFeed = {
    read: async () => {
      feed.reads++
      if (feed.error) throw new Error(feed.error)
      return feed.list
    },
  }
  return { feed, reader }
}

/** A download that writes `size` bytes when `finish` is called, so a test can look at it halfway. */
const fakeFetchFile = () => {
  const pending: Array<{ url: string; file: string; finish: (error?: Error) => void; progress: (fraction: number) => void }> = []
  const fetchFile: FetchFile = (url, file, onProgress) =>
    new Promise<void>((resolve, reject) => {
      pending.push({
        url,
        file,
        progress: onProgress,
        finish: (error) => {
          if (error) return reject(error)
          fs.writeFileSync(file, "12345")
          resolve()
        },
      })
    })
  return { fetchFile, pending }
}

const fakeInstaller = () => {
  const installed: string[] = []
  const installer: Installer = { action: "Download", install: async (file) => void installed.push(file) }
  return { installer, installed }
}

const make = (options: { current?: string; list?: unknown[]; settings?: string | null } = {}) => {
  const { feed, reader } = fakeFeed(options.list ?? [github("v0.5.1"), github("v0.6.0-beta.1"), github("v0.5.0")])
  const { fetchFile, pending } = fakeFetchFile()
  const { installer, installed } = fakeInstaller()
  const downloads = tempDir()
  let stored: string | null = options.settings ?? null
  const opened: string[] = []
  let now = 1_000
  const updater = new Updater({
    current: options.current ?? "0.5.0",
    arch: "arm64",
    feed: reader,
    settings: { read: () => stored, write: (text) => void (stored = text) },
    downloadsDir: downloads,
    fetchFile,
    installer,
    openExternal: (url) => void opened.push(url),
    now: () => now,
  })
  const states: UpdateState[] = []
  updater.onChange((state) => states.push(state))
  return {
    updater,
    feed,
    pending,
    installed,
    downloads,
    opened,
    states,
    stored: () => parseUpdateSettings(stored),
    tick: (ms: number) => void (now += ms),
  }
}

/** Lets the promise callbacks that are already due run. */
const settled = () => new Promise<void>((resolve) => setImmediate(resolve))

describe("openDmg", () => {
  it("opens the DMG, and fails with what the opener said", async () => {
    const opened: string[] = []
    await openDmg(async (file) => (opened.push(file), "")).install("/d/Cello-v0.5.1-mac-arm64.dmg")
    expect(opened).toEqual(["/d/Cello-v0.5.1-mac-arm64.dmg"])
    await expect(openDmg(async () => "Failed to open").install("/x")).rejects.toThrow("Failed to open")
  })
})

describe("Updater", () => {
  it("checks every 4 hours", () => {
    expect(CHECK_EVERY_MS).toBe(4 * 60 * 60 * 1000)
  })

  it("a check finds a newer stable release and, downloading automatically, fetches this Mac's DMG into Downloads", async () => {
    const t = make()
    await t.updater.check()
    expect(t.updater.state).toMatchObject({ status: "downloading", latest: { version: "0.5.1" }, checkedAt: 1_000 })
    expect(t.pending).toHaveLength(1)
    expect(t.pending[0]!.url).toBe("https://example.test/Cello-v0.5.1-mac-arm64.dmg")
    expect(t.pending[0]!.file).toBe(path.join(t.downloads, "Cello-v0.5.1-mac-arm64.dmg"))
    t.pending[0]!.progress(0.4)
    expect(t.updater.state.progress).toBe(0.4)
    t.pending[0]!.finish()
    await settled()
    expect(t.updater.state.status).toBe("downloaded")
    expect(t.installed).toEqual([])
  })

  it("Download opens the downloaded DMG (the installer seam), right away", async () => {
    const t = make()
    await t.updater.check()
    t.pending[0]!.finish()
    await settled()
    await t.updater.command({ kind: "download" })
    expect(t.installed).toEqual([path.join(t.downloads, "Cello-v0.5.1-mac-arm64.dmg")])
  })

  it("without automatic downloads, Download fetches it, then opens it", async () => {
    const t = make({ settings: JSON.stringify({ autoDownload: false }) })
    await t.updater.check()
    expect(t.updater.state.status).toBe("available")
    expect(t.pending).toHaveLength(0)
    const download = t.updater.command({ kind: "download" })
    await settled()
    expect(t.updater.state.status).toBe("downloading")
    t.pending[0]!.finish()
    await download
    expect(t.installed).toEqual([path.join(t.downloads, "Cello-v0.5.1-mac-arm64.dmg")])
    expect(t.updater.state.status).toBe("downloaded")
  })

  it("Download while the background download runs waits for it instead of starting another", async () => {
    const t = make()
    await t.updater.check()
    const download = t.updater.command({ kind: "download" })
    await settled()
    expect(t.pending).toHaveLength(1)
    t.pending[0]!.finish()
    await download
    expect(t.installed).toHaveLength(1)
  })

  it("a DMG already in Downloads from an earlier launch counts as downloaded", async () => {
    const t = make()
    fs.writeFileSync(path.join(t.downloads, "Cello-v0.5.1-mac-arm64.dmg"), "12345")
    await t.updater.check()
    expect(t.updater.state.status).toBe("downloaded")
    expect(t.pending).toHaveLength(0)
  })

  it("a release without this Mac's DMG: Download opens its page on GitHub", async () => {
    const t = make({ list: [{ ...github("v0.5.1"), assets: [] }] })
    await t.updater.check()
    expect(t.updater.state).toMatchObject({ status: "available", latest: { asset: null } })
    await t.updater.command({ kind: "download" })
    expect(t.opened).toEqual(["https://github.com/lnmunhoz/cello/releases/tag/v0.5.1"])
  })

  it("a download that fails goes back to available, says why, and leaves no file behind", async () => {
    const t = make()
    await t.updater.check()
    t.pending[0]!.finish(new Error("connection reset"))
    await settled()
    expect(t.updater.state).toMatchObject({ status: "available", error: "Couldn't download 0.5.1: connection reset" })
    expect(fs.readdirSync(t.downloads)).toEqual([])
  })

  it("offline: the check fails quietly, and the next one works", async () => {
    const t = make({ current: "0.5.1" })
    t.feed.error = "Couldn't reach GitHub (fetch failed)"
    await t.updater.check()
    expect(t.updater.state).toMatchObject({ status: "error", error: "Couldn't reach GitHub (fetch failed)", checking: false })
    t.feed.error = null
    await t.updater.check()
    expect(t.updater.state).toMatchObject({ status: "up-to-date", error: null })
  })

  it("two checks at once ask GitHub once", async () => {
    const t = make({ current: "0.5.1" })
    await Promise.all([t.updater.check(), t.updater.check()])
    expect(t.feed.reads).toBe(1)
  })

  it("switching to Preview offers the prerelease and keeps the choice; it downloads that one", async () => {
    const t = make({ current: "0.5.1" })
    await t.updater.check()
    expect(t.updater.state.status).toBe("up-to-date")
    await t.updater.command({ kind: "channel", channel: "preview" })
    expect(t.updater.state).toMatchObject({ channel: "preview", latest: { version: "0.6.0-beta.1" }, status: "downloading" })
    expect(t.stored().channel).toBe("preview")
    expect(t.pending.at(-1)!.url).toContain("Cello-v0.6.0-beta.1-mac-arm64.dmg")
  })

  it("acknowledging the toast and the Updated notice is kept for the next launch", async () => {
    const t = make({ current: "0.5.1", settings: JSON.stringify({ lastRun: "0.5.0", autoDownload: false }) })
    expect(t.updater.state.updatedFrom).toBe("0.5.0")
    await t.updater.command({ kind: "acknowledge", what: "updated", version: "0.5.1" })
    await t.updater.command({ kind: "channel", channel: "preview" })
    await t.updater.check()
    await t.updater.command({ kind: "acknowledge", what: "notify", version: "0.6.0-beta.1" })
    expect(t.stored()).toEqual({ channel: "preview", autoDownload: false, notified: "0.6.0-beta.1", lastRun: "0.5.1" })
  })

  it("the first launch ever writes down the version it runs", () => {
    const t = make({ current: "0.5.1" })
    expect(t.stored().lastRun).toBe("0.5.1")
  })

  it("tells its listeners each change, and stops when they unsubscribe", async () => {
    const t = make({ current: "0.5.1" })
    const seen: string[] = []
    const off = t.updater.onChange((state) => seen.push(state.status))
    await t.updater.check()
    off()
    await t.updater.command({ kind: "auto-download", on: false })
    expect(seen).toEqual(["up-to-date", "up-to-date"])
    expect(t.stored().autoDownload).toBe(false)
  })
})
