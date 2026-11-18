import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { machineFacts, readRepoFacts } from "./repoFacts.ts"

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cello-facts-")))
afterAll(() => fs.rmSync(base, { recursive: true, force: true }))

const write = (root: string, files: Record<string, string>) => {
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    fs.writeFileSync(path.join(root, name), text)
  }
}

describe("reading a repo for detection (CEL-89)", () => {
  it("reports marker files, every package.json (workspace members too) and the config files' text", () => {
    const root = fs.mkdtempSync(path.join(base, "repo-"))
    write(root, {
      "package.json": JSON.stringify({ workspaces: ["apps/*", "packages/client"], scripts: { test: "vitest run" } }),
      "bun.lock": "",
      "playwright.config.ts": "export default {}",
      "apps/web/package.json": JSON.stringify({ devDependencies: { vite: "7" } }),
      "apps/web/vite.config.ts": "server: { port: 5199 }",
      "apps/notes/README.md": "no package here",
      "packages/client/package.json": "{ not json",
      ".maestro/flow.yaml": "",
    })
    const facts = readRepoFacts(root)
    expect(facts.paths).toEqual(expect.arrayContaining(["package.json", "bun.lock", ".maestro", "playwright.config.ts", "apps/web/package.json", "apps/web/vite.config.ts"]))
    expect(facts.packages.map((p) => p.path)).toEqual(["package.json", "apps/web/package.json"])
    expect(facts.texts).toEqual({ "playwright.config.ts": "export default {}", "apps/web/vite.config.ts": "server: { port: 5199 }" })
  })

  it("an empty repo has no facts", () => {
    expect(readRepoFacts(fs.mkdtempSync(path.join(base, "empty-")))).toEqual({ paths: [], packages: [], texts: {} })
  })

  it("finds ffmpeg and docker on PATH, and Playwright's browsers in its cache folder", () => {
    const home = fs.mkdtempSync(path.join(base, "home-"))
    const bin = path.join(home, "bin")
    fs.mkdirSync(bin)
    expect(machineFacts({ HOME: home, PATH: bin }, "linux")).toEqual({ ffmpeg: false, docker: false, playwrightBrowsers: false })
    for (const tool of ["ffmpeg", "docker"]) fs.writeFileSync(path.join(bin, tool), "#!/bin/sh\n", { mode: 0o755 })
    fs.mkdirSync(path.join(home, ".cache", "ms-playwright", "chromium-1200"), { recursive: true })
    expect(machineFacts({ HOME: home, PATH: bin }, "linux")).toEqual({ ffmpeg: true, docker: true, playwrightBrowsers: true })
    fs.mkdirSync(path.join(home, "Library", "Caches", "ms-playwright", "chromium-1200"), { recursive: true })
    expect(machineFacts({ HOME: home, PATH: bin }, "darwin").playwrightBrowsers).toBe(true)
    expect(machineFacts({ HOME: home, PATH: bin, PLAYWRIGHT_BROWSERS_PATH: path.join(home, "none") }, "darwin").playwrightBrowsers).toBe(false)
  })
})
