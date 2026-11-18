// The web build doesn't depend on the shell's Node (CEL-175). `bun run build` once ran `vite` under
// whatever `node` was first on PATH, and an older Node (fnm's default v22.17) couldn't load
// vite.config.ts, which imports TypeScript from the workspace. The app's scripts now run Vite under Bun.
// Here `node` on PATH is a stub that fails, so any build that reaches for Node fails the test.
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { APP_VERSION } from "@cello/shared/version"
import { afterEach, expect, it } from "vitest"
import { UNDER_LOAD } from "../../../cli/test/integration/underLoad.ts"

const web = path.join(import.meta.dirname, "../..")

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

// A real `bun run build` is a real OS process, so it takes UNDER_LOAD (docs/testing.md). Measured for
// CEL-175: 0.6-0.9 s on a 10-core Mac at load average ~15-22, 1.2 s with 60 extra busy loops on top,
// 0.4 s at load average ~185 (the build is mostly one Bun process).
it("builds with `bun run build` while `node` on PATH fails", UNDER_LOAD, () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cello-web-build-")))
  dirs.push(tmp)
  const fakebin = path.join(tmp, "fakebin")
  fs.mkdirSync(fakebin)
  fs.writeFileSync(path.join(fakebin, "node"), '#!/bin/sh\necho "node was called: $*" >&2\nexit 97\n', { mode: 0o755 })
  const root = path.join(tmp, "root")
  fs.mkdirSync(root)
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>build test</title>\n")
  const out = path.join(tmp, "out")

  const result = spawnSync(
    "bun",
    ["run", "build", root, "--config", path.join(web, "vite.config.ts"), "--outDir", out, "--emptyOutDir", "--logLevel", "error"],
    {
      cwd: web,
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakebin}${path.delimiter}${process.env.PATH ?? ""}`, CELLO_BUILD_COMMIT: "abcdef1" },
    },
  )

  expect(result.stderr).not.toContain("node was called")
  expect(result.status, result.stderr).toBe(0)
  expect(fs.existsSync(path.join(out, "index.html"))).toBe(true)
  const stamp = JSON.parse(fs.readFileSync(path.join(out, "build.json"), "utf8")) as { version: string; commit: string }
  expect(stamp.version).toBe(APP_VERSION)
  expect(stamp.commit).toBe("abcdef1")
})
