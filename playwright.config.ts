// End-to-end tests: the built web app against a real server with a temp data folder (never ~/.cello).
// `bun run test:e2e` runs them in Docker (scripts/test-in-docker.ts); `bun run test:e2e:local` runs
// them here in headless Chromium, building the web app first. Videos are converted to MP4 in e2e/videos/.
import { defineConfig, devices } from "@playwright/test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { slowMo, testTimeoutMs, VIDEO_SIZE } from "./e2e/recording.ts"

// Ports come from the environment so parallel runs (worktrees, a running dev app) don't clash.
const SERVER_PORT = Number(process.env.CELLO_E2E_SERVER_PORT ?? 4791)
const WEB_PORT = Number(process.env.CELLO_WEB_PORT ?? 5199)
// Workers load this file too; they inherit the folder the main process made.
process.env.CELLO_E2E_DATA ??= fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-"))

export default defineConfig({
  testDir: "e2e",
  // e2e/*.test.ts are Vitest unit tests of the harness's own pure parts.
  testMatch: "**/*.spec.ts",
  // Not test-results/ itself: Playwright empties its output folder, and test-results/docker/ holds
  // the Docker runs' videos (one of them maybe still being written).
  outputDir: "test-results/playwright",
  fullyParallel: false,
  workers: 1,
  // Longer in review mode (CELLO_E2E_REVIEW=1), where captions hold and actions wait by design.
  timeout: testTimeoutMs(process.env),
  forbidOnly: true,
  reporter: [["list"]],
  globalTeardown: "./e2e/teardown.ts",
  use: {
    // The server only accepts pages on its own port or CELLO_WEB_PORT (default 5199).
    baseURL: `http://localhost:${WEB_PORT}`,
    ...devices["Desktop Chrome"],
    viewport: VIDEO_SIZE,
    video: { mode: "on", size: VIDEO_SIZE },
    // Videos for a review packet: CELLO_E2E_REVIEW=1 slows every browser action and holds each step
    // (e2e/recording.ts); CELLO_E2E_SLOWMO sets the slow motion alone. Off by default; tests never wait on it.
    launchOptions: { slowMo: slowMo(process.env) },
  },
  webServer: [
    {
      command: "bun src/main.ts",
      cwd: "apps/server",
      env: {
        CELLO_PORT: String(SERVER_PORT),
        CELLO_DATA_DIR: process.env.CELLO_E2E_DATA!,
        CELLO_WEB_PORT: String(WEB_PORT),
        // Waking sessions (CEL-92): a stub `claude` (e2e/stub-bin) first on the PATH, Claude Code's folder in
        // the temp data folder (never ~/.claude), and short waits. Waking stays off unless a test turns it on.
        PATH: `${path.resolve("e2e/stub-bin")}:${process.env.PATH}`,
        CLAUDE_CONFIG_DIR: path.join(process.env.CELLO_E2E_DATA!, "claude"),
        CELLO_E2E: "1",
        CELLO_WAKE_BATCH_MS: "3000",
        CELLO_WAKE_QUIET_MS: "0",
      },
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
