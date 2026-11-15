// The desktop e2e helpers refuse to load on the Mac, whichever config ran them: `-c apps/desktop/e2e`
// uses Playwright's default config and skips playwright.config.ts's check, but every test that
// launches Electron imports e2e/support.ts.
import { afterEach, describe, expect, it } from "vitest"
import { ALLOW_LOCAL } from "../../../scripts/docker/guard.ts"

describe("e2e/support.ts on macOS", () => {
  const saved = process.env[ALLOW_LOCAL.name]
  afterEach(() => {
    if (saved === undefined) delete process.env[ALLOW_LOCAL.name]
    else process.env[ALLOW_LOCAL.name] = saved
  })

  it.runIf(process.platform === "darwin")("throws on import without the opt-in, pointing at the Docker run", async () => {
    delete process.env[ALLOW_LOCAL.name]
    await expect(import("../e2e/support.ts")).rejects.toThrow("bun run test:docker:desktop")
  })
})
