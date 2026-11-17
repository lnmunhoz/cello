// What a release builds: this Mac's own cello for the deploy (every release), and the downloads (the cello
// zip, Cello.app's DMG and zip) on GitHub Actions per architecture, or on this Mac with --local-artifacts.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { artifactNames, artifactSteps, buildArtifacts, PACKAGING_FAILED, STAGED_CLI } from "./artifacts.ts"

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cello-release-artifacts-")))
afterAll(() => fs.rmSync(base, { recursive: true, force: true }))
const root = "/repo"
const mac = { root, version: "0.3.0", platform: "darwin", arch: "arm64", downloads: true, desktop: true, sign: false } as const
const shown = (options: Parameters<typeof artifactSteps>[0]) =>
  artifactSteps(options).map((s) => [s.cwd.replace(root, "."), s.cmd.join(" ").replaceAll(root, ".")])

describe("artifactNames", () => {
  it("names each download for its version and machine", () => {
    expect(artifactNames("0.3.0", "darwin", "arm64")).toEqual({
      cli: "cello-v0.3.0-darwin-arm64.zip",
      dmg: "Cello-v0.3.0-mac-arm64.dmg",
      app: "Cello-v0.3.0-mac-arm64.zip",
    })
    expect(artifactNames("0.3.0", "darwin", "x64").dmg).toBe("Cello-v0.3.0-mac-x64.dmg")
  })

  it("matches the names electron-builder gives the DMG and app zip (electron-builder.json's artifactName)", () => {
    const config = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../../apps/desktop/electron-builder.json"), "utf8"))
    const named = (ext: string) =>
      String(config.mac.artifactName).replace("${version}", "0.3.0").replace("${arch}", "x64").replace("${ext}", ext)
    expect([named("dmg"), named("zip")]).toEqual([artifactNames("0.3.0", "darwin", "x64").dmg, artifactNames("0.3.0", "darwin", "x64").app])
  })
})

describe("artifactSteps", () => {
  it("a release's own cello: builds it for this machine into release/stage (never over the live apps/cli/dist/cello), and nothing else", () => {
    expect(shown({ ...mac, downloads: false })).toEqual([["./apps/cli", "bun run build --outfile ./release/stage/cello --target bun-darwin-arm64"]])
  })

  it("the downloads: the cello zip, then Cello.app packaged with that same build, its seal checked, as a DMG and a zip moved into release/", () => {
    expect(shown(mac)).toEqual([
      ["./apps/cli", "bun run build --outfile ./release/stage/cello --target bun-darwin-arm64"],
      ["./release/stage", "zip -j ./release/cello-v0.3.0-darwin-arm64.zip cello"],
      ["./apps/desktop", "bun run package --cli ./release/stage/cello --arch arm64 --artifacts"],
      // Signed ad hoc or with a Developer ID, a broken seal (a file changed after signing) fails the build.
      ["./apps/desktop", "codesign --verify --deep --strict --verbose=2 dist/mac-arm64/Cello.app"],
      ["./apps/desktop", "mv dist/Cello-v0.3.0-mac-arm64.dmg ./release/Cello-v0.3.0-mac-arm64.dmg"],
      ["./apps/desktop", "mv dist/Cello-v0.3.0-mac-arm64.zip ./release/Cello-v0.3.0-mac-arm64.zip"],
    ])
  })

  it("on Intel: the x64 cello and Cello.app", () => {
    expect(shown({ ...mac, arch: "x64" }).map(([, cmd]) => cmd)).toEqual([
      "bun run build --outfile ./release/stage/cello --target bun-darwin-x64",
      "zip -j ./release/cello-v0.3.0-darwin-x64.zip cello",
      "bun run package --cli ./release/stage/cello --arch x64 --artifacts",
      "codesign --verify --deep --strict --verbose=2 dist/mac/Cello.app",
      "mv dist/Cello-v0.3.0-mac-x64.dmg ./release/Cello-v0.3.0-mac-x64.dmg",
      "mv dist/Cello-v0.3.0-mac-x64.zip ./release/Cello-v0.3.0-mac-x64.zip",
    ])
  })

  it("signs Cello.app only when asked (the workflow, when its signing secrets exist)", () => {
    expect(shown({ ...mac, sign: true })[2]![1]).toBe("bun run package --cli ./release/stage/cello --arch arm64 --artifacts --sign")
  })

  it("--skip-desktop leaves Cello.app out", () => {
    expect(artifactSteps({ ...mac, desktop: false }).map((s) => s.cmd[0])).toEqual(["bun", "zip"])
  })

  it("elsewhere: refuses to package Cello.app with a way out, and still zips the CLI when it's skipped", () => {
    expect(() => artifactSteps({ ...mac, platform: "linux", arch: "x64" })).toThrow(
      /Packaging Cello\.app needs macOS \(this is linux-x64\)\. Release without it: bun run release -- --local-artifacts --skip-desktop/,
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

  it("empties release/ first, so only this release's files get attached, runs each step in order and returns the downloads", () => {
    const dir = repo("ok")
    const ran: string[] = []
    const files = buildArtifacts({ ...mac, root: dir }, (cmd) => {
      ran.push(cmd[0]!)
      return 0
    })
    expect(fs.readdirSync(path.join(dir, "release"))).toEqual(["stage"])
    expect(STAGED_CLI).toBe("release/stage/cello")
    expect(ran).toEqual(["bun", "zip", "bun", "codesign", "mv", "mv"])
    expect(files).toEqual([
      path.join(dir, "release/cello-v0.3.0-darwin-arm64.zip"),
      path.join(dir, "release/Cello-v0.3.0-mac-arm64.dmg"),
      path.join(dir, "release/Cello-v0.3.0-mac-arm64.zip"),
    ])
  })

  it("a release's own cello returns no downloads", () => {
    const dir = repo("stage-only")
    expect(buildArtifacts({ ...mac, root: dir, downloads: false }, () => 0)).toEqual([])
  })

  // A step that writes the staged binary, as the real build does, then exits with `code` at `failAt`.
  const building = (dir: string, failAt: string, code: number) => (cmd: ReadonlyArray<string>) => {
    if (cmd.includes("build")) fs.writeFileSync(path.join(dir, STAGED_CLI), "half a binary")
    return cmd.join(" ").includes(failAt) ? code : 0
  }

  it("a failed Cello.app package names the way out, deletes the staged build and marks that packaging failed", () => {
    const dir = repo("fail-app")
    expect(() => buildArtifacts({ ...mac, root: dir }, building(dir, "package", 1))).toThrow(
      /Packaging Cello\.app failed \(bun run package --cli \S+ --arch arm64 --artifacts exited 1\)\. Fix it, or release without it: bun run release -- --local-artifacts --skip-desktop/,
    )
    expect(fs.existsSync(path.join(dir, "release/stage"))).toBe(false)
    expect(fs.existsSync(path.join(dir, PACKAGING_FAILED))).toBe(true)
  })

  it("a failed CLI build (a full disk leaves a truncated outfile) deletes the staged build", () => {
    const dir = repo("fail-cli")
    expect(() => buildArtifacts({ ...mac, root: dir }, building(dir, "build", 2))).toThrow(
      /Building the cello binary failed \(bun run build --outfile \S+ --target bun-darwin-arm64 exited 2\)/,
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
