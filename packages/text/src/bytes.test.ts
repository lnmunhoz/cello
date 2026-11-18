// File sizes in decimal units, as macOS Finder shows them, everywhere Cello prints one.
import { describe, expect, it } from "vitest"
import { formatBytes } from "./bytes.ts"

describe("formatBytes", () => {
  it("counts bytes below a thousand as they are", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(999)).toBe("999 B")
  })

  it("uses 1000 per unit, like Finder: a 20,480-byte file is 20 KB, as Finder says", () => {
    expect(formatBytes(1_000)).toBe("1.0 KB")
    expect(formatBytes(20_480)).toBe("20 KB")
    expect(formatBytes(3_400_000)).toBe("3.4 MB")
    expect(formatBytes(1_100_000_000)).toBe("1.1 GB")
    expect(formatBytes(2_000_000_000_000)).toBe("2.0 TB")
  })

  it("shows one decimal below 10 and whole numbers from 10, switching where 9.95 rounds up", () => {
    expect(formatBytes(1_234)).toBe("1.2 KB")
    expect(formatBytes(9_949)).toBe("9.9 KB")
    expect(formatBytes(9_950)).toBe("10 KB")
    expect(formatBytes(258_048)).toBe("258 KB")
  })

  it("moves to the next unit where a value would round to 1000", () => {
    expect(formatBytes(999_499)).toBe("999 KB")
    expect(formatBytes(999_500)).toBe("1.0 MB")
    expect(formatBytes(999_500_000)).toBe("1.0 GB")
  })
})
