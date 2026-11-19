import { describe, expect, it } from "vitest"
import { flavorArg, parseFlavor } from "./flavor.ts"

describe("parseFlavor: which build of Cello this is (CEL-149)", () => {
  it("knows release and dev, nothing else", () => {
    expect(parseFlavor("release")).toBe("release")
    expect(parseFlavor("dev")).toBe("dev")
    for (const bad of ["", "Dev", "beta", null, undefined, 1]) expect(parseFlavor(bad), String(bad)).toBeNull()
  })
})

describe("flavorArg: a build script's --flavor", () => {
  it("takes the value after --flavor", () => {
    expect(flavorArg(["bun", "build.ts", "--flavor", "release"], "dev")).toBe("release")
    expect(flavorArg(["--outfile", "x", "--flavor", "dev"], "release")).toBe("dev")
  })

  it("is the script's default without the flag", () => {
    expect(flavorArg(["bun", "build.ts"], "dev")).toBe("dev")
    expect(flavorArg([], "release")).toBe("release")
  })

  it("refuses another value, or none, instead of building the wrong app", () => {
    expect(() => flavorArg(["--flavor", "beta"], "dev")).toThrow("--flavor takes release or dev, not beta.")
    expect(() => flavorArg(["--flavor"], "dev")).toThrow("--flavor takes release or dev, not nothing.")
  })
})
