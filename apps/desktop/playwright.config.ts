// End-to-end tests of the desktop app: the built Electron app (dist-electron) against `cello start`
// servers with temp data folders on free ports (never 4747/4748/5199, never ~/.cello).
// `bun run test:e2e` builds the app first; e2e/setup.ts builds apps/cli/dist/cello when missing.
// Videos (MP4) and screenshots land in test-results/videos and test-results/screenshots.
import { defineConfig } from "@playwright/test"

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
