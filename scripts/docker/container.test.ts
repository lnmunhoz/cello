import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { buildArgs, containerScript, dockerArgs, EXCLUDES, imageTag, parseCommand, versions } from "./container.ts"

const root = path.resolve(import.meta.dirname, "../..")

/**
 * The words a step of the container script runs, as bash parses them: `step <name> <command>` with
 * the commands it calls (bun, cd, xvfb-run) replaced by stubs that print their name and arguments.
 */
const stepArgv = (script: string, name: string): string[] => {
  const line = script.split("\n").find((l) => l.startsWith(`step ${name} `))
  if (!line) throw new Error(`no step ${name}`)
  const command = execFileSync("bash", ["-c", `step() { printf %s "$2"; }; ${line}`], { encoding: "utf8" })
  const stubs = ["bun", "cd", "xvfb-run"].map((stub) => `${stub}() { printf '%s\\n' ${stub} "$@"; }`).join("; ")
  return execFileSync("bash", ["-c", `${stubs}; ${command}`], { encoding: "utf8" }).trimEnd().split("\n")
}
const image = "cello-test:abc"

describe("versions", () => {
  it("reads the pinned Playwright and Bun from the repo, matching what's installed", () => {
    const pinned = versions(root)
    const installed = JSON.parse(fs.readFileSync(path.join(root, "node_modules/@playwright/test/package.json"), "utf8")).version
    expect(pinned.playwright).toBe(installed)
    expect(pinned.bun).toBe(fs.readFileSync(path.join(root, ".bun-version"), "utf8").trim())
  })
})

describe("imageTag", () => {
  const inputs = { dockerfile: "FROM x\n", playwright: "1.65.1", bun: "1.4.4" }

  it("names the versions and hashes them with the Dockerfile, so the image is rebuilt only when one changes", () => {
    const tag = imageTag(inputs)
    expect(tag).toMatch(/^cello-test:pw1\.65\.1-bun1\.4\.4-[0-9a-f]{10}$/)
    expect(imageTag({ ...inputs })).toBe(tag)
    expect(imageTag({ ...inputs, dockerfile: "FROM x\nRUN y\n" })).not.toBe(tag)
    expect(imageTag({ ...inputs, playwright: "1.66.0" })).not.toBe(tag)
    expect(imageTag({ ...inputs, bun: "1.4.5" })).not.toBe(tag)
  })
})

describe("buildArgs", () => {
  it("builds FROM the Playwright image of the pinned version, with only docker/ as the context", () => {
    const args = buildArgs({ tag: image, playwright: "1.65.1", bun: "1.4.4", dockerfile: "/repo/docker/test.Dockerfile" })
    expect(args).toEqual([
      "build", "-t", image, "-f", "/repo/docker/test.Dockerfile",
      "--build-arg", "PLAYWRIGHT_VERSION=1.65.1", "--build-arg", "BUN_VERSION=1.4.4", "/repo/docker",
    ])
  })

  it("the Dockerfile takes its base image tag from that build argument", () => {
    const dockerfile = fs.readFileSync(path.join(root, "docker/test.Dockerfile"), "utf8")
    expect(dockerfile).toMatch(/^FROM mcr\.microsoft\.com\/playwright:v\$\{PLAYWRIGHT_VERSION\}-noble$/m)
  })
})

describe("parseCommand", () => {
  it("takes a mode and passes the rest to Playwright", () => {
    expect(parseCommand(["all"])).toEqual({ mode: "all", args: [] })
    expect(parseCommand(["e2e", "e2e/board.spec.ts", "--grep", "drag"])).toEqual({ mode: "e2e", args: ["e2e/board.spec.ts", "--grep", "drag"] })
    expect(parseCommand(["desktop", "--", "-g", "CEL-12"])).toEqual({ mode: "desktop", args: ["-g", "CEL-12"] })
  })

  it("refuses an unknown mode, and Playwright arguments for the full run (two suites, which would get them?)", () => {
    expect(parseCommand([])).toHaveProperty("error")
    expect(parseCommand(["web"])).toHaveProperty("error")
    expect(parseCommand(["all", "--grep", "x"])).toHaveProperty("error")
  })
})

describe("dockerArgs", () => {
  const args = dockerArgs({ image, mode: "desktop", args: [], repo: "/repo", out: "/results", cpus: "3", memory: "4g", env: {} })

  it("mounts the repo read-only and the run's results folder, with caches for Bun and Electron", () => {
    expect(args).toContain("/repo:/src:ro")
    expect(args).toContain("/results:/out")
    expect(args).toContain("cello-test-bun-cache:/root/.bun/install/cache")
    expect(args).toContain("cello-test-electron-cache:/root/.cache/electron")
  })

  it("caps CPUs and memory, reaps processes with --init and gives Chromium a bigger /dev/shm", () => {
    expect(args.slice(0, 2)).toEqual(["run", "--rm"])
    for (const flag of ["--init", "--cpus=3", "--memory=4g", "--shm-size=1g"]) expect(args).toContain(flag)
  })

  it("never shares the host's network, IPC or processes, and publishes no ports (the default ports are the container's own)", () => {
    for (const risky of ["--privileged", "--network=host", "--net=host", "--ipc=host", "--pid=host", "-p", "--publish", "-P"]) {
      expect(args).not.toContain(risky)
    }
  })

  it("tells the tests they're in the container, and passes CELLO_E2E_SLOWMO and CELLO_E2E_ONLINE through only when set", () => {
    expect(args).toContain("CELLO_DESKTOP_E2E=docker")
    expect(args.join(" ")).not.toContain("CELLO_E2E_SLOWMO")
    const slow = dockerArgs({ image, mode: "e2e", args: [], repo: "/repo", out: "/results", cpus: "4", memory: "6g", env: { CELLO_E2E_SLOWMO: "400", CELLO_E2E_ONLINE: "1", HOME: "/Users/x" } })
    expect(slow).toContain("CELLO_E2E_SLOWMO=400")
    expect(slow).toContain("CELLO_E2E_ONLINE=1")
    expect(slow.join(" ")).not.toContain("HOME=")
  })

  it("runs the container script with bash in the test image", () => {
    expect(args.slice(-4)).toEqual([image, "bash", "-c", containerScript("desktop", [])])
  })
})

describe("containerScript", () => {
  it("copies the repo from the read-only mount, leaving out installs, builds, results, other worktrees and data folders", () => {
    const script = containerScript("e2e", [])
    const copy = script.split("\n").find((line) => line.startsWith("tar -C /src"))!
    for (const pattern of ["node_modules", ".git", "dist", "dist-electron", "test-results", ".cello", "./e2e/videos", "./.claude/worktrees"]) {
      expect(EXCLUDES).toContain(pattern)
      expect(copy).toContain(`--exclude='${pattern}'`)
    }
    expect(copy).toContain("| tar -xf - -C /work")
  })

  it("installs from the lockfile, and stops when that fails", () => {
    const script = containerScript("e2e", [])
    expect(stepArgv(script, "install")).toEqual(["bun", "install", "--frozen-lockfile"])
    expect(script).toMatch(/^step install .* \|\| exit 1$/m)
  })

  it("the full run: unit and integration, typecheck, web e2e and desktop e2e (Electron on a virtual screen that fits its 1440×900 window at 2x)", () => {
    const script = containerScript("all", [])
    expect(stepArgv(script, "unit")).toEqual(["bun", "run", "test"])
    expect(stepArgv(script, "typecheck")).toEqual(["bun", "run", "typecheck"])
    expect(stepArgv(script, "web-e2e")).toEqual(["bun", "run", "test:e2e:local"])
    expect(stepArgv(script, "desktop-e2e")).toEqual(["cd", "apps/desktop", "xvfb-run", "-a", "-s", "-screen 0 3200x2000x24", "bun", "run", "test:e2e:local"])
  })

  it("one suite runs alone, with the Playwright arguments quoted", () => {
    const web = containerScript("e2e", ["e2e/board.spec.ts", "--grep", "Lucas's card"])
    expect(web).not.toMatch(/step (unit|typecheck|desktop-e2e) /)
    expect(stepArgv(web, "web-e2e")).toEqual(["bun", "run", "test:e2e:local", "e2e/board.spec.ts", "--grep", "Lucas's card"])
    const desktop = containerScript("desktop", ["-g", "CEL-12"])
    expect(desktop).not.toMatch(/step (unit|typecheck|web-e2e) /)
    expect(stepArgv(desktop, "desktop-e2e")).toEqual([
      "cd", "apps/desktop", "xvfb-run", "-a", "-s", "-screen 0 3200x2000x24", "bun", "run", "test:e2e:local", "-g", "CEL-12",
    ])
  })

  it("copies the videos, screenshots and Playwright output out, then exits with the worst status", () => {
    const script = containerScript("all", [])
    expect(script).toContain("cp -R e2e/videos /out/web/videos")
    expect(script).toContain("cp -R test-results/playwright /out/web/playwright")
    expect(script).toContain("cp -R apps/desktop/test-results/. /out/desktop/")
    expect(script.trimEnd().split("\n").at(-1)).toBe("exit $status")
    // Each step records its exit code and keeps going; any failure makes the run fail.
    expect(script).toContain(`[ "$code" -eq 0 ] || status=1`)
  })
})
