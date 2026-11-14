// Shared steps for the desktop e2e tests: temp folders, free ports, `cello start` servers, a local
// test site, launching the app, and finding its three views (board, panel toolbar, panel page).
import { spawn, type ChildProcess } from "node:child_process"
import * as fs from "node:fs"
import * as http from "node:http"
import * as net from "node:net"
import { createRequire } from "node:module"
import * as os from "node:os"
import * as path from "node:path"
import { _electron, type ElectronApplication, type Page } from "@playwright/test"
import { isAlive } from "../../server/src/process/isAlive.ts"
import { LOCK_FILE, parseBanner, parseLock, type LockInfo } from "../src/server/plan.ts"

export const DESKTOP_DIR = path.resolve(import.meta.dirname, "..")
export const CLI_DIR = path.resolve(DESKTOP_DIR, "../cli")
export const CELLO_BIN = path.join(CLI_DIR, "dist/cello")
export const VIDEOS_DIR = path.join(DESKTOP_DIR, "test-results/videos")
export const SCREENSHOTS_DIR = path.join(DESKTOP_DIR, "test-results/screenshots")
/** Electron's package exports the path of its binary. */
export const ELECTRON = createRequire(path.join(DESKTOP_DIR, "package.json"))("electron") as string

export { isAlive }

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

const baseEnv = () => ({ PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? os.homedir() })

/** Stops a process this test started, by its pid, and waits for it to exit. */
const stopChild = (child: ChildProcess) =>
  new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve()
    child.once("exit", () => resolve())
    process.kill(child.pid!, "SIGTERM")
  })

/** `cello start` (the compiled binary) on a free port with a temp data folder, as Lucas's terminal would run it. */
export const startCello = async (dataDir: string): Promise<{ url: string; port: number; pid: number }> => {
  const child = spawn(CELLO_BIN, ["start"], {
    env: { ...baseEnv(), CELLO_PORT: "0", CELLO_DATA_DIR: dataDir },
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
  return { url, port: Number(new URL(url).port), pid: child.pid! }
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
}

/** The environment a launch gets: only what the test sets, plus PATH and HOME. */
export const appEnv = (env: AppEnv): Record<string, string> => ({ ...baseEnv(), ...env })

export const launchApp = async (env: AppEnv): Promise<ElectronApplication> => {
  const app = await _electron.launch({ executablePath: ELECTRON, args: [DESKTOP_DIR], env: appEnv(env) })
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
    const child = spawn(ELECTRON, [DESKTOP_DIR, ...args], { env: appEnv(env), stdio: "ignore" })
    child.once("exit", (code) => resolve(code))
  })

/** "Joins a running server: the board loads" → "joins-a-running-server-the-board-loads" */
export const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80).replace(/-$/, "")
