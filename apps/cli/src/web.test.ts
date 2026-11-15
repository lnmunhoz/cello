// Which web app `cello start` serves: CELLO_WEB_DIR when it holds a build, else the built-in one (the
// binary's embedded files, or apps/web/dist from source).
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { webFor } from "./web.ts"

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cello-web-")))
afterAll(() => fs.rmSync(base, { recursive: true, force: true }))

const builtIn = new Map([["/index.html", "/$bunfs/root/index.html"]])

describe("the web app cello start serves", () => {
  it("is CELLO_WEB_DIR when it holds a build, even in the compiled binary (CEL-37: tests serve two builds)", () => {
    const dir = path.join(base, "build-b")
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, "index.html"), "<title>B</title>")
    expect(webFor({ CELLO_WEB_DIR: dir }, () => builtIn)?.get("/index.html")).toBe(path.join(dir, "index.html"))
  })

  it("is the built-in one otherwise, or when CELLO_WEB_DIR has no index.html", () => {
    expect(webFor({}, () => builtIn)).toBe(builtIn)
    expect(webFor({ CELLO_WEB_DIR: path.join(base, "missing") }, () => builtIn)).toBe(builtIn)
  })
})
