// Cello for macOS. Finds or starts the Cello server (sidecar.ts), shows the board in the main window
// with a browser panel on its right, and handles `cello://` links. One instance at a time: a second
// launch hands its link to the running app and quits.
import { execFile } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { plistPath, SERVICE_LABEL, serviceLogPath } from "@cello/shared/launchAgent"
import { app, BaseWindow, dialog, Menu, session, webContents } from "electron"
import { findCelloLink, parseCelloLink, routeCelloLink, SCHEME, type CelloLink } from "./links/celloLink.ts"
import { INSTALLED_APP } from "./install/plan.ts"
import { buildMenu, type MenuActions } from "./menu.ts"
import { PANEL_PARTITION } from "./panel/Panel.ts"
import { celloCommand, serverConfig, serviceFor, serviceInstaller } from "./server/plan.ts"
import { answerOf, parseQuitChoice, planQuit, QUIT_CHOICE_FILE, QUIT_QUESTION, type QuitAnswer, type QuitChoice, serverStatusLabel } from "./server/quit.ts"
import { connectServer, installService, lockHolder, type Server, startDetached } from "./server/sidecar.ts"
import { appNotice, boardNotice, bundleOf, relaunchOptions, restartTarget, stampFile, type AppNotice } from "./update/appUpdate.ts"
import { MainWindow } from "./window/MainWindow.ts"

// A closed stdout (the app started from a pipe that went away) must not crash the app.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") throw error
  })
}

app.setName("Cello")
// Dev and the packaged app keep separate state; tests point CELLO_DESKTOP_USER_DATA at a temp folder.
app.setPath(
  "userData",
  process.env.CELLO_DESKTOP_USER_DATA || path.join(app.getPath("appData"), app.isPackaged ? "Cello" : "Cello Dev"),
)

/** The app folder (apps/desktop, or app.asar when packaged); scripts/build.ts bundles into its dist-electron/. */
const appPath = app.getAppPath()
const files = {
  preload: path.join(appPath, "dist-electron/preload.cjs"),
  chromePreload: path.join(appPath, "dist-electron/chrome-preload.cjs"),
  chromeHtml: path.join(appPath, "dist-electron/chrome.html"),
  devIcon: path.join(appPath, "resources/icon.png"),
  repoRoot: path.resolve(appPath, "../.."),
  stamp: stampFile({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath }),
}

/** The stamp of the build on disk now (scripts/build.ts writes it); null while it's missing. */
const readStamp = (): string | null => {
  try {
    return fs.readFileSync(files.stamp, "utf8").trim() || null
  } catch {
    return null
  }
}

/** Allowed for the board (our own page) and for panel pages (any site); everything else is denied. */
const BOARD_PERMISSIONS: ReadonlySet<string> = new Set(["clipboard-sanitized-write", "fullscreen"])
const PANEL_PERMISSIONS: ReadonlySet<string> = new Set(["clipboard-sanitized-write", "fullscreen", "pointerLock", "loopback-network"])

if (!app.requestSingleInstanceLock()) {
  // exit, not quit: quit is asynchronous and this instance has nothing to clean up.
  app.exit(0)
} else {
  run()
}

function run() {
  let main: MainWindow | null = null
  let server: Server | null = null
  let boardLoaded = false
  /** Links that arrived before the board was up (macOS sends a launch link to open-url early). */
  const pending: CelloLink[] = []
  /** The build this process loaded, to tell when another replaced it on disk (CEL-75). */
  const loadedStamp = readStamp()
  let notice: AppNotice | null = null
  /** A Restart into a new build: quitting doesn't ask about the server then; the new app starts its own. */
  let restarting = false

  /** The main window, unless it was closed (macOS keeps the app running without one). */
  const live = () => (main && !main.isClosed ? main : null)

  const config = serverConfig(process.env)
  /** The `cello` the app starts servers with. */
  const appCommand = () =>
    celloCommand({ env: process.env, isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, repoRoot: files.repoRoot, exists: fs.existsSync })

  /** A background service is installed for this data folder (CEL-81): its plist in ~/Library/LaunchAgents names it. */
  const serviceInstalled = () => {
    try {
      return serviceFor(fs.readFileSync(plistPath(process.env.HOME || os.homedir()), "utf8"), config.dataDir)
    } catch {
      return false
    }
  }
  /** Asks launchd to start the installed service (a no-op when it already runs). */
  const startService = () =>
    new Promise<void>((resolve, reject) =>
      execFile("launchctl", ["kickstart", `gui/${process.getuid?.() ?? 0}/${SERVICE_LABEL}`], (error) => (error ? reject(error) : resolve())))

  /** Keep or Stop, as answered to the quit question; null until it was answered. */
  const choiceFile = path.join(app.getPath("userData"), QUIT_CHOICE_FILE)
  const rememberedChoice = () => {
    try {
      return parseQuitChoice(fs.readFileSync(choiceFile, "utf8"))
    } catch {
      return null
    }
  }
  const remember = (choice: QuitChoice) => {
    try {
      fs.writeFileSync(choiceFile, JSON.stringify({ onQuit: choice }))
    } catch {}
  }

  let menuActions: MenuActions | null = null
  let menuStatus: string | null = null
  /** Builds the menu again when the server status line changed: after connecting, and when the window takes focus. */
  const refreshMenu = () => {
    if (!menuActions) return
    const status = serverStatusLabel(server && { startedByUs: server.startedByUs, service: serviceInstalled(), pid: lockHolder(config.dataDir) })
    if (status === menuStatus) return
    menuStatus = status
    Menu.setApplicationMenu(buildMenu(app.name, menuActions, status))
  }

  /**
   * Whether to offer a restart: another build replaced this one on disk, or this copy isn't
   * /Applications' (src/update/appUpdate.ts). Checked when the window takes focus and when a link arrives.
   */
  const checkForUpdate = () => {
    notice = appNotice({
      execPath: process.execPath,
      bundle: app.isPackaged ? bundleOf(process.execPath) : null,
      loaded: loadedStamp,
      onDisk: readStamp(),
      installed: INSTALLED_APP,
      installedExists: process.platform === "darwin" && fs.existsSync(INSTALLED_APP),
    })
    live()?.showAppNotice(notice && boardNotice(notice))
  }

  /**
   * The notice's Restart: quits (stopping a server the app started) and starts the new build. The notice
   * is checked again first, and nothing happens while the executable to start isn't on disk (an install
   * halfway through), so the board keeps showing it.
   */
  const restart = () => {
    checkForUpdate()
    const target = restartTarget(notice, process.execPath, fs.existsSync)
    if (!target) return
    restarting = true
    // The new instance starts once this one exits; without the lock released it could find it still
    // held, hand its arguments to this exiting instance and quit.
    app.releaseSingleInstanceLock()
    app.relaunch(relaunchOptions(target, process))
    app.quit()
  }

  /** Brings the main window forward, opening a new one on the board if it was closed. */
  const showWindow = (): MainWindow | null => {
    const current = live()
    if (current) {
      current.focus()
      return current
    }
    if (!server || !boardLoaded) return null
    const window = openWindow()
    void window.loadBoard(server.url)
    return window
  }

  const follow = (raw: string) => {
    const link = parseCelloLink(raw)
    if (!link) return
    checkForUpdate()
    const window = boardLoaded ? showWindow() : null
    if (!window || !server) {
      pending.push(link)
      return
    }
    open(window, server.url, link)
  }

  /** Follows a link once the board is up: a task or a page on the board to the board, another site to the browser panel. */
  const open = (window: MainWindow, boardOrigin: string, link: CelloLink) => {
    const route = routeCelloLink(link, boardOrigin)
    if (route.kind === "task") void window.loadBoard(boardOrigin, route.path)
    else if (route.kind === "board") window.openInBoard(route.url)
    else window.panel.open(route.url)
  }

  app.on("open-url", (event, url) => {
    event.preventDefault()
    follow(url)
  })
  app.on("second-instance", (_event, argv) => {
    const link = findCelloLink(argv)
    if (link) follow(link)
    else showWindow()
  })
  const launchLink = findCelloLink(process.argv)
  if (launchLink) follow(launchLink)
  // In dev, registering would point cello:// at the bare Electron binary; the packaged app also
  // declares the scheme in its Info.plist (electron-builder.json).
  if (app.isPackaged) app.setAsDefaultProtocolClient(SCHEME)

  const openWindow = () => {
    main = new MainWindow({
      statePath: path.join(app.getPath("userData"), "window-state.json"),
      preload: files.preload,
      chromePreload: files.chromePreload,
      chromeHtml: files.chromeHtml,
      platform: process.platform,
      restartApp: restart,
    })
    main.window.on("focus", () => {
      checkForUpdate()
      refreshMenu()
    })
    checkForUpdate()
    return main
  }

  const connect = async (window: MainWindow): Promise<Server | null> => {
    const { port, dataDir } = config
    const command = appCommand()
    for (;;) {
      try {
        return await connectServer({
          port,
          dataDir,
          command: command ? [command] : null,
          env: process.env,
          log: (text) => process.stdout.write(text),
          service: { installed: serviceInstalled(), start: startService },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        window.showMessage(message)
        const { response } = await dialog.showMessageBox({
          type: "error",
          message: "Cello couldn't reach its server",
          detail: message,
          buttons: ["Try Again", "Quit"],
          defaultId: 0,
          cancelId: 1,
        })
        if (response === 1) return null
      }
    }
  }

  app.whenReady().then(async () => {
    for (const [target, allowed] of [
      [session.defaultSession, BOARD_PERMISSIONS],
      [session.fromPartition(PANEL_PARTITION), PANEL_PERMISSIONS],
    ] as const) {
      target.setPermissionRequestHandler((_contents, permission, callback) => callback(allowed.has(permission)))
      target.setPermissionCheckHandler((_contents, permission) => allowed.has(permission))
    }
    menuActions = {
      target: () => live()?.focusedContents(webContents.getFocusedWebContents()) ?? null,
      togglePanel: () => live()?.panel.toggle(),
      focusAddress: () => {
        live()?.panel.show()
        live()?.panel.focusAddress()
      },
      toggleFullScreen: () => {
        const window = live()?.window
        window?.setFullScreen(!window.isFullScreen())
      },
      go: (direction) => live()?.go(direction, webContents.getFocusedWebContents()),
    }
    refreshMenu()
    if (!app.isPackaged && fs.existsSync(files.devIcon)) app.dock?.setIcon(files.devIcon)

    const window = openWindow()
    window.showMessage("Starting Cello…")
    server = await connect(window)
    if (!server) return app.quit()
    refreshMenu()
    // A task link that launched the app decides the first page; page links open once it's up.
    const task = pending.find((link) => link.kind === "task")
    if (!window.isClosed) await window.loadBoard(server.url, task?.kind === "task" ? task.path : "/")
    boardLoaded = true
    for (const link of pending.splice(0)) {
      const current = live()
      if (link.kind === "panel" && current) open(current, server.url, link)
    }
  })

  // macOS keeps the app running with no window; the dock icon brings the board back.
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })
  app.on("activate", () => {
    if (BaseWindow.getAllWindows().length === 0) showWindow()
  })

  /**
   * What quitting does to a server the app started (CEL-81, quit.ts): asks the first time, then keeps
   * it running on its own, stops it, or installs the background service in its place. False when Lucas
   * cancelled, and the app stays open.
   */
  const settleServer = async (running: Server, plan: "ask" | QuitChoice): Promise<boolean> => {
    // On the window when there is one (a sheet on macOS); the app may be quitting with none open.
    const window = live()?.window
    const ask = () => (window ? dialog.showMessageBox(window, QUIT_QUESTION) : dialog.showMessageBox(QUIT_QUESTION))
    let answer: QuitAnswer = plan === "ask" ? answerOf((await ask()).response) : plan
    if (answer === "cancel") return false
    if (plan === "ask" && answer !== "install") remember(answer)
    // Close the window first, so the board's WebSocket ends cleanly instead of being cut off; the
    // server stops within about a second either way (CEL-17). Closing (not destroying) still saves
    // the window's size and position.
    for (const window of BaseWindow.getAllWindows()) window.close()
    await running.stop()
    if (answer === "install") {
      const installer = serviceInstaller({ env: process.env, exists: fs.existsSync, fallback: appCommand() })
      const installed = installer
        ? await installService({ command: installer, port: Number(new URL(running.url).port), dataDir: config.dataDir, env: process.env })
        : { ok: false, output: "There's no cello binary to install the service with." }
      if (installed.ok) return true
      await dialog.showMessageBox({
        type: "error",
        message: "Cello couldn't install the background service",
        detail: `${installed.output}\n\nThe server keeps running until the Mac restarts; \`cello service install\` in a terminal tries again.`,
      })
      answer = "keep"
    }
    const command = appCommand()
    if (answer === "keep" && command) {
      // The app's child can't outlive it (its output is piped to the app), so a fresh one takes over.
      await startDetached({ command: [command], url: running.url, dataDir: config.dataDir, env: process.env, logPath: serviceLogPath(config.dataDir) })
    }
    return true
  }

  // A server the app joined is never stopped; one it started is settled first, then the app quits again.
  let settling: Promise<void> | null = null
  let settled = false
  app.on("before-quit", (event) => {
    if (settled || !server) return
    const plan = planQuit({ startedByUs: server.startedByUs, service: serviceInstalled(), remembered: restarting ? "stop" : rememberedChoice() })
    if (plan === "leave") return
    event.preventDefault()
    settling ??= settleServer(server, plan).then((quit) => {
      settling = null
      if (!quit) return
      settled = true
      app.quit()
    })
  })
}
