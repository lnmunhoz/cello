// Settings → Board (CEL-149): which data folder and port the app's server uses, kept in the app's own state.
import { describe, expect, it } from "vitest"
import { boardFileText, boardState, checkBoard, defaultBoard, launchBoard, otherFolder, parseBoardFile } from "./board.ts"

const HOME = "/Users/me"

describe("defaultBoard", () => {
  it("is ~/.cello on 4747, as `cello start` uses", () => {
    expect(defaultBoard(HOME)).toEqual({ dataDir: "/Users/me/.cello", port: 4747 })
  })
})

describe("launchBoard: the board the app opens at launch", () => {
  it("is the default with nothing saved and nothing in the environment", () => {
    expect(launchBoard({ env: { HOME }, saved: null, home: HOME })).toEqual({ board: { dataDir: "/Users/me/.cello", port: 4747 }, setBy: [] })
  })

  it("is the saved one", () => {
    expect(launchBoard({ env: { HOME }, saved: { dataDir: "/Users/me/.cello-release", port: 4757 }, home: HOME })).toEqual({
      board: { dataDir: "/Users/me/.cello-release", port: 4757 },
      setBy: [],
    })
  })

  it("CELLO_DATA_DIR and CELLO_PORT win, each on its own, and say so (dev and the e2e tests set them)", () => {
    const saved = { dataDir: "/Users/me/.cello-release", port: 4757 }
    expect(launchBoard({ env: { HOME, CELLO_PORT: "4791", CELLO_DATA_DIR: "/tmp/cello-e2e" }, saved, home: HOME })).toEqual({
      board: { dataDir: "/tmp/cello-e2e", port: 4791 },
      setBy: ["CELLO_DATA_DIR", "CELLO_PORT"],
    })
    expect(launchBoard({ env: { HOME, CELLO_PORT: "4791" }, saved: null, home: HOME })).toEqual({
      board: { dataDir: "/Users/me/.cello", port: 4791 },
      setBy: ["CELLO_PORT"],
    })
  })
})

describe("parseBoardFile: board.json in the app's state folder", () => {
  it("reads back what boardFileText writes", () => {
    const board = { dataDir: "/Users/me/.cello-release", port: 4757 }
    expect(parseBoardFile(boardFileText(board))).toEqual(board)
  })

  it("is null for a missing, broken or wrong file, so the app falls back to the default instead of failing", () => {
    for (const text of [null, "", "{", "[]", '{"dataDir":"relative/path","port":4757}', '{"dataDir":"/x","port":"4757"}', '{"dataDir":"/x","port":80}']) {
      expect(parseBoardFile(text), String(text)).toBeNull()
    }
  })
})

describe("checkBoard: a board typed in Settings", () => {
  it("takes an absolute folder, or one under ~, and a port", () => {
    expect(checkBoard({ dataDir: " ~/.cello-release ", port: 4757 }, HOME)).toEqual({ dataDir: "/Users/me/.cello-release", port: 4757 })
    expect(checkBoard({ dataDir: "~", port: 4757 }, HOME)).toEqual({ dataDir: "/Users/me", port: 4757 })
    expect(checkBoard({ dataDir: "/Volumes/x/board/", port: 65535 }, HOME)).toEqual({ dataDir: "/Volumes/x/board", port: 65535 })
  })

  it("says what's wrong otherwise", () => {
    expect(checkBoard({ dataDir: "", port: 4757 }, HOME)).toBe("Give the board a folder, like ~/.cello-release.")
    expect(checkBoard({ dataDir: "boards/test", port: 4757 }, HOME)).toBe("The folder needs a full path, like ~/.cello-release or /Users/you/boards/test.")
    for (const port of [0, 80, 1023, 65536, 4757.5, Number.NaN]) {
      expect(checkBoard({ dataDir: "/x", port }, HOME), String(port)).toBe("The port is a whole number from 1024 to 65535, like 4757.")
    }
  })
})

describe("otherFolder: a folder picked when the board couldn't open", () => {
  it("keeps the port for the same folder", () => {
    expect(otherFolder("/Users/me/.cello", { dataDir: "/Users/me/.cello", port: 4747 })).toEqual({ dataDir: "/Users/me/.cello", port: 4747 })
  })

  it("moves another folder off 4747, which belongs to ~/.cello's server, to 4757", () => {
    expect(otherFolder("/Users/me/.cello-release", { dataDir: "/Users/me/.cello", port: 4747 })).toEqual({ dataDir: "/Users/me/.cello-release", port: 4757 })
  })

  it("keeps a port that was already the board's own", () => {
    expect(otherFolder("/Users/me/boards/b", { dataDir: "/Users/me/boards/a", port: 4800 })).toEqual({ dataDir: "/Users/me/boards/b", port: 4800 })
  })
})

describe("boardState: what Settings → Board shows", () => {
  it("the board in use, the default, and who set it", () => {
    expect(boardState({ board: { dataDir: "/Users/me/.cello-release", port: 4757 }, setBy: [], home: HOME, switching: false, error: null })).toEqual({
      dataDir: "/Users/me/.cello-release",
      port: 4757,
      defaultDataDir: "/Users/me/.cello",
      defaultPort: 4747,
      setBy: [],
      switching: false,
      error: null,
    })
  })
})
