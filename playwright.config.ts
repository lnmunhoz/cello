// End-to-end tests: the built web app against a real server with a temp data folder (never ~/.cello).
// `bun run test:e2e` runs them in Docker (scripts/test-in-docker.ts); `bun run test:e2e:local` runs
// them here in headless Chromium, building the web app first. Videos are converted to MP4 in e2e/videos/.
import { defineConfig, devices } from "@playwright/test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

// Ports come from the environment so parallel runs (worktrees, a running dev app) don't clash.
const SERVER_PORT = Number(process.env.CELLO_E2E_SERVER_PORT ?? 4791)
const WEB_PORT = Number(process.env.CELLO_WEB_PORT ?? 5199)
// Workers load this file too; they inherit the folder the main process made.
process.env.CELLO_E2E_DATA ??= fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-"))

export default defineConfig({
  testDir: "e2e",
  // Not test-results/ itself: Playwright empties its output folder, and test-results/docker/ holds
  // the Docker runs' videos (one of them maybe still being written).
  outputDir: "test-results/playwright",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  reporter: [["list"]],
  globalTeardown: "./e2e/teardown.ts",
  use: {
    // The server only accepts pages on its own port or CELLO_WEB_PORT (default 5199).
    baseURL: `http://localhost:${WEB_PORT}`,
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    video: { mode: "on", size: { width: 1440, height: 900 } },
    // Videos for a review packet: CELLO_E2E_SLOWMO=400 slows every browser action so each step can be
    // seen. Off by default; tests never wait on it.
    launchOptions: { slowMo: Number(process.env.CELLO_E2E_SLOWMO ?? 0) },
  },
  webServer: [
    {
      command: "bun src/main.ts",
      cwd: "apps/server",
      env: { CELLO_PORT: String(SERVER_PORT), CELLO_DATA_DIR: process.env.CELLO_E2E_DATA!, CELLO_WEB_PORT: String(WEB_PORT) },
      url: `http://127.0.0.1:${SERVER_PORT}/rpc`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      stdout: "pipe",
    },
    {
      // On 127.0.0.1, not "localhost" (which Node binds to ::1 when it lists that first, as in the Docker
      // image): Node 26's fetch and WebSocket, which the tests' RPC client uses, dial only 127.0.0.1 for
      // localhost. The browser still opens http://localhost and falls back to 127.0.0.1.
      command: "bunx vite preview --host 127.0.0.1",
      cwd: "apps/web",
      env: { CELLO_SERVER: `127.0.0.1:${SERVER_PORT}`, CELLO_WEB_PORT: String(WEB_PORT) },
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
    },
  ],
})
