import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { dataDirOf, portOf } from "./env.ts"

// Where `cello start`, the service and every command find the board when nothing says otherwise: 4747 and ~/.cello.
describe("portOf", () => {
  it("is CELLO_PORT, else 4747 (an empty one counts as not set)", () => {
    expect(portOf({ CELLO_PORT: "4748" })).toBe(4748)
    expect(portOf({})).toBe(4747)
    expect(portOf({ CELLO_PORT: "" })).toBe(4747)
  })
})

describe("dataDirOf", () => {
  it("is CELLO_DATA_DIR before anything else, as a full path", () => {
    expect(dataDirOf({ CELLO_DATA_DIR: "/tmp/board", HOME: "/Users/me" })).toBe("/tmp/board")
    expect(dataDirOf({ CELLO_DATA_DIR: "relative/board", HOME: "/Users/me" })).toBe(path.resolve("relative/board"))
  })

  it("is .cello under HOME without it, and under the system's home folder without HOME", () => {
    expect(dataDirOf({ HOME: "/Users/me" })).toBe("/Users/me/.cello")
    expect(dataDirOf({ CELLO_DATA_DIR: "", HOME: "/Users/me" })).toBe("/Users/me/.cello")
    expect(dataDirOf({})).toBe(path.join(os.homedir(), ".cello"))
    expect(dataDirOf({ HOME: "" })).toBe(path.join(os.homedir(), ".cello"))
  })
})
