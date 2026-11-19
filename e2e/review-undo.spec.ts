// CEL-191: after Approve or Send back on the Review page, the decision waits in an undo window before
// it is sent. The window is 30 s in these tests so nothing races it; the ones that need it to end move
// the page's clock (page.clock), and what is checked is what the page shows and what reached the socket
// (decisionsThroughTest(page).sent()), never a wait.
import * as fs from "node:fs"
import type { Page } from "@playwright/test"
import { caption, captionWithUrl, column, createProject, expect, projectLink, sidebarSettings, test, uniqueKey } from "./fixtures.ts"
import { cello, decidedSeen, decisionsThroughTest, submitPackets, watchDecided } from "./packets.ts"

const UNDO_KEY = "cello:review-undo"

const rowOf = (page: Page, key: string) => {
  const article = page.getByRole("article", { name: new RegExp(`${key}\\b`) })
  return {
    article,
    header: article.getByRole("button", { name: new RegExp(`^${key}\\b`) }),
    approve: article.locator('[data-decide="approved"]'),
    sendBack: article.locator('[data-decide="sent_back"]'),
    box: article.getByLabel("New comment"),
    undo: article.locator("[data-undo]"),
    words: article.locator("[data-decided]"),
  }
}

/** A project with packets handed in, the Review page's undo window set to `window` ("30": 30 s; "off"), the clock the test's to move. */
async function setUp(page: Page, prefix: string, window: string, titles: ReadonlyArray<string>) {
  await page.addInitScript(([k, w]) => localStorage.setItem(k!, w!), [UNDO_KEY, window])
  await page.clock.install()
  const decisions = await decisionsThroughTest(page)
  const key = uniqueKey(prefix)
  await createProject(page, `Undo ${prefix}`, key)
  const { dir } = await submitPackets(page, key, titles)
  const rows = titles.map((_, i) => rowOf(page, `${key}-${i + 1}`))
  return { key, decisions, dir, rows }
}

test("CEL-191: Approve says Approved · Undo and sends nothing; Undo puts the row back with the note still typed; Z does the same", async ({ page }) => {
  const { key, decisions, dir, rows } = await setUp(page, "UND", "30", ["Approve, then think again", "Next in line"])
  const [one, two] = rows as [(typeof rows)[number], (typeof rows)[number]]
  await captionWithUrl(page, `Open ${key}-1 and write a note`)
  await page.goto(`/review?open=${key}-1`)
  await watchDecided(page)
  await expect(one.header).toHaveAttribute("aria-expanded", "true")
  await one.box.fill("Ship it.")

  await caption(page, "Approve: the row says Approved, with Undo. Nothing is sent, and the next row stays shut")
  await one.approve.click()
  await expect(one.words).toHaveText("Approved")
  await expect(one.undo).toBeVisible()
  await expect(one.undo).toBeFocused()
  await expect(one.article.locator("[data-undo-progress]")).toHaveCount(1)
  await expect(one.approve).toBeDisabled()
  await expect(two.header).toHaveAttribute("aria-expanded", "false")
  expect(decisions.sent()).toEqual([])

  await caption(page, "Undo: the row is as it was, with the note still in the box. Nothing was sent")
  await one.undo.click()
  await expect(one.words).toHaveCount(0)
  await expect(one.undo).toHaveCount(0)
  await expect(one.header).toHaveAttribute("aria-expanded", "true")
  await expect(one.box).toHaveValue("Ship it.")
  await expect(one.approve).toBeEnabled()
  await expect(one.sendBack).toBeEnabled()
  expect(decisions.sent()).toEqual([])

  await caption(page, "Approve again, then press Z: the same, from the keyboard")
  await one.approve.click()
  await expect(one.undo).toBeVisible()
  await page.keyboard.press("z")
  await expect(one.undo).toHaveCount(0)
  await expect(one.header).toBeFocused()
  await expect(one.box).toHaveValue("Ship it.")
  expect(decisions.sent()).toEqual([])

  await caption(page, "Z while typing in the note is just a letter")
  await one.box.click()
  await page.keyboard.press("End")
  await page.keyboard.press("z")
  await expect(one.box).toHaveValue("Ship it.z")
  expect(decisions.sent()).toEqual([])
  fs.rmSync(dir, { recursive: true, force: true })
})

test("CEL-191: when the window ends the decision is sent once: the row says Approved, folds away and the next opens; a Send back after it goes the same way", async ({ page }) => {
  const { key, decisions, dir, rows } = await setUp(page, "END", "30", ["Let the window end", "Then send this back"])
  const [one, two] = rows as [(typeof rows)[number], (typeof rows)[number]]
  await page.goto(`/review?open=${key}-1`)
  await watchDecided(page)
  await expect(one.header).toHaveAttribute("aria-expanded", "true")

  await caption(page, "Approve: Approved · Undo, and the window runs")
  await one.approve.click()
  await expect(one.undo).toBeVisible()
  expect(decisions.sent()).toEqual([])

  await caption(page, "The window ends: it is sent, the row folds away and the next one opens")
  await page.clock.fastForward(30_000)
  await expect(one.article).toHaveCount(0)
  expect(decisions.sent()).toEqual(["review.approve"])
  expect(await decidedSeen(page)).toContain(`${key}-1: Approved`)
  await expect(two.header).toHaveAttribute("aria-expanded", "true")

  await caption(page, "Send back with a note: the same, and the row says Sent back")
  await two.box.fill("Make it quieter.")
  await two.sendBack.click()
  await expect(two.undo).toBeVisible()
  await expect(two.words).toHaveText("Sent back")
  await page.clock.fastForward(30_000)
  await expect(two.article).toHaveCount(0)
  expect(decisions.sent()).toEqual(["review.approve", "review.sendBack"])
  fs.rmSync(dir, { recursive: true, force: true })
})

test("CEL-191: two rows in their windows at once: Undo one, and only the other is sent", async ({ page }) => {
  const { key, decisions, dir, rows } = await setUp(page, "TWO", "30", ["First to decide", "Second to decide"])
  const [one, two] = rows as [(typeof rows)[number], (typeof rows)[number]]
  await page.goto(`/review?open=${key}-1`)
  await expect(one.header).toHaveAttribute("aria-expanded", "true")

  await caption(page, `Approve ${key}-1, then open ${key}-2 and send it back: both wait`)
  await one.approve.click()
  await expect(one.undo).toBeVisible()
  await two.header.click()
  await two.box.fill("Needs a second look.")
  await two.sendBack.click()
  await expect(two.undo).toBeVisible()
  await expect(one.undo).toBeVisible()
  expect(decisions.sent()).toEqual([])

  await caption(page, `Undo ${key}-1: it is a plain row again; ${key}-2 still waits`)
  await one.undo.click()
  await expect(one.words).toHaveCount(0)
  await expect(two.undo).toBeVisible()

  await caption(page, `${key}-2's window ends: only its Send back is sent, once`)
  await page.clock.fastForward(30_000)
  await expect(two.article).toHaveCount(0)
  await expect(one.header).toBeVisible()
  expect(decisions.sent()).toEqual(["review.sendBack"])
  fs.rmSync(dir, { recursive: true, force: true })
})

test("CEL-191: leaving the Review page with a decision waiting sends it at once, once", async ({ page }) => {
  const { key, decisions, dir, rows } = await setUp(page, "LEA", "30", ["Approve and walk away"])
  const [one] = rows as [(typeof rows)[number]]
  await page.goto(`/review?open=${key}-1`)
  await expect(one.header).toHaveAttribute("aria-expanded", "true")
  await one.approve.click()
  await expect(one.undo).toBeVisible()
  expect(decisions.sent()).toEqual([])

  await caption(page, "Leave for the board: Lucas did click Approve, so it is sent now")
  await projectLink(page, key).click()
  await expect(column(page, "Done").locator(`[data-task-key="${key}-1"]`)).toBeVisible()
  expect(decisions.sent()).toEqual(["review.approve"])

  await caption(page, "Back on Review the packet is gone, and nothing was sent twice")
  await page.getByRole("navigation", { name: "Inbox" }).getByRole("link", { name: /^Review/ }).click()
  await expect(one.article).toHaveCount(0)
  expect(decisions.sent()).toEqual(["review.approve"])
  fs.rmSync(dir, { recursive: true, force: true })
})

test("CEL-191: a task decided from elsewhere during the window is not decided again: the row goes, a note says why, nothing is sent", async ({ page }) => {
  const { key, decisions, dir, rows } = await setUp(page, "OVT", "30", ["Decided from the CLI", "Stays waiting"])
  const [one, two] = rows as [(typeof rows)[number], (typeof rows)[number]]
  await page.goto(`/review?open=${key}-1`)
  await expect(one.header).toHaveAttribute("aria-expanded", "true")
  await one.approve.click()
  await expect(one.undo).toBeVisible()

  await captionWithUrl(page, `Meanwhile the agent moves ${key}-1 out of In Review with the CLI`)
  cello("task", "move", `${key}-1`, "In Progress")
  await expect(one.article).toHaveCount(0)
  await expect(page.getByText(`${key}-1 changed while you waited`)).toBeVisible()
  await page.clock.fastForward(30_000)
  await expect(two.header).toBeVisible()
  expect(decisions.sent()).toEqual([])
  fs.rmSync(dir, { recursive: true, force: true })
})

test("CEL-191: a decision the server refuses after its window shows the failure on the row, with the note still there", async ({ page }) => {
  const { key, decisions, dir, rows } = await setUp(page, "FAI", "30", ["Refused after the window"])
  const [one] = rows as [(typeof rows)[number]]
  await page.goto(`/review?open=${key}-1`)
  await expect(one.header).toHaveAttribute("aria-expanded", "true")
  await one.box.fill("Ship it.")
  decisions.failNext()
  await one.approve.click()
  await expect(one.undo).toBeVisible()

  await caption(page, "The window ends and the server refuses: the row shows why, the packet is open, the note is still there")
  await page.clock.fastForward(30_000)
  await expect(one.article.getByRole("alert")).toContainText("no longer exists")
  await expect(one.words).toHaveCount(0)
  await expect(one.header).toHaveAttribute("aria-expanded", "true")
  await expect(one.box).toHaveValue("Ship it.")
  await expect(one.approve).toBeEnabled()
  expect(decisions.sent()).toEqual(["review.approve"])
  fs.rmSync(dir, { recursive: true, force: true })
})

test("CEL-191: with the window off, Approve is sent at once and the row never offers Undo", async ({ page }) => {
  const { key, decisions, dir, rows } = await setUp(page, "OFF", "off", ["Sent at once"])
  const [one] = rows as [(typeof rows)[number]]
  await page.goto(`/review?open=${key}-1`)
  await watchDecided(page)
  await expect(one.header).toHaveAttribute("aria-expanded", "true")
  await caption(page, "The setting is off: Approve is sent at once, as before")
  await one.approve.click()
  await expect(one.article).toHaveCount(0)
  expect(decisions.sent()).toEqual(["review.approve"])
  expect(await decidedSeen(page)).toEqual([`${key}-1: Approved`])
  await expect(page.locator("[data-undo]")).toHaveCount(0)
  fs.rmSync(dir, { recursive: true, force: true })
})

test("CEL-191: Settings → Review turns the undo window on or off and sets how long; it is on for 5 seconds until changed, and kept after a reload", async ({ page }) => {
  await page.goto("/")
  await sidebarSettings(page).click()
  await page.evaluate((k) => localStorage.removeItem(k), UNDO_KEY)
  await page.reload()
  const undo = page.getByRole("switch", { name: "Undo a decision before it is sent" })
  const settings = page.locator("[data-review-settings]")

  await caption(page, "Never changed: on, for 5 seconds")
  await expect(undo).toBeChecked()
  await expect(settings).toContainText("for 5 seconds")

  await caption(page, "Pick 10 s: the Review page will wait 10 seconds")
  await settings.getByText("10 s", { exact: true }).click()
  await expect(settings).toContainText("for 10 seconds")
  expect(await page.evaluate((k) => localStorage.getItem(k), UNDO_KEY)).toBe("10")
  await page.reload()
  await expect(undo).toBeChecked()
  await expect(settings).toContainText("for 10 seconds")

  await caption(page, "Turn it off: decisions are sent at once, and the length is kept for later")
  await undo.click()
  await expect(undo).not.toBeChecked()
  await expect(settings).toContainText("sent at once")
  await expect(settings.getByText("How long")).toHaveCount(0)
  expect(await page.evaluate((k) => localStorage.getItem(k), UNDO_KEY)).toBe("off:10")
  await page.reload()
  await expect(undo).not.toBeChecked()

  await undo.click()
  await expect(settings).toContainText("for 10 seconds")
})
