// Cello.app's updates (CEL-140) end to end: the built Electron app, pointed at a local fake of GitHub's
// release list (CELLO_UPDATE_FEED), saving DMGs into a temp folder (CELLO_UPDATE_DOWNLOADS), with Finder
// replaced by a recorder (Electron's shell.openPath). Each test records an MP4 of the whole window.
import * as fs from "node:fs"
import * as path from "node:path"
import { expect, test, type ElectronApplication, type Page } from "@playwright/test"
import { startFakeReleaseFeed, type FakeRelease } from "../test/fakeReleaseFeed.ts"
import { recordWindow, screenshotWindow, type Recording } from "./recorder.ts"
import { appPages, cleanup, launchApp, quitApp, SCREENSHOTS_DIR, sidebarSettings, slug, startCello, tempDir, VIDEOS_DIR } from "./support.ts"

let recording: Recording | null = null
const record = (app: ElectronApplication, title: string) => {
  recording = recordWindow(app, path.join(VIDEOS_DIR, `${slug(title)}.mp4`))
  return recording
}
const closers: Array<() => Promise<void>> = []

test.afterEach(async () => {
  await recording?.stop()
  recording = null
  for (const close of closers.splice(0)) await close()
  await cleanup()
})

const NOTES_051 = [
  "### Fixes",
  "",
  "- **web:** the footer names the running release (CEL-140)",
  "- the Review page's Approve button waits for the save",
  "",
  "| Download | For |",
  "| --- | --- |",
  "| Cello-v0.5.1-mac-arm64.dmg | Apple silicon |",
  "| Cello-v0.5.1-mac-x64.dmg | Intel |",
].join("\n")

const RELEASES: FakeRelease[] = [
  { version: "0.6.0-beta.1", notes: "### Features\n\n- **desktop:** a preview of the next version", dmg: "beta dmg", publishedAt: "2026-11-17T12:00:00Z" },
  { version: "0.5.1", notes: NOTES_051, dmg: "a disk image's bytes", publishedAt: "2026-11-17T10:00:00Z" },
  { version: "0.5.0", notes: "### Features\n\n- Settings → Updates", dmg: "older dmg", publishedAt: "2026-11-15T10:00:00Z" },
]

const feedWith = async (releases: FakeRelease[]) => {
  const feed = await startFakeReleaseFeed(releases)
  closers.push(feed.close)
  return feed
}

/** Replaces Finder: `nextOpened` then resolves with the next file the app asks to open. */
const recordOpenedFiles = (app: ElectronApplication) =>
  app.evaluate(({ shell }) => {
    const scope = globalThis as { opened?: string[]; openWaiters?: Array<(file: string) => void> }
    scope.opened = []
    scope.openWaiters = []
    shell.openPath = async (file: string) => {
      scope.opened!.push(file)
      for (const resolve of scope.openWaiters!.splice(0)) resolve(file)
      return ""
    }
  })

/** The first file the app asked to open, once it has. */
const firstOpened = (app: ElectronApplication) =>
  app.evaluate(() => {
    const scope = globalThis as { opened?: string[]; openWaiters?: Array<(file: string) => void> }
    return scope.opened![0] ?? new Promise<string>((resolve) => scope.openWaiters!.push(resolve))
  })

const toastOf = (board: Page, title: string) => board.locator("li", { hasText: title })

/** Waits for the page's CSS transitions to end (a toast fading in, a segmented control's indicator sliding). */
const settled = (board: Page) => board.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))).then(() => {}))

const themes = async (app: ElectronApplication, board: Page, name: string) => {
  await settled(board)
  await screenshotWindow(app, path.join(SCREENSHOTS_DIR, `${name}-light.png`))
  await board.getByRole("button", { name: "Use dark theme" }).click()
  await settled(board)
  await screenshotWindow(app, path.join(SCREENSHOTS_DIR, `${name}-dark.png`))
  await board.getByRole("button", { name: "Use light theme" }).click()
}

test("CEL-140: a newer release shows in the footer and as a toast, once; What's new shows its notes in the side panel; the Releases page marks it; Download opens the DMG it downloaded", async ({}, testInfo) => {
  const feed = await feedWith(RELEASES)
  const dataDir = tempDir("cello-desktop-e2e-")
  const downloads = tempDir("cello-desktop-downloads-")
  const server = await startCello(dataDir)
  const app = await launchApp({
    CELLO_PORT: String(server.port),
    CELLO_DATA_DIR: dataDir,
    CELLO_DESKTOP_USER_DATA: tempDir("cello-desktop-user-"),
    CELLO_UPDATE_FEED: feed.url,
    CELLO_APP_VERSION: "0.5.0",
    CELLO_UPDATE_DOWNLOADS: downloads,
  })
  await recordOpenedFiles(app)
  const video = record(app, testInfo.title)
  const { board } = await appPages(app, server.url)
  const footer = board.locator("[data-update-footer]")
  const toast = toastOf(board, "Cello 0.5.1 is available")

  await video.caption("Cello.app 0.5.0 on Stable asks GitHub for releases at launch: 0.5.1 is out")
  await expect(footer).toHaveText("Update available: 0.5.1")
  await expect(toast).toBeVisible()
  await expect(toast.getByRole("button", { name: "Download" })).toBeVisible()
  await expect(toast.getByRole("button", { name: "What's new" })).toBeVisible()

  await video.caption("Downloading updates automatically: the DMG for this Mac lands in Downloads in the background")
  await expect(footer).toHaveAttribute("data-update-footer", "downloaded")
  const dmg = path.join(downloads, `Cello-v0.5.1-mac-${process.arch}.dmg`)
  expect(fs.readFileSync(dmg, "utf8")).toBe("a disk image's bytes")
  await themes(app, board, "update-toast")

  await video.caption("What's new: the release's notes open in the side panel, its table included")
  await toast.getByRole("button", { name: "What's new" }).click()
  await expect(toast).toHaveCount(0)
  const viewer = board.locator('[data-side-panel="viewer"]')
  await expect(viewer.getByRole("heading", { name: "What's new in Cello 0.5.1" })).toBeVisible()
  const notes = viewer.locator('[data-release="0.5.1"]')
  await expect(notes).toContainText("the footer names the running release")
  await expect(notes.locator("[data-markdown-table] table")).toContainText("Apple silicon")
  await expect(notes.getByRole("button", { name: "Download" })).toBeVisible()
  await themes(app, board, "update-whats-new")
  await viewer.getByRole("button", { name: "Close viewer" }).click()

  await video.caption("The toast was shown once: reloading the board doesn't bring it back")
  await board.reload()
  await expect(footer).toHaveText("Update available: 0.5.1")
  await expect(toast).toHaveCount(0)

  await video.caption("The footer opens the Releases page: 0.5.0 running, 0.5.1 available, the preview left out on Stable")
  await footer.click()
  await expect(board.getByRole("heading", { name: "Releases", level: 1 })).toBeVisible()
  await expect(board.locator('[data-release="0.5.0"]')).toHaveAttribute("data-release-mark", "running")
  await expect(board.locator('[data-release="0.5.1"]')).toHaveAttribute("data-release-mark", "available")
  await expect(board.locator('[data-release="0.6.0-beta.1"]')).not.toHaveAttribute("data-release-mark")
  await expect(board.locator('[data-release="0.6.0-beta.1"]')).toContainText("Preview")
  await themes(app, board, "releases-page")

  await video.caption("Download opens the downloaded DMG at once (Finder mounts it; drag Cello onto Applications)")
  await board.locator('[data-release="0.5.1"]').getByRole("button", { name: "Download" }).click()
  expect(await firstOpened(app)).toBe(dmg)
  expect(feed.downloads).toHaveLength(1)
})

test("CEL-140: Settings → Updates: switching to Preview offers the newer prerelease; Check now asks GitHub again", async ({}, testInfo) => {
  const feed = await feedWith(RELEASES)
  const dataDir = tempDir("cello-desktop-e2e-")
  const server = await startCello(dataDir)
  const userData = tempDir("cello-desktop-user-")
  // On the latest stable already, with automatic downloads off.
  fs.writeFileSync(path.join(userData, "updates.json"), JSON.stringify({ channel: "stable", autoDownload: false, notified: null, lastRun: "0.5.1" }))
  const app = await launchApp({
    CELLO_PORT: String(server.port),
    CELLO_DATA_DIR: dataDir,
    CELLO_DESKTOP_USER_DATA: userData,
    CELLO_UPDATE_FEED: feed.url,
    CELLO_APP_VERSION: "0.5.1",
    CELLO_UPDATE_DOWNLOADS: tempDir("cello-desktop-downloads-"),
  })
  const video = record(app, testInfo.title)
  const { board } = await appPages(app, server.url)
  const footer = board.locator("[data-update-footer]")

  await video.caption("Cello.app 0.5.1 on Stable: up to date")
  await expect(footer).toHaveText("Cello 0.5.1 · Stable · up to date")
  await expect(board.locator("li", { hasText: "is available" })).toHaveCount(0)

  await video.caption("Settings → Updates: the channel, Check now, automatic downloads and when it last checked")
  await sidebarSettings(board).click()
  const section = board.getByRole("region", { name: "Updates" })
  await section.scrollIntoViewIfNeeded()
  await expect(section.locator("[data-update-line]")).toHaveText("Cello 0.5.1 · Stable · up to date")
  await expect(section.locator("[data-update-checked]")).toContainText("Last checked just now")
  await expect(section.getByRole("switch", { name: "Download updates automatically" })).not.toBeChecked()
  await themes(app, board, "settings-updates")

  await video.caption("Check now asks GitHub again")
  const reads = feed.reads()
  const asked = feed.nextRead()
  await section.getByRole("button", { name: "Check now" }).click()
  await asked
  expect(feed.reads()).toBe(reads + 1)

  await video.caption("Switch to Preview: the beta, newer than 0.5.1, is offered at once")
  await section.getByRole("radio", { name: "Preview" }).click()
  await expect(section.locator("[data-update-line]")).toHaveText("Update available: 0.6.0-beta.1")
  await expect(footer).toHaveText("Update available: 0.6.0-beta.1")
  await expect(toastOf(board, "Cello 0.6.0-beta.1 is available")).toBeVisible()
  expect(JSON.parse(fs.readFileSync(path.join(userData, "updates.json"), "utf8"))).toMatchObject({ channel: "preview" })
  await themes(app, board, "settings-updates-preview")

  await video.caption("The Releases page now marks the beta available")
  await toastOf(board, "Cello 0.6.0-beta.1 is available").getByRole("button", { name: "Dismiss" }).click()
  await section.getByRole("link", { name: "See all releases →" }).click()
  await expect(board.locator('[data-release="0.6.0-beta.1"]')).toHaveAttribute("data-release-mark", "available")
  await expect(board.locator('[data-release="0.5.1"]')).toHaveAttribute("data-release-mark", "running")

  await video.caption("Back to Stable: up to date again")
  await sidebarSettings(board).click()
  await board.getByRole("region", { name: "Updates" }).getByRole("radio", { name: "Stable" }).click()
  await expect(footer).toHaveText("Cello 0.5.1 · Stable · up to date")
})

test("CEL-140: the first launch after an update says Updated to …, with What's new, once", async ({}, testInfo) => {
  const feed = await feedWith(RELEASES)
  const dataDir = tempDir("cello-desktop-e2e-")
  const server = await startCello(dataDir)
  const userData = tempDir("cello-desktop-user-")
  // 0.5.0 ran last; this launch is 0.5.1.
  fs.writeFileSync(path.join(userData, "updates.json"), JSON.stringify({ channel: "stable", autoDownload: true, notified: "0.5.1", lastRun: "0.5.0" }))
  const env = {
    CELLO_PORT: String(server.port),
    CELLO_DATA_DIR: dataDir,
    CELLO_DESKTOP_USER_DATA: userData,
    CELLO_UPDATE_FEED: feed.url,
    CELLO_APP_VERSION: "0.5.1",
    CELLO_UPDATE_DOWNLOADS: tempDir("cello-desktop-downloads-"),
  }
  const app = await launchApp(env)
  const video = record(app, testInfo.title)
  const { board } = await appPages(app, server.url)
  const updated = toastOf(board, "Updated to Cello 0.5.1")

  await video.caption("The first launch of 0.5.1 after 0.5.0: \"Updated to Cello 0.5.1\"")
  await expect(updated).toBeVisible()
  await expect(updated).toContainText("From 0.5.0")
  await expect(board.locator("[data-update-footer]")).toHaveText("Cello 0.5.1 · Stable · up to date")
  await themes(app, board, "updated-to")

  await video.caption("What's new: 0.5.1's notes in the side panel")
  await updated.getByRole("button", { name: "What's new" }).click()
  const viewer = board.locator('[data-side-panel="viewer"]')
  await expect(viewer.locator('[data-release="0.5.1"]')).toHaveAttribute("data-release-mark", "running")
  await expect(viewer.locator('[data-release="0.5.1"]')).toContainText("the footer names the running release")
  expect(JSON.parse(fs.readFileSync(path.join(userData, "updates.json"), "utf8"))).toMatchObject({ lastRun: "0.5.1" })

  await video.caption("The next launch says nothing: it was said once (the video ends here)")
  await recording!.stop()
  recording = null
  await quitApp(app)
  const again = await launchApp(env)
  const next = (await appPages(again, server.url)).board
  await expect(next.locator("[data-update-footer]")).toHaveText("Cello 0.5.1 · Stable · up to date")
  await expect(toastOf(next, "Updated to")).toHaveCount(0)
})
