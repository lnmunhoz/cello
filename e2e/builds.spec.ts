// CEL-50: build history. Two real web builds (A, then B) are served in turn by a real `cello start` on
// its own port and data folder, as in reload.spec.ts. The server records each build once; the Builds
// page lists both, newest first, with what changed in each, and the footer's popover links to it.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { caption, expect, test } from "./fixtures.ts"
import { buildWeb, freePort, seed, startCello, still, stop, stopAll } from "./servedBuilds.ts"

const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-builds-")))
const A = { commit: "aaaaaaa", dir: path.join(work, "web-a") }
const B = { commit: "bbbbbbb", dir: path.join(work, "web-b") }
/** What build B's build.json lists as merged since A. Git isn't in the container, so the test writes it. */
const B_CHANGES = ["merge: build history, one click from the footer (CEL-1)", "docs: what a build is"]

test.beforeAll(async () => {
  test.setTimeout(180_000)
  buildWeb(A, [])
  buildWeb(B, B_CHANGES)
})

test.afterEach(stopAll)

test.afterAll(() => fs.rmSync(work, { recursive: true, force: true }))

/** Deploys A, then B, on a fresh data folder; returns the port and the running server. */
const deployAThenB = async (port: number) => {
  const dataDir = fs.mkdtempSync(path.join(work, "data-"))
  const a = await startCello(A, port, dataDir)
  await seed(port, "Build history")
  return { dataDir, a }
}

test("CEL-50: after deploying A then B, the footer's popover opens the Builds page, which lists both with what changed", async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 90_000))
  const port = await freePort()
  const { dataDir, a } = await deployAThenB(port)
  await page.goto(`http://127.0.0.1:${port}/CEL`)
  const footer = page.locator("[data-build-footer]")

  await caption(page, "The board runs build aaaaaaa, the first build this data folder has seen")
  await expect(footer).toContainText("build aaaaaaa")

  await caption(page, "Deploy build bbbbbbb: the server restarts and records it; the tab reloads into it")
  await stop(a)
  await startCello(B, port, dataDir)
  await expect(page.locator("[data-reload-bar]")).toHaveAttribute("data-reload-bar", "reload")
  await page.waitForEvent("load", { timeout: 15_000 })
  await expect(page.locator("[data-reload-bar]")).toHaveCount(0)
  await expect(footer).toContainText("build bbbbbbb")

  await caption(page, "The footer's popover has what changed in this build, and \"See all builds →\"")
  await footer.click()
  const seeAll = page.getByRole("link", { name: "See all builds →" })
  await expect(seeAll).toBeVisible()
  await still(page, "builds-footer-popover")
  await seeAll.click()

  await caption(page, "The Builds page: newest first, grouped by day, the running build marked and open")
  await expect(page).toHaveURL(/\/builds$/)
  await expect(seeAll).toHaveCount(0)
  const today = page.getByRole("region", { name: "Today" })
  const rows = today.locator("[data-build-row]")
  await expect(rows).toHaveCount(2)
  const b = today.locator('[data-build-row="2"]')
  const a1 = today.locator('[data-build-row="1"]')
  await expect(rows.first()).toHaveAttribute("data-build-row", "2")
  await expect(b).toHaveAttribute("data-running", "true")
  await expect(b).toContainText("#2")
  await expect(b).toContainText("build bbbbbbb")
  await expect(b).toContainText("Running")
  await expect(b).toContainText("2 changes")
  await expect(b).toContainText(/live since \d\d:\d\d · for (under a minute|\d+ min)/)
  const changes = b.getByRole("list", { name: "Changes in build 2" })
  await expect(changes.getByRole("listitem")).toHaveCount(2)
  await expect(changes.getByRole("listitem").first()).toContainText("merge: build history, one click from the footer")
  await expect(changes.getByRole("link", { name: /CEL-1/ })).toBeVisible()
  await expect(a1).not.toHaveAttribute("data-running", "true")
  await expect(a1).toContainText("build aaaaaaa")
  await expect(a1).toContainText("no changes")
  await still(page, "builds-page-light")

  await caption(page, "Open build #1: the history starts there")
  await a1.getByRole("button").click()
  await expect(a1).toContainText("No commits between this build and the one before it.")
  await expect(a1).toContainText("The history starts here")
  await still(page, "builds-page-light-expanded")

  await caption(page, "Settings has a Builds section with the running build and the same link")
  await page.goto(`http://127.0.0.1:${port}/settings`)
  const section = page.getByRole("region", { name: "Builds" })
  await expect(section).toContainText("build bbbbbbb")
  await section.scrollIntoViewIfNeeded()
  await still(page, "builds-settings-section")
  await section.getByRole("link", { name: "See all builds →" }).click()
  await expect(page).toHaveURL(/\/builds$/)
  await expect(page.locator("[data-build-row]")).toHaveCount(2)
})

test("CEL-50: a restart of the same build adds no row; the Builds page in the dark theme", async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 90_000))
  await page.addInitScript(() => localStorage.setItem("cello:theme", "dark"))
  const port = await freePort()
  const { dataDir, a } = await deployAThenB(port)
  await stop(a)
  const b = await startCello(B, port, dataDir)

  await caption(page, "Restart build bbbbbbb (same build): it isn't recorded twice")
  await stop(b)
  await startCello(B, port, dataDir)
  await page.goto(`http://127.0.0.1:${port}/builds`)
  await expect(page.locator("[data-build-row]")).toHaveCount(2)
  const latest = page.locator('[data-build-row="2"]')
  await expect(latest).toHaveAttribute("data-running", "true")
  await expect(latest).toContainText(/last started \d\d:\d\d/)
  await expect(latest.getByRole("link", { name: /CEL-1/ })).toBeVisible()
  await still(page, "builds-page-dark")
})

test("CEL-50: a server that serves no web app (dev) has no builds: the page says how they get recorded", async ({ page }) => {
  // The suite's own server (apps/server, with Vite's preview serving the app) is a dev server.
  await page.goto("/builds")
  await caption(page, "No builds recorded on a dev server")
  await expect(page.locator("[data-builds-empty]")).toContainText("No builds recorded yet")
  await still(page, "builds-page-empty")
})
