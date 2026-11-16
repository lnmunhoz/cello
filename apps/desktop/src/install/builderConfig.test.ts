// Which cello binary Cello.app bundles: apps/cli/dist/cello by default, or another build (a release's
// staged one, CEL-36) through a copy of electron-builder.json that names it.
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { bundlingCli } from "./builderConfig.ts"

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
