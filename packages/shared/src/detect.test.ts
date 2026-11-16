import { describe, expect, it } from "vitest"
import { detectRepo, type MachineFacts, type RepoFacts } from "./detect.ts"

const ALL_TOOLS: MachineFacts = { ffmpeg: true, docker: true, playwrightBrowsers: true }
const NO_TOOLS: MachineFacts = { ffmpeg: false, docker: false, playwrightBrowsers: false }

const repo = (facts: Partial<RepoFacts>): RepoFacts => ({ paths: [], packages: [], texts: {}, ...facts })

const VITE_APP = repo({
  paths: ["package.json", "bun.lock", "tsconfig.json", "vite.config.ts", "playwright.config.ts"],
  packages: [{
    path: "package.json",
    json: {
      scripts: { dev: "vite --port 5199", test: "vitest run", typecheck: "tsc -b", "test:e2e": "playwright test" },
      devDependencies: { vite: "7", vitest: "3", "@playwright/test": "1.50", typescript: "5" },
    },
  }],
  texts: {
    "playwright.config.ts": `export default defineConfig({ outputDir: "test-results/e2e", use: { video: "on", screenshot: "only-on-failure" } })`,
  },
})

describe("detecting how a repo tests (CEL-89)", () => {
  it("a Vite app with Vitest and Playwright on bun: every command, the port, the e2e folders, all evidence ready", () => {
    const found = detectRepo(VITE_APP, ALL_TOOLS)
    expect(found.stack).toEqual(["web (Vite)"])
    expect(found.packageManager).toBe("bun")
    expect(found.tools).toEqual({ unit: "Vitest", e2e: ["Playwright"] })
    expect(found.fields).toEqual({
      "install": "bun install",
      "unit": "bun run test",
      "typecheck": "bun run typecheck",
      "ui.runsIn": "local",
      "app.start": "bun run dev",
      "app.url": "http://localhost:5199",
      "e2e.web.run": "bun run test:e2e",
      "e2e.web.videos": "test-results/e2e",
      "e2e.web.screenshots": "test-results/e2e",
      "evidence.ui": "MP4 video of the e2e run of the flow, plus screenshots (light and dark when it matters)",
      "evidence.cli": "terminal transcript of the commands and their output, plus the test output",
    })
    expect(found.readiness.map((r) => [r.kind, r.state])).toEqual([
      ["unit tests", "ready"],
      ["e2e video", "ready"],
      ["screenshots", "ready"],
      ["terminal transcript", "ready"],
    ])
  })

  it("Playwright without video, browsers or ffmpeg is partly there, each with what to do", () => {
    const noVideo = { ...VITE_APP, texts: { "playwright.config.ts": "export default defineConfig({})" } }
    const found = detectRepo(noVideo, NO_TOOLS)
    expect(found.fields["e2e.web.videos"]).toBe("test-results")
    const video = found.readiness.find((r) => r.kind === "e2e video")!
    expect(video.state).toBe("partial")
    expect(video.suggestion).toContain(`use: { video: "on" }`)
    expect(video.suggestion).toContain("npx playwright install chromium")
    expect(video.suggestion).toContain("ffmpeg")
    expect(found.readiness.find((r) => r.kind === "screenshots")!.state).toBe("partial")
  })

  it("an empty repo: nothing detected, every evidence kind missing with a suggestion", () => {
    const found = detectRepo(repo({}), ALL_TOOLS)
    expect(found.stack).toEqual([])
    expect(found.packageManager).toBeNull()
    expect(found.fields).toEqual({})
    expect(found.readiness.map((r) => [r.kind, r.state])).toEqual([
      ["unit tests", "missing"],
      ["e2e video", "missing"],
      ["screenshots", "missing"],
      ["terminal transcript", "partial"],
    ])
    for (const r of found.readiness) expect(r.suggestion).toBeTruthy()
  })

  it("Next with Jest and Cypress on npm: Next's port, Cypress's folders, video off by default", () => {
    const found = detectRepo(repo({
      paths: ["package.json", "package-lock.json", "tsconfig.json", "cypress.config.ts", "next.config.js"],
      packages: [{
        path: "package.json",
        json: { scripts: { dev: "next dev", test: "jest", "cy:run": "cypress run" }, dependencies: { next: "15" }, devDependencies: { jest: "29", cypress: "13", typescript: "5" } },
      }],
      texts: { "cypress.config.ts": "export default defineConfig({ e2e: {} })" },
    }), ALL_TOOLS)
    expect(found.stack).toEqual(["web (Next)"])
    expect(found.tools).toEqual({ unit: "Jest", e2e: ["Cypress"] })
    expect(found.fields).toMatchObject({
      "install": "npm install",
      "unit": "npm run test",
      "typecheck": "npx tsc --noEmit",
      "app.start": "npm run dev",
      "app.url": "http://localhost:3000",
      "e2e.web.run": "npm run cy:run",
      "e2e.web.videos": "cypress/videos",
      "e2e.web.screenshots": "cypress/screenshots",
    })
    expect(found.readiness.find((r) => r.kind === "e2e video")).toMatchObject({ state: "partial" })
  })

  it("a monorepo whose e2e runs in Docker: Electron and Vite from the workspace packages, ui.runsIn docker", () => {
    const monorepo = repo({
      paths: ["package.json", "bun.lock", "playwright.config.ts", "apps/web/package.json", "apps/desktop/package.json", "apps/cli/package.json"],
      packages: [
        { path: "package.json", json: { scripts: { test: "vitest run", "test:e2e": "bun scripts/test-in-docker.ts e2e" }, devDependencies: { "@playwright/test": "1" } } },
        { path: "apps/web/package.json", json: { devDependencies: { vite: "7" } } },
        { path: "apps/desktop/package.json", json: { devDependencies: { electron: "39" } } },
        { path: "apps/cli/package.json", json: { bin: { cello: "src/bin.ts" } } },
      ],
      texts: { "playwright.config.ts": `use: { video: process.env.CI ? "on" : "retain-on-failure" }` },
    })
    const found = detectRepo(monorepo, ALL_TOOLS)
    expect(found.stack).toEqual(["web (Vite)", "desktop (Electron)", "CLI"])
    expect(found.fields["ui.runsIn"]).toBe("docker")
    expect(found.fields["e2e.web.run"]).toBe("bun run test:e2e")
    expect(found.readiness.find((r) => r.kind === "e2e video")!.state).toBe("ready")
    expect(detectRepo(monorepo, { ...ALL_TOOLS, docker: false }).readiness.find((r) => r.kind === "e2e video")).toMatchObject({
      state: "partial",
      suggestion: "install or start Docker: the e2e runs in it.",
    })
  })

  it("a Python service with pytest, a Go module and a CLI-only package: no UI, so no e2e video needed", () => {
    const python = detectRepo(repo({ paths: ["pyproject.toml", "uv.lock", "tests"], texts: { "pyproject.toml": "[tool.pytest.ini_options]\n" } }), ALL_TOOLS)
    expect(python.fields).toMatchObject({ install: "uv sync", unit: "uv run pytest" })
    expect(python.tools.unit).toBe("pytest")
    const go = detectRepo(repo({ paths: ["go.mod"] }), ALL_TOOLS)
    expect(go.fields).toMatchObject({ install: "go mod download", unit: "go test ./...", typecheck: "go vet ./..." })
    expect(go.stack).toEqual(["backend (Go)"])
    expect(go.readiness.find((r) => r.kind === "e2e video")).toMatchObject({ state: "not needed" })
    const cli = detectRepo(repo({
      paths: ["package.json", "pnpm-lock.yaml"],
      packages: [{ path: "package.json", json: { bin: "dist/cli.js", scripts: { test: "bun test" } } }],
    }), ALL_TOOLS)
    expect(cli.stack).toEqual(["CLI"])
    expect(cli.fields).toMatchObject({ install: "pnpm install", unit: "pnpm test" })
    expect(cli.tools.unit).toBe("bun test")
    expect(cli.fields["evidence.ui"]).toBeUndefined()
    expect(cli.readiness.find((r) => r.kind === "screenshots")).toMatchObject({ state: "not needed" })
  })

  it("a `test` script that runs e2e isn't the unit command; Expo apps get Metro's port and a mobile surface for Maestro", () => {
    const found = detectRepo(repo({
      paths: ["package.json", "yarn.lock", ".maestro"],
      packages: [{ path: "package.json", json: { scripts: { start: "expo start", test: "playwright test" }, dependencies: { expo: "52" } } }],
    }), ALL_TOOLS)
    expect(found.stack).toEqual(["mobile (Expo)"])
    expect(found.fields["unit"]).toBeUndefined()
    expect(found.fields).toMatchObject({ "app.start": "yarn start", "app.url": "http://localhost:8081", "e2e.mobile.run": "maestro test .maestro" })
    expect(found.tools.e2e).toEqual(["Maestro"])
  })
})
