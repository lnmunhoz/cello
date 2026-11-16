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
    expect(detectRepo(monorepo, { ...ALL_TOOLS, docker: false }).readiness.find((r) => r.kind === "e2e video")!.suggestion)
      .toContain("install or start Docker: the e2e runs in it")
  })
})

describe("values detection can't settle are left out, never written half-resolved (CEL-96)", () => {
  const withConfig = (config: string, extra: Partial<RepoFacts> = {}) => ({
    ...VITE_APP,
    packages: [{ path: "package.json", json: { ...VITE_APP.packages[0]!.json, scripts: { test: "vitest run", "test:e2e": "playwright test" } } }],
    texts: { "playwright.config.ts": config },
    ...extra,
  })

  it("a baseURL built from a constant with a default in the config resolves to that default", () => {
    const config = [
      "const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 4791)",
      "const WEB_PORT = Number(process.env.CELLO_WEB_PORT ?? 5199) // ports from the environment",
      "export default defineConfig({ use: { baseURL: `http://localhost:${WEB_PORT}`, video: \"on\" } })",
    ].join("\n")
    const found = detectRepo(withConfig(config), ALL_TOOLS)
    expect(found.fields["app.url"]).toBe("http://localhost:5199")
    expect(found.unresolved).toEqual([])
    // A string default next to the variable, and `||`, resolve the same way.
    expect(detectRepo(withConfig("use: { baseURL: process.env.BASE_URL || \"http://127.0.0.1:3000\" }"), ALL_TOOLS).fields["app.url"]).toBe("http://127.0.0.1:3000")
    expect(detectRepo(withConfig("use: { baseURL: `http://localhost:${process.env.PORT ?? \"8080\"}` }"), ALL_TOOLS).fields["app.url"]).toBe("http://localhost:8080")
  })

  it("a baseURL naming a variable with no default is left unset, and the report says it couldn't tell", () => {
    const found = detectRepo(withConfig("use: { baseURL: `http://localhost:${process.env.WEB_PORT}`, video: \"on\" }", {
      packages: [{ path: "package.json", json: { scripts: { dev: "vite --port $PORT", "test:e2e": "playwright test" }, devDependencies: { "@playwright/test": "1" } } }],
    }), ALL_TOOLS)
    expect(found.fields["app.url"]).toBeUndefined()
    expect(Object.values(found.fields).filter((v) => /\$\{|process\.env/.test(v))).toEqual([])
    expect(found.unresolved).toEqual([{ field: "app.url", why: "baseURL in playwright.config.ts is `http://localhost:${process.env.WEB_PORT}`, which names a variable with no default there" }])
  })

  it("the app's port in vite.config, behind an env variable with a default, gives app.url when Playwright has no baseURL", () => {
    const found = detectRepo(repo({
      paths: ["package.json", "bun.lock", "apps/web/package.json", "apps/web/vite.config.ts"],
      packages: [
        { path: "package.json", json: { scripts: { dev: "bun run --filter @app/web dev" } } },
        { path: "apps/web/package.json", json: { name: "@app/web", devDependencies: { vite: "7" } } },
      ],
      texts: { "apps/web/vite.config.ts": "export default defineConfig({ server: { port: Number(process.env.WEB_PORT ?? 5199), strictPort: true } })" },
    }), ALL_TOOLS)
    expect(found.fields["app.url"]).toBe("http://localhost:5199")
  })

  it("an outputDir naming a variable with no default leaves the folders unset; the report says to set them", () => {
    const found = detectRepo(withConfig("export default defineConfig({ outputDir: `${process.env.OUT}/e2e`, use: { video: \"on\" } })"), ALL_TOOLS)
    expect(found.fields["e2e.web.run"]).toBe("bun run test:e2e")
    expect(found.fields["e2e.web.videos"]).toBeUndefined()
    expect(found.fields["e2e.web.screenshots"]).toBeUndefined()
    expect(found.readiness.find((r) => r.kind === "e2e video")).toMatchObject({ state: "partial" })
    expect(found.readiness.find((r) => r.kind === "e2e video")!.suggestion).toContain("set e2e.web.videos")
  })
})

describe("e2e runs through Docker or a wrapper script (CEL-96)", () => {
  const wrapped = (testE2e: string, scripts: Record<string, string> = {}) => ({
    ...VITE_APP,
    packages: [{ path: "package.json", json: { ...VITE_APP.packages[0]!.json, scripts: { dev: "vite --port 5199", test: "vitest run", "test:e2e": testE2e, ...scripts } } }],
  })

  it("Playwright's outputDir isn't where a wrapped run's videos land: the folders are left unset, the report says to set them", () => {
    for (const run of ["bun scripts/test-in-docker.ts e2e", "docker compose run e2e npx playwright test", "node scripts/e2e.mjs"]) {
      const found = detectRepo(wrapped(run), ALL_TOOLS)
      expect(found.fields["e2e.web.run"], run).toBe("bun run test:e2e")
      expect(found.fields["e2e.web.videos"], run).toBeUndefined()
      expect(found.fields["e2e.web.screenshots"], run).toBeUndefined()
      const video = found.readiness.find((r) => r.kind === "e2e video")!
      expect(video.state, run).toBe("partial")
      expect(video.suggestion, run).toContain("set e2e.web.videos")
      expect(video.suggestion, run).toContain(run)
      const shots = found.readiness.find((r) => r.kind === "screenshots")!
      expect(shots.state, run).toBe("partial")
      expect(shots.suggestion, run).toContain("Set e2e.web.screenshots")
    }
    expect(detectRepo(wrapped("bun scripts/test-in-docker.ts e2e"), ALL_TOOLS).fields["ui.runsIn"]).toBe("docker")
    expect(detectRepo(wrapped("node scripts/e2e.mjs"), ALL_TOOLS).fields["ui.runsIn"]).toBe("local")
  })

  it("a script that only calls another script running Playwright directly isn't a wrapper", () => {
    const found = detectRepo(wrapped("bun run e2e:run", { "e2e:run": "vite build && playwright test" }), ALL_TOOLS)
    expect(found.fields["e2e.web.videos"]).toBe("test-results/e2e")
    expect(found.readiness.find((r) => r.kind === "e2e video")!.state).toBe("ready")
  })
})

describe("one e2e entry per Playwright config, each with its surface (CEL-96)", () => {
  const ELECTRON_CONFIG = `export default defineConfig({ testDir: "e2e", outputDir: "test-results/playwright", workers: 1 })`

  it("Cello's own layout: web e2e and desktop e2e both through Docker, app.url from the config's default, no wrong video folder", () => {
    const found = detectRepo(repo({
      paths: ["package.json", "bun.lock", "tsconfig.json", "playwright.config.ts", "apps/web/package.json", "apps/web/vite.config.ts", "apps/desktop/package.json", "apps/desktop/playwright.config.ts", "apps/cli/package.json"],
      packages: [
        {
          path: "package.json",
          json: {
            scripts: {
              dev: "bun run --filter @cello/server dev & bun run --filter @cello/web dev",
              test: "bun --bun vitest run",
              "test:e2e": "bun scripts/test-in-docker.ts e2e",
              "test:e2e:local": "bun run --filter @cello/web build && playwright test",
              "test:docker": "bun scripts/test-in-docker.ts all",
              "test:docker:e2e": "bun scripts/test-in-docker.ts e2e",
              "test:docker:desktop": "bun scripts/test-in-docker.ts desktop",
              typecheck: "tsc -p .",
            },
            devDependencies: { "@playwright/test": "1.65.1", typescript: "7", vitest: "5" },
          },
        },
        { path: "apps/web/package.json", json: { name: "@cello/web", scripts: { dev: "vite" }, devDependencies: { vite: "7" } } },
        {
          path: "apps/desktop/package.json",
          json: {
            name: "@cello/desktop",
            scripts: { "test:e2e": "bun ../../scripts/test-in-docker.ts desktop", "test:e2e:local": "bun scripts/build.ts && playwright test -c playwright.config.ts" },
            devDependencies: { electron: "44" },
          },
        },
        { path: "apps/cli/package.json", json: { bin: { cello: "src/bin.ts" } } },
      ],
      texts: {
        "playwright.config.ts": [
          "const WEB_PORT = Number(process.env.CELLO_WEB_PORT ?? 5199)",
          "export default defineConfig({",
          "  outputDir: \"test-results/playwright\",",
          "  use: {",
          "    baseURL: `http://localhost:${WEB_PORT}`,",
          "    video: { mode: \"on\", size: VIDEO_SIZE },",
          "  },",
          "})",
        ].join("\n"),
        "apps/web/vite.config.ts": "export default defineConfig({ server: { port: Number(process.env.CELLO_WEB_PORT ?? 5199) } })",
        "apps/desktop/playwright.config.ts": ELECTRON_CONFIG,
      },
    }), ALL_TOOLS)
    expect(found.tools.e2e).toEqual(["Playwright"])
    expect(found.fields).toEqual({
      "install": "bun install",
      "unit": "bun run test",
      "typecheck": "bun run typecheck",
      "ui.runsIn": "docker",
      "app.start": "bun run dev",
      "app.url": "http://localhost:5199",
      "e2e.web.run": "bun run test:e2e",
      "e2e.desktop.run": "bun run test:docker:desktop",
      "evidence.ui": "MP4 video of the e2e run of the flow, plus screenshots (light and dark when it matters)",
      "evidence.cli": "terminal transcript of the commands and their output, plus the test output",
    })
    const video = found.readiness.find((r) => r.kind === "e2e video")!
    expect(video).toMatchObject({ state: "partial", note: "Playwright: bun run test:e2e (web), bun run test:docker:desktop (desktop)" })
    expect(video.suggestion).toContain("set e2e.web.videos")
    expect(video.suggestion).toContain("set e2e.desktop.videos")
  })

  it("a config using _electron is desktop; the desktop package's own e2e script runs it from its folder; its folders sit under that folder", () => {
    const found = detectRepo(repo({
      paths: ["package.json", "pnpm-lock.yaml", "packages/app/package.json", "packages/app/playwright.config.ts"],
      packages: [
        { path: "package.json", json: { devDependencies: { "@playwright/test": "1" } } },
        { path: "packages/app/package.json", json: { scripts: { "e2e": "playwright test" } } },
      ],
      texts: { "packages/app/playwright.config.ts": `import { _electron } from "playwright"\nexport default defineConfig({ outputDir: "out" })` },
    }), ALL_TOOLS)
    expect(found.fields["e2e.desktop.run"]).toBe("cd packages/app && pnpm e2e")
    expect(found.fields["e2e.web.run"]).toBeUndefined()
    // Electron's videos are set where the tests launch it, not in the config, so the folder is left to the agent.
    expect(found.fields["e2e.desktop.videos"]).toBeUndefined()
    expect(found.readiness.find((r) => r.kind === "e2e video")!.suggestion).toContain("set e2e.desktop.videos")
  })

  it("a web config in a workspace package: its folders sit under the package; with no script for it, `playwright test -c` runs it", () => {
    const found = detectRepo(repo({
      paths: ["package.json", "package-lock.json", "apps/site/package.json", "apps/site/playwright.config.ts"],
      packages: [
        { path: "package.json", json: { devDependencies: { "@playwright/test": "1" } } },
        { path: "apps/site/package.json", json: { devDependencies: { vite: "7" } } },
      ],
      texts: { "apps/site/playwright.config.ts": `export default defineConfig({ outputDir: "test-results/e2e", use: { video: "on" } })` },
    }), ALL_TOOLS)
    expect(found.fields).toMatchObject({
      "e2e.web.run": "npx playwright test -c apps/site/playwright.config.ts",
      "e2e.web.videos": "apps/site/test-results/e2e",
      "e2e.web.screenshots": "apps/site/test-results/e2e",
    })
  })

  it("a root script naming the config's package runs that surface; the web run doesn't take the desktop's script", () => {
    const found = detectRepo(repo({
      paths: ["package.json", "bun.lock", "playwright.config.ts", "apps/desktop/package.json", "apps/desktop/playwright.config.ts"],
      packages: [
        { path: "package.json", json: { scripts: { "e2e:app": "playwright test -c apps/desktop/playwright.config.ts", "e2e:site": "playwright test" }, devDependencies: { "@playwright/test": "1" } } },
        { path: "apps/desktop/package.json", json: { devDependencies: { electron: "44" } } },
      ],
      texts: { "playwright.config.ts": `use: { video: "on" }`, "apps/desktop/playwright.config.ts": ELECTRON_CONFIG },
    }), ALL_TOOLS)
    expect(found.fields["e2e.desktop.run"]).toBe("bun run e2e:app")
    expect(found.fields["e2e.web.run"]).toBe("bun run e2e:site")
  })
})

describe("detecting, continued (CEL-89)", () => {

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
