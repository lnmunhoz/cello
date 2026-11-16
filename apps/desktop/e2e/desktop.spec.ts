// The desktop app end to end: the built Electron app against real `cello start` servers with temp
// data folders on free ports. Each test records an MP4 of the whole window (test-results/videos).
import * as fs from "node:fs"
import * as path from "node:path"
import { expect, test, type ElectronApplication, type Page } from "@playwright/test"
import { parsePlist } from "@cello/shared/launchAgent"
import { writeFakeLaunchctl } from "../../cli/test/fakeLaunchctl.ts"
import { recordWindow, screenshotWindow, type Recording } from "./recorder.ts"
import {
  answerQuitQuestion,
  answerQuitThenShowNext,
  appPages,
  buildWeb,
  CELLO_BIN,
  celloAsAgent,
  cleanup,
  closeAppMenu,
  closeNextDialog,
  closeQuitQuestion,
  COMMAND_OR_CONTROL,
  DESKTOP_DIR,
  entryOf,
  freePort,
  isAlive,
  killOnCleanup,
  launchApp,
  nextDialogShown,
  openAppMenu,
  quitApp,
  quitQuestions,
  screenshotScreen,
  serverStatus,
  serviceProblem,
  showQuitQuestion,
  startQuit,
  writeServicePlist,
  overwrite,
  pressKey,
  readLock,
  relaunchedApp,
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
  watchForRelaunch,
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

interface Size {
  readonly width: number
  readonly height: number
}

/**
 * Resolves with the window's content size once the board view covers it, and once that size is `size`
 * when given. A window change settles in steps on Linux: `leave-full-screen` fires before the menu bar
 * takes its row back, so the content area is briefly 27px taller than where it ends up, and the board
 * view follows a moment later (CEL-16, CEL-50). Checked now and on every window, content view and board
 * view change, never on a timer.
 */
const boardSettled = (app: ElectronApplication, size?: Size) =>
  app.evaluate(
    ({ BaseWindow }, size) =>
      new Promise<Size>((resolve) => {
        const window = BaseWindow.getAllWindows()[0]!
        const board = window.contentView.children[0]!
        const windowEvents = ["resize", "resized", "enter-full-screen", "leave-full-screen"] as const
        const check = () => {
          const content = window.getContentBounds()
          const bounds = board.getBounds()
          const covers = bounds.width === content.width && bounds.height === content.height
          const wanted = size === undefined || (content.width === size.width && content.height === size.height)
          if (!covers || !wanted) return
          for (const event of windowEvents) window.off(event as "resize", check)
          window.contentView.off("bounds-changed", check)
          board.off("bounds-changed", check)
          resolve({ width: content.width, height: content.height })
        }
        for (const event of windowEvents) window.on(event as "resize", check)
        window.contentView.on("bounds-changed", check)
        board.on("bounds-changed", check)
        check()
      }),
    size,
  )

/**
 * The board view is exactly the window's content area (once it settles, at `size` when given), and
 * the web app inside fills it: the page doesn't scroll, Settings sits at the bottom of the sidebar,
 * and the main panel reaches the bottom. Returns the content size.
 */
async function expectBoardFills(app: ElectronApplication, board: Page, size?: Size): Promise<Size> {
  const content = await boardSettled(app, size)
  const { bounds } = (await views(app)).board
  expect({ width: bounds.width, height: bounds.height }, "the board view covers the window").toEqual(content)
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
  return content
}

/** Resolves once the board has painted what's in the DOM now (two frames), so a capture shows it. */
const painted = (board: Page) => board.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))

/**
 * Puts the window in full screen and resolves once the board view has followed it to the screen's
 * width, checked in the main process on the change itself. The Docker run's Xvfb has no window
 * manager to hold full screen: the window grows to the screen (1600×973, sometimes 1600×1000), then
 * snaps back to its old outer size (1440×627, the menu bar hidden) while still flagged full screen.
 * Which of those a later check sees is a race, so the grown state is caught as it happens, with
 * the listeners in place before the change starts. Resolves with that content size.
 */
const boardFollowsFullScreen = (app: ElectronApplication) =>
  app.evaluate(
    ({ BaseWindow, screen }) =>
      new Promise<Size>((resolve) => {
        const window = BaseWindow.getAllWindows()[0]!
        const board = window.contentView.children[0]!
        const screenWidth = screen.getDisplayMatching(window.getBounds()).bounds.width
        const windowEvents = ["resize", "resized", "enter-full-screen"] as const
        const check = () => {
          const content = window.getContentBounds()
          const bounds = board.getBounds()
          if (content.width !== screenWidth || bounds.width !== content.width || bounds.height !== content.height) return
          for (const event of windowEvents) window.off(event as "resize", check)
          window.contentView.off("bounds-changed", check)
          board.off("bounds-changed", check)
          resolve({ width: content.width, height: content.height })
        }
        for (const event of windowEvents) window.on(event as "resize", check)
        window.contentView.on("bounds-changed", check)
        board.on("bounds-changed", check)
        window.setFullScreen(true)
      }),
  )

/** Runs `change` on the main window and resolves on `event` (registered first, so a synchronous one isn't missed). */
const windowChange = (app: ElectronApplication, event: "resize" | "leave-full-screen", change: "short" | "windowed") =>
  app.evaluate(
    ({ BaseWindow }, { event, change }) =>
      new Promise<void>((resolve) => {
        const window = BaseWindow.getAllWindows()[0]!
        window.once(event as "resize", () => resolve())
        if (change === "short") window.setContentSize(1440, 600)
        else window.setFullScreen(false)
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
  const short = await expectBoardFills(app, board)

  await video.caption("Full screen: the board grows with the window, no grey band under it")
  const full = await boardFollowsFullScreen(app)
  expect(full.width, "the board grew past the short window").toBeGreaterThan(short.width)

  await video.caption("Leave full screen: the board shrinks back with the window")
  await windowChange(app, "leave-full-screen", "windowed")
  await expectBoardFills(app, board, short)
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

test("CEL-12, CEL-44, CEL-60: a screenshot clicked on the board opens in the image modal, and its Open in viewer in the board's side panel; a packet link to another site opens in the native panel beside the task", async ({}, testInfo) => {
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
  // The still shows it after its fade-in has finished.
  await modal.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  await screenshotWindow(app, path.join(SCREENSHOTS_DIR, "image-modal-badge.png"))

  await video.caption("Esc closes it; Open in viewer in the modal shows the screenshot in the board's own side panel (CEL-60)")
  await board.keyboard.press("Escape")
  await expect(modal).toHaveCount(0)
  await badge.click()
  await modal.getByRole("button", { name: "Open The board in the viewer" }).click()
  await expect(modal).toHaveCount(0)
  await expect(webViewer.locator("img[data-viewer-image]")).toBeVisible()
  expect((await views(app)).page.visible).toBe(false)
  expect(board.url()).toBe(`${server.url}/DSK/issues`)
  await screenshotWindow(app, path.join(SCREENSHOTS_DIR, "viewer-evidence-badge.png"))
  await board.keyboard.press("Escape")
  await expect(webViewer).toHaveCount(0)

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

test("CEL-60, CEL-20: cello://open with a Cello page opens it in the board's own side panel, not the native browser; its text file and task keys open in the app; an outside site still opens in the native browser", async ({}, testInfo) => {
  const site = await testSite()
  const dataDir = tempDir("cello-desktop-e2e-")
  const server = await startCello(dataDir)
  const env = { CELLO_PORT: String(server.port), CELLO_DATA_DIR: dataDir, CELLO_DESKTOP_USER_DATA: tempDir("cello-desktop-user-") }
  const app = await launchApp(env)
  const video = record(app, testInfo.title)
  const { board, panel } = await appPages(app, server.url)
  const sidePanel = board.getByRole("complementary", { name: "Viewer" })

  await video.caption("Create a project on the board")
  await board.getByRole("button", { name: "New project" }).first().click()
  await board.getByLabel("Name").fill("Desktop pages")
  await board.getByLabel("Key").fill("DSK")
  await board.getByRole("button", { name: "Create project" }).click()
  await board.waitForURL(`${server.url}/DSK/issues`)

  await video.caption("An agent creates two tasks and publishes a page with a task table and a test log")
  celloAsAgent(server.port, "task", "create", "Pages in the side panel", "--project", "DSK", "--status", "Todo")
  celloAsAgent(server.port, "task", "create", "Live status on pages", "--project", "DSK", "--status", "Todo")
  const folder = tempDir("cello-desktop-page-")
  fs.writeFileSync(path.join(folder, "run.log"), "$ bun run test\n\u001b[32m✓\u001b[39m 56 tests \u001b[1mpassed\u001b[22m\n")
  const file = path.join(folder, "progress.md")
  fs.writeFileSync(
    file,
    ["# Desktop progress", "", "The run is in [the test log](run.log).", "", "| Task | What |", "| --- | --- |", "| DSK-1 | Pages in the side panel |", "| DSK-2 | Live status on pages |", ""].join("\n"),
  )
  // The page's address, then the cello:// link agents put in replies (CEL-88), which is what gets opened here.
  const [, pageUrl, replyLine] = celloAsAgent(server.port, "doc", "publish", file, "--project", "DSK").split("\n")
  expect(pageUrl).toBe(`${server.url}/DSK/pages/desktop-progress`)
  expect(replyLine).toBe(`Link in replies (opens in Cello): cello://open?url=${encodeURIComponent(pageUrl!)}`)

  await video.caption("open the cello:// link doc publish printed: it opens in the board's side panel, rendered by the app; the native browser stays shut")
  expect(await secondLaunch(env, [replyLine!.slice(replyLine!.indexOf("cello://"))])).toBe(0)
  await expect(sidePanel.getByRole("heading", { level: 1, name: "Desktop progress" })).toBeVisible()
  await expect(sidePanel.locator("iframe")).toHaveCount(0)
  // The header names the document, not its address.
  await expect(sidePanel.getByRole("heading", { level: 2, name: "Desktop progress" })).toBeVisible()
  await expect(sidePanel.getByRole("button", { name: "Expand to full page" })).toBeVisible()
  expect((await views(app)).page.visible).toBe(false)
  expect(board.url()).toBe(`${server.url}/DSK/issues`)
  await screenshotWindow(app, path.join(SCREENSHOTS_DIR, "side-panel-page.png"))

  await video.caption("Its link to the test log: the log shows in the side panel as text, not in the native browser")
  await sidePanel.getByRole("link", { name: "the test log" }).click()
  await expect(sidePanel.locator("pre[data-text-view=plain]")).toContainText("56 tests passed")
  expect((await views(app)).page.visible).toBe(false)
  await screenshotWindow(app, path.join(SCREENSHOTS_DIR, "side-panel-text.png"))

  await video.caption("Open the page again and click DSK-2 in it: the task opens in the main window, in the panel's place")
  expect(await secondLaunch(env, [`cello://open?url=${encodeURIComponent(pageUrl!)}`])).toBe(0)
  const key = sidePanel.locator('table [data-task-link="DSK-2"]')
  await expect(key.locator("[data-task-status]")).toHaveText("Todo")
  await key.click()
  await board.waitForURL(`${server.url}/DSK/2`)
  await expect(board.getByRole("complementary", { name: "DSK-2 details" })).toBeVisible()
  await expect(sidePanel).toHaveCount(0)
  expect((await views(app)).page.visible).toBe(false)

  await video.caption("open cello://open?url=<another site>: that one opens in the native browser")
  expect(await secondLaunch(env, [`cello://open?url=${encodeURIComponent(site.url)}`])).toBe(0)
  await panel.waitForURL(site.url)
  await expect(panel.getByRole("heading", { name: "Cello panel test page" })).toBeVisible()
  expect((await views(app)).page.visible).toBe(true)
  await expect(sidePanel).toHaveCount(0)
  await screenshotWindow(app, path.join(SCREENSHOTS_DIR, "native-panel-outside-site.png"))
})


test("CEL-54: the main window goes back and forward with ⌘[ and ⌘] (Ctrl on Linux), the mouse's buttons and the History menu; a dead address is never a dead end", async ({}, testInfo) => {
  const dataDir = tempDir("cello-desktop-e2e-")
  const server = await startCello(dataDir)
  const app = await launchApp({ CELLO_PORT: String(server.port), CELLO_DATA_DIR: dataDir, CELLO_DESKTOP_USER_DATA: tempDir("cello-desktop-user-") })
  const video = record(app, testInfo.title)
  const { board } = await appPages(app, server.url)
  const [back, forward] = process.platform === "darwin" ? ["⌘[", "⌘]"] : ["Ctrl+[", "Ctrl+]"]
  const issues = `${server.url}/NAV/issues`
  const docs = `${server.url}/NAV/docs`

  await video.caption("A project on the board; open its Docs tab")
  await board.getByRole("button", { name: "New project" }).first().click()
  await board.getByLabel("Name").fill("Navigation")
  await board.getByLabel("Key").fill("NAV")
  await board.getByRole("button", { name: "Create project" }).click()
  await board.waitForURL(issues)
  await expect(board.getByRole("dialog")).toBeHidden()
  // The "Starting Cello…" message the board replaced isn't behind it in the history.
  expect(await app.evaluate(({ BaseWindow }) => (BaseWindow.getAllWindows()[0]!.contentView.children[0] as Electron.WebContentsView).webContents.navigationHistory.getAllEntries().map((e) => e.url))).not.toContainEqual(expect.stringMatching(/^data:/))
  await board.getByRole("link", { name: "Docs", exact: true }).click()
  await board.waitForURL(docs)

  await video.caption(`${back}: back to the board; ${forward}: forward to Docs`)
  await pressKey(app, VIEW.board, "[", [COMMAND_OR_CONTROL])
  await board.waitForURL(issues)
  await pressKey(app, VIEW.board, "]", [COMMAND_OR_CONTROL])
  await board.waitForURL(docs)

  await video.caption("The mouse's back and forward buttons (an app command on Linux and Windows)")
  const appCommand = (command: string) => app.evaluate(({ BaseWindow }, command) => BaseWindow.getAllWindows()[0]!.emit("app-command", {}, command), command)
  await appCommand("browser-backward")
  await board.waitForURL(issues)
  await appCommand("browser-forward")
  await board.waitForURL(docs)

  await video.caption("History in the menu bar has Back and Forward, with their keys")
  const menu = await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()!.items.find((item) => item.label === "History")!.submenu!.items.map((item) => [item.label, item.accelerator]),
  )
  expect(menu).toEqual([["Back", "CmdOrCtrl+["], ["Forward", "CmdOrCtrl+]"]])
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById("history-back")!.click())
  await board.waitForURL(issues)
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById("history-forward")!.click())
  await board.waitForURL(docs)

  await video.caption("A link to a file that isn't there (what stranded Lucas): Cello's own Not found screen, with a way out")
  await board.goto(`${server.url}/NAV/pages/a-palette-typing.mp4`)
  const notFound = board.getByRole("region", { name: "Not found" })
  await expect(notFound).toContainText("No page “a-palette-typing.mp4” in Navigation")
  await expect(notFound.getByRole("link", { name: "Go to the NAV board" })).toBeVisible()
  await painted(board)
  await screenshotWindow(app, path.join(SCREENSHOTS_DIR, "not-found-in-app.png"))

  await video.caption(`${back} leaves it: back on Docs`)
  await pressKey(app, VIEW.board, "[", [COMMAND_OR_CONTROL])
  await board.waitForURL(docs)
  await expect(board.getByRole("region", { name: "Not found" })).toHaveCount(0)
})

test("CEL-37: the board in the app notices a new Cello build when the server restarts, says so, and reloads into it", async ({}, testInfo) => {
  test.setTimeout(240_000)
  const builds = tempDir("cello-desktop-builds-")
  const a = buildWeb(path.join(builds, "a"), "aaaaaaa")
  const b = buildWeb(path.join(builds, "b"), "bbbbbbb")
  expect(entryOf(a)).not.toBe(entryOf(b))
  const dataDir = tempDir("cello-desktop-e2e-")
  const port = await freePort()
  const first = await startCello(dataDir, { port, webDir: a })
  const app = await launchApp({ CELLO_PORT: String(port), CELLO_DATA_DIR: dataDir, CELLO_DESKTOP_USER_DATA: tempDir("cello-desktop-user-") })
  const video = record(app, testInfo.title)
  const { board } = await appPages(app, first.url)
  const footer = board.locator("[data-build-footer]")
  const bar = board.locator("[data-reload-bar]")
  const loaded = () => board.locator('script[type="module"]').first().getAttribute("src")

  await video.caption("The app's board runs build aaaaaaa: the sidebar's footer names it")
  await expect(footer).toContainText("build aaaaaaa")
  expect(await loaded()).toBe(entryOf(a))
  await screenshotWindow(app, path.join(SCREENSHOTS_DIR, "reload-desktop-build-a.png"))

  await video.caption("Deploy: the server restarts as build bbbbbbb while the app stays open")
  await first.kill()
  await startCello(dataDir, { port, webDir: b })

  await video.caption("The board reconnects: \"Cello was updated\", and it reloads by itself in a few seconds")
  await expect(bar).toContainText("Cello was updated")
  await expect(bar).toContainText("build bbbbbbb")
  await expect(bar).toHaveAttribute("data-reload-bar", "reload")
  await screenshotWindow(app, path.join(SCREENSHOTS_DIR, "reload-desktop-bar.png"))
  await board.waitForEvent("load", { timeout: 20_000 })

  await video.caption("After the reload the board runs build bbbbbbb, and the bar is gone")
  expect(await loaded()).toBe(entryOf(b))
  await expect(footer).toContainText("build bbbbbbb")
  await expect(bar).toHaveCount(0)
  await screenshotWindow(app, path.join(SCREENSHOTS_DIR, "reload-desktop-build-b.png"))
})

test("CEL-75: when a new build of the app lands on disk, the board says so; Later hides it until the next build; Restart starts a new app on it", async ({}, testInfo) => {
  const site = await testSite()
  const dataDir = tempDir("cello-desktop-e2e-")
  const server = await startCello(dataDir)
  const env = { CELLO_PORT: String(server.port), CELLO_DATA_DIR: dataDir, CELLO_DESKTOP_USER_DATA: tempDir("cello-desktop-user-") }
  const app = await launchApp(env)
  const video = record(app, testInfo.title)
  const { board, panel } = await appPages(app, server.url)
  const bar = board.locator("[data-app-restart-bar]")
  const writeStamp = overwrite(path.join(DESKTOP_DIR, "dist-electron/build.json"))
  const focusWindow = () => app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]!.emit("focus"))

  await video.caption("The app runs the build it started with: no notice")
  await expect(board.getByRole("button", { name: "New project" }).first()).toBeVisible()
  await focusWindow()
  await expect(bar).toHaveCount(0)

  await video.caption("A new build of the app lands on disk (bun run build rewrites dist-electron/build.json) while it runs")
  writeStamp(`${JSON.stringify({ builtAt: "2026-11-16T05:00:00.000Z", commit: "bbbbbbb" })}\n`)

  await video.caption("An agent opens a cello:// link: the app follows it, and says it was updated")
  expect(await secondLaunch(env, [`cello://open?url=${encodeURIComponent(site.url)}`])).toBe(0)
  await panel.waitForURL(site.url)
  await expect(bar).toHaveAttribute("data-app-restart-bar", "updated")
  await expect(bar).toContainText("The Cello app was updated")
  await screenshotWindow(app, path.join(SCREENSHOTS_DIR, "app-restart-bar-light.png"))
  await board.getByRole("button", { name: "Use dark theme" }).click()
  await screenshotWindow(app, path.join(SCREENSHOTS_DIR, "app-restart-bar-dark.png"))
  await board.getByRole("button", { name: "Use light theme" }).click()

  await video.caption("Later (×) hides it; switching back to the app doesn't bring it back for the same build")
  await bar.getByRole("button", { name: "Later" }).click()
  await expect(bar).toHaveCount(0)
  await focusWindow()
  await expect(bar).toHaveCount(0)

  await video.caption("Another build lands: the next time the window takes focus, the notice is back")
  writeStamp(`${JSON.stringify({ builtAt: "2026-11-16T06:00:00.000Z", commit: "ccccccc" })}\n`)
  await focusWindow()
  await expect(bar).toHaveAttribute("data-app-restart-bar", "updated")

  await video.caption("Restart: the app quits and a new one starts, on the new build (the video ends here; the window closes)")
  const oldPid = await app.evaluate(() => process.pid)
  const relaunched = watchForRelaunch(env.CELLO_DESKTOP_USER_DATA)
  const closed = app.waitForEvent("close")
  await recording!.stop()
  recording = null
  await bar.getByRole("button", { name: "Restart" }).click()
  await closed
  const next = await relaunchedApp(await relaunched, server.url)
  expect(next.pid).not.toBe(oldPid)
  const fresh = next.board
  await expect(fresh.getByRole("button", { name: "New project" }).first()).toBeVisible()
  // It loaded the build on disk, so it has nothing to say.
  await expect(fresh.locator("[data-app-restart-bar]")).toHaveCount(0)
  await fresh.screenshot({ path: path.join(SCREENSHOTS_DIR, "app-restarted-board.png") })
})

test("CEL-75: a Cello running from a build folder offers a restart from /Applications", async ({}, testInfo) => {
  const dataDir = tempDir("cello-desktop-e2e-")
  const server = await startCello(dataDir)
  const app = await launchApp({ CELLO_PORT: String(server.port), CELLO_DATA_DIR: dataDir, CELLO_DESKTOP_USER_DATA: tempDir("cello-desktop-user-") })
  const video = record(app, testInfo.title)
  const { board } = await appPages(app, server.url)
  const bar = board.locator("[data-app-restart-bar]")
  await expect(board.getByRole("button", { name: "New project" }).first()).toBeVisible()

  // Only a packaged macOS app can run from a build folder; here main sends the notice it would send.
  await video.caption("The app runs from apps/desktop/dist/mac-arm64/Cello.app while /Applications has a copy")
  const running = "/Users/me/projects/cello/apps/desktop/dist/mac-arm64/Cello.app"
  await app.evaluate(({ BaseWindow }, notice) => {
    ;(BaseWindow.getAllWindows()[0]!.contentView.children[0] as Electron.WebContentsView).webContents.send("cello:app-notice", notice)
  }, { kind: "elsewhere", key: `elsewhere:${running}`, running })
  await expect(bar).toHaveAttribute("data-app-restart-bar", "elsewhere")
  await expect(bar).toContainText("Cello is running from a build folder")
  await expect(bar.getByRole("button", { name: "Restart from Applications" })).toBeVisible()
  await screenshotWindow(app, path.join(SCREENSHOTS_DIR, "app-restart-bar-elsewhere-light.png"))
})

test("CEL-81: starts the bundled cello when no server is running; the first quit asks, Stop Server stops it, and the next quit doesn't ask", async ({}, testInfo) => {
  const dataDir = tempDir("cello-desktop-e2e-")
  const userData = tempDir("cello-desktop-user-")
  const asked = path.join(tempDir("cello-desktop-asked-"), "questions.jsonl")
  const port = await freePort()
  const url = `http://127.0.0.1:${port}`
  const env = { CELLO_PORT: String(port), CELLO_DATA_DIR: dataDir, CELLO_DESKTOP_USER_DATA: userData, CELLO_BIN }
  const app = await launchApp(env)
  const video = record(app, testInfo.title)
  const { board } = await appPages(app, url)

  await video.caption(`Nothing answered on ${port}: the app started its own cello server`)
  await expect(board.getByRole("button", { name: "New project" }).first()).toBeVisible()
  const lock = readLock(dataDir)
  expect(lock?.port).toBe(port)
  expect(isAlive(lock!.pid)).toBe(true)
  expect(await serverStatus(app)).toBe(`Server: started by this app (pid ${lock!.pid})`)
  await openAppMenu(app)
  await screenshotScreen(app, path.join(SCREENSHOTS_DIR, "server-status-started-by-this-app.png"))
  await closeAppMenu(app)

  await video.caption("Quit: the app started this server, so it asks what to do with it")
  await showQuitQuestion(app)
  await screenshotScreen(app, path.join(SCREENSHOTS_DIR, "quit-question.png"))
  await closeQuitQuestion(app)
  await video.caption("Cancel keeps the app open, and the server with it")
  await expect(board.getByRole("button", { name: "New project" }).first()).toBeVisible()
  expect(isAlive(lock!.pid)).toBe(true)

  await video.caption("Move and resize the window, then quit and pick Stop Server")
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]!.setBounds({ x: 120, y: 80, width: 1100, height: 720 }))
  await answerQuitQuestion(app, 1, asked)
  await recording!.stop()
  recording = null
  await app.close()

  expect(quitQuestions(asked).map((q) => [q.message, q.buttons])).toEqual([
    ["Keep Cello running for your agents?", ["Keep Running", "Stop Server", "Install Background Service", "Cancel"]],
  ])
  expect(readLock(dataDir)).toBeNull()
  expect(isAlive(lock!.pid)).toBe(false)
  expect(JSON.parse(fs.readFileSync(path.join(userData, "server-on-quit.json"), "utf8"))).toEqual({ onQuit: "stop" })
  const saved = JSON.parse(fs.readFileSync(path.join(userData, "window-state.json"), "utf8"))
  expect(saved.bounds).toEqual({ x: 120, y: 80, width: 1100, height: 720 })

  // Stop was remembered: the next launch starts its own server again, and quitting stops it without asking.
  const again = await launchApp(env)
  await appPages(again, url)
  const second = readLock(dataDir)
  expect(isAlive(second!.pid)).toBe(true)
  await answerQuitQuestion(again, 0, asked)
  await again.close()
  expect(quitQuestions(asked)).toHaveLength(1)
  expect(isAlive(second!.pid)).toBe(false)
})

test("CEL-81: Keep Running leaves the server up after the app quits, so agents keep working; the next launch joins it", async ({}, testInfo) => {
  const dataDir = tempDir("cello-desktop-e2e-")
  const userData = tempDir("cello-desktop-user-")
  const asked = path.join(tempDir("cello-desktop-asked-"), "questions.jsonl")
  const port = await freePort()
  const url = `http://127.0.0.1:${port}`
  const env = { CELLO_PORT: String(port), CELLO_DATA_DIR: dataDir, CELLO_DESKTOP_USER_DATA: userData, CELLO_BIN }
  const app = await launchApp(env)
  const video = record(app, testInfo.title)
  const { board } = await appPages(app, url)
  await expect(board.getByRole("button", { name: "New project" }).first()).toBeVisible()
  const started = readLock(dataDir)!

  await video.caption("Quit and pick Keep Running")
  await answerQuitQuestion(app, 0, asked)
  await recording!.stop()
  recording = null
  await quitApp(app)

  // A server of its own took over before the app exited: another pid, on the same port.
  const kept = readLock(dataDir)!
  killOnCleanup(kept.pid)
  expect(kept.pid).not.toBe(started.pid)
  expect(kept.port).toBe(port)
  expect(isAlive(kept.pid)).toBe(true)
  expect(isAlive(started.pid)).toBe(false)
  expect(JSON.parse(celloAsAgent(port, "whoami")).server.build.version).toEqual(expect.any(String))
  expect(fs.readFileSync(path.join(dataDir, "logs/server.log"), "utf8")).toContain(`Cello is running at ${url}`)
  expect(JSON.parse(fs.readFileSync(path.join(userData, "server-on-quit.json"), "utf8"))).toEqual({ onQuit: "keep" })

  // The next launch joins it, says so, and quitting leaves it running without asking.
  const again = await launchApp(env)
  const next = record(again, "CEL-81: after Keep Running, the next launch joins the server that kept running")
  const pages = await appPages(again, url)
  await expect(pages.board.getByRole("button", { name: "New project" }).first()).toBeVisible()
  await next.caption("The next launch joins the server that kept running")
  expect(await serverStatus(again)).toBe(`Server: started outside the app (pid ${kept.pid})`)
  await answerQuitQuestion(again, 1, asked)
  await recording!.stop()
  recording = null
  await again.close()
  expect(quitQuestions(asked)).toHaveLength(1)
  expect(isAlive(kept.pid)).toBe(true)
})

test("CEL-81: with the background service installed, the app joins it, says so in the menu, and never stops it on quit", async ({}, testInfo) => {
  const dataDir = tempDir("cello-desktop-e2e-")
  const home = tempDir("cello-desktop-home-")
  const asked = path.join(tempDir("cello-desktop-asked-"), "questions.jsonl")
  // The service's server: `cello start`, as launchd would run it; its plist in the temp HOME; and a fake
  // launchctl that reports that server's pid as the job's.
  const server = await startCello(dataDir)
  const scratch = tempDir("cello-desktop-launchd-")
  writeFakeLaunchctl(path.join(scratch, "bin"), path.join(scratch, "state"), process.getuid!())
  fs.writeFileSync(path.join(scratch, "state/loaded"), "")
  fs.writeFileSync(path.join(scratch, "state/pid"), String(server.pid))
  writeServicePlist(home, dataDir, server.port, CELLO_BIN)
  const app = await launchApp({
    CELLO_PORT: String(server.port),
    CELLO_DATA_DIR: dataDir,
    CELLO_DESKTOP_USER_DATA: tempDir("cello-desktop-user-"),
    CELLO_BIN,
    HOME: home,
    PATH: `${path.join(scratch, "bin")}:${process.env.PATH}`,
  })
  const video = record(app, testInfo.title)
  const { board } = await appPages(app, server.url)
  await video.caption("The background service already runs the server: the app joins it")
  await expect(board.getByRole("button", { name: "New project" }).first()).toBeVisible()

  await video.caption("launchd's job is the pid holding the data folder, so the app menu says background service")
  expect(await serverStatus(app)).toBe(`Server: background service (pid ${server.pid})`)
  await openAppMenu(app)
  await screenshotScreen(app, path.join(SCREENSHOTS_DIR, "server-status-background-service.png"))
  await closeAppMenu(app)

  await video.caption("Quit: no question, and the service keeps running")
  await answerQuitQuestion(app, 1, asked)
  await recording!.stop()
  recording = null
  await app.close()
  expect(quitQuestions(asked)).toEqual([])
  expect(isAlive(server.pid)).toBe(true)
  expect(JSON.parse(celloAsAgent(server.port, "whoami")).server.build.version).toEqual(expect.any(String))
})

test("CEL-81: a service plist whose program is gone doesn't lock the app out: it starts its own server and says why in the menu", async ({}, testInfo) => {
  const dataDir = tempDir("cello-desktop-e2e-")
  const home = tempDir("cello-desktop-home-")
  const scratch = tempDir("cello-desktop-launchd-")
  const asked = path.join(scratch, "questions.jsonl")
  // A plist left behind: its program is gone, and launchd doesn't have the job loaded (kickstart fails).
  writeFakeLaunchctl(path.join(scratch, "bin"), path.join(scratch, "state"), process.getuid!())
  const port = await freePort()
  writeServicePlist(home, dataDir, port, path.join(scratch, "moved-away/cello"))
  const app = await launchApp({
    CELLO_PORT: String(port),
    CELLO_DATA_DIR: dataDir,
    CELLO_DESKTOP_USER_DATA: tempDir("cello-desktop-user-"),
    CELLO_BIN,
    HOME: home,
    PATH: `${path.join(scratch, "bin")}:${process.env.PATH}`,
  })
  const video = record(app, testInfo.title)
  const { board } = await appPages(app, `http://127.0.0.1:${port}`)
  await video.caption("The service's plist is stale: launchd couldn't start it, so the app started its own server")
  await expect(board.getByRole("button", { name: "New project" }).first()).toBeVisible()
  const lock = readLock(dataDir)!
  expect(await serverStatus(app)).toBe(`Server: started by this app (pid ${lock.pid})`)
  expect(await serviceProblem(app)).toMatch(/^Background service didn't start: launchctl couldn't start it/)
  await openAppMenu(app)
  await screenshotScreen(app, path.join(SCREENSHOTS_DIR, "server-status-service-didnt-start.png"))
  await closeAppMenu(app)

  await video.caption("Quit asks, as without a service: the broken service can't take over")
  await answerQuitQuestion(app, 1, asked)
  await recording!.stop()
  recording = null
  await app.close()
  expect(quitQuestions(asked)).toHaveLength(1)
  expect(isAlive(lock.pid)).toBe(false)
})

test("CEL-81: when Keep Running's new server doesn't start, the app says so, stays open and starts its server again", async ({}, testInfo) => {
  const dataDir = tempDir("cello-desktop-e2e-")
  const userData = tempDir("cello-desktop-user-")
  const scratch = tempDir("cello-desktop-keep-")
  const asked = path.join(scratch, "questions.jsonl")
  // A cello that works, except the second time it's run: the detached server Keep Running starts.
  const flaky = path.join(scratch, "cello")
  fs.writeFileSync(flaky, [
    "#!/bin/sh",
    `n=$(ls ${scratch}/run-* 2>/dev/null | wc -l)`,
    `: > ${scratch}/run-$n`,
    `if [ "$n" -eq 1 ]; then echo "cello start failed (the test's flaky cello)" >&2; exit 1; fi`,
    `exec ${CELLO_BIN} "$@"`,
    "",
  ].join("\n"), { mode: 0o755 })
  const port = await freePort()
  const url = `http://127.0.0.1:${port}`
  const app = await launchApp({ CELLO_PORT: String(port), CELLO_DATA_DIR: dataDir, CELLO_DESKTOP_USER_DATA: userData, CELLO_BIN: flaky })
  const video = record(app, testInfo.title)
  const { board } = await appPages(app, url)
  await expect(board.getByRole("button", { name: "New project" }).first()).toBeVisible()
  const first = readLock(dataDir)!

  await video.caption("Quit and pick Keep Running; the server meant to take over won't start")
  await answerQuitThenShowNext(app, 0, asked)
  const reopened = new Promise<Page[]>((resolve) => {
    const pages: Page[] = []
    app.on("window", (page) => {
      pages.push(page)
      if (pages.length === 3) resolve(pages)
    })
  })
  await startQuit(app)
  await nextDialogShown(app)
  await screenshotScreen(app, path.join(SCREENSHOTS_DIR, "keep-running-failed.png"))
  expect(quitQuestions(asked).map((q) => q.message)).toEqual(["Keep Cello running for your agents?", "Cello couldn't keep its server running"])
  await closeNextDialog(app)

  // The app stays open: a new window on a server of its own.
  const pages = await reopened
  const again = await Promise.any(pages.map((page) => page.waitForURL((u) => u.href.startsWith(url)).then(() => page)))
  await video.caption("Cello said so, stayed open, and started its server again")
  await expect(again.getByRole("button", { name: "New project" }).first()).toBeVisible()
  const second = readLock(dataDir)!
  expect(second.pid).not.toBe(first.pid)
  expect(isAlive(second.pid)).toBe(true)
  expect(await serverStatus(app)).toBe(`Server: started by this app (pid ${second.pid})`)

  // Stop on the way out, so the test leaves no server behind.
  fs.writeFileSync(path.join(userData, "server-on-quit.json"), JSON.stringify({ onQuit: "stop" }))
  await recording!.stop()
  recording = null
  await app.close()
  expect(isAlive(second.pid)).toBe(false)
})

test("CEL-81: Install Background Service stops the app's server and runs `cello service install` (a fake launchctl, a temp HOME)", async ({}, testInfo) => {
  const dataDir = tempDir("cello-desktop-e2e-")
  const userData = tempDir("cello-desktop-user-")
  const home = tempDir("cello-desktop-home-")
  const scratch = tempDir("cello-desktop-launchd-")
  const asked = path.join(scratch, "questions.jsonl")
  const uid = process.getuid!()
  const { calls } = writeFakeLaunchctl(path.join(scratch, "bin"), path.join(scratch, "state"), uid)
  const port = await freePort()
  const url = `http://127.0.0.1:${port}`
  const app = await launchApp({
    CELLO_PORT: String(port),
    CELLO_DATA_DIR: dataDir,
    CELLO_DESKTOP_USER_DATA: userData,
    CELLO_BIN,
    HOME: home,
    PATH: `${path.join(scratch, "bin")}:${process.env.PATH}`,
  })
  const video = record(app, testInfo.title)
  const { board } = await appPages(app, url)
  await expect(board.getByRole("button", { name: "New project" }).first()).toBeVisible()
  const started = readLock(dataDir)!

  await video.caption("Quit and pick Install Background Service")
  await answerQuitQuestion(app, 2, asked)
  await recording!.stop()
  recording = null
  await app.close()

  expect(isAlive(started.pid)).toBe(false)
  const plist = path.join(home, "Library/LaunchAgents/dev.cello.server.plist")
  const installed = parsePlist(fs.readFileSync(plist, "utf8"))
  expect(installed).toMatchObject({ program: [fs.realpathSync(CELLO_BIN), "start"], dataDir, port, logPath: path.join(dataDir, "logs/server.log") })
  expect(calls()).toEqual([`enable gui/${uid}/dev.cello.server`, `bootstrap gui/${uid} ${plist}`])
  // Install isn't a remembered answer: once the service is there, quitting never asks.
  expect(fs.existsSync(path.join(userData, "server-on-quit.json"))).toBe(false)
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
