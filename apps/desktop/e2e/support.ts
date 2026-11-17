// Shared steps for the desktop e2e tests: temp folders, free ports, `cello start` servers, a local
// test site, launching the app, and finding its three views (board, panel toolbar, panel page).
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import * as fs from "node:fs"
import * as http from "node:http"
import * as net from "node:net"
import { createRequire } from "node:module"
import * as os from "node:os"
import * as path from "node:path"
import { _electron, chromium, type ElectronApplication, type Page } from "@playwright/test"
import { assertDesktopE2eAllowed, IN_CONTAINER } from "../../../scripts/docker/guard.ts"
import { celloScheme } from "@cello/shared/celloLink"
import { plistPath, renderPlist, serviceLogPath } from "@cello/shared/launchAgent"
import { isAlive } from "../../server/src/process/isAlive.ts"
import { LOCK_FILE, parseBanner, parseLock, type LockInfo } from "../src/server/plan.ts"

// Every test that launches Electron imports this file, so the Mac is refused here too, whichever
// config ran the tests (`-c apps/desktop/e2e` uses Playwright's default one and skips ours).
assertDesktopE2eAllowed()

export const DESKTOP_DIR = path.resolve(import.meta.dirname, "..")
export const CLI_DIR = path.resolve(DESKTOP_DIR, "../cli")
export const CELLO_BIN = path.join(CLI_DIR, "dist/cello")
export const VIDEOS_DIR = path.join(DESKTOP_DIR, "test-results/videos")
export const SCREENSHOTS_DIR = path.join(DESKTOP_DIR, "test-results/screenshots")
/**
 * The scheme of the links these tests open: the app and the `cello` the tests build are the dev flavor
 * (scripts/build.ts and apps/cli/scripts/build.ts default to it, CEL-149), so `cello-dev://`.
 */
export const LINK_SCHEME = celloScheme("dev")
/** Electron's package exports the path of its binary. */
export const ELECTRON = createRequire(path.join(DESKTOP_DIR, "package.json"))("electron") as string

export { isAlive }

/** The modifier Electron's CommandOrControl means here: ⌘ on macOS, Ctrl on Linux (the Docker run). */
export const COMMAND_OR_CONTROL = process.platform === "darwin" ? "meta" : "control"
/** The panel's shortcut as captions spell it. */
export const TOGGLE_PANEL_KEYS = process.platform === "darwin" ? "⌘\\" : "Ctrl+\\"

/**
 * Chromium switches for the Docker run (Linux under Xvfb), none on the Mac:
 * - `--no-sandbox` when running as root, which the container does: Chromium won't start as root
 *   with its sandbox on. The container is the sandbox: a throwaway Linux box with the repo
 *   read-only and nothing of the Mac's. Playwright runs its own Chromium without it as well.
 * - `--force-device-scale-factor=2`: Xvfb has no Retina, so this makes screenshots as sharp as the
 *   Mac's (2880 px wide for the 1440 px window) instead of 1x captures scaled up.
 * - `--hide-scrollbars`: macOS shows overlay scrollbars only while scrolling; Linux would draw
 *   classic ones in every frame. Playwright's headless browser for the web e2e hides them too.
 */
const inContainer = process.env[IN_CONTAINER.name] === IN_CONTAINER.value
const ELECTRON_FLAGS = inContainer
  ? [...(process.getuid?.() === 0 ? ["--no-sandbox"] : []), "--force-device-scale-factor=2", "--hide-scrollbars"]
  : []

/** Ports the real board, the dev server and Vite use; tests never touch them. */
const RESERVED_PORTS = new Set([4747, 4748, 5199])

const cleanups: Array<() => void | Promise<void>> = []
/** Runs everything registered with `onCleanup`, last first. Call it from afterEach. */
export const cleanup = async () => {
  for (const run of cleanups.splice(0).reverse()) await run()
}
const onCleanup = (run: () => void | Promise<void>) => cleanups.push(run)

/** A temp folder (under the OS temp dir, never ~/.cello), removed after the test. */
export const tempDir = (prefix: string) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  onCleanup(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** A writer for `file` (a build output, say); what was there comes back after the test. */
export const overwrite = (file: string): ((text: string) => void) => {
  const before = fs.readFileSync(file)
  onCleanup(() => fs.writeFileSync(file, before))
  return (text) => fs.writeFileSync(file, text)
}

export const freePort = async (): Promise<number> => {
  for (;;) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = net.createServer()
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as net.AddressInfo
        server.close(() => resolve(port))
      })
    })
    if (!RESERVED_PORTS.has(port)) return port
  }
}

/** PATH and HOME, plus Xvfb's display in the Docker run (unset on macOS). */
const baseEnv = (): Record<string, string> => ({
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? os.homedir(),
  ...Object.fromEntries((["DISPLAY", "XAUTHORITY"] as const).flatMap((name) => (process.env[name] ? [[name, process.env[name]]] : []))),
})

/** Stops a process this test started, by its pid, and waits for it to exit. */
const stopChild = (child: ChildProcess, signal: NodeJS.Signals = "SIGTERM") =>
  new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve()
    child.once("exit", () => resolve())
    process.kill(child.pid!, signal)
  })

export interface StartOptions {
  /** The port; 0 (the default) picks a free one. */
  readonly port?: number
  /** A web build to serve instead of the binary's own (CELLO_WEB_DIR). */
  readonly webDir?: string
}

/** `cello start` (the compiled binary) on a free port with a temp data folder, as Lucas's terminal would run it. */
export const startCello = async (
  dataDir: string,
  options: StartOptions = {},
): Promise<{ url: string; port: number; pid: number; kill: () => Promise<void> }> => {
  const child = spawn(CELLO_BIN, ["start"], {
    env: {
      ...baseEnv(),
      CELLO_PORT: String(options.port ?? 0),
      CELLO_DATA_DIR: dataDir,
      ...(options.webDir ? { CELLO_WEB_DIR: options.webDir } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  onCleanup(() => stopChild(child))
  const url = await new Promise<string>((resolve, reject) => {
    let output = ""
    child.stdout!.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk
      const found = parseBanner(output)
      if (found) resolve(found)
    })
    child.once("exit", (code) => reject(new Error(`cello start exited (${code}): ${output}`)))
  })
  // SIGKILL, for a restart: with the board connected a SIGTERM'd server still takes 20 s to exit
  // (CEL-17), and the next server takes over its stale lock either way.
  return { url, port: Number(new URL(url).port), pid: child.pid!, kill: () => stopChild(child, "SIGKILL") }
}

/** A real web build into `outDir` (`vite build`), stamped with `commit` (CEL-37); returns `outDir`. */
export const buildWeb = (outDir: string, commit: string): string => {
  const result = spawnSync("bunx", ["vite", "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "error"], {
    cwd: path.resolve(DESKTOP_DIR, "../web"),
    encoding: "utf8",
    env: { ...process.env, CELLO_BUILD_COMMIT: commit },
  })
  if (result.status !== 0) throw new Error(`vite build failed: ${result.stderr}`)
  return outDir
}

/** The bundle a build's index.html loads ("/assets/index-Dk3….js"): which build a page runs. */
export const entryOf = (dir: string): string =>
  /<script type="module" crossorigin src="([^"]+)"/.exec(fs.readFileSync(path.join(dir, "index.html"), "utf8"))![1]!

/** Runs the compiled `cello` CLI as a Claude Code session against the server on `port`, as an agent would. */
export const celloAsAgent = (port: number, ...args: string[]): string => {
  const result = spawnSync(CELLO_BIN, args, {
    cwd: os.tmpdir(),
    encoding: "utf8",
    env: { ...baseEnv(), CELLO_PORT: String(port), CLAUDE_CODE_SESSION_ID: "desktop0e2e-agent-session", CLAUDE_PID: String(process.pid) },
  })
  if (result.status !== 0) throw new Error(`cello ${args.join(" ")} failed: ${result.stderr}`)
  return result.stdout.trim()
}

/** A local site for the panel: a page with a link that opens a new window, and the page it links to. */
export const testSite = async (): Promise<{ url: string }> => {
  const pages: Record<string, string> = {
    "/": `<!doctype html><title>Panel test page</title><body style="font:16px system-ui;padding:24px">
      <h1>Cello panel test page</h1><p>Served by the e2e test on 127.0.0.1.</p>
      <p><a href="/second" target="_blank">Open the second page</a></p></body>`,
    "/second": `<!doctype html><title>Second page</title><body style="font:16px system-ui;padding:24px"><h1>Second test page</h1></body>`,
  }
  const server = http.createServer((request, response) => {
    const page = pages[new URL(request.url ?? "/", "http://x").pathname]
    response.writeHead(page ? 200 : 404, { "content-type": "text/html; charset=utf-8" })
    response.end(page ?? "Not found")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  onCleanup(() => new Promise<void>((resolve) => server.close(() => resolve())))
  return { url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/` }
}

export interface AppEnv {
  readonly CELLO_PORT: string
  readonly CELLO_DATA_DIR: string
  readonly CELLO_DESKTOP_USER_DATA: string
  readonly CELLO_BIN?: string
  /** A temp HOME, for a test about ~/Library/LaunchAgents (CEL-81); the test's own HOME otherwise. */
  readonly HOME?: string
  /** A PATH with a fake `launchctl` first (CEL-81). */
  readonly PATH?: string
  /** The release feed to check (CEL-140): a fake one; without it the unpackaged app checks nothing. */
  readonly CELLO_UPDATE_FEED?: string
  /** The version the app says it runs, in place of apps/desktop/package.json's (CEL-140). */
  readonly CELLO_APP_VERSION?: string
  /** Where it saves DMGs, in place of ~/Downloads (CEL-140). */
  readonly CELLO_UPDATE_DOWNLOADS?: string
}

/** A background service's plist in `home`, as `cello service install` writes it (CEL-81). */
export const writeServicePlist = (home: string, dataDir: string, port: number, program: string) => {
  const plist = plistPath(home)
  fs.mkdirSync(path.dirname(plist), { recursive: true })
  fs.writeFileSync(plist, renderPlist({ program: [program, "start"], home, path: "/usr/bin:/bin", dataDir, port, logPath: serviceLogPath(dataDir) }))
  return plist
}

/** Kills `pid` (a server the app left running, say) by that pid when the test ends. */
export const killOnCleanup = (pid: number) =>
  onCleanup(() => {
    if (isAlive(pid)) process.kill(pid, "SIGKILL")
  })

/**
 * Quits the app and waits for its process to exit. `app.close()` also waits for the app's output pipes
 * to close, and a server the app left running (Keep Running, CEL-81) inherits them on Linux, where
 * libuv forks without closing inherited descriptors; they close when the test kills that server.
 */
export const quitApp = async (app: ElectronApplication) => {
  const proc = app.process()
  if (proc.exitCode !== null || proc.signalCode !== null) return
  const exited = new Promise<void>((resolve) => proc.once("exit", () => resolve()))
  await app.evaluate(({ app: electronApp }) => {
    setImmediate(() => electronApp.quit())
  })
  await exited
}

/** The app menu's server status line (CEL-81). */
export const serverStatus = (app: ElectronApplication) =>
  app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("server-status")?.label ?? null)

/**
 * Answers the quit question (CEL-81) with button `response` (0 Keep Running, 1 Stop Server, 2 Install
 * Background Service, 3 Cancel) instead of showing it, and appends each question asked to `record`
 * (one JSON line), which outlives the app.
 */
export const answerQuitQuestion = (app: ElectronApplication, response: number, record: string) =>
  app.evaluate(({ dialog }, { response, record }) => {
    const fs = process.getBuiltinModule("node:fs")
    dialog.showMessageBox = (async (...args: unknown[]) => {
      fs.appendFileSync(record, `${JSON.stringify(args.at(-1))}\n`)
      return { response, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  }, { response, record })

/**
 * Answers the quit question with `response`, then lets the next dialog (an error box) show for real,
 * for a screenshot; both are recorded to `record`. Await `nextDialogShown`, then `closeNextDialog`.
 */
export const answerQuitThenShowNext = (app: ElectronApplication, response: number, record: string) =>
  app.evaluate(({ dialog }, { response, record }) => {
    const fs = process.getBuiltinModule("node:fs")
    const original = dialog.showMessageBox.bind(dialog) as (...args: unknown[]) => Promise<Electron.MessageBoxReturnValue>
    const controller = new AbortController()
    let shown: () => void = () => {}
    const scope = globalThis as { nextDialogShown?: Promise<void>; closeNextDialog?: () => void }
    scope.nextDialogShown = new Promise<void>((resolve) => (shown = resolve))
    scope.closeNextDialog = () => controller.abort()
    let calls = 0
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = args.at(-1) as Electron.MessageBoxOptions
      fs.appendFileSync(record, `${JSON.stringify(options)}\n`)
      if (calls++ === 0) return { response, checkboxChecked: false }
      dialog.showMessageBox = original as typeof dialog.showMessageBox
      const result = original(...args.slice(0, -1), { ...options, signal: controller.signal })
      shown()
      return result
    }) as typeof dialog.showMessageBox
  }, { response, record })

/**
 * Shows the next message box for real (for a screenshot) and records its options to `record`; once the test
 * calls `closeNextDialog`, it closes and the app gets button `response`, as if it had been clicked (CEL-149).
 */
export const showNextDialogAnswering = (app: ElectronApplication, response: number, record: string) =>
  app.evaluate(({ dialog }, { response, record }) => {
    const fs = process.getBuiltinModule("node:fs")
    const original = dialog.showMessageBox.bind(dialog) as (...args: unknown[]) => Promise<Electron.MessageBoxReturnValue>
    const controller = new AbortController()
    let shown: () => void = () => {}
    const scope = globalThis as { nextDialogShown?: Promise<void>; closeNextDialog?: () => void }
    scope.nextDialogShown = new Promise<void>((resolve) => (shown = resolve))
    scope.closeNextDialog = () => controller.abort()
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = args.at(-1) as Electron.MessageBoxOptions
      fs.appendFileSync(record, `${JSON.stringify(options)}\n`)
      dialog.showMessageBox = original as typeof dialog.showMessageBox
      const closed = original(...args.slice(0, -1), { ...options, signal: controller.signal })
      shown()
      await closed
      return { response, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  }, { response, record })

/** Answers the next folder picker with `folder`, as if it had been chosen in it (CEL-149). */
export const pickFolderNext = (app: ElectronApplication, folder: string) =>
  app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as typeof dialog.showOpenDialog
  }, folder)

/** A board in `dataDir` made by this build's `cello start`, then stopped cleanly (its lock released). */
export const makeBoard = async (dataDir: string): Promise<void> => {
  const child = spawn(CELLO_BIN, ["start"], { env: { ...baseEnv(), CELLO_PORT: "0", CELLO_DATA_DIR: dataDir }, stdio: ["ignore", "pipe", "pipe"] })
  onCleanup(() => stopChild(child))
  await new Promise<void>((resolve, reject) => {
    let output = ""
    child.stdout!.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk
      if (parseBanner(output)) resolve()
    })
    child.once("exit", (code) => reject(new Error(`cello start exited (${code}): ${output}`)))
  })
  await stopChild(child)
}

export const nextDialogShown = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as { nextDialogShown?: Promise<void> }).nextDialogShown)

export const closeNextDialog = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as { closeNextDialog?: () => void }).closeNextDialog?.())

/** Starts quitting the app without waiting for it (a quit that may not happen). */
export const startQuit = (app: ElectronApplication) =>
  app.evaluate(({ app: electronApp }) => {
    setImmediate(() => electronApp.quit())
  })

/** The app menu's line saying why the background service didn't start; null when there's none. */
export const serviceProblem = (app: ElectronApplication) =>
  app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("service-problem")?.label ?? null)

/** The questions `answerQuitQuestion` recorded. */
export const quitQuestions = (record: string): Array<{ message: string; buttons: string[] }> =>
  fs.existsSync(record) ? fs.readFileSync(record, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : []

/**
 * Starts quitting and lets the real quit question show (for a screenshot of it); resolves once the app
 * has called for it. `closeQuitQuestion` dismisses it as Cancel, so the app stays open.
 */
export const showQuitQuestion = (app: ElectronApplication) =>
  app.evaluate(({ app: electronApp, dialog }) =>
    new Promise<void>((resolve) => {
      const original = dialog.showMessageBox.bind(dialog) as (...args: unknown[]) => Promise<Electron.MessageBoxReturnValue>
      const controller = new AbortController()
      ;(globalThis as { closeQuitQuestion?: () => void }).closeQuitQuestion = () => controller.abort()
      dialog.showMessageBox = ((...args: unknown[]) => {
        dialog.showMessageBox = original as typeof dialog.showMessageBox
        const options = args.at(-1) as Electron.MessageBoxOptions
        const shown = original(...args.slice(0, -1), { ...options, signal: controller.signal })
        resolve()
        return shown
      }) as typeof dialog.showMessageBox
      electronApp.quit()
    }))

export const closeQuitQuestion = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as { closeQuitQuestion?: () => void }).closeQuitQuestion?.())

/** Opens the app menu (Cello ▸) as a popup over the window, for a screenshot of its server status line. */
export const openAppMenu = (app: ElectronApplication) =>
  app.evaluate(({ BaseWindow, Menu }) => {
    const window = BaseWindow.getAllWindows()[0]!
    Menu.getApplicationMenu()!.items[0]!.submenu!.popup({ window, x: 24, y: 8 })
  })

export const closeAppMenu = (app: ElectronApplication) =>
  app.evaluate(({ BaseWindow, Menu }) => Menu.getApplicationMenu()!.items[0]!.submenu!.closePopup(BaseWindow.getAllWindows()[0]))

/**
 * A PNG of the whole X screen (Docker only: Xvfb's display), for what the window recorder can't see:
 * native dialogs and menus. Captures for `seconds` and keeps the last frame, so a window that is still
 * being mapped is in it; cropped to the screen's top-left corner through the main window (Xvfb has no
 * window manager, so a menu or dialog may sit anywhere from the corner to the window).
 */
export const screenshotScreen = async (app: ElectronApplication, file: string, seconds = 1.5) => {
  const display = process.env.DISPLAY
  if (!display) return
  const bounds = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]?.getBounds() ?? null)
  const scale = inContainer ? 2 : 1
  const crop = bounds
    ? ["-vf", `crop=${(Math.max(bounds.x, 0) + bounds.width) * scale}:${(Math.max(bounds.y, 0) + bounds.height) * scale}:0:0`]
    : []
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const result = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "x11grab", "-framerate", "4", "-t", String(seconds), "-i", display, ...crop, "-update", "1", file], {
    encoding: "utf8",
  })
  if (result.status !== 0) throw new Error(`ffmpeg x11grab failed: ${result.stderr}`)
}

/** The environment a launch gets: only what the test sets, plus PATH and HOME. */
export const appEnv = (env: AppEnv): Record<string, string> => ({ ...baseEnv(), ...env })

export const launchApp = async (env: AppEnv): Promise<ElectronApplication> => {
  const app = await _electron.launch({ executablePath: ELECTRON, args: [...ELECTRON_FLAGS, DESKTOP_DIR], env: appEnv(env) })
  let closed = false
  app.once("close", () => (closed = true))
  onCleanup(async () => {
    if (!closed) await app.close()
  })
  return app
}

/** The app's three views as Playwright pages, once the board has loaded from `boardUrl`. */
export const appPages = async (app: ElectronApplication, boardUrl: string): Promise<{ board: Page; chrome: Page; panel: Page }> => {
  while (app.windows().length < 3) await app.waitForEvent("window")
  const pages = app.windows()
  const withUrl = (test: (url: URL) => boolean) =>
    Promise.any(pages.map((page) => page.waitForURL(test, { waitUntil: "commit" }).then(() => page)))
  const board = await withUrl((url) => url.href.startsWith(boardUrl))
  const chrome = await withUrl((url) => url.href.endsWith("chrome.html"))
  const panel = pages.find((page) => page !== board && page !== chrome)!
  return { board, chrome, panel }
}

export interface ViewInfo {
  readonly bounds: { x: number; y: number; width: number; height: number }
  readonly visible: boolean
  readonly url: string
}

/** What the main window shows, from the main process: the board, the panel's chrome and its page. */
export const views = async (app: ElectronApplication): Promise<{ board: ViewInfo; chrome: ViewInfo; page: ViewInfo }> => {
  const [board, chrome, page] = await app.evaluate(({ BaseWindow }) =>
    BaseWindow.getAllWindows()[0]!.contentView.children.map((view) => ({
      bounds: view.getBounds(),
      visible: view.getVisible(),
      url: (view as Electron.WebContentsView).webContents.getURL(),
    })))
  return { board: board!, chrome: chrome!, page: page! }
}

/** The window's views, bottom to top. */
export const VIEW = { board: 0, chrome: 1, page: 2 } as const

/**
 * Presses a key in one of the window's views through Electron's own input path
 * (`webContents.sendInputEvent`), which runs `before-input-event` as a real key press does.
 * Playwright's keyboard goes through DevTools and never reaches it.
 */
export const pressKey = (app: ElectronApplication, view: number, keyCode: string, modifiers: ReadonlyArray<"meta" | "control" | "shift" | "alt">) =>
  app.evaluate(({ BaseWindow }, key) => {
    const contents = (BaseWindow.getAllWindows()[0]!.contentView.children[key.view] as Electron.WebContentsView).webContents
    contents.sendInputEvent({ type: "keyDown", keyCode: key.keyCode, modifiers: [...key.modifiers] })
    contents.sendInputEvent({ type: "keyUp", keyCode: key.keyCode, modifiers: [...key.modifiers] })
  }, { view, keyCode, modifiers })

export const readLock = (dataDir: string): LockInfo | null => {
  const file = path.join(dataDir, LOCK_FILE)
  return fs.existsSync(file) ? parseLock(fs.readFileSync(file, "utf8")) : null
}

/** Runs the app binary a second time with `args`; it should hand them to the running app and exit. */
export const secondLaunch = (env: AppEnv, args: ReadonlyArray<string>) =>
  new Promise<number | null>((resolve) => {
    const child = spawn(ELECTRON, [...ELECTRON_FLAGS, DESKTOP_DIR, ...args], { env: appEnv(env), stdio: "ignore" })
    child.once("exit", (code) => resolve(code))
  })

const DEVTOOLS_PORT_FILE = "DevToolsActivePort"

/**
 * Waits for the app a Restart starts (CEL-75), which Playwright didn't launch: it keeps Playwright's
 * `--remote-debugging-port=0`, so Chromium writes its DevTools port into the user data folder. Call it
 * before the Restart; resolves with that port once the new app has written it (an fs.watch event).
 */
export const watchForRelaunch = (userData: string): Promise<number> => {
  const file = path.join(userData, DEVTOOLS_PORT_FILE)
  // The running app wrote one at its own start.
  fs.rmSync(file, { force: true })
  return new Promise((resolve) => {
    const check = () => {
      const [port, endpoint] = (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "").split("\n")
      if (!port || !endpoint) return
      watcher.close()
      resolve(Number(port))
    }
    const watcher = fs.watch(userData, check)
  })
}

/**
 * The relaunched app's board, over the DevTools port `watchForRelaunch` found, and its pid. After the
 * test it's stopped by that pid, and the test waits for its DevTools connection to close.
 */
export const relaunchedApp = async (port: number, boardUrl: string): Promise<{ pid: number; board: Page }> => {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  // Chromium names its own processes; the browser process is the app's main process.
  const cdp = await browser.newBrowserCDPSession()
  const { processInfo } = (await cdp.send("SystemInfo.getProcessInfo")) as { processInfo: Array<{ type: string; id: number }> }
  const pid = processInfo.find((info) => info.type === "browser")?.id
  if (!pid) throw new Error(`No browser process in ${JSON.stringify(processInfo)}`)
  onCleanup(async () => {
    const gone = new Promise((resolve) => browser.once("disconnected", resolve))
    process.kill(pid, "SIGTERM")
    await gone
  })
  const context = browser.contexts()[0]!
  // The board, the panel's toolbar and the panel's page, as in appPages.
  while (context.pages().length < 3) await context.waitForEvent("page")
  const board = await Promise.any(context.pages().map((page) => page.waitForURL((url) => url.href.startsWith(boardUrl), { waitUntil: "commit" }).then(() => page)))
  return { pid, board }
}

/** "Joins a running server: the board loads" → "joins-a-running-server-the-board-loads" */
export const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80).replace(/-$/, "")
