// CEL-5 and CEL-35: who made a task, who's on it right now and where it is inside In Progress, live.
// Agents act through RPC with the CLI's identity headers (x-cello-pid included, so the server can
// tell whether their process is alive). Agent cursors are off here, so cards change in place.
import { spawnSync } from "node:child_process"
import * as path from "node:path"
import type { Page } from "@playwright/test"
import { newCommandId, openClient, type PromiseClient } from "../packages/client/test/support/promiseClient.ts"
import { caption, card, column, defaultWorkspace, expect, seedProject, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { SHOTS } from "./packets.ts"

/** An agent session over RPC, as the CLI would call: its session id, and its process's pid. */
const agentAs = (baseURL: string, session: string, pid: number) =>
  openClient(`${baseURL.replace(/^http/, "ws")}/rpc`, { "x-cello-session": session, "x-cello-client": "Claude Code", "x-cello-pid": String(pid) })

const display = (page: Page) => page.getByRole("button", { name: /^Display/ })

/** Turns Display → "Group In Progress by stage" on or off, then closes the popover. */
async function groupByStage(page: Page, on: boolean) {
  await display(page).click()
  const toggle = page.getByRole("switch", { name: "Group In Progress by stage" })
  if ((await toggle.getAttribute("aria-checked")) !== String(on)) await toggle.click()
  await expect(toggle).toHaveAttribute("aria-checked", String(on))
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Display options" })).toBeHidden()
}

/** "Agents working" in the sidebar: its count is in `data-agents-working`. */
const agentsWorking = (page: Page) => page.locator('aside[data-sidebar="expanded"] [data-agents-working]')

/** A project with tasks in Todo, made by Lucas; returns their keys. */
async function seed(cello: PromiseClient, prefix: string, titles: ReadonlyArray<string>) {
  const key = uniqueKey(prefix)
  const project = await seedProject(cello, prefix === "WHO" ? "Who's on it" : "Stage lanes", key)
  const { statuses } = await defaultWorkspace(cello)
  for (const title of titles) {
    await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title, statusId: statuses.Todo!.id }))
  }
  return { key, keys: titles.map((_, i) => `${key}-${i + 1}`) }
}

test.beforeEach(async ({ context }) => {
  // Before the first page only: the Display toggle must survive the test's own reloads.
  await context.addInitScript(() => {
    if (localStorage.getItem("cello:agent-cursors") === null) localStorage.setItem("cello:agent-cursors", "off")
  })
})

test("CEL-5, CEL-35: an agent claims, checks in and moves through the stages: card, panel and sidebar follow live; an ended session comes back with one ripple", async ({ page, cello, baseURL }) => {
  // The server's sweep notices an exited process within 30 s: this test waits for it once.
  test.setTimeout(Math.max(test.info().timeout, 90_000))
  const { key, keys } = await seed(cello, "WHO", ["Presence on cards", "Restore asks before overwriting"])
  const [first, second] = keys as [string, string]
  await page.goto(`/${key}/issues`)
  await expect(column(page, "Todo").locator("[data-task-key]")).toHaveCount(2)
  const before = Number(await agentsWorking(page).getAttribute("data-agents-working"))

  await caption(page, "Lucas made both tasks: each card says who created it")
  await expect(card(page, first).locator("[data-provenance]")).toContainText(/created \w{3} \d+$/)

  await caption(page, "Session 5e7a91c2 claims the first task: the card shows it working, and the sidebar counts it")
  const live = await agentAs(baseURL!, "5e7a91c2-presence-live", process.pid)
  await live.run((c) => c["task.claim"]({ commandId: newCommandId(), key: first }))
  const firstCard = column(page, "In Progress").locator(`[data-task-key="${first}"]`)
  await expect(firstCard.locator("[data-card-work]")).toContainText("5e7a91c2 active now")
  await expect(firstCard.locator('[data-presence="active"]')).toBeVisible()
  await expect(firstCard.locator("[data-provenance]")).toContainText("created · 5e7a91c2 changed just now")
  await expect(agentsWorking(page)).toHaveAttribute("data-agents-working", String(before + 1))

  await caption(page, "`cello task stage building`, then `review`: the stage changes on the card as it's set")
  await live.run((c) => c["task.stage"]({ commandId: newCommandId(), key: first, stage: "building" }))
  await expect(firstCard.locator('[data-stage="building"]')).toHaveText("Building")
  await live.run((c) => c["task.stage"]({ commandId: newCommandId(), key: first, stage: "review" }))
  await expect(firstCard.locator('[data-stage="review"]')).toHaveText("Agent review")

  await firstCard.click()
  const panel = taskPanel(page, first)
  await expect(panel).toBeVisible()
  // Opened first, so the panel stays on screen for the whole caption.
  await caption(page, "The task panel says it too: who's on it and the stage in the header, Created by, Last changed and Working on it")
  await expect(panel.locator("[data-panel-work]")).toContainText("5e7a91c2 active now")
  await expect(panel.locator("[data-panel-work]")).toContainText("Agent review")
  await expect(panel.locator("[data-last-changed]")).toContainText("Claude Code session 5e7a91c2")
  await expect(panel.locator("[data-working-on-it]")).toContainText("Claude Code session 5e7a91c2 active now")
  await expect(panel.locator('section[aria-labelledby="history-heading"]')).toContainText("Claude Code set the stage to Agent review")
  // Its own caption, so the panel stays open under the one above until it's closed.
  await caption(page, "Back to the board")
  await panel.getByRole("button", { name: "Close task" }).click()

  await caption(page, "A second session claims the other task, but its process has already exited")
  const exited = spawnSync("true").pid!
  const gone = await agentAs(baseURL!, "c1d2e3f4-presence-gone", exited)
  await gone.run((c) => c["task.claim"]({ commandId: newCommandId(), key: second }))
  const secondCard = column(page, "In Progress").locator(`[data-task-key="${second}"]`)
  await expect(secondCard.locator("[data-card-work]")).toContainText("c1d2e3f4 active now")

  await caption(page, "Within 30 s the server notices the process is gone: the card says ended, in grey, with no reload")
  await expect(secondCard.locator("[data-card-work]")).toContainText("c1d2e3f4 ended", { timeout: 45_000 })
  await expect(secondCard.locator('[data-presence="ended"]')).toBeVisible()
  await expect(secondCard.locator("[data-ripple]")).toHaveCount(0)

  await caption(page, "The session is resumed with a new process and calls Cello: active again, with one ripple from its dot")
  const resumed = await agentAs(baseURL!, "c1d2e3f4-presence-gone", process.pid)
  await resumed.run((c) => c["whoami"]({ project: {} }))
  await expect(secondCard.locator("[data-card-work]")).toContainText("c1d2e3f4 active now")
  await expect(secondCard.locator("[data-ripple]")).toHaveCount(1)
  // One ripple, not a loop: it plays once.
  await expect(secondCard.locator("[data-ripple]")).toHaveCSS("animation-iteration-count", "1")

  await live.run((c) => c["task.release"]({ commandId: newCommandId(), key: first }))
  await resumed.run((c) => c["task.release"]({ commandId: newCommandId(), key: second }))
  await Promise.all([live.close(), gone.close(), resumed.close()])
})

test("CEL-35: Display → Group In Progress by stage splits the column into lanes; a drag into another lane snaps back; the list gets a stage column", async ({ page, cello, baseURL }) => {
  const { key, keys } = await seed(cello, "LANE", ["Wire the stage command", "Review the presence events", "Fix the lane drop", "Plan the next step"])
  const [building, review, fixing, plain] = keys as [string, string, string, string]
  const agent = await agentAs(baseURL!, "9b8c7d6e-presence-lanes", process.pid)
  for (const [taskKey, stage] of [[building, "building"], [review, "review"], [fixing, "fixing"], [plain, null]] as const) {
    await agent.run((c) => c["task.claim"]({ commandId: newCommandId(), key: taskKey }))
    if (stage) await agent.run((c) => c["task.stage"]({ commandId: newCommandId(), key: taskKey, stage }))
  }
  await page.goto(`/${key}/issues`)
  const progress = column(page, "In Progress")
  await expect(progress.locator("[data-task-key]")).toHaveCount(4)

  await caption(page, "By default each card says its stage in words, and In Progress keeps its own order")
  await expect(progress.locator("[data-lane]")).toHaveCount(0)
  await expect(card(page, review).locator('[data-stage="review"]')).toBeVisible()

  await caption(page, "Display → Group In Progress by stage: a lane per stage, in order, then the tasks with no stage")
  await groupByStage(page, true)
  await expect(progress.locator("[data-lane]")).toHaveText([/Building\s*1/, /Agent review\s*1/, /Fixing findings\s*1/, /No stage\s*1/])
  await expect(progress.locator("[data-task-key]").nth(0)).toHaveAttribute("data-task-key", building)
  await expect(progress.locator("[data-task-key]").nth(1)).toHaveAttribute("data-task-key", review)
  await expect(progress.locator("[data-task-key]").nth(2)).toHaveAttribute("data-task-key", fixing)
  await expect(progress.locator("[data-task-key]").nth(3)).toHaveAttribute("data-task-key", plain)
  // The lane says the stage, so the cards don't repeat it.
  await expect(progress.locator("[data-card-work] [data-stage]")).toHaveCount(0)
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await progress.screenshot({ path: path.join(SHOTS, `cel-35-lanes-column-${theme}.png`) })
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"))

  await caption(page, "Dragging the Agent review card into the Building lane: it snaps back, the stage is the agent's to set")
  const from = (await card(page, review).boundingBox())!
  const to = (await card(page, building).boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + 8, { steps: 20 })
  await expect(progress.locator("[data-dragging]")).toHaveAttribute("data-task-key", review)
  await page.mouse.up()
  await expect(progress.locator("[data-dragging]")).toHaveCount(0)
  await expect(progress.locator("[data-task-key]").nth(0)).toHaveAttribute("data-task-key", building)
  await expect(progress.locator("[data-task-key]").nth(1)).toHaveAttribute("data-task-key", review)
  expect((await cello.run((c) => c["task.get"]({ key: review }))).task).toMatchObject({ stage: "review", version: 3 })

  await caption(page, "The list: In Progress gets a stage column, row by row in lane order")
  await page.goto(`/${key}/issues?layout=list`)
  const rows = page.locator('[data-layout="list"] section[data-group="In Progress"] [data-task-key]')
  await expect(rows).toHaveCount(4)
  await expect(rows.nth(0).locator('[data-stage-column] [data-stage="building"]')).toBeVisible()
  await expect(rows.nth(1).locator('[data-stage-column] [data-stage="review"]')).toBeVisible()
  await expect(rows.nth(3).locator("[data-stage]")).toHaveCount(0)
  await expect(rows.locator("[data-row-work] [data-stage]")).toHaveCount(0)
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await page.screenshot({ path: path.join(SHOTS, `cel-35-lanes-list-${theme}.png`) })
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"))

  await caption(page, "Turning it off brings back one column in its own order, with the stage on each card")
  await page.goto(`/${key}/issues`)
  await groupByStage(page, false)
  await expect(progress.locator("[data-lane]")).toHaveCount(0)
  await expect(card(page, review).locator('[data-stage="review"]')).toBeVisible()
  await expect(progress.locator("[data-task-key]").nth(0)).toHaveAttribute("data-task-key", building)
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await progress.screenshot({ path: path.join(SHOTS, `cel-5-35-words-column-${theme}.png`) })
    await page.locator('aside[data-sidebar="expanded"] nav[aria-label="Inbox"]').screenshot({ path: path.join(SHOTS, `cel-35-sidebar-${theme}.png`) })
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"))

  await caption(page, "The task panel in words: who's on it, the stage, Created by, Last changed and Working on it")
  await card(page, review).click()
  const panel = taskPanel(page, review)
  await expect(panel.locator("[data-working-on-it]")).toContainText("Claude Code session 9b8c7d6e active now")
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await page.screenshot({ path: path.join(SHOTS, `cel-5-35-panel-${theme}.png`) })
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"))
  await page.goto(`/${key}/issues?layout=list`)
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await page.screenshot({ path: path.join(SHOTS, `cel-5-35-words-list-${theme}.png`) })
  }

  await caption(page, "The agent asks Lucas about the Fixing findings task: it waits under the lanes, in its own Needs input group, its stage kept")
  await page.evaluate(() => document.documentElement.classList.remove("dark"))
  await page.goto(`/${key}/issues`)
  await groupByStage(page, true)
  await agent.run((c) => c["ask.create"]({ commandId: newCommandId(), key: fixing, title: "Which fix?", questions: [{ prompt: "Ship the narrower drop zone?" }], files: [], links: [] }))
  await expect(progress.locator("[data-lane]")).toHaveText([/Building\s*1/, /Agent review\s*1/, /No stage\s*1/, /Needs input\s*1/])
  await expect(progress.locator("[data-task-key]").nth(3)).toHaveAttribute("data-task-key", fixing)
  await expect(card(page, fixing).locator('[data-stage="fixing"]')).toBeVisible()

  await caption(page, "With the Needs input column on too: Needs input is its own column, and In Progress keeps its lanes")
  await display(page).click()
  await page.getByRole("switch", { name: "Needs input column" }).click()
  await expect(page.getByRole("switch", { name: "Needs input column" })).toHaveAttribute("aria-checked", "true")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Display options" })).toBeHidden()
  await expect(column(page, "Needs input").locator(`[data-task-key="${fixing}"]`)).toBeVisible()
  await expect(progress.locator("[data-lane]")).toHaveText([/Building\s*1/, /Agent review\s*1/, /No stage\s*1/])
  await page.screenshot({ path: path.join(SHOTS, "cel-35-lanes-and-needs-input-light.png") })

  await agent.run((c) => c["ask.withdraw"]({ commandId: newCommandId(), key: fixing }))
  for (const taskKey of keys) await agent.run((c) => c["task.release"]({ commandId: newCommandId(), key: taskKey }))
  await agent.close()
})

test("CEL-5: a comment is activity: the card says who commented just now, with a count, and moves up under Last updated", async ({ page, cello, baseURL }) => {
  const key = uniqueKey("TALK")
  const project = await seedProject(cello, "Comments on cards", key)
  const { statuses } = await defaultWorkspace(cello)
  const ids: string[] = []
  for (const title of ["Write the release notes", "Fix the drop zone", "Plan the next milestone"]) {
    const { result } = await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title, statusId: statuses.Todo!.id }))
    ids.push(result.id)
  }
  const [oldest, middle, newest] = [`${key}-1`, `${key}-2`, `${key}-3`]
  const todo = column(page, "Todo").locator("[data-task-key]")
  const order = async (keys: ReadonlyArray<string>) => {
    for (const [i, k] of keys.entries()) await expect(todo.nth(i)).toHaveAttribute("data-task-key", k)
  }
  // The session holds a task of its own (In Progress), so the board knows it by its short id.
  const agent = await agentAs(baseURL!, "2fd0505c-presence-talk", process.pid)
  await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Agent's own work", statusId: statuses.Todo!.id }))
  await agent.run((c) => c["task.claim"]({ commandId: newCommandId(), key: `${key}-4` }))
  await page.goto(`/${key}/issues`)
  await expect(todo).toHaveCount(3)

  await caption(page, "Display → Ordering → Last updated: the newest task is on top, and no card has comments yet")
  await display(page).click()
  await page.getByRole("combobox", { name: "Ordering", exact: true }).click()
  await page.getByRole("option", { name: "Last updated", exact: true }).click()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Display options" })).toBeHidden()
  await order([newest, middle, oldest])
  await expect(todo.locator("[data-comment-count]")).toHaveCount(0)

  await caption(page, "Session 2fd0505c comments on the oldest task: its card says so, shows one comment, and moves to the top")
  await agent.run((c) => c["comment.add"]({ commandId: newCommandId(), taskId: ids[0]!, body: "Started on the notes: the draft is in the PR." }))
  const commented = card(page, oldest)
  await expect(commented.locator("[data-provenance]")).toHaveText(/created · 2fd0505c commented just now$/)
  await expect(commented.locator("[data-comment-count]")).toHaveText("1")
  await order([oldest, newest, middle])

  await caption(page, "Lucas replies: the card names him now, and counts two")
  await cello.run((c) => c["comment.add"]({ commandId: newCommandId(), taskId: ids[0]!, body: "Thanks, I'll read it tonight." }))
  await expect(commented.locator("[data-provenance]")).toHaveText(/created · commented just now$/)
  await expect(commented.locator("[data-comment-count]")).toHaveText("2")
  await expect(commented.locator("[data-comment-count]")).toHaveAttribute("aria-label", "2 comments")

  await caption(page, "Session 2fd0505c comments on the middle task: it moves up to the top")
  await agent.run((c) => c["comment.add"]({ commandId: newCommandId(), taskId: ids[1]!, body: "Found the cause: the lane's drop zone is too wide." }))
  await expect(card(page, middle).locator("[data-provenance]")).toHaveText(/created · 2fd0505c commented just now$/)
  await order([middle, oldest, newest])
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await column(page, "Todo").screenshot({ path: path.join(SHOTS, `cel-5-comments-column-${theme}.png`), animations: "disabled" })
    await commented.screenshot({ path: path.join(SHOTS, `cel-5-comments-card-${theme}.png`), animations: "disabled" })
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"))

  await caption(page, "Renaming the task is a change again: the card says changed, and keeps its count")
  const { task } = await cello.run((c) => c["task.get"]({ key: oldest }))
  await agent.run((c) => c["task.update"]({ commandId: newCommandId(), id: task.id, expectedVersion: task.version, title: "Write the release notes for 0.4" }))
  await expect(commented.locator("[data-provenance]")).toHaveText(/created · 2fd0505c changed just now$/)
  await expect(commented.locator("[data-comment-count]")).toHaveText("2")

  await caption(page, "The list: each row with comments shows its count; the full provenance is on hover")
  await page.goto(`/${key}/issues?layout=list`)
  const row = page.locator(`[data-layout="list"] [data-task-key="${middle}"]`)
  await expect(row.locator("[data-comment-count]")).toHaveText("1")
  await expect(row.locator("[data-provenance]")).toHaveAttribute("title", /last commented by Claude Code session 2fd0505c, just now$/)
  await expect(page.locator(`[data-layout="list"] [data-task-key="${newest}"] [data-comment-count]`)).toHaveCount(0)
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await page.screenshot({ path: path.join(SHOTS, `cel-5-comments-list-${theme}.png`) })
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"))
  await agent.run((c) => c["task.release"]({ commandId: newCommandId(), key: `${key}-4` }))
  await agent.close()
})
