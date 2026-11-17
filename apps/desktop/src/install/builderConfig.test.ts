// The electron-builder config one `bun run package` uses: which cello binary Cello.app bundles (apps/cli/dist/cello
// by default, or a release's staged build, CEL-36), which architecture, whether it also makes the DMG and zip a
// release attaches, and whether it's signed (CEL-139).
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { bundlingCli, packagedApp, packagingConfig, parsePackaging } from "./builderConfig.ts"

const config = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../../electron-builder.json"), "utf8"))

describe("bundlingCli", () => {
  it("swaps the cello resource's source for the given binary and leaves the rest of the config alone", () => {
    const swapped = bundlingCli(config, "/repo/release/stage/cello")
    expect(swapped.extraResources).toEqual([
      { from: "/repo/release/stage/cello", to: "cello" },
      { from: "dist-electron/build.json", to: "build.json" },
    ])
    expect({ ...swapped, extraResources: config.extraResources }).toEqual(config)
    expect(config.extraResources[0]).toEqual({ from: "../cli/dist/cello", to: "cello" }) // not mutated
  })

  it("refuses a config without the cello resource", () => {
    expect(() => bundlingCli({ extraResources: [] }, "/x/cello")).toThrow(/electron-builder\.json has no extraResources entry for cello/)
  })
})

describe("packagingConfig", () => {
  it("the release: an ad-hoc signed Cello.app folder for Apple silicon, as electron-builder.json has it", () => {
    expect(packagingConfig(config, { arch: "arm64", artifacts: false, sign: false, flavor: "release" })).toEqual(config)
    // "-": signed ad hoc, so the whole bundle (helpers, Resources/cello) is sealed again after electron-builder
    // rewrote it, and a downloaded copy gets macOS's "can't verify the developer" prompt instead of "is damaged".
    expect(config.mac).toMatchObject({ target: [{ target: "dir", arch: ["arm64"] }], identity: "-", hardenedRuntime: false })
  })

  it("for a release: the DMG and zip for the given architecture, named as the release attaches them", () => {
    const intel = packagingConfig(config, { arch: "x64", artifacts: true, sign: false, flavor: "release" })
    expect(intel.mac).toEqual({
      ...config.mac,
      target: [
        { target: "dmg", arch: ["x64"] },
        { target: "zip", arch: ["x64"] },
      ],
    })
    expect(config.mac.artifactName).toBe("Cello-v${version}-mac-${arch}.${ext}")
    expect(packagingConfig(config, { arch: "x64", artifacts: false, sign: false, flavor: "release" }).mac.target).toEqual([{ target: "dir", arch: ["x64"] }])
  })

  it("signed: no ad-hoc identity, so electron-builder signs with CSC_LINK's certificate, with the hardened runtime and the entitlements Electron and Bun need", () => {
    const signed = packagingConfig(config, { arch: "arm64", artifacts: true, sign: true, flavor: "release" })
    expect(signed.mac).not.toHaveProperty("identity")
    expect(signed.mac).toMatchObject({
      hardenedRuntime: true,
      entitlements: "resources/entitlements.mac.plist",
      entitlementsInherit: "resources/entitlements.mac.plist",
    })
    expect(fs.existsSync(path.join(import.meta.dirname, "../..", String(signed.mac.entitlements)))).toBe(true)
    expect(config.mac.identity).toBe("-") // not mutated
  })

  it("Cello Dev (CEL-149): its own name, bundle id, cello-dev:// scheme and DEV icon, so macOS keeps it apart from Cello", () => {
    const dev = packagingConfig(config, { arch: "arm64", artifacts: false, sign: false, flavor: "dev" })
    expect(dev).toEqual({
      ...config,
      productName: "Cello Dev",
      appId: "app.cello.desktop.dev",
      protocols: [{ name: "Cello Dev", schemes: ["cello-dev"] }],
      mac: { ...config.mac, icon: "resources/CelloDev.icon", artifactName: "Cello-Dev-v${version}-mac-${arch}.${ext}" },
    })
    expect(fs.existsSync(path.join(import.meta.dirname, "../..", "resources/CelloDev.icon/icon.json"))).toBe(true)
    // electron-builder.json is the release's.
    expect(config).toMatchObject({ productName: "Cello", appId: "app.cello.desktop", protocols: [{ name: "Cello", schemes: ["cello"] }] })
  })

  it("strips Electron's demo app before signing and the DMG: the afterPack hook exists", () => {
    expect(config.afterPack).toBe("./scripts/after-pack.cjs")
    expect(fs.existsSync(path.join(import.meta.dirname, "../..", config.afterPack))).toBe(true)
  })
})

describe("packagedApp", () => {
  it("is where electron-builder puts the app: dist/mac-arm64, or dist/mac for x64 (its default arch)", () => {
    expect(packagedApp("arm64", "release")).toBe("dist/mac-arm64/Cello.app")
    expect(packagedApp("x64", "release")).toBe("dist/mac/Cello.app")
    expect(packagedApp("arm64", "dev")).toBe("dist/mac-arm64/Cello Dev.app")
  })
})

describe("parsePackaging", () => {
  it("defaults to an unsigned Apple silicon app folder of Cello Dev: a package made on the Mac is the dev build (CEL-149)", () => {
    expect(parsePackaging([])).toEqual({ arch: "arm64", artifacts: false, sign: false, flavor: "dev" })
    expect(parsePackaging(["--install"])).toMatchObject({ flavor: "dev" })
  })

  it("takes --arch, --artifacts and --sign among package.ts's other flags; the downloads (--artifacts) are the release", () => {
    expect(parsePackaging(["--cli", "/x/cello", "--arch", "x64", "--artifacts", "--sign"])).toEqual({ arch: "x64", artifacts: true, sign: true, flavor: "release" })
  })

  it("--flavor names it either way", () => {
    expect(parsePackaging(["--flavor", "release"])).toMatchObject({ artifacts: false, flavor: "release" })
    expect(parsePackaging(["--artifacts", "--flavor", "dev"])).toMatchObject({ artifacts: true, flavor: "dev" })
    expect(() => parsePackaging(["--flavor", "canary"])).toThrow("--flavor takes release or dev, not canary.")
  })

  it("refuses an architecture it can't package", () => {
    expect(() => parsePackaging(["--arch", "ia32"])).toThrow("--arch takes arm64 or x64, not ia32.")
    expect(() => parsePackaging(["--arch"])).toThrow("--arch takes arm64 or x64, not nothing.")
  })
})
