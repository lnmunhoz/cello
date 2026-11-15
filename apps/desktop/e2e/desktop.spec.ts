// The desktop app end to end: the built Electron app against real `cello start` servers with temp
// data folders on free ports. Each test records an MP4 of the whole window (test-results/videos).
import * as fs from "node:fs"
import * as path from "node:path"
import { expect, test, type ElectronApplication, type Page } from "@playwright/test"
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

/**
 * The board view is exactly the window's content area, and the web app inside fills it: the page
 * doesn't scroll, Settings sits at the bottom of the sidebar, and the main panel reaches the bottom.
 */
async function expectBoardFills(app: ElectronApplication, board: Page) {
  const content = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]!.getContentBounds())
  const { bounds } = (await views(app)).board
  expect({ width: bounds.width, height: bounds.height }, "the board view covers the window").toEqual({ width: content.width, height: content.height })
  // The page hears about its new size with a resize event; wait for that, not a timer.
  await board.evaluate(
    (height) =>
      new Promise<void>((resolve) => {
        const check = () => window.innerHeight === height && resolve()
        window.addEventListener("resize", check)
        check()
      }),
    content.height,
  )
  const fit = await board.evaluate(() => ({
    height: window.innerHeight,
    scrollHeight: document.documentElement.scrollHeight,
    settings: document.querySelector('a[href="/settings"]')!.getBoundingClientRect().bottom,
    main: document.querySelector("main")!.getBoundingClientRect().bottom,
  }))
  expect(fit.scrollHeight, "the page doesn't scroll").toBe(fit.height)
  expect(fit.height - fit.main, "the main panel reaches the bottom, less its margin").toBe(8)
  expect(fit.height - fit.settings, "Settings sits at the bottom of the sidebar").toBeLessThanOrEqual(16)
}

/** Resolves once the board has painted what's in the DOM now (two frames), so a capture shows it. */
const painted = (board: Page) => board.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))

/** Runs `change` on the main window and resolves on `event` (registered first, so a synchronous one isn't missed). */
const windowChange = (app: ElectronApplication, event: "resize" | "enter-full-screen" | "leave-full-screen", change: "short" | "full" | "windowed") =>
  app.evaluate(
    ({ BaseWindow }, { event, change }) =>
      new Promise<void>((resolve) => {
        const window = BaseWindow.getAllWindows()[0]!
        window.once(event as "resize", () => resolve())
        if (change === "short") window.setContentSize(1440, 600)
        else window.setFullScreen(change === "full")
      }),
    { event, change },
  )

test("CEL-25: the board fills the window with a wide board: in a short window, in full screen, and back", async ({}, testInfo) => {
  const dataDir = tempDir("cello-desktop-e2e-")
  const server = await startCello(dataDir)
  const app = await launchApp({ CELLO_PORT: String(server.port), CELLO_DATA_DIR: dataDir, CELLO_DESKTOP_USER_DATA: tempDir("cello-desktop-user-") })
  const video = record(app, testInfo.title)
  const { board } = await appPages(app, server.url)

  await video.caption("A project with a full column: the board is wider than the window")
  await board.getByRole("button", { name: "New project" }).first().click()
  await board.getByLabel("Name").fill("Wide board")
  await board.getByLabel("Key").fill("WIDE")
  await board.getByRole("button", { name: "Create project" }).click()
  await board.waitForURL(`${server.url}/WIDE/issues`)
  for (let i = 1; i <= 16; i++) celloAsAgent(server.port, "task", "create", `Task ${i}`, "--project", "WIDE")
  await expect(board.locator('[data-task-key="WIDE-16"]')).toBeVisible()
  await expectBoardFills(app, board)

  await video.caption("Make the window short: the board follows it")
  await windowChange(app, "resize", "short")
  await expectBoardFills(app, board)

  await video.caption("Full screen: the board grows with the window, no grey band under it")
  await windowChange(app, "enter-full-screen", "full")
  await expectBoardFills(app, board)
  await painted(board)
  await screenshotWindow(app, path.join(SCREENSHOTS_DIR, "board-fills-full-screen.png"))

  await video.caption("Leave full screen: the board shrinks back with the window")
  await windowChange(app, "leave-full-screen", "windowed")
  await expectBoardFills(app, board)
})

test("CEL-24: ⌘B in the board collapses the sidebar to a rail and expands it again; the app's menus don't take it", async ({}, testInfo) => {
  const dataDir = tempDir("cello-desktop-e2e-")
  const server = await startCello(dataDir)
  const app = await launchApp({ CELLO_PORT: String(server.port), CELLO_DATA_DIR: dataDir, CELLO_DESKTOP_USER_DATA: tempDir("cello-desktop-user-") })
  const video = record(app, testInfo.title)
  const { board } = await appPages(app, server.url)
  const sidebar = board.getByRole("complementary", { name: "Sidebar" })
  // ⌘ on a Mac, Ctrl elsewhere (the web app's "mod").
  const mod = process.platform === "darwin" ? "meta" : "control"

  await video.caption("A project on the board; the sidebar starts expanded")
  await board.getByRole("button", { name: "New project" }).first().click()
  await board.getByLabel("Name").fill("Sidebar")
  await board.getByLabel("Key").fill("SIDE")
  await board.getByRole("button", { name: "Create project" }).click()
  await board.waitForURL(`${server.url}/SIDE/issues`)
  celloAsAgent(server.port, "task", "create", "Collapse the sidebar with ⌘B", "--project", "SIDE")
  await expect(board.locator('[data-task-key="SIDE-1"]')).toBeVisible()
  await expect(sidebar).toHaveAttribute("data-sidebar", "expanded")
  // No menu item claims ⌘B (⌘\ is the panel's), so the key reaches the board.
  const accelerators = await app.evaluate(({ Menu }) => {
    const all: string[] = []
    const walk = (items: Electron.MenuItem[]) => {
      for (const item of items) {
        if (item.accelerator) all.push(item.accelerator)
        if (item.submenu) walk(item.submenu.items)
      }
    }
    walk(Menu.getApplicationMenu()?.items ?? [])
    return all
  })
  // Every spelling Electron takes for ⌘B or Ctrl+B.
  expect(accelerators.filter((a) => /^(cmdorctrl|commandorcontrol|cmd|command|ctrl|control|super|meta)\+b$/i.test(a.replace(/\s/g, "")))).toEqual([])

  await video.caption("⌘B: the sidebar collapses to a rail of icons")
  await pressKey(app, VIEW.board, "b", [mod])
  await expect(sidebar).toHaveAttribute("data-sidebar", "rail")
  await painted(board)
  await screenshotWindow(app, path.join(SCREENSHOTS_DIR, "sidebar-rail.png"))

  await video.caption("⌘B again: expanded")
  await pressKey(app, VIEW.board, "b", [mod])
  await expect(sidebar).toHaveAttribute("data-sidebar", "expanded")
  await expectBoardFills(app, board)
})

test("CEL-12, CEL-44: a screenshot clicked on the board opens in the image modal in the board's page, and its Open in viewer goes to the native panel; a packet link opens in the native panel beside the task", async ({}, testInfo) => {
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

  await video.caption("Click the card's evidence badge: the screenshot opens in the image modal, over the board")
  await badge.click()
  const modal = board.getByRole("dialog", { name: "The board" })
  await expect(modal.locator("img[data-modal-image]")).toBeVisible()
  expect((await views(app)).page.visible).toBe(false)
  await screenshotWindow(app, path.join(SCREENSHOTS_DIR, "image-modal-badge.png"))

  await video.caption("Esc closes it; Open in viewer in the modal shows the screenshot in the native panel")
  await board.keyboard.press("Escape")
  await expect(modal).toHaveCount(0)
  await badge.click()
  await modal.getByRole("button", { name: "Open The board in the viewer" }).click()
  await expect(modal).toHaveCount(0)
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
