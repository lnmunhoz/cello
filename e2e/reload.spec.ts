// CEL-37: an open tab notices a new Cello build. Two real web builds (A and B, `vite build` with their
// own commit stamps) are served by a real `cello start` from source on its own port and data folder;
// the test restarts that server as build B with the tab still open. Idle, the tab shows "Cello was
// updated" and reloads by itself into B; while a comment is being written it only offers the reload.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { caption, expect, test } from "./fixtures.ts"
import { buildWeb, entryOf, freePort, loadedEntry, seed as seedBoard, startCello, still, stop, stopAll } from "./servedBuilds.ts"

const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-reload-")))
const A = { commit: "aaaaaaa", dir: path.join(work, "web-a") }
const B = { commit: "bbbbbbb", dir: path.join(work, "web-b") }
/** What build B's build.json lists as merged since A. Git isn't in the container, so the test writes it. */
const B_CHANGES = ["merge: open tabs notice a new Cello build and offer a reload (CEL-1)", "docs: what each column means"]
/** A third build, for a tab two builds behind (CEL-148). */
const C = { commit: "ccccccc", dir: path.join(work, "web-c") }
const C_CHANGES = ["merge: the update notice expands to show what's in the new build (CEL-1)"]

const seed = (port: number) => seedBoard(port, "Ship the reload bar")

test.beforeAll(async () => {
  test.setTimeout(240_000)
  buildWeb(A)
  buildWeb(B, B_CHANGES)
  buildWeb(C, C_CHANGES)
  expect(entryOf(A.dir)).not.toBe(entryOf(B.dir))
  expect(entryOf(B.dir)).not.toBe(entryOf(C.dir))
})

test.afterEach(stopAll)

test.afterAll(() => fs.rmSync(work, { recursive: true, force: true }))

test("CEL-37: a tab open on build A notices build B when the server restarts, says so, and reloads into it by itself", async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 90_000))
  const port = await freePort()
  const dataDir = fs.mkdtempSync(path.join(work, "data-"))
  const a = await startCello(A, port, dataDir)
  await seed(port)
  await page.goto(`http://127.0.0.1:${port}/CEL`)
  const footer = page.locator("[data-build-footer]")
  const bar = page.locator("[data-reload-bar]")

  await caption(page, "The board runs build aaaaaaa: the sidebar's footer names it and when the server went live")
  await expect(footer).toHaveAccessibleName(/^Cello \d+\.\d+\.\d+ · build aaaaaaa · live since \d\d:\d\d\. What changed in this build$/)
  await expect(footer).toContainText("build aaaaaaa")
  expect(await loadedEntry(page)).toBe(entryOf(A.dir))
  await expect(bar).toHaveCount(0)
  await still(page, "reload-footer-build-a")

  await caption(page, "Deploy: the server restarts as build bbbbbbb while the tab stays open")
  await stop(a)
  await startCello(B, port, dataDir)

  await caption(page, "The tab reconnects and sees a new build: \"Cello was updated\", reloading by itself in a few seconds")
  await expect(bar).toHaveAttribute("data-reload-bar", "reload")
  await expect(bar).toContainText("Cello was updated")
  await expect(bar).toContainText("build bbbbbbb")
  await expect(bar).toContainText(/reloading in \d s/)
  await still(page, "reload-bar-countdown")
  await page.waitForEvent("load", { timeout: 15_000 })

  await caption(page, "After the reload the tab runs build bbbbbbb, and the bar is gone")
  expect(await loadedEntry(page)).toBe(entryOf(B.dir))
  await expect(footer).toContainText("build bbbbbbb")
  await expect(bar).toHaveCount(0)

  await caption(page, "A click on the footer lists what changed since the previous build, task keys linked")
  await footer.click()
  const changes = page.getByRole("list", { name: "Changes in this build" })
  await expect(changes.getByRole("listitem")).toHaveCount(2)
  await expect(changes.getByRole("listitem").first()).toContainText("merge: open tabs notice a new Cello build and offer a reload")
  await expect(changes.getByRole("link", { name: /CEL-1/ })).toBeVisible()
  await still(page, "reload-footer-changes")
})

test("CEL-37: while a comment is being written the tab only offers the reload; the Reload button brings in build B", async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 90_000))
  const port = await freePort()
  const dataDir = fs.mkdtempSync(path.join(work, "data-"))
  const a = await startCello(A, port, dataDir)
  await seed(port)
  await page.goto(`http://127.0.0.1:${port}/CEL/1`)
  const bar = page.locator("[data-reload-bar]")

  await caption(page, "On build aaaaaaa, start writing a comment on CEL-1")
  const comment = page.getByRole("textbox", { name: "New comment" })
  await comment.click()
  await comment.pressSequentially("Half-written thought about the bar")
  expect(await loadedEntry(page)).toBe(entryOf(A.dir))

  await caption(page, "Deploy build bbbbbbb while the comment is half written")
  await stop(a)
  await startCello(B, port, dataDir)

  await caption(page, "The bar offers the reload and waits: no countdown while something is being edited")
  await expect(bar).toHaveAttribute("data-reload-bar", "offer")
  await expect(bar).toContainText("Cello was updated")
  await expect(bar).not.toContainText("reloading in")
  await expect(comment).toHaveValue("Half-written thought about the bar")
  await still(page, "reload-bar-offer")

  await caption(page, "Click Reload: the tab loads build bbbbbbb")
  const reloaded = page.waitForEvent("load")
  await bar.getByRole("button", { name: "Reload" }).click()
  await reloaded
  expect(await loadedEntry(page)).toBe(entryOf(B.dir))
  await expect(bar).toHaveCount(0)
  await expect(page.locator("[data-build-footer]")).toContainText("build bbbbbbb")
})

test("CEL-37: a new label's name typed in Settings and left is a draft too: the tab only offers the reload (dark theme)", async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 90_000))
  await page.addInitScript(() => localStorage.setItem("cello:theme", "dark"))
  const port = await freePort()
  const dataDir = fs.mkdtempSync(path.join(work, "data-"))
  const a = await startCello(A, port, dataDir)
  await seed(port)
  await page.goto(`http://127.0.0.1:${port}/settings`)
  const bar = page.locator("[data-reload-bar]")

  await caption(page, "In Settings, type a new label's name, then click away without adding it")
  const name = page.getByRole("textbox", { name: "New label name" })
  await name.fill("needs-design")
  await page.getByRole("main").click({ position: { x: 600, y: 860 } })
  await expect(name).not.toBeFocused()

  await caption(page, "Deploy build bbbbbbb: the typed name would be lost, so the bar only offers the reload")
  await stop(a)
  await startCello(B, port, dataDir)
  await expect(bar).toHaveAttribute("data-reload-bar", "offer")
  await expect(bar).not.toContainText("reloading in")
  await expect(name).toHaveValue("needs-design")
  await still(page, "reload-bar-offer-dark")

  await caption(page, "The footer's popover, in the dark theme")
  await page.locator("[data-build-footer]").click()
  await expect(page.getByRole("list", { name: "Changes in this build" }).getByRole("listitem")).toHaveCount(2)
  await still(page, "reload-footer-changes-dark")
})

test("CEL-148: a tab two builds behind expands the notice to see both builds' changes, newest first, task keys linked; Reload brings in the newest", async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 120_000))
  const port = await freePort()
  const dataDir = fs.mkdtempSync(path.join(work, "data-"))
  const a = await startCello(A, port, dataDir)
  await seed(port)
  await page.goto(`http://127.0.0.1:${port}/CEL/1`)
  const bar = page.locator("[data-reload-bar]")
  const toggle = bar.getByRole("button", { name: "What's in this build" })

  await caption(page, "On build aaaaaaa, start writing a comment, so the tab only offers the reload")
  const comment = page.getByRole("textbox", { name: "New comment" })
  await comment.click()
  await comment.pressSequentially("Reading what's new first")

  await caption(page, "Deploy build bbbbbbb, then build ccccccc: the tab, still on aaaaaaa, is two builds behind")
  await stop(a)
  const b = await startCello(B, port, dataDir)
  await expect(bar).toContainText("build bbbbbbb")
  await stop(b)
  await startCello(C, port, dataDir)
  await expect(bar).toContainText("build ccccccc")
  await expect(bar).toHaveAttribute("data-reload-bar", "offer")

  await caption(page, "The notice is small by default: a chevron beside Reload opens what's in the build")
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await expect(bar.getByRole("list")).toHaveCount(0)
  await still(page, "update-notice-collapsed")

  await caption(page, "Open it: every build since the one this tab runs, newest first, one line per merge")
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  const builds = bar.locator("[data-new-build]")
  await expect(builds).toHaveCount(2)
  await expect(builds.nth(0)).toHaveAttribute("data-new-build", "3")
  await expect(builds.nth(0)).toContainText("#3 · build ccccccc")
  await expect(builds.nth(1)).toHaveAttribute("data-new-build", "2")
  await expect(builds.nth(1)).toContainText("#2 · build bbbbbbb")
  const newest = bar.getByRole("list", { name: "Changes in build 3" })
  await expect(newest.getByRole("listitem")).toHaveCount(1)
  await expect(newest.getByRole("listitem")).toContainText("merge: the update notice expands to show what's in the new build")
  const before = bar.getByRole("list", { name: "Changes in build 2" })
  await expect(before.getByRole("listitem")).toHaveCount(2)
  await expect(before.getByRole("listitem").first()).toContainText("merge: open tabs notice a new Cello build and offer a reload")
  await expect(before.getByRole("listitem").nth(1)).toContainText("docs: what each column means")

  await caption(page, "Task keys are links to their tasks")
  const key = newest.getByRole("link", { name: /CEL-1/ })
  await expect(key).toBeVisible()
  await expect(key).toHaveAttribute("href", /\/CEL\/1$/)
  await key.hover()
  await still(page, "update-notice-expanded")

  await caption(page, "Collapse it again: the notice is back to one line")
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await expect(builds).toHaveCount(0)

  await caption(page, "Reload works the same either way: the tab loads build ccccccc")
  const reloaded = page.waitForEvent("load")
  await bar.getByRole("button", { name: "Reload" }).click()
  await reloaded
  expect(await loadedEntry(page)).toBe(entryOf(C.dir))
  await expect(bar).toHaveCount(0)
  await expect(page.locator("[data-build-footer]")).toContainText("build ccccccc")
})

test("CEL-148: opening the list while the notice counts down stops the countdown, so there's time to read it (dark theme)", async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 90_000))
  await page.addInitScript(() => localStorage.setItem("cello:theme", "dark"))
  const port = await freePort()
  const dataDir = fs.mkdtempSync(path.join(work, "data-"))
  const a = await startCello(A, port, dataDir)
  await seed(port)
  await page.goto(`http://127.0.0.1:${port}/CEL`)
  const bar = page.locator("[data-reload-bar]")

  await caption(page, "Idle on build aaaaaaa. Deploy build bbbbbbb: the notice counts down to a reload; open what's in it right away")
  await stop(a)
  await startCello(B, port, dataDir)
  await expect(bar).toHaveAttribute("data-reload-bar", "reload")
  await bar.getByRole("button", { name: "What's in this build" }).click()

  await caption(page, "The countdown stops and Reload waits for you, with build #2's changes listed")
  await expect(bar).toHaveAttribute("data-reload-bar", "offer")
  await expect(bar).not.toContainText("reloading in")
  await expect(bar.locator("[data-new-build]")).toHaveCount(1)
  const changes = bar.getByRole("list", { name: "Changes in build 2" })
  await expect(changes.getByRole("listitem")).toHaveCount(2)
  await expect(changes.getByRole("link", { name: /CEL-1/ })).toBeVisible()
  expect(await loadedEntry(page)).toBe(entryOf(A.dir))
  await still(page, "update-notice-expanded-dark")

  await caption(page, "Click Reload: the tab loads build bbbbbbb")
  const reloaded = page.waitForEvent("load")
  await bar.getByRole("button", { name: "Reload" }).click()
  await reloaded
  expect(await loadedEntry(page)).toBe(entryOf(B.dir))
  await expect(bar).toHaveCount(0)
})
