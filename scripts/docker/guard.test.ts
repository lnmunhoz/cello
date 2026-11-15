import { describe, expect, it } from "vitest"
import { desktopE2eRefusal } from "./guard.ts"

describe("desktopE2eRefusal", () => {
  it("refuses on macOS, pointing at the Docker run", () => {
    const refusal = desktopE2eRefusal("darwin", {})
    expect(refusal).toContain("bun run test:docker:desktop")
    expect(refusal).toContain("CELLO_ALLOW_LOCAL_DESKTOP=1")
  })

  it("runs on macOS only with the explicit opt-in", () => {
    expect(desktopE2eRefusal("darwin", { CELLO_ALLOW_LOCAL_DESKTOP: "1" })).toBeNull()
    expect(desktopE2eRefusal("darwin", { CELLO_ALLOW_LOCAL_DESKTOP: "true" })).not.toBeNull()
  })

  it("doesn't take the container's flag as a pass on macOS: Docker runs Linux, so there it was set by hand", () => {
    expect(desktopE2eRefusal("darwin", { CELLO_DESKTOP_E2E: "docker" })).not.toBeNull()
  })

  it("runs on Linux: the container (xvfb, no screen of Lucas's)", () => {
    expect(desktopE2eRefusal("linux", { CELLO_DESKTOP_E2E: "docker" })).toBeNull()
    expect(desktopE2eRefusal("linux", {})).toBeNull()
  })
})
