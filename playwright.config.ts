// End-to-end tests: the built web app against a real server with a temp data folder (never ~/.cello).
// `bun run test:e2e` builds the web app first. Videos are converted to MP4 in e2e/videos/.
import { defineConfig, devices } from "@playwright/test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const SERVER_PORT = 4791
// Workers load this file too; they inherit the folder the main process made.
process.env.CELLO_E2E_DATA ??= fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-"))

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  reporter: [["list"]],
  globalTeardown: "./e2e/teardown.ts",
  use: {
    // The server only accepts pages on localhost:5199 (its Vite port).
    baseURL: "http://localhost:5199",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    video: { mode: "on", size: { width: 1440, height: 900 } },
  },
  webServer: [
    {
      command: "bun src/main.ts",
      cwd: "apps/server",
      env: { CELLO_PORT: String(SERVER_PORT), CELLO_DATA_DIR: process.env.CELLO_E2E_DATA },
      url: `http://127.0.0.1:${SERVER_PORT}/rpc`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      stdout: "pipe",
    },
    {
      command: "bunx vite preview",
      cwd: "apps/web",
      env: { CELLO_SERVER: `127.0.0.1:${SERVER_PORT}` },
      url: "http://localhost:5199",
      reuseExistingServer: false,
    },
  ],
})
