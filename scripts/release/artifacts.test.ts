// What a release builds and attaches: the `cello` binary and Cello.app, each zipped into release/.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { artifactNames, artifactSteps, buildArtifacts, PACKAGING_FAILED, STAGED_CLI } from "./artifacts.ts"

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cello-release-artifacts-")))
afterAll(() => fs.rmSync(base, { recursive: true, force: true }))
const root = "/repo"
const mac = { root, version: "0.3.0", platform: "darwin", arch: "arm64", desktop: true } as const

describe("artifactNames", () => {
  it("names each zip for its version and machine", () => {
    expect(artifactNames("0.3.0", "darwin", "arm64")).toEqual({
      cli: "cello-v0.3.0-darwin-arm64.zip",
      app: "Cello-v0.3.0-mac-arm64.zip",
    })
  })
})

describe("artifactSteps", () => {
  it("on a Mac: builds the CLI into release/stage (never over the live apps/cli/dist/cello), zips it, packages Cello.app with that build and zips it with ditto (as Apple does)", () => {
    expect(artifactSteps(mac).map((s) => [s.cwd.replace(root, "."), s.cmd.join(" ")])).toEqual([
      ["./apps/cli", "bun run build --outfile /repo/release/stage/cello"],
      ["./release/stage", "zip -j /repo/release/cello-v0.3.0-darwin-arm64.zip cello"],
      ["./apps/desktop", "bun run package --cli /repo/release/stage/cello"],
      [
        "./apps/desktop/dist/mac-arm64",
        "ditto -c -k --sequesterRsrc --keepParent Cello.app /repo/release/Cello-v0.3.0-mac-arm64.zip",
      ],
    ])
  })

  it("--skip-desktop leaves Cello.app out", () => {
    expect(artifactSteps({ ...mac, desktop: false }).map((s) => s.cmd[0])).toEqual(["bun", "zip"])
  })

  it("elsewhere: refuses to package Cello.app with a way out, and still zips the CLI when it's skipped", () => {
    expect(() => artifactSteps({ ...mac, platform: "linux", arch: "x64" })).toThrow(
      /Packaging Cello\.app needs macOS on Apple silicon \(this is linux-x64\)\. Release without it: bun run release -- --skip-desktop/,
    )
    expect(artifactSteps({ ...mac, platform: "linux", arch: "x64", desktop: false })[1]!.cmd).toEqual([
      "zip",
      "-j",
      "/repo/release/cello-v0.3.0-linux-x64.zip",
      "cello",
    ])
  })
})

describe("buildArtifacts", () => {
  const repo = (name: string) => {
    const dir = path.join(base, name)
    fs.mkdirSync(path.join(dir, "release"), { recursive: true })
    fs.writeFileSync(path.join(dir, "release/cello-v0.2.9-darwin-arm64.zip"), "stale")
    return dir
  }

  it("empties release/ first, so only this release's zips get attached, and runs each step in order", () => {
    const dir = repo("ok")
    const ran: string[] = []
    const zips = buildArtifacts({ ...mac, root: dir }, (cmd) => {
      ran.push(cmd[0]!)
      return 0
    })
    expect(fs.readdirSync(path.join(dir, "release"))).toEqual(["stage"])
    expect(STAGED_CLI).toBe("release/stage/cello")
    expect(ran).toEqual(["bun", "zip", "bun", "ditto"])
    expect(zips).toEqual([
      path.join(dir, "release/cello-v0.3.0-darwin-arm64.zip"),
      path.join(dir, "release/Cello-v0.3.0-mac-arm64.zip"),
    ])
  })

  // A step that writes the staged binary, as the real build does, then exits with `code` at `failAt`.
  const building = (dir: string, failAt: string, code: number) => (cmd: ReadonlyArray<string>) => {
    if (cmd.includes("build")) fs.writeFileSync(path.join(dir, STAGED_CLI), "half a binary")
    return cmd.join(" ").includes(failAt) ? code : 0
  }

  it("a failed Cello.app package names the way out, deletes the staged build and marks that packaging failed", () => {
    const dir = repo("fail-app")
    expect(() => buildArtifacts({ ...mac, root: dir }, building(dir, "package", 1))).toThrow(
      /Packaging Cello\.app failed \(bun run package --cli \S+ exited 1\)\. Fix it, or release without it: bun run release -- --skip-desktop/,
    )
    expect(fs.existsSync(path.join(dir, "release/stage"))).toBe(false)
    expect(fs.existsSync(path.join(dir, PACKAGING_FAILED))).toBe(true)
  })

  it("a failed CLI build (a full disk leaves a truncated outfile) deletes the staged build", () => {
    const dir = repo("fail-cli")
    expect(() => buildArtifacts({ ...mac, root: dir }, building(dir, "build", 2))).toThrow(
      /Building the cello binary failed \(bun run build --outfile \S+ exited 2\)/,
    )
    expect(fs.existsSync(path.join(dir, "release/stage"))).toBe(false)
    expect(fs.existsSync(path.join(dir, PACKAGING_FAILED))).toBe(false)
  })

  it("stops at the first failing step", () => {
    const dir = repo("first")
    const ran: string[] = []
    expect(() =>
      buildArtifacts({ ...mac, root: dir }, (cmd) => {
        ran.push(cmd[0]!)
        return cmd[0] === "zip" ? 9 : 0
      }),
    ).toThrow(/zip -j \S+ cello exited 9/)
    expect(ran).toEqual(["bun", "zip"])
  })
})
