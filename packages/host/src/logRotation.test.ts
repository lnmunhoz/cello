import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { rotateLog } from "./logRotation.ts"

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})
const temp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-log-rotation-"))
  dirs.push(dir)
  return dir
}

describe("rotateLog", () => {
  it("moves a log past the limit to <log>.1, replacing the previous one, so two at most are kept", () => {
    const log = path.join(temp(), "server.log")
    fs.writeFileSync(`${log}.1`, "oldest")
    fs.writeFileSync(log, "x".repeat(20))
    expect(rotateLog(log, 10)).toBe(true)
    expect(fs.existsSync(log)).toBe(false)
    expect(fs.readFileSync(`${log}.1`, "utf8")).toBe("x".repeat(20))
  })

  it("leaves a small log, and a missing one, alone", () => {
    const log = path.join(temp(), "server.log")
    expect(rotateLog(log, 10)).toBe(false)
    fs.writeFileSync(log, "short")
    expect(rotateLog(log, 10)).toBe(false)
    expect(fs.readFileSync(log, "utf8")).toBe("short")
  })
})
