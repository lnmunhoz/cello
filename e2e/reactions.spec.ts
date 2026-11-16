// CEL-77: Lucas reacts to an agent's comment with one click instead of typing a reply. 👍 from the
// comment's picker shows as a chip under it and reaches the agent's `cello inbox --new`, once; a 🚀
// found by searching the picker wakes the agent's background `cello inbox --wait`; the agent's own ✅ (`cello task react … last ✅`) shows up live; clicking a chip toggles Lucas's reaction,
// and taking one back before the agent reads it means it never arrives. The same comments, with their
// chips, show under the packet on the Review page. Stills (light and dark) go to e2e/videos/.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Browser, Locator } from "@playwright/test"
import { animationsSettled, caption, card, column, createProject, expect, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { showTerminalAndPoint as showTerminal } from "./agentScreen.ts"
import { celloAs, celloInBackground, SHOTS, WEB_URL } from "./packets.ts"
import { isReview } from "./recording.ts"

const SESSION = "e2e0reactions-agent-session"

test.beforeEach(() => {
  if (isReview(process.env)) test.setTimeout(240_000)
})

/** A chip under a comment, by its emoji ("👍 1: Lucas…"). */
const chip = (comment: Locator, emoji: string) => comment.getByRole("button", { name: new RegExp(`^${emoji} \\d`) })

/** The task panel at the agent's comment, light and dark, with the chips and then the open picker: e2e/videos/cel-77-*.png. */
async function screenshots(browser: Browser, task: string) {
  fs.mkdirSync(SHOTS, { recursive: true })
  const [projectKey, number] = task.split("-") as [string, string]
  for (const colorScheme of ["light", "dark"] as const) {
    const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 }, colorScheme })
    const page = await context.newPage()
    await page.goto(`/${projectKey}/${number}`)
    const panel = taskPanel(page, task)
    const comment = panel.locator("[data-comment-id]").first()
    await expect(chip(comment, "👍")).toBeVisible()
    await expect(chip(panel.locator("[data-comment-id]").nth(1), "✅")).toBeVisible()
    const comments = panel.getByRole("region", { name: "Comments" })
    await comments.scrollIntoViewIfNeeded()
    const box = (await comments.boundingBox())!
    // The comments, with room above for the picker, which opens upwards.
    const around = { x: box.x - 16, y: Math.max(0, box.y - 260), width: box.width + 32, height: Math.min(900, box.height + 276) }
    await page.screenshot({ path: path.join(SHOTS, `cel-77-chips-${colorScheme}.png`), clip: around })
    await comment.getByRole("button", { name: "Add a reaction" }).click()
    const picker = page.getByRole("group", { name: "Pick a reaction" })
    await expect(picker).toBeVisible()
    // The picker fades in; shoot it once that's done.
    await animationsSettled(page)
    await page.screenshot({ path: path.join(SHOTS, `cel-77-picker-${colorScheme}.png`), clip: around })
    await context.close()
  }
}

test("CEL-77: Lucas reacts 👍 to an agent's comment; the chip shows, and the agent's `cello inbox` has it once", async ({ page, browser }) => {
  const key = uniqueKey("RCT")
  const task = `${key}-1`
  const agent = celloAs(SESSION)
  await createProject(page, "Reactions", key)

  await caption(page, `An agent session claims ${task} and asks Lucas something in a comment`)
  agent("task", "create", "Emoji reactions on comments", "--project", key)
  agent("task", "claim", task)
  agent("task", "comment", task, "Built the picker and the chips. Shall I merge it?")
  await expect(column(page, "In Progress").locator(`[data-task-key="${task}"]`)).toBeVisible()

  await caption(page, "Lucas opens the task: a small react button sits under the comment")
  await card(page, task).click()
  const panel = taskPanel(page, task)
  const question = panel.locator("[data-comment-id]").first()
  await expect(question).toContainText("Shall I merge it?")
  await question.getByRole("button", { name: "Add a reaction" }).click()

  await caption(page, "He answers with one click: 👍 from the quick picks")
  const picker = page.getByRole("group", { name: "Pick a reaction" })
  await expect(picker.getByRole("group", { name: "Quick reactions" }).getByRole("button")).toHaveCount(5)
  await picker.getByRole("button", { name: "React 👍" }).click()
  await expect(picker).toBeHidden()
  await expect(chip(question, "👍")).toHaveAttribute("aria-pressed", "true")
  await expect(chip(question, "👍")).toHaveAccessibleName("👍 1: You. Click to take yours back")
  await expect(chip(question, "👍")).toContainText("1")

  await caption(page, "In the agent's session: `cello inbox --new` has the 👍, with the start of its comment")
  const inbox = agent("inbox", "--new")
  await showTerminal(page, "cello inbox --new", inbox)
  expect(inbox).toMatch(new RegExp(`${task}  Emoji reactions on comments\n  .+ reacted 👍 to your comment, just now\n    "Built the picker and the chips\\. Shall I merge it\\?"`))
  expect(inbox).toContain("no need to answer it on the card")
  await expect(page.getByLabel("Agent terminal")).toContainText("reacted 👍 to your comment")
  await page.screenshot({ path: path.join(SHOTS, "cel-77-reaction-reaches-inbox.png") })

  await caption(page, "Asked again, it prints nothing: each reaction arrives once")
  const again = agent("inbox", "--new")
  await showTerminal(page, "cello inbox --new", again)
  expect(again).toBe("")

  await caption(page, "The agent ends its turn with `cello inbox --wait` running in the background, so Lucas can wake it")
  const waiting = celloInBackground(SESSION)("inbox", "--wait")
  const waitingLine = await waiting.printed
  expect(waitingLine).toContain("Waiting for new comments")
  await showTerminal(page, "cello inbox --wait   # in the background", waitingLine)

  await caption(page, "Lucas searches the picker for “rocket” and reacts 🚀: the waiting command wakes with it")
  await question.getByRole("button", { name: "Add a reaction" }).click()
  const search = page.getByRole("group", { name: "Pick a reaction" })
  await search.getByLabel("Search emoji").fill("rocket")
  await search.getByRole("group", { name: "More reactions" }).getByRole("button", { name: "React 🚀" }).click()
  await expect(chip(question, "🚀")).toHaveAttribute("aria-pressed", "true")
  const woken = await waiting
  expect(woken.code).toBe(0)
  expect(woken.stdout).toMatch(/reacted 🚀 to your comment, just now\n {4}"Built the picker and the chips\. Shall I merge it\?"/)
  await showTerminal(page, "# cello inbox --wait exits, waking the agent with:", woken.stdout)
  await expect(page.getByLabel("Agent terminal")).toContainText("reacted 🚀 to your comment")

  await caption(page, "Lucas replies in words too; the agent reacts ✅ to that with `cello task react … last ✅`, and the chip shows up live")
  await panel.getByLabel("New comment").fill("Yes, merge it.")
  await panel.getByRole("button", { name: "Comment", exact: true }).click()
  const answer = panel.locator("[data-comment-id]").last()
  await expect(answer).toContainText("Yes, merge it.")
  const reacted = agent("task", "react", task, "last", "✅")
  await showTerminal(page, `cello task react ${task} last ✅`, reacted)
  await expect(chip(answer, "✅")).toHaveAttribute("aria-pressed", "false")
  await expect(chip(answer, "✅")).toHaveAccessibleName(/^✅ 1: Claude Code/)
  agent("inbox", "--new") // the agent takes Lucas's "Yes" comment, so what follows is only about reactions

  await caption(page, "Clicking the ✅ chip adds Lucas's own: 2, pressed")
  await chip(answer, "✅").click()
  await expect(chip(answer, "✅")).toHaveAttribute("aria-pressed", "true")
  await expect(chip(answer, "✅")).toContainText("2")

  await caption(page, "A 🎉 on the agent's comment, taken back with a click before the agent reads it: it never arrives")
  await question.getByRole("button", { name: "Add a reaction" }).click()
  await page.getByRole("group", { name: "Pick a reaction" }).getByRole("button", { name: "React 🎉" }).click()
  await expect(chip(question, "🎉")).toHaveAttribute("aria-pressed", "true")
  await caption(page, "There's the 🎉 chip, Lucas's own… and a click on it takes it back")
  await chip(question, "🎉").click()
  await expect(chip(question, "🎉")).toBeHidden()
  const nothing = agent("inbox", "--new")
  await showTerminal(page, "cello inbox --new", nothing)
  expect(nothing).toBe("")
  await expect(page.getByLabel("Agent terminal")).toContainText("(prints nothing)")

  await caption(page, "The agent hands the task in (with a stand-in test log as its evidence); on the Review page the comments carry their chips")
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-reactions-"))
  fs.writeFileSync(path.join(dir, "vitest.log"), "Test Files  178 passed (178)\n")
  agent("task", "submit", task, "--summary", "Reactions on comments", "--step", "React to a comment", "--attach", path.join(dir, "vitest.log"))
  await page.goto(`/review?open=${task}`)
  const row = page.getByRole("article", { name: new RegExp(task) })
  const onReview = row.locator("[data-comment-id]").first()
  await expect(chip(onReview, "👍")).toHaveAttribute("aria-pressed", "true")
  await expect(chip(row.locator("[data-comment-id]").nth(1), "✅")).toContainText("2")
  await onReview.scrollIntoViewIfNeeded()
  await caption(page, "Lucas's 👍 reached the agent once; the reaction he took back never did")
  fs.rmSync(dir, { recursive: true, force: true })

  await screenshots(browser, task)
})
