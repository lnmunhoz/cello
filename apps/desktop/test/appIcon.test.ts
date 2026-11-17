// The packaged app's icon is the Icon Composer document that art/icon/build-app-icons.mjs makes, so macOS
// 26 draws the agent flat (docs/specs/app-icon). electron-builder compiles it with actool when packaging;
// this checks what it's handed, without Xcode.
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "vitest"

const desktop = path.resolve(import.meta.dirname, "..")
const config = JSON.parse(fs.readFileSync(path.join(desktop, "electron-builder.json"), "utf8"))

describe("the packaged app's icon", () => {
  it("is the Icon Composer document: flat (no glass, shadow, specular or translucency), orange in light and dark", () => {
    expect(config.mac.icon).toBe("resources/Cello.icon")
    const document = path.join(desktop, config.mac.icon)
    const icon = JSON.parse(fs.readFileSync(path.join(document, "icon.json"), "utf8"))

    const orange = { solid: "srgb:1.00000,0.47843,0.18431,1.00000" }
    expect(icon["fill-specializations"]).toEqual([{ value: orange }, { appearance: "dark", value: orange }])
    for (const group of icon.groups) {
      expect(group).toMatchObject({ shadow: { kind: "none" }, specular: false, translucency: { enabled: false } })
      for (const layer of group.layers) {
        expect(layer.glass).toBe(false)
        expect(fs.existsSync(path.join(document, "Assets", layer["image-name"]))).toBe(true)
      }
    }
  })

  it("Cello Dev's (CEL-149) is the same document in indigo with a DEV badge on top, just as flat", () => {
    const read = (name: string) => JSON.parse(fs.readFileSync(path.join(desktop, "resources", name, "icon.json"), "utf8"))
    const [release, dev] = [read("Cello.icon"), read("CelloDev.icon")]
    // Indigo #5E5CE6 in light and dark, so the two apps tell apart in the Dock.
    const indigo = { solid: "srgb:0.36863,0.36078,0.90196,1.00000" }
    expect(dev["fill-specializations"]).toEqual([{ value: indigo }, { appearance: "dark", value: indigo }])
    expect(dev["fill-specializations"]).not.toEqual(release["fill-specializations"])
    expect(dev.groups.map((g: { layers: Array<{ name: string }> }) => g.layers.map((l) => l.name))).toEqual([["dev-badge"], ["agent"]])
    expect(dev.groups.slice(1)).toEqual(release.groups)
    for (const group of dev.groups) {
      expect(group).toMatchObject({ shadow: { kind: "none" }, specular: false, translucency: { enabled: false } })
      for (const layer of group.layers) expect(fs.existsSync(path.join(desktop, "resources/CelloDev.icon/Assets", layer["image-name"]))).toBe(true)
    }
  })
})
