import { describe, expect, it } from "vitest"
import { appIdentity, executableOf, userDataName } from "./flavor.ts"

describe("appIdentity: the two Cellos macOS keeps apart (CEL-149)", () => {
  it("the release is Cello, as it always was: app.cello.desktop, cello:// links, updates from GitHub", () => {
    expect(appIdentity("release")).toEqual({
      flavor: "release",
      name: "Cello",
      appId: "app.cello.desktop",
      scheme: "cello",
      installedApp: "/Applications/Cello.app",
      icon: "resources/Cello.icon",
      checksUpdates: true,
    })
  })

  it("the dev build is Cello Dev: its own bundle id, cello-dev:// links, the DEV icon, no update checks", () => {
    expect(appIdentity("dev")).toEqual({
      flavor: "dev",
      name: "Cello Dev",
      appId: "app.cello.desktop.dev",
      scheme: "cello-dev",
      installedApp: "/Applications/Cello Dev.app",
      icon: "resources/CelloDev.icon",
      checksUpdates: false,
    })
  })
})

describe("executableOf", () => {
  it("is the app's main executable, named as the app", () => {
    expect(executableOf("/Applications/Cello.app", appIdentity("release"))).toBe("/Applications/Cello.app/Contents/MacOS/Cello")
    expect(executableOf("/Applications/Cello Dev.app", appIdentity("dev"))).toBe("/Applications/Cello Dev.app/Contents/MacOS/Cello Dev")
  })
})

describe("userDataName: each app keeps its own state, so the two run side by side", () => {
  it("is the app's name when packaged, and apart from it when run from the repo (bun run dev, the e2e tests)", () => {
    expect(userDataName(appIdentity("release"), true)).toBe("Cello")
    expect(userDataName(appIdentity("dev"), true)).toBe("Cello Dev")
    expect(userDataName(appIdentity("dev"), false)).toBe("Cello Dev (unpackaged)")
    expect(userDataName(appIdentity("release"), false)).toBe("Cello (unpackaged)")
  })
})
