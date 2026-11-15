// End-to-end tests of the desktop app: the built Electron app (dist-electron) against `cello start`
// servers with temp data folders on free ports (never 4747/4748/5199, never ~/.cello).
// They open real windows, so they run in Docker under Xvfb (`bun run test:docker:desktop`, or
// `bun run test:e2e` here), never on the Mac's screen: this file refuses to load on macOS.
// `test:e2e:local` is what the container runs: it builds the app first; e2e/setup.ts builds
// apps/cli/dist/cello when missing. Videos (MP4) and screenshots land in test-results/videos and
// test-results/screenshots, copied out to test-results/docker/latest/desktop/.
import { defineConfig } from "@playwright/test"
import { desktopE2eRefusal } from "../../scripts/docker/guard.ts"

const refusal = desktopE2eRefusal(process.platform, process.env)
if (refusal) throw new Error(refusal)

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results/playwright",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  reporter: [["list"]],
  timeout: 90_000,
  globalSetup: "./e2e/setup.ts",
})
