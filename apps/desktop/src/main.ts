// Cello for macOS. Finds or starts the Cello server (sidecar.ts), shows the board in the main window
// with a browser panel on its right, and handles `cello://` links. One instance at a time: a second
// launch hands its link to the running app and quits.
import { execFile } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { parseDesktopBoardCommand } from "@cello/domain/desktopBoard"
import { parseFlavor } from "@cello/release/flavor"
import { parsePrint, plistPath, serviceLogPath, serviceTarget } from "@cello/host/launchAgent"
import { parseUpdateCommand } from "@cello/release/updates"
import { app, BaseWindow, dialog, Menu, session, shell, webContents } from "electron"
import { appIdentity, executableOf, userDataName } from "./flavor.ts"
import { findCelloLink, parseCelloLink, routeCelloLink, type CelloLink } from "./links/celloLink.ts"
import { buildMenu, type MenuActions } from "./menu.ts"
import { PANEL_PARTITION } from "./panel/Panel.ts"
import {
  type Board,
  BOARD_FILE,
  boardFileText,
  boardState,
  checkBoard,
  defaultBoard,
  type FolderKind,
  isDefaultBoard,
  launchBoard,
  otherFolder,
  readBoardFile,
  type SavedBoard,
} from "./server/board.ts"
import { DB_FILE } from "@cello/host/serverLock"
import { celloCommand, isBoardTooNew, planServer, serviceFor, serviceInstaller, takenPortMessage } from "./server/plan.ts"
import { answerOf, parseQuitChoice, planQuit, QUIT_CHOICE_FILE, QUIT_QUESTION, type QuitAnswer, type QuitChoice, serverStatusLabel } from "./server/quit.ts"
import { connectServer, installService, lockHolder, type Server, startDetached, survey } from "./server/sidecar.ts"
import { appNotice, boardNotice, bundleOf, relaunchOptions, restartTarget, stampFile, type AppNotice } from "./update/appUpdate.ts"
import { downloadFile } from "./update/download.ts"
import { feedFor, githubFeed } from "./update/feed.ts"
import { CHECK_EVERY_MS, openDmg, Updater } from "./update/Updater.ts"
import { MainWindow } from "./window/MainWindow.ts"

// A closed stdout (the app started from a pipe that went away) must not crash the app.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") throw error
  })
}

/** scripts/build.ts bakes the flavor in (`--flavor`, CEL-149): Cello, or Cello Dev. */
declare const __CELLO_FLAVOR__: string | undefined
const identity = appIdentity(parseFlavor(typeof __CELLO_FLAVOR__ === "string" ? __CELLO_FLAVOR__ : null) ?? "dev")

app.setName(identity.name)
// Each app (Cello, Cello Dev) and a run from the repo keep separate state, so they run side by side; tests point
// CELLO_DESKTOP_USER_DATA at a temp folder.
app.setPath(
  "userData",
  process.env.CELLO_DESKTOP_USER_DATA || path.join(app.getPath("appData"), userDataName(identity, app.isPackaged)),
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

  /**
   * The update check (CEL-140). The packaged app reads GitHub's release list, and only that (`feedFor`).
   * A dev build checks nothing, so its board shows no update UI, unless CELLO_UPDATE_FEED names a test
   * feed (the e2e tests' fake one); only then do CELLO_APP_VERSION and CELLO_UPDATE_DOWNLOADS stand in for
   * the version and ~/Downloads. The packaged app ignores all three.
   */
  let updater: Updater | null = null
  const updatesFile = () => path.join(app.getPath("userData"), "updates.json")
  const startUpdates = () => {
    const feed = feedFor(process.env, app.isPackaged, identity.checksUpdates)
    if (!feed) return
    const test = !app.isPackaged
    const started = new Updater({
      current: (test && process.env.CELLO_APP_VERSION) || app.getVersion(),
      arch: process.arch,
      feed: githubFeed(feed.url),
      trusted: feed.trusted,
      settings: {
        read: () => {
          try {
            return fs.readFileSync(updatesFile(), "utf8")
          } catch {
            return null
          }
        },
        write: (text) => fs.writeFileSync(updatesFile(), text),
      },
      downloadsDir: (test && process.env.CELLO_UPDATE_DOWNLOADS) || app.getPath("downloads"),
      fetchFile: downloadFile,
      // shell is read at each call, so a test can stand in for Finder.
      installer: openDmg((file) => shell.openPath(file)),
      openExternal: (url) => void shell.openExternal(url),
      now: Date.now,
    })
    updater = started
    started.onChange((state) => live()?.showUpdateState(state))
    live()?.showUpdateState(started.state)
    void started.check()
    setInterval(() => void started.check(), CHECK_EVERY_MS)
  }
  /** A command from the board's update UI, checked field by field. */
  const updateCommand = (message: unknown) => {
    const command = parseUpdateCommand(message)
    if (command && updater) void updater.command(command).catch(() => {})
  }

  /** The main window, unless it was closed (macOS keeps the app running without one). */
  const live = () => (main && !main.isClosed ? main : null)

  /**
   * Which board the app's server uses (Settings → Board, CEL-149): the one saved in board.json, else ~/.cello on
   * 4747; CELLO_DATA_DIR and CELLO_PORT win for a launch. Read at each use: a switch changes it.
   */
  const home = process.env.HOME || os.homedir()
  const boardFile = path.join(app.getPath("userData"), BOARD_FILE)
  /** board.json as it is now: none, a board, or a file that's there but can't be used. */
  const readSavedBoard = (): SavedBoard => {
    let text: string
    try {
      text = fs.readFileSync(boardFile, "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "none" }
      text = ""
    }
    return readBoardFile(text, boardFile)
  }
  const launched = launchBoard({ env: process.env, saved: readSavedBoard(), home })
  let config: Board = launched.board
  /** Why no board can open yet (board.json unreadable, CELLO_PORT not a port): connect asks before trying any. */
  let boardProblem: string | null = launched.problem
  let boardSwitching = false
  /** Quit was chosen while a switch was finding its server: quit once it has one, so a server it started is settled. */
  let quitAfterSwitch = false
  let boardError: string | null = null
  /** What's in a folder a board would use (Settings and Use Another Board… refuse a folder of other files). */
  const folderKind = (dir: string): FolderKind => {
    let entries: string[]
    try {
      entries = fs.readdirSync(dir)
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "other"
    }
    if (entries.includes(DB_FILE)) return "board"
    return entries.every((name) => name === ".DS_Store") ? "empty" : "other"
  }
  const showBoard = () => live()?.showBoardState(boardState({ board: config, setBy: launched.setBy, home, switching: boardSwitching, error: boardError }))
  /** The `cello` the app starts servers with. */
  const appCommand = () =>
    celloCommand({ env: process.env, isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, repoRoot: files.repoRoot, exists: fs.existsSync })

  /** A background service is installed for this data folder (CEL-81): its plist in ~/Library/LaunchAgents names it. */
  const serviceInstalled = (dataDir = config.dataDir) => {
    try {
      return serviceFor(fs.readFileSync(plistPath(process.env.HOME || os.homedir()), "utf8"), dataDir)
    } catch {
      return false
    }
  }
  /** Asks launchd to start the installed service (a no-op when it already runs). */
  const startService = () =>
    new Promise<void>((resolve, reject) =>
      execFile("launchctl", ["kickstart", serviceTarget(process.getuid?.() ?? 0)], (error) => (error ? reject(error) : resolve())))

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

  /** The pid of the service's job as launchd reports it; null when it isn't loaded or running. */
  const serviceJobPid = () =>
    new Promise<number | null>((resolve) =>
      execFile("launchctl", ["print", serviceTarget(process.getuid?.() ?? 0)], (error, stdout) => resolve(error ? null : parsePrint(stdout).pid)))

  let menuActions: MenuActions | null = null
  let menuKey: string | null = null
  /**
   * Builds the menu again when its server lines changed: after connecting, and when the window takes
   * focus. The server is "the background service" only when launchd's job is the pid holding the lock.
   */
  const refreshMenu = async () => {
    if (!menuActions) return
    const pid = lockHolder(config.dataDir)
    const service = !!server && !server.startedByUs && serviceInstalled() && pid !== null && (await serviceJobPid()) === pid
    const status = serverStatusLabel(server && { startedByUs: server.startedByUs, service, pid })
    const note = server?.serviceProblem ? `Background service didn't start (${server.serviceProblem}): run cello service status` : null
    const key = `${status}\n${note}`
    if (key === menuKey || !menuActions) return
    menuKey = key
    Menu.setApplicationMenu(buildMenu(app.name, menuActions, status, note))
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
      installed: identity.installedApp,
      installedExec: executableOf(identity.installedApp, identity),
      installedExists: process.platform === "darwin" && fs.existsSync(identity.installedApp),
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
    const link = parseCelloLink(raw, identity.flavor)
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
    const link = findCelloLink(argv, identity.flavor)
    if (link) follow(link)
    else showWindow()
  })
  const launchLink = findCelloLink(process.argv, identity.flavor)
  if (launchLink) follow(launchLink)
  // In dev, registering would point the scheme at the bare Electron binary; the packaged app also
  // declares it in its Info.plist (electron-builder.json, or the dev flavor's config).
  if (app.isPackaged) app.setAsDefaultProtocolClient(identity.scheme)

  const openWindow = () => {
    main = new MainWindow({
      statePath: path.join(app.getPath("userData"), "window-state.json"),
      preload: files.preload,
      chromePreload: files.chromePreload,
      chromeHtml: files.chromeHtml,
      platform: process.platform,
      restartApp: restart,
      updateCommand,
      boardCommand,
      title: identity.name,
    })
    if (updater) main.showUpdateState(updater.state)
    showBoard()
    main.window.on("focus", () => {
      checkForUpdate()
      void refreshMenu()
    })
    checkForUpdate()
    return main
  }

  /**
   * Saves the board in board.json and uses it from now on; false (and why, in Settings) when it can't be saved.
   * Written beside it and renamed over it, so the file is the old board or the new one, never half of one.
   */
  const saveBoard = (next: Board): boolean => {
    const staged = `${boardFile}.new`
    try {
      fs.mkdirSync(path.dirname(boardFile), { recursive: true })
      fs.writeFileSync(staged, boardFileText(next))
      fs.renameSync(staged, boardFile)
    } catch (error) {
      fs.rmSync(staged, { force: true })
      boardError = `Couldn't save the board in ${boardFile}: ${error instanceof Error ? error.message : String(error)}`
      showBoard()
      return false
    }
    config = next
    boardError = null
    showBoard()
    return true
  }

  /** Use Another Board…: a folder picked in Finder, checked as Settings checks one; false when none was used. */
  const pickAnotherBoard = async (): Promise<boolean> => {
    const picked = await dialog.showOpenDialog({
      title: "Choose a folder for the board",
      buttonLabel: "Use This Folder",
      defaultPath: home,
      properties: ["openDirectory", "createDirectory"],
    })
    const folder = picked.canceled ? undefined : picked.filePaths[0]
    if (!folder) return false
    const checked = checkBoard({ dataDir: folder, port: otherFolder(folder, config).port }, home, folderKind)
    if (typeof checked === "string") {
      await dialog.showMessageBox({ type: "warning", message: `${identity.name} can't use that folder`, detail: checked })
      return false
    }
    return saveBoard(checked)
  }

  /**
   * Finds or starts the server for the board, asking what to do when it can't (or when no board can open yet:
   * board.json unreadable, CELLO_PORT not a port): try again, use the default board, use another board (a folder
   * picked in Finder), or quit; the board choices only when the environment didn't set the board. A board a newer
   * Cello migrated (CEL-149) shows the server's own sentence, in the window and the dialog.
   */
  const connect = async (window: MainWindow): Promise<Server | null> => {
    const command = appCommand()
    for (;;) {
      const { port, dataDir } = config
      let message: string
      if (boardProblem !== null) {
        message = boardProblem
      } else {
        try {
          return await connectServer({
            port,
            dataDir,
            command: command ? [command] : null,
            env: process.env,
            log: (text) => process.stdout.write(text),
            service: { installed: serviceInstalled(), start: startService },
            defaultBoard: isDefaultBoard(config, home),
          })
        } catch (error) {
          message = error instanceof Error ? error.message : String(error)
        }
      }
      window.showMessage(message)
      const canSwitch = launched.setBy.length === 0
      const onDefault = isDefaultBoard(config, home) && boardProblem === null
      const choices = [
        "Try Again",
        ...(canSwitch && !onDefault ? ["Use Default Board"] : []),
        ...(canSwitch ? ["Use Another Board…"] : []),
        "Quit",
      ] as const
      const { response } = await dialog.showMessageBox({
        type: "error",
        message: isBoardTooNew(message)
          ? `${identity.name} can't open this board`
          : boardProblem !== null
          ? `${identity.name} can't open a board yet`
          : `${identity.name} couldn't reach its server`,
        detail: message,
        buttons: [...choices],
        defaultId: 0,
        cancelId: choices.length - 1,
      })
      const choice = choices[response] ?? "Quit"
      if (choice === "Quit") return null
      if (choice === "Try Again" && boardProblem !== null) {
        // Read board.json again (it may have been fixed by hand); CELLO_PORT can't change while the app runs.
        const again = launchBoard({ env: process.env, saved: readSavedBoard(), home })
        config = again.board
        boardProblem = again.problem
      }
      if (choice === "Use Default Board" && saveBoard(defaultBoard(home))) boardProblem = null
      if (choice === "Use Another Board…" && (await pickAnotherBoard())) boardProblem = null
    }
  }

  /**
   * Settings → Board's switch (CEL-149): saves the board, stops a server the app started for the old one (one it
   * joined keeps running), and finds or starts the new one's, then shows its Settings. Nothing in the old data
   * folder or the new one is touched by the app itself.
   */
  const switchBoard = async (next: Board) => {
    const window = live()
    if (!window || boardSwitching) return
    boardSwitching = true
    if (!saveBoard(next)) {
      boardSwitching = false
      return showBoard()
    }
    // `server` stays the old one until it's stopped, and is the new one as soon as it's found: a quit meanwhile
    // waits for the switch (before-quit), so it settles whichever server is the app's then.
    boardLoaded = false
    window.showMessage(`Opening the board in ${next.dataDir}…`)
    if (server?.startedByUs) await server.stop()
    server = null
    server = await connect(window)
    boardSwitching = false
    if (!server) return app.quit()
    if (quitAfterSwitch) return app.quit()
    showBoard()
    await refreshMenu()
    if (!window.isClosed) await window.loadBoard(server.url, "/settings")
    boardLoaded = true
  }

  /**
   * A command from Settings → Board, checked field by field, then for what the folder and port may be, then that
   * the port isn't another board's (or another program's): nothing switches until all of that holds.
   */
  function boardCommand(message: unknown) {
    const command = parseDesktopBoardCommand(message)
    if (!command || boardSwitching) return
    if (launched.setBy.length > 0) {
      boardError = `${launched.setBy.join(" and ")} set the board for this launch. Start the app without them to change it here.`
      return showBoard()
    }
    const checked = checkBoard(command, home, folderKind)
    if (typeof checked === "string") {
      boardError = checked
      return showBoard()
    }
    boardError = null
    if (checked.dataDir === config.dataDir && checked.port === config.port) return showBoard()
    boardSwitching = true
    showBoard()
    void survey(checked.port, checked.dataDir, { service: serviceInstalled(checked.dataDir), defaultBoard: isDefaultBoard(checked, home) }).then((found) => {
      boardSwitching = false
      if (quitAfterSwitch) return app.quit()
      if (planServer(found).kind === "taken") {
        boardError = takenPortMessage(checked.port)
        return showBoard()
      }
      return switchBoard(checked)
    })
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
    await refreshMenu()
    if (!app.isPackaged && fs.existsSync(files.devIcon)) app.dock?.setIcon(files.devIcon)

    const window = openWindow()
    startUpdates()
    window.showMessage("Starting Cello…")
    server = await connect(window)
    if (!server) return app.quit()
    await refreshMenu()
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
    if (answer === "keep") {
      // The app's child can't outlive it (its output is piped to the app), so a fresh one takes over.
      const command = appCommand()
      const logPath = serviceLogPath(config.dataDir)
      const kept = command ? await startDetached({ command: [command], url: running.url, dataDir: config.dataDir, env: process.env, logPath }) : null
      if (kept === null) {
        await dialog.showMessageBox({
          type: "error",
          message: "Cello couldn't keep its server running",
          detail:
            `The server for ${config.dataDir} stopped, and the one that should take over didn't answer at ${running.url}. Its log is ${logPath}.\n\n` +
            "Cello stays open and starts its server again.",
        })
        await reopen()
        return false
      }
    }
    return true
  }

  /** After a quit that couldn't keep the server: a window again, on a server of the app's own. */
  const reopen = async () => {
    server = null
    const window = openWindow()
    window.showMessage("Starting Cello…")
    server = await connect(window)
    if (!server) return app.quit()
    await refreshMenu()
    if (!window.isClosed) await window.loadBoard(server.url)
  }

  // A server the app joined is never stopped; one it started is settled first, then the app quits again.
  let settling: Promise<void> | null = null
  let settled = false
  app.on("before-quit", (event) => {
    if (settled) return
    // Mid-switch (CEL-149), a server the app is starting isn't in `server` yet: quit once the switch has it.
    if (boardSwitching) {
      event.preventDefault()
      quitAfterSwitch = true
      return
    }
    if (!server) return
    // A service that didn't start (the app fell back to its own server) can't take over: ask as without one.
    const plan = planQuit({ startedByUs: server.startedByUs, service: serviceInstalled() && !server.serviceProblem, remembered: restarting ? "stop" : rememberedChoice() })
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
