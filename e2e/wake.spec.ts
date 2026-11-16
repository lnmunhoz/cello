// CEL-92: Cello wakes an agent's session by itself when Lucas acts on its claimed task and the session's
// process is gone. Settings has the per-project switch (off by default) and the cap; the task panel's
// Working on it row says what Cello is doing: a wake due with Don't wake, a woken run with Stop and Log,
// how it ended, or why it didn't wake. The woken "Claude Code" is e2e/stub-bin/claude (the server has
// it first on its PATH): it takes the comment with `cello inbox` and answers on the card as the session.
// Stills go to e2e/videos/cel-92-*.
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import type { Locator, Page } from "@playwright/test"
import { newCommandId, openClient } from "../packages/client/test/support/promiseClient.ts"
import { caption, defaultWorkspace, expect, seedProject, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { SHOTS } from "./packets.ts"
import { isReview } from "./recording.ts"

const root = path.resolve(import.meta.dirname, "..")
/** Claude Code's folder for the e2e server (playwright.config.ts): where conversations "are". */
const claudeDir = path.join(process.env.CELLO_E2E_DATA!, "claude")

test.beforeEach(async ({ context }) => {
  if (isReview(process.env)) test.setTimeout(240_000)
  await context.addInitScript(() => {
    if (localStorage.getItem("cello:agent-cursors") === null) localStorage.setItem("cello:agent-cursors", "off")
  })
})

/** A pid that has exited: the session's Claude process is gone. */
const deadPid = () => spawnSync("true").pid

/**
 * A Claude Code session whose process is gone, that claimed `key`: its conversation is on this machine
 * (a file in Claude Code's folder), and the stub answers `answer` on the card when woken.
 */
async function goneSession(baseURL: string, session: string, key: string, answer: string, options: { hold?: boolean } = {}) {
  // Where Claude Code keeps a conversation started in `root`: projects/<root, every other character a dash>.
  const project = path.join(claudeDir, "projects", root.replace(/[^A-Za-z0-9]/g, "-"))
  fs.mkdirSync(project, { recursive: true })
  fs.writeFileSync(path.join(project, `${session}.jsonl`), "{}\n")
  fs.writeFileSync(path.join(claudeDir, `key-${session}`), key)
  fs.writeFileSync(path.join(claudeDir, `answer-${session}`), answer)
  if (options.hold) fs.writeFileSync(path.join(claudeDir, `hold-${session}`), "")
  const agent = await openClient(`${baseURL.replace(/^http/, "ws")}/rpc`, {
    "x-cello-session": session,
    "x-cello-client": "Claude Code",
    "x-cello-pid": String(deadPid()),
    "x-cello-cwd": root,
    "x-cello-permission-mode": "acceptEdits",
  })
  await agent.run((c) => c["task.claim"]({ commandId: newCommandId(), key }))
  return agent
}

/** Light and dark stills of `target`, without the video's cursor and captions. */
async function stills(page: Page, name: string, target: Locator) {
  await page.mouse.move(5, 5)
  const overlay = (shown: boolean) => page.evaluate((v) => document.getElementById("e2e-layer")?.style.setProperty("visibility", v), shown ? "visible" : "hidden")
  await overlay(false)
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await target.screenshot({ path: path.join(SHOTS, `cel-92-${name}-${theme}.png`) })
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"))
  await overlay(true)
}

/** Stills of the task panel, its wake line under Working on it. */
const shoot = (page: Page, key: string, name: string) => stills(page, name, taskPanel(page, key))

async function say(page: Page, key: string, text: string) {
  const thread = taskPanel(page, key).getByRole("region", { name: "Comments" })
  await thread.getByLabel("New comment").fill(text)
  await thread.getByRole("button", { name: "Comment", exact: true }).click()
  await expect(thread.getByLabel("New comment")).toHaveValue("")
}

test("CEL-92: Settings turns waking on per project (off by default) and sets the cap", async ({ page, cello }) => {
  const key = uniqueKey("WAKE")
  await seedProject(cello, "Wake settings", key)
  await page.goto(`/settings?project=${key}`)
  const section = page.getByRole("region", { name: "Waking agents" })
  await caption(page, "Settings → Waking agents: off until Lucas turns it on, 3 wakes per task per hour")
  await section.scrollIntoViewIfNeeded()
  const toggle = section.getByRole("switch")
  await expect(toggle).not.toBeChecked()
  await expect(section.getByLabel("Wakes per task per hour")).toHaveValue("3")
  await expect(section.locator("[data-wake-agent='claude-code']")).toHaveText("Claude Code: installed")

  await caption(page, "He turns it on and allows 5 wakes an hour")
  await toggle.click()
  await expect(toggle).toBeChecked()
  const cap = section.getByLabel("Wakes per task per hour")
  await cap.fill("5")
  await cap.press("Enter")
  // The field shows the stored value again once the change came back from the server.
  await expect(cap).toHaveValue("5")
  await expect(cap).not.toBeFocused()

  await caption(page, "After a reload both are kept")
  await page.reload()
  await section.scrollIntoViewIfNeeded()
  await expect(section.getByRole("switch")).toBeChecked()
  await expect(section.getByLabel("Wakes per task per hour")).toHaveValue("5")
  await stills(page, "settings", section)
})

test("CEL-92: before a wake (Don't wake), during a woken run (Stop, Log), and not woken when waking is off", async ({ page, cello, baseURL }) => {
  const key = uniqueKey("WAKE")
  const project = await seedProject(cello, "Wake", key)
  const { statuses } = await defaultWorkspace(cello)
  await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Use the other icon", statusId: statuses.Todo!.id }))
  const task = `${key}-1`
  await goneSession(baseURL!, "c92e2e01-hold-session", task, "On it: switching the icon now.", { hold: true })
  const row = taskPanel(page, task).locator("[data-wake]")

  await page.goto(`/${key}/1`)
  await caption(page, `Session c92e2e01 claimed ${task}, then its Claude process ended. Waking is off for ${key} (the default)`)
  await say(page, task, "Please use the other icon")
  await expect(row).toHaveAttribute("data-wake", "not_woken")
  await expect(row).toHaveText("Not woken: waking is off for this project")
  await shoot(page, task, "not-woken")

  await caption(page, "Lucas turns waking on and comments again: Cello will wake the session in a moment, unless he says Don't wake")
  await cello.run((c) => c["wake.setSettings"]({ commandId: newCommandId(), project: { key }, enabled: true }))
  await say(page, task, "Use the round one")
  await expect(row).toHaveAttribute("data-wake", "scheduled")
  await expect(row).toContainText("Session c92e2e01 isn't running. Cello will wake it in 3 s")
  await row.getByRole("button", { name: "Don't wake" }).click()
  await expect(row).toHaveText("Not woken: you said don't wake it")

  await caption(page, "Another comment, and this time he lets it wake: Woken by Cello · running, with Stop and Log")
  await say(page, task, "The round one, please")
  await expect(row).toHaveAttribute("data-wake", "scheduled")
  await expect(row).toHaveAttribute("data-wake", "running", { timeout: 15_000 })
  await expect(row).toContainText("Woken by Cello · running")
  // The woken session took the comments and answered on the card, as itself.
  await expect(taskPanel(page, task).getByText("On it: switching the icon now.")).toBeVisible({ timeout: 15_000 })
  const log = await row.getByRole("link", { name: "Log" }).getAttribute("href")
  expect((await page.request.get(log!)).status()).toBe(200)
  expect(await (await page.request.get(log!)).text()).toContain('"type":"cello.run"')
  await shoot(page, task, "running")

  await caption(page, "Lucas presses Stop: the run ends, and the line says so, with its log")
  await row.getByRole("button", { name: "Stop" }).click()
  await expect(row).toHaveAttribute("data-wake", "ended")
  await expect(row).toContainText(/^Woken by Cello just now · was stopped after \d+ s/)
  await expect(row.getByRole("link", { name: "Log" })).toBeVisible()
  await shoot(page, task, "stopped")
})

test("CEL-92: after a woken run, the session's answer is on the card and the history says Cello woke it", async ({ page, cello, baseURL }) => {
  const key = uniqueKey("WAKE")
  const project = await seedProject(cello, "Wake after", key)
  const { statuses } = await defaultWorkspace(cello)
  await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Shorter labels", statusId: statuses.Todo!.id }))
  const task = `${key}-1`
  await cello.run((c) => c["wake.setSettings"]({ commandId: newCommandId(), project: { key }, enabled: true }))
  await goneSession(baseURL!, "c92e2e02-done-session", task, "Done: the labels are shorter now.")
  const row = taskPanel(page, task).locator("[data-wake]")

  await page.goto(`/${key}/1`)
  await caption(page, `Session c92e2e02 claimed ${task} and its process ended; waking is on. Lucas comments`)
  await say(page, task, "Make the labels shorter")
  await expect(row).toHaveAttribute("data-wake", "scheduled")
  await caption(page, "Cello wakes it; it answers on the card and exits: the line says how the run ended")
  await expect(taskPanel(page, task).getByText("Done: the labels are shorter now.")).toBeVisible({ timeout: 15_000 })
  await expect(row).toHaveAttribute("data-wake", "ended", { timeout: 15_000 })
  await expect(row).toContainText(/^Woken by Cello just now · completed in \d+ s/)
  await caption(page, "The history says what Cello did")
  const history = taskPanel(page, task).getByRole("region", { name: "History" })
  await history.scrollIntoViewIfNeeded()
  await expect(history).toContainText("Cello woke Claude Code session c92e2e02 (a comment, mode acceptEdits)")
  await expect(history).toContainText(/Claude Code session c92e2e02's woken run completed in \d+ s/)
  await shoot(page, task, "ended")
})
