// The desktop app end to end: the built Electron app against real `cello start` servers with temp
// data folders on free ports. Each test records an MP4 of the whole window (test-results/videos).
import * as fs from "node:fs"
import * as path from "node:path"
import { expect, test } from "@playwright/test"
import { recordWindow, screenshotWindow, type Recording } from "./recorder.ts"
import {
  appPages,
  CELLO_BIN,
  celloAsAgent,
  cleanup,
  COMMAND_OR_CONTROL,
  freePort,
  isAlive,
  launchApp,
  pressKey,
  readLock,
  SCREENSHOTS_DIR,
  secondLaunch,
  slug,
  startCello,
  tempDir,
  testSite,
  TOGGLE_PANEL_KEYS,
  VIDEOS_DIR,
  VIEW,
  views,
} from "./support.ts"

const ARTIFACT = "https://claude.ai/artifact/RNpQF3GNVbCdMLNVWJqoYh"

let recording: Recording | null = null
const record = (app: Parameters<typeof recordWindow>[0], title: string) => {
  recording = recordWindow(app, path.join(VIDEOS_DIR, `${slug(title)}.mp4`))
  return recording
}

test.afterEach(async () => {
  await recording?.stop()
  recording = null
  await cleanup()
})

test("joins a running server: the board loads, openPanel shows a local page, ⌘\\ (Ctrl+\\ on Linux) toggles the panel", async ({}, testInfo) => {
  const site = await testSite()
  const dataDir = tempDir("cello-desktop-e2e-")
  const server = await startCello(dataDir)
  const app = await launchApp({ CELLO_PORT: String(server.port), CELLO_DATA_DIR: dataDir, CELLO_DESKTOP_USER_DATA: tempDir("cello-desktop-user-") })
  const video = record(app, testInfo.title)
  const { board, chrome, panel } = await appPages(app, server.url)

  await video.caption("The app joins the server already running and loads the board")
  await expect(board.getByRole("button", { name: "New project" }).first()).toBeVisible()
  expect(readLock(dataDir)?.pid).toBe(server.pid)
  expect((await views(app)).page.visible).toBe(false)

  await video.caption("The board calls window.celloDesktop.openPanel(url, title)")
  await board.evaluate(([url]) => window.celloDesktop!.openPanel(url!, "Local test page"), [site.url])
  await panel.waitForURL(site.url)
  await expect(panel.getByRole("heading", { name: "Cello panel test page" })).toBeVisible()
  await expect(chrome.getByLabel("Address")).toHaveValue("Local test page")
  await expect(chrome.getByRole("button", { name: "Back" })).toBeDisabled()
  const open = await views(app)
  expect(open.page.visible).toBe(true)
  expect(open.board.bounds.width + open.chrome.bounds.width).toBe(open.chrome.bounds.x + open.chrome.bounds.width)
  await screenshotWindow(app, path.join(SCREENSHOTS_DIR, "panel-local-page.png"))

  await video.caption("Only http(s) pages: openPanel refuses a file: URL")
  await board.evaluate(() => window.celloDesktop!.openPanel("file:///etc/passwd"))
  await expect(chrome.getByLabel("Address")).toHaveValue("Local test page")

  await video.caption("A panel link that opens a new window stays in the panel")
  await panel.getByRole("link", { name: "Open the second page" }).click()
  await panel.waitForURL(`${site.url}second`)
  await expect(chrome.getByLabel("Address")).toHaveValue("Second page")

  await video.caption("The toolbar's Back button returns to the first page")
  await chrome.getByRole("button", { name: "Back" }).click()
  await panel.waitForURL(site.url)

  await video.caption("A board link with target=_blank opens in the panel")
  await board.evaluate((url) => {
    const link = Object.assign(document.createElement("a"), { href: url, target: "_blank", textContent: "link" })
    document.body.append(link)
    link.click()
    link.remove()
  }, `${site.url}?from=board`)
  await panel.waitForURL(`${site.url}?from=board`)
  expect(app.windows()).toHaveLength(3)

  const toolbar = chrome.locator("html")
  await expect(toolbar).toHaveAttribute("data-panel", "open")

  await video.caption(`${TOGGLE_PANEL_KEYS} in the board closes the panel`)
  await pressKey(app, VIEW.board, "\\", [COMMAND_OR_CONTROL])
  await expect(toolbar).toHaveAttribute("data-panel", "closed")
  const closed = await views(app)
  expect(closed.page.visible).toBe(false)
  expect(closed.board.bounds.width).toBe(open.board.bounds.width + open.chrome.bounds.width)

  await video.caption(`${TOGGLE_PANEL_KEYS} opens it again, on the same page`)
  await pressKey(app, VIEW.board, "\\", [COMMAND_OR_CONTROL])
  await expect(toolbar).toHaveAttribute("data-panel", "open")
  const reopened = await views(app)
  expect(reopened.page.visible).toBe(true)
  expect(reopened.page.url).toBe(`${site.url}?from=board`)

  await video.caption("Drag the panel's left edge 122px to the left to make it wider")
  const before = (await views(app)).chrome.bounds.width
  // One move: DevTools mouse positions are relative to the view, which moves as the panel widens.
  await chrome.mouse.move(2, 300)
  await chrome.mouse.down()
  await chrome.mouse.move(-120, 300)
  await chrome.mouse.up()
  await chrome.waitForFunction((width) => window.innerWidth === width, before + 122)
  expect((await views(app)).chrome.bounds.width).toBe(before + 122)

  await video.caption("The toolbar's close button closes the panel")
  await chrome.getByRole("button", { name: "Close panel" }).click()
  await expect(toolbar).toHaveAttribute("data-panel", "closed")
  expect((await views(app)).page.visible).toBe(false)
})

test("CEL-12: evidence clicked on the board opens in the native panel, not the web viewer: the card's badge, then a packet link beside the task", async ({}, testInfo) => {
  const site = await testSite()
  const dataDir = tempDir("cello-desktop-e2e-")
  const server = await startCello(dataDir)
  const app = await launchApp({ CELLO_PORT: String(server.port), CELLO_DATA_DIR: dataDir, CELLO_DESKTOP_USER_DATA: tempDir("cello-desktop-user-") })
  const video = record(app, testInfo.title)
  const { board, chrome, panel } = await appPages(app, server.url)
  const webViewer = board.getByRole("complementary", { name: "Viewer" })

  await video.caption("Create a project on the board")
  await board.getByRole("button", { name: "New project" }).first().click()
  await board.getByLabel("Name").fill("Desktop viewer")
  await board.getByLabel("Key").fill("DSK")
  await board.getByRole("button", { name: "Create project" }).click()
  await board.waitForURL(`${server.url}/DSK/issues`)

  await video.caption("An agent runs cello task submit with a screenshot and a link")
  const evidence = tempDir("cello-desktop-evidence-")
  const shot = path.join(evidence, "board.png")
  await screenshotWindow(app, shot)
  celloAsAgent(server.port, "task", "create", "Evidence in the native panel", "--project", "DSK")
  celloAsAgent(server.port, "task", "claim", "DSK-1")
  celloAsAgent(
    server.port, "task", "submit", "DSK-1",
    "--summary", "Evidence opens in the **native panel** in the desktop app.",
    "--step", "Click the evidence badge on the card",
    "--attach", shot, "--caption", "The board",
    "--link", site.url, "--caption", "The local page",
  )
  const taskCard = board.locator('[data-task-key="DSK-1"]')
  const badge = taskCard.locator("[data-evidence-badge]")
  await expect(badge).toContainText("2")

  await video.caption("Click the card's evidence badge: the screenshot opens in the native panel")
  await badge.click()
  await panel.waitForURL(/\/attachments\/[^/]+$/)
  await expect(chrome.getByLabel("Address")).toHaveValue("The board")
  expect((await views(app)).page.visible).toBe(true)
  await expect(webViewer).toHaveCount(0)
  expect(board.url()).toBe(`${server.url}/DSK/issues`)
  await screenshotWindow(app, path.join(SCREENSHOTS_DIR, "panel-evidence-badge.png"))

  await video.caption("Open the card: the packet's link opens in the native panel, beside the task")
  await taskCard.click()
  const task = board.getByRole("complementary", { name: "DSK-1 details" })
  await task.getByRole("region", { name: "Review packet" }).getByRole("link", { name: "The local page" }).click()
  await panel.waitForURL(site.url)
  await expect(panel.getByRole("heading", { name: "Cello panel test page" })).toBeVisible()
  await expect(chrome.getByLabel("Address")).toHaveValue("The local page")
  await expect(task).toBeVisible()
  await expect(webViewer).toHaveCount(0)
  await screenshotWindow(app, path.join(SCREENSHOTS_DIR, "panel-evidence-link.png"))
})

test("CEL-20: a task key clicked in a page shown in the native panel opens the task in the main window; the page stays in the panel", async ({}, testInfo) => {
  const dataDir = tempDir("cello-desktop-e2e-")
  const server = await startCello(dataDir)
  const env = { CELLO_PORT: String(server.port), CELLO_DATA_DIR: dataDir, CELLO_DESKTOP_USER_DATA: tempDir("cello-desktop-user-") }
  const app = await launchApp(env)
  const video = record(app, testInfo.title)
  const { board, panel } = await appPages(app, server.url)

  await video.caption("Create a project on the board")
  await board.getByRole("button", { name: "New project" }).first().click()
  await board.getByLabel("Name").fill("Desktop keys")
  await board.getByLabel("Key").fill("DSK")
  await board.getByRole("button", { name: "Create project" }).click()
  await board.waitForURL(`${server.url}/DSK/issues`)

  await video.caption("An agent creates two tasks and publishes a page with a task table")
  celloAsAgent(server.port, "task", "create", "Keys in the native panel", "--project", "DSK", "--status", "Todo")
  celloAsAgent(server.port, "task", "create", "Live status on pages", "--project", "DSK", "--status", "Todo")
  const file = path.join(tempDir("cello-desktop-page-"), "progress.md")
  fs.writeFileSync(file, ["# Desktop progress", "", "| Task | What |", "| --- | --- |", "| DSK-1 | Keys in the native panel |", "| DSK-2 | Live status on pages |", ""].join("\n"))
  const pageUrl = celloAsAgent(server.port, "doc", "publish", file, "--project", "DSK").split("\n").at(-1)!
  expect(pageUrl).toBe(`${server.url}/DSK/pages/desktop-progress`)

  await video.caption("open cello://open?url=<the page>: it shows in the native panel, without the sidebar")
  expect(await secondLaunch(env, [`cello://open?url=${encodeURIComponent(pageUrl)}`])).toBe(0)
  await panel.waitForURL(`${pageUrl}?embed=1`)
  await expect(panel.getByRole("heading", { level: 1, name: "Desktop progress" })).toBeVisible()
  await expect(panel.getByRole("navigation", { name: "Projects" })).toHaveCount(0)
  const key = panel.locator('[data-task-link="DSK-2"]')
  await expect(key).toHaveAttribute("href", "/DSK/2")
  await expect(key.locator("[data-task-status]")).toHaveText("Todo")

  await video.caption("Click DSK-2 in the panel: the task opens in the main window, and the page stays in the panel")
  // The link starts a navigation that the panel cancels (it opens the task on the board instead), so
  // the click mustn't wait for that navigation to finish: it never does.
  await key.click({ noWaitAfter: true })
  await board.waitForURL(`${server.url}/DSK/2`)
  await expect(board.getByRole("complementary", { name: "DSK-2 details" })).toBeVisible()
  expect(panel.url()).toBe(`${pageUrl}?embed=1`)
  expect((await views(app)).page.visible).toBe(true)
  await screenshotWindow(app, path.join(SCREENSHOTS_DIR, "panel-task-key.png"))
})

test("starts the bundled cello when no server is running, and stops it on quit", async ({}, testInfo) => {
  const dataDir = tempDir("cello-desktop-e2e-")
  const userData = tempDir("cello-desktop-user-")
  const port = await freePort()
  const url = `http://127.0.0.1:${port}`
  const app = await launchApp({ CELLO_PORT: String(port), CELLO_DATA_DIR: dataDir, CELLO_DESKTOP_USER_DATA: userData, CELLO_BIN })
  const video = record(app, testInfo.title)
  const { board } = await appPages(app, url)

  await video.caption(`Nothing answered on ${port}: the app started its own cello server`)
  await expect(board.getByRole("button", { name: "New project" }).first()).toBeVisible()
  const lock = readLock(dataDir)
  expect(lock?.port).toBe(port)
  expect(isAlive(lock!.pid)).toBe(true)

  await video.caption("Move and resize the window, then quit")
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]!.setBounds({ x: 120, y: 80, width: 1100, height: 720 }))
  await recording!.stop()
  recording = null
  await app.close()

  expect(readLock(dataDir)).toBeNull()
  expect(isAlive(lock!.pid)).toBe(false)
  const saved = JSON.parse(fs.readFileSync(path.join(userData, "window-state.json"), "utf8"))
  expect(saved.bounds).toEqual({ x: 120, y: 80, width: 1100, height: 720 })
})

test("cello:// links from a second launch reach the running app", async ({}, testInfo) => {
  const site = await testSite()
  const dataDir = tempDir("cello-desktop-e2e-")
  const server = await startCello(dataDir)
  const env = { CELLO_PORT: String(server.port), CELLO_DATA_DIR: dataDir, CELLO_DESKTOP_USER_DATA: tempDir("cello-desktop-user-") }
  const app = await launchApp(env)
  const video = record(app, testInfo.title)
  const { board, panel } = await appPages(app, server.url)
  await expect(board.getByRole("button", { name: "New project" }).first()).toBeVisible()

  await video.caption("open cello://open?url=… : the second launch hands it over and quits")
  const pageUrl = `${site.url}?from=link`
  expect(await secondLaunch(env, [`cello://open?url=${encodeURIComponent(pageUrl)}`])).toBe(0)
  await panel.waitForURL(pageUrl)
  expect((await views(app)).page.visible).toBe(true)

  await video.caption("open cello://CEL-1 : the board goes to that task")
  expect(await secondLaunch(env, ["cello://CEL-1"])).toBe(0)
  await board.waitForURL(`${server.url}/CEL/1`)
})

test("shows a claude.ai artifact page in the panel, which a browser iframe can't", async ({}, testInfo) => {
  test.skip(!process.env.CELLO_E2E_ONLINE, "needs the internet: run with CELLO_E2E_ONLINE=1")
  const dataDir = tempDir("cello-desktop-e2e-")
  const server = await startCello(dataDir)
  const app = await launchApp({ CELLO_PORT: String(server.port), CELLO_DATA_DIR: dataDir, CELLO_DESKTOP_USER_DATA: tempDir("cello-desktop-user-") })
  const video = record(app, testInfo.title)
  const { board, panel } = await appPages(app, server.url)
  await expect(board.getByRole("button", { name: "New project" }).first()).toBeVisible()

  await video.caption("openPanel(claude.ai artifact): loaded top-level, so frame-ancestors doesn't apply")
  await board.evaluate(([url]) => window.celloDesktop!.openPanel(url!, "Claude artifact"), [ARTIFACT])
  // claude.ai may send a signed-out visitor to its sign-in page; either way the page renders in the panel.
  await panel.waitForURL((url) => url.hostname === "claude.ai", { waitUntil: "load" })
  await expect(panel.locator("body")).not.toBeEmpty()
  await panel.waitForLoadState("networkidle").catch(() => {})
  await screenshotWindow(app, path.join(SCREENSHOTS_DIR, "panel-claude-artifact.png"))
})
