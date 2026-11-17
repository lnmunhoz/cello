// Settings → Board (CEL-149): which data folder and port the app's server uses, kept in the app's own state.
import { describe, expect, it } from "vitest"
import {
  boardFileText,
  boardState,
  checkBoard,
  defaultBoard,
  type FolderKind,
  isDefaultBoard,
  launchBoard,
  otherFolder,
  readBoardFile,
  SUGGESTED_PORT,
} from "./board.ts"

const HOME = "/Users/me"
const FILE = "/Users/me/Library/Application Support/Cello/board.json"
/** A fake disk: every folder is new unless named. */
const folders = (kinds: Record<string, FolderKind>) => (dir: string): FolderKind => kinds[dir] ?? "missing"

describe("defaultBoard", () => {
  it("is ~/.cello on 4747, as `cello start` uses", () => {
    expect(defaultBoard(HOME)).toEqual({ dataDir: "/Users/me/.cello", port: 4747 })
    expect(isDefaultBoard({ dataDir: "/Users/me/.cello", port: 4747 }, HOME)).toBe(true)
    expect(isDefaultBoard({ dataDir: "/Users/me/.cello-test", port: 4747 }, HOME)).toBe(false)
    expect(isDefaultBoard({ dataDir: "/Users/me/.cello", port: 4757 }, HOME)).toBe(false)
  })
})

describe("readBoardFile: board.json in the app's state folder", () => {
  it("reads back what boardFileText writes", () => {
    const board = { dataDir: "/Users/me/.cello-release", port: 4757 }
    expect(readBoardFile(boardFileText(board), FILE)).toEqual({ kind: "board", board })
  })

  it("is none when there's no file", () => {
    expect(readBoardFile(null, FILE)).toEqual({ kind: "none" })
  })

  it("says so when the file is there but cut off or wrong, instead of opening the default board", () => {
    for (const text of ["", "{", "[]", '{"dataDir":"relative/path","port":4757}', '{"dataDir":"/x","port":"4757"}', '{"dataDir":"/x","port":80}']) {
      expect(readBoardFile(text, FILE), text).toEqual({
        kind: "unreadable",
        problem: `The board setting in ${FILE} can't be read, so the app didn't open any board. Use the default board (~/.cello on 4747), or pick another.`,
      })
    }
  })
})

describe("launchBoard: the board the app opens at launch", () => {
  it("is the default with nothing saved and nothing in the environment", () => {
    expect(launchBoard({ env: { HOME }, saved: { kind: "none" }, home: HOME })).toEqual({
      board: { dataDir: "/Users/me/.cello", port: 4747 },
      setBy: [],
      problem: null,
    })
  })

  it("is the saved one", () => {
    const board = { dataDir: "/Users/me/.cello-release", port: 4757 }
    expect(launchBoard({ env: { HOME }, saved: { kind: "board", board }, home: HOME })).toEqual({ board, setBy: [], problem: null })
  })

  it("carries an unreadable file's problem, so the app asks before opening anything", () => {
    expect(launchBoard({ env: { HOME }, saved: { kind: "unreadable", problem: "broken" }, home: HOME }).problem).toBe("broken")
  })

  it("CELLO_DATA_DIR and CELLO_PORT win, each on its own, and say so (dev and the e2e tests set them)", () => {
    const saved = { kind: "board", board: { dataDir: "/Users/me/.cello-release", port: 4757 } } as const
    expect(launchBoard({ env: { HOME, CELLO_PORT: "4791", CELLO_DATA_DIR: "/tmp/cello-e2e" }, saved, home: HOME })).toEqual({
      board: { dataDir: "/tmp/cello-e2e", port: 4791 },
      setBy: ["CELLO_DATA_DIR", "CELLO_PORT"],
      problem: null,
    })
    expect(launchBoard({ env: { HOME, CELLO_PORT: "4791" }, saved: { kind: "none" }, home: HOME })).toEqual({
      board: { dataDir: "/Users/me/.cello", port: 4791 },
      setBy: ["CELLO_PORT"],
      problem: null,
    })
    // Both set: a broken file doesn't matter.
    expect(launchBoard({ env: { HOME, CELLO_PORT: "4791", CELLO_DATA_DIR: "/tmp/x" }, saved: { kind: "unreadable", problem: "broken" }, home: HOME }).problem).toBeNull()
  })

  it("refuses a CELLO_PORT that isn't a port, saying what it is", () => {
    for (const port of ["abc", "0", "80", "70000", "47.5"]) {
      expect(launchBoard({ env: { HOME, CELLO_PORT: port }, saved: { kind: "none" }, home: HOME }).problem, port).toBe(
        `CELLO_PORT is "${port}", but a port is a whole number from 1024 to 65535.`,
      )
    }
  })
})

describe("checkBoard: a board typed in Settings", () => {
  const disk = folders({ "/Users/me/.cello": "board", "/Users/me/boards/empty": "empty", "/Users/me/Documents": "other" })

  it("takes a new, empty or existing board folder, as a full path or one under ~, and a port", () => {
    expect(checkBoard({ dataDir: " ~/.cello-release ", port: 4757 }, HOME, disk)).toEqual({ dataDir: "/Users/me/.cello-release", port: 4757 })
    expect(checkBoard({ dataDir: "/Users/me/boards/empty/", port: 65535 }, HOME, disk)).toEqual({ dataDir: "/Users/me/boards/empty", port: 65535 })
    expect(checkBoard({ dataDir: "~/.cello", port: 4747 }, HOME, disk)).toEqual({ dataDir: "/Users/me/.cello", port: 4747 })
  })

  it("says what's wrong otherwise", () => {
    expect(checkBoard({ dataDir: "", port: 4757 }, HOME, disk)).toBe("Give the board a folder, like ~/.cello-release.")
    expect(checkBoard({ dataDir: "boards/test", port: 4757 }, HOME, disk)).toBe("The folder needs a full path, like ~/.cello-release or /Users/you/boards/test.")
    for (const port of [0, 80, 1023, 65536, 4757.5, Number.NaN]) {
      expect(checkBoard({ dataDir: "/x", port }, HOME, disk), String(port)).toBe("The port is a whole number from 1024 to 65535, like 4757.")
    }
  })

  it("never takes / or the home folder itself", () => {
    for (const dataDir of ["/", "~", "/Users/me", "/Users/me/"]) {
      expect(checkBoard({ dataDir, port: 4757 }, HOME, disk), dataDir).toBe(
        `A board needs a folder of its own, like ~/.cello-release, not ${dataDir.trim() === "~" ? "/Users/me" : dataDir.replace(/(.)\/$/, "$1")}.`,
      )
    }
  })

  it("never takes a folder that holds other files and isn't a board", () => {
    expect(checkBoard({ dataDir: "~/Documents", port: 4757 }, HOME, disk)).toBe(
      "/Users/me/Documents already holds other files and isn't a Cello board (no cello.db). Pick a new or empty folder, or another board's.",
    )
  })
})

describe("otherFolder: a folder picked when the board couldn't open", () => {
  it("keeps the port for the same folder", () => {
    expect(otherFolder("/Users/me/.cello", { dataDir: "/Users/me/.cello", port: 4747 })).toEqual({ dataDir: "/Users/me/.cello", port: 4747 })
  })

  it("moves another folder off 4747, which belongs to ~/.cello's server, to 4757", () => {
    expect(SUGGESTED_PORT).toBe(4757)
    expect(otherFolder("/Users/me/.cello-release", { dataDir: "/Users/me/.cello", port: 4747 })).toEqual({ dataDir: "/Users/me/.cello-release", port: 4757 })
  })

  it("keeps a port that was already the board's own", () => {
    expect(otherFolder("/Users/me/boards/b", { dataDir: "/Users/me/boards/a", port: 4800 })).toEqual({ dataDir: "/Users/me/boards/b", port: 4800 })
  })
})

describe("boardState: what Settings → Board shows", () => {
  it("the board in use, the default, the port it suggests for another folder, and who set it", () => {
    expect(boardState({ board: { dataDir: "/Users/me/.cello-release", port: 4757 }, setBy: [], home: HOME, switching: false, error: null })).toEqual({
      dataDir: "/Users/me/.cello-release",
      port: 4757,
      defaultDataDir: "/Users/me/.cello",
      defaultPort: 4747,
      suggestedPort: 4757,
      setBy: [],
      switching: false,
      error: null,
    })
  })
})
