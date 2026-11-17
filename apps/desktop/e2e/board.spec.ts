// Settings → Board (CEL-149) end to end: the built Electron app, its board chosen in its own state folder
// (board.json, as Settings saves it), never through CELLO_DATA_DIR or CELLO_PORT, so the setting is what decides.
// Every board is a temp folder on a free port. Each test records an MP4 of the whole window.
import { spawnSync } from "node:child_process"
import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { expect, test, type ElectronApplication, type Page } from "@playwright/test"
import { recordWindow, screenshotWindow, type Recording } from "./recorder.ts"
import {
  answerQuitQuestion,
  appPages,
  CELLO_BIN,
  cleanup,
  closeNextDialog,
  freePort,
  isAlive,
  killOnCleanup,
  launchApp,
  makeBoard,
  nextDialogShown,
  pickFolderNext,
  quitQuestions,
  readLock,
  SCREENSHOTS_DIR,
  screenshotScreen,
  showNextDialogAnswering,
  slug,
  tempDir,
  VIDEOS_DIR,
} from "./support.ts"

let recording: Recording | null = null
const record = (app: ElectronApplication, title: string) => {
  recording = recordWindow(app, path.join(VIDEOS_DIR, `${slug(title)}.mp4`))
  return recording
}

test.afterEach(async () => {
  await recording?.stop()
  recording = null
  await cleanup()
})

/** Two free ports, never the same. */
const twoPorts = async (): Promise<[number, number]> => {
  const first = await freePort()
  for (;;) {
    const second = await freePort()
    if (second !== first) return [first, second]
  }
}

/** The app's state folder with a board saved in it, as Settings → Board saves it. */
const userDataWith = (board: { dataDir: string; port: number }) => {
  const userData = tempDir("cello-desktop-user-")
  fs.writeFileSync(path.join(userData, "board.json"), JSON.stringify(board))
  return userData
}

const boardSection = (board: Page) => board.getByRole("region", { name: "Board" })

const openSettings = async (board: Page) => {
  // A dialog still closing (New project's) would take the click.
  await expect(board.getByRole("dialog")).toHaveCount(0)
    await board.getByRole("link", { name: "Settings" }).first().click()
  await expect(boardSection(board)).toBeVisible()
}

/** Waits for the page's CSS transitions to end, so a screenshot isn't caught mid-fade. */
const settled = (board: Page) => board.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))).then(() => {}))

const themes = async (app: ElectronApplication, board: Page, name: string) => {
  await settled(board)
  await screenshotWindow(app, path.join(SCREENSHOTS_DIR, `${name}-light.png`))
  await board.getByRole("button", { name: "Use dark theme" }).click()
  await settled(board)
  await screenshotWindow(app, path.join(SCREENSHOTS_DIR, `${name}-dark.png`))
  await board.getByRole("button", { name: "Use light theme" }).click()
}

const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")

test("CEL-149: Settings → Board switches the app to a test board: its own server, empty like a new board's; the old one's server stops", async ({}, testInfo) => {
  const [portA, portB] = await twoPorts()
  const first = tempDir("cello-board-first-")
  const second = tempDir("cello-board-test-")
  const userData = userDataWith({ dataDir: first, port: portA })
  const asked = path.join(tempDir("cello-desktop-asked-"), "questions.jsonl")
  const app = await launchApp({ CELLO_DESKTOP_USER_DATA: userData, CELLO_BIN })
  const video = record(app, testInfo.title)
  const { board } = await appPages(app, `http://127.0.0.1:${portA}`)

  await video.caption(`The app opens the board saved in its settings: ${first} on ${portA}, with a server of its own`)
  expect(readLock(first)?.port).toBe(portA)
  const firstServer = readLock(first)!.pid
  killOnCleanup(firstServer)
  await board.getByRole("button", { name: "New project" }).first().click()
  await board.getByLabel("Name").fill("My real work")
  await board.getByLabel("Key").fill("REAL")
  await board.getByRole("button", { name: "Create project" }).click()
  await board.waitForURL(`http://127.0.0.1:${portA}/REAL/issues`)

  await video.caption("Settings → Board shows that folder and port")
  await openSettings(board)
  const section = boardSection(board)
  await expect(section.getByLabel("Board folder")).toHaveValue(first)
  await expect(section.getByLabel("Board port")).toHaveValue(String(portA))
  await themes(app, board, "board-setting")

  await video.caption("A folder without a full path is refused, and nothing changes")
  await section.getByLabel("Board folder").fill("boards/test")
  await section.getByRole("button", { name: "Switch board" }).click()
  await expect(section.getByRole("alert")).toHaveText("The folder needs a full path, like ~/.cello-release or /Users/you/boards/test.")
  expect(readLock(first)?.pid).toBe(firstServer)

  await video.caption(`Point it at a test board, ${second} on ${portB}, and switch`)
  await section.getByLabel("Board folder").fill(second)
  await section.getByLabel("Board port").fill(String(portB))
  await section.getByRole("button", { name: "Switch board" }).click()
  await board.waitForURL(`http://127.0.0.1:${portB}/settings`)
  await expect(boardSection(board).getByLabel("Board folder")).toHaveValue(second)
  await expect(boardSection(board).getByLabel("Board port")).toHaveValue(String(portB))

  await video.caption("The app started a server for the test board; the one it had started for the first board stopped")
  expect(readLock(second)?.port).toBe(portB)
  expect(isAlive(readLock(second)!.pid)).toBe(true)
  killOnCleanup(readLock(second)!.pid)
  expect(readLock(first)).toBeNull()
  expect(isAlive(firstServer)).toBe(false)
  expect(JSON.parse(fs.readFileSync(path.join(userData, "board.json"), "utf8"))).toEqual({ dataDir: second, port: portB })
  expect(fs.existsSync(path.join(first, "cello.db"))).toBe(true)

  await video.caption("The test board starts empty, like a new user's: the first board's project isn't there")
  await board.goto(`http://127.0.0.1:${portB}/`)
  await expect(board.getByRole("button", { name: "New project" }).first()).toBeVisible()
  await expect(board.getByText("My real work")).toHaveCount(0)
  await screenshotWindow(app, path.join(SCREENSHOTS_DIR, "board-setting-test-board-empty.png"))

  await video.caption("Quit and stop the test board's server")
  const testServer = readLock(second)!.pid
  await answerQuitQuestion(app, 1, asked)
  await recording!.stop()
  recording = null
  await app.close()
  expect(quitQuestions(asked)).toHaveLength(1)
  expect(isAlive(testServer)).toBe(false)
})

test("CEL-149: a board a newer Cello migrated is refused: the window and the dialog say so, nothing is written, and Use Another Board… opens another", async ({}, testInfo) => {
  const [portA, portB] = await twoPorts()
  const first = tempDir("cello-board-first-")
  const newer = tempDir("cello-board-newer-")
  const other = tempDir("cello-board-other-")
  // A board this build made, then migrated by a "newer" Cello: one migration this build doesn't have.
  await makeBoard(newer)
  const db = path.join(newer, "cello.db")
  const bumped = spawnSync(
    "bun",
    ["-e", `const { Database } = require("bun:sqlite"); const db = new Database(process.argv[1]); const { n } = db.query("SELECT MAX(migration_id) AS n FROM migrations").get(); db.run("INSERT INTO migrations (migration_id, name) VALUES (?, 'from_a_newer_cello')", [n + 1]); db.close(); console.log(String(n + 1).padStart(4, "0"))`, db],
    { encoding: "utf8" },
  )
  expect(bumped.status, bumped.stderr).toBe(0)
  const migration = `${bumped.stdout.trim()}_from_a_newer_cello`
  const [filesBefore, dbBefore] = [fs.readdirSync(newer).sort(), hash(db)]

  const userData = userDataWith({ dataDir: first, port: portA })
  const asked = path.join(tempDir("cello-desktop-asked-"), "dialogs.jsonl")
  const app = await launchApp({ CELLO_DESKTOP_USER_DATA: userData, CELLO_BIN })
  const video = record(app, testInfo.title)
  const { board } = await appPages(app, `http://127.0.0.1:${portA}`)
  killOnCleanup(readLock(first)!.pid)

  await video.caption(`Settings → Board: switch to ${newer}, a board a newer Cello already migrated`)
  await openSettings(board)
  const section = boardSection(board)
  await section.getByLabel("Board folder").fill(newer)
  await section.getByLabel("Board port").fill(String(portB))
  await showNextDialogAnswering(app, 1, asked)
  await pickFolderNext(app, other)
  await section.getByRole("button", { name: "Switch board" }).click()

  await video.caption("The app's server refuses it: the window says which migration, which version, and what to do")
  await nextDialogShown(app)
  const refusal = `This board (${newer}) was opened by a newer Cello (migration ${migration}); this cello is v`
  await expect(board.locator("body > p")).toContainText(refusal)
  await expect(board.locator("body > p")).toContainText("Update Cello, or use another board. Nothing was changed.")
  await screenshotWindow(app, path.join(SCREENSHOTS_DIR, "board-too-new-window.png"))
  await screenshotScreen(app, path.join(SCREENSHOTS_DIR, "board-too-new-dialog.png"))
  const [dialog] = quitQuestions(asked) as Array<{ message: string; detail: string; buttons: string[] }>
  expect(dialog).toMatchObject({ message: "Cello Dev can't open this board", buttons: ["Try Again", "Use Another Board…", "Quit"] })
  expect(dialog!.detail).toContain(refusal)

  await video.caption("Nothing in that board changed: the same database, the same files, no lock left")
  expect(hash(db)).toBe(dbBefore)
  expect(fs.readdirSync(newer).sort()).toEqual(filesBefore)
  expect(readLock(newer)).toBeNull()

  await video.caption(`Use Another Board…: picking ${other} opens a new board there`)
  await closeNextDialog(app)
  await board.waitForURL(`http://127.0.0.1:${portB}/settings`)
  await expect(boardSection(board).getByLabel("Board folder")).toHaveValue(other)
  expect(readLock(other)?.port).toBe(portB)
  killOnCleanup(readLock(other)!.pid)
  expect(JSON.parse(fs.readFileSync(path.join(userData, "board.json"), "utf8"))).toEqual({ dataDir: other, port: portB })
  await screenshotWindow(app, path.join(SCREENSHOTS_DIR, "board-too-new-other-board.png"))

  const server = readLock(other)!.pid
  await answerQuitQuestion(app, 1, asked)
  await recording!.stop()
  recording = null
  await app.close()
  expect(isAlive(server)).toBe(false)
})
