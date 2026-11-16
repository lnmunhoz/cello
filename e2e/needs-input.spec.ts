// CEL-47, the whole loop: an agent runs `cello task ask --wait` in the background (the real CLI, from
// source, as a Claude Code session) with two questions, option screenshots and a link. The card moves
// to Needs input, the sidebar counts it, and the Review page shows it first. Lucas answers in the
// browser: picks an option with the keyboard and one with the mouse, writes a comment, pastes a
// screenshot from the clipboard, and sends with ⌘Enter. The agent's command returns with his answers
// (the screenshot saved as a file), and the card is back in In Progress. Stills go to e2e/videos/.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Page } from "@playwright/test"
import { animationsSettled, caption, card, column, createProject, dragCard, expect, test, uniqueKey } from "./fixtures.ts"
import { celloAs, celloInBackground, SHOTS, showTerminal as drawTerminal } from "./packets.ts"

const SESSION = "e2e0asks-agent-session"

/** `cello …` in the background, as the agent session: resolves with what it printed once it exits. */
const inBackground = celloInBackground(SESSION)

/** The agent's terminal, drawn at the bottom left so the video shows its side next to the board; it doesn't move the pointer. */
const showTerminal = (page: Page, command: string, output: string) => drawTerminal(page, command, output, { hover: false, empty: "" })

const hideTerminal = (page: Page) => page.evaluate(() => document.getElementById("e2e-terminal")?.remove())

/** Puts a PNG on the clipboard, the way a screenshot tool leaves one. */
const copyImage = async (page: Page, file: string) => {
  const base64 = fs.readFileSync(file).toString("base64")
  await page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) })])
  }, base64)
}

test("CEL-47: an agent asks with --wait; Lucas answers from the sidebar (several picks, None of these, a pasted screenshot); the agent gets the answers; round 2 follows, and Lucas moving the card withdraws it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  const key = uniqueKey("ASK")
  const task = `${key}-1`
  const agent = celloAs(SESSION)
  await createProject(page, "Search", key)

  await caption(page, `An agent session claims ${task}`)
  agent("task", "create", "Search results layout", "--project", key)
  agent("task", "claim", task)
  await expect(column(page, "In Progress").locator(`[data-task-key="${task}"]`)).toBeVisible()

  // The evidence: screenshots of the two layouts (the board, standing in for them) and the scope page.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-ask-"))
  await page.screenshot({ path: path.join(dir, "peek.png") })
  await page.screenshot({ path: path.join(dir, "palette.png"), clip: { x: 0, y: 0, width: 900, height: 560 } })
  fs.writeFileSync(path.join(dir, "ask.yaml"), [
    "title: Search results layout",
    "intro: Both layouts are built; the screenshots are from the real app.",
    "questions:",
    "  - prompt: Which layout?",
    "    options:",
    "      - label: \"Peek: list + preview\"",
    "        description: Shows the highlighted result's text",
    "        image: peek.png",
    "        recommended: true",
    "        because: Most results are long text",
    "      - label: \"Palette: one line per result\"",
    "        image: palette.png",
    "  - prompt: Which extras?",
    "    kind: any",
    "    options: [Filters, Recent searches]",
    "  - prompt: Anything else before I build it?",
    "links:",
    "  - { url: \"http://127.0.0.1:4747/CEL/pages/search-scope\", caption: The scope }",
  ].join("\n"))

  await caption(page, "The agent asks on the card and waits: cello task ask --file ask.yaml --wait, in the background")
  const waiting = inBackground("task", "ask", task, "--file", path.join(dir, "ask.yaml"), "--wait")
  // The Needs input column is off by default: the card stays in In Progress, badged, and the sidebar counts it.
  await expect(card(page, task).locator("[data-questions-badge]")).toHaveText("Needs input")
  await expect(column(page, "In Progress").locator(`[data-task-key="${task}"]`)).toBeVisible()
  await expect(column(page, "Needs input")).toHaveCount(0)
  await expect(page.locator("[data-input-count]")).toHaveText("1 waiting")
  await page.screenshot({ path: path.join(SHOTS, "cel-47-card-needs-input.png") })

  await caption(page, "Display → Needs input column: on, the card has its own column; off again, it's back in In Progress")
  const display = async (on: boolean) => {
    await page.getByRole("button", { name: /Display/ }).click()
    const toggle = page.getByRole("switch", { name: "Needs input column" })
    if ((await toggle.getAttribute("aria-checked")) !== String(on)) await toggle.click()
    await expect(toggle).toHaveAttribute("aria-checked", String(on))
    await page.keyboard.press("Escape")
  }
  await display(true)
  await expect(column(page, "Needs input").locator(`[data-task-key="${task}"]`)).toBeVisible()
  await page.screenshot({ path: path.join(SHOTS, "cel-47-column-on.png") })
  await display(false)
  await expect(column(page, "In Progress").locator(`[data-task-key="${task}"]`)).toBeVisible()
  await expect(column(page, "Needs input")).toHaveCount(0)

  await caption(page, "Lucas opens Needs input in the sidebar: the questions sit first on the Review page")
  await page.getByRole("navigation", { name: "Inbox" }).getByRole("link", { name: /Needs input/ }).click()
  const row = page.locator(`[data-review-task="${task}"]`)
  await expect(row).toHaveAttribute("data-open", "")
  await expect(page.getByRole("list", { name: "Needs your input" })).toContainText(task)
  const ask = row.locator("[data-ask]")
  await expect(ask.getByRole("heading", { name: "Search results layout" })).toBeVisible()
  await expect(ask.locator("[data-recommended]")).toHaveText("Recommended")
  await expect(ask.getByText("Most results are long text")).toBeVisible()
  // The recommended option comes picked; the others wait for him.
  const first = ask.locator('[data-question="q1"]')
  await expect(first.getByRole("checkbox", { name: /Peek/ })).toHaveAttribute("aria-checked", "true")
  await expect(first.getByRole("checkbox", { name: /Palette/ })).toHaveAttribute("aria-checked", "false")
  await expect(ask.getByRole("button", { name: "Send answers" })).toBeDisabled()
  await page.screenshot({ path: path.join(SHOTS, "cel-47-review-page-ask.png") })

  await caption(page, "An option's screenshot opens large")
  await ask.getByRole("button", { name: "Open the image for Peek: list + preview" }).click()
  const modal = page.locator("[data-image-modal]")
  await expect(modal).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(modal).toBeHidden()

  await caption(page, "Question 1: Peek is already picked; he presses 2 to pick Palette too, and says why")
  await first.getByRole("checkbox", { name: /Peek/ }).focus()
  await page.keyboard.press("2")
  await expect(first.getByRole("checkbox", { name: /Palette/ })).toHaveAttribute("aria-checked", "true")
  await expect(first.getByRole("checkbox", { name: /Peek/ })).toHaveAttribute("aria-checked", "true")
  await first.getByRole("textbox", { name: "Comment on question 1" }).fill("Both, behind a toggle. Narrower preview, like this:")

  await caption(page, "He pastes a screenshot from the clipboard (⌘V) into the comment")
  const pasted = path.join(dir, "pasted.png")
  await page.screenshot({ path: pasted, clip: { x: 0, y: 0, width: 640, height: 400 } })
  await copyImage(page, pasted)
  await first.getByRole("textbox", { name: "Comment on question 1" }).focus()
  await page.keyboard.press("ControlOrMeta+V")
  await expect(first.locator("img[data-pasted-screenshot]")).toHaveCount(1)
  await expect(first.getByRole("textbox", { name: "Comment on question 1" })).toHaveValue("Both, behind a toggle. Narrower preview, like this:")

  await caption(page, "Question 2: None of these, which needs a comment")
  const second = ask.locator('[data-question="q2"]')
  await second.getByRole("checkbox", { name: /None of these/ }).click()
  await expect(second.getByText("“None of these” needs a comment that says what instead.")).toBeVisible()
  await expect(ask.locator("[data-ask-progress]")).toHaveText("1 of 3 answered")
  await second.getByRole("textbox", { name: "Comment on question 2" }).fill("Neither yet: a saved-search list later.")
  await expect(ask.locator("[data-ask-progress]")).toHaveText("2 of 3 answered")

  await caption(page, "Question 3, a few words")
  await ask.getByRole("textbox", { name: "Comment on question 3" }).fill("Keep the empty state from the old page.")
  await expect(ask.locator("[data-ask-progress]")).toHaveText("All answered")
  await page.screenshot({ path: path.join(SHOTS, "cel-47-answers-drafted.png") })
  // Stills of the open ask, light and dark.
  await first.screenshot({ path: path.join(SHOTS, "cel-47-question-light.png") })
  await page.getByRole("button", { name: "Use dark theme" }).click()
  await expect(page.locator("html")).toHaveClass(/dark/)
  // The colors fade to the new theme: wait for the fades to end, so the still shows the dark one.
  await animationsSettled(page)
  await first.screenshot({ path: path.join(SHOTS, "cel-47-question-dark.png") })
  await second.screenshot({ path: path.join(SHOTS, "cel-47-none-of-these-dark.png") })
  await page.screenshot({ path: path.join(SHOTS, "cel-47-answers-drafted-dark.png") })
  await page.getByRole("button", { name: "Use light theme" }).click()

  await caption(page, "The draft survives a reload")
  await page.reload()
  await expect(row.locator('[data-question="q1"]').getByRole("checkbox", { name: /Palette/ })).toHaveAttribute("aria-checked", "true")
  await expect(row.locator('[data-question="q1"] img[data-pasted-screenshot]')).toHaveCount(1)
  await expect(row.getByRole("textbox", { name: "Comment on question 3" })).toHaveValue("Keep the empty state from the old page.")

  await caption(page, "⌘Enter sends the answers")
  await row.getByRole("textbox", { name: "Comment on question 3" }).focus()
  await page.keyboard.press("ControlOrMeta+Enter")
  await expect(page.getByRole("list", { name: "Needs your input" })).toBeHidden()

  await caption(page, "The agent's background command returns with his answers, the screenshot as a file")
  const { code, out } = await waiting
  expect(code).toBe(0)
  await showTerminal(page, `cello task ask ${task} --file ask.yaml --wait`, out)
  expect(out).toContain(`answered "Search results layout" on ${task}`)
  expect(out).toContain("1. Which layout?\n   Picked: Peek: list + preview (your recommendation), Palette: one line per result\n   Comment: Both, behind a toggle.")
  expect(out).toContain("2. Which extras?\n   Picked: None of these\n   Comment: Neither yet: a saved-search list later.")
  expect(out).toContain("3. Anything else before I build it?\n   Comment: Keep the empty state from the old page.")
  const saved = /Screenshot: (\S+)/.exec(out)![1]!
  // The clipboard re-encodes an image, so compare what it shows: a PNG of the same size as the one copied.
  const pngSize = (file: string) => {
    const bytes = fs.readFileSync(file)
    expect(bytes.subarray(1, 4).toString()).toBe("PNG")
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
  }
  expect(pngSize(saved)).toEqual(pngSize(pasted))
  await expect(page.getByLabel("Agent terminal")).toContainText("Picked: None of these")
  await page.screenshot({ path: path.join(SHOTS, "cel-47-agent-gets-answers.png") })

  await caption(page, "Round 2: the agent asks a follow-up on the same card")
  await hideTerminal(page)
  await page.goto(`/${key}`)
  await expect(column(page, "In Progress").locator(`[data-task-key="${task}"]`)).toBeVisible()
  await expect(card(page, task).locator("[data-questions-badge]")).toHaveCount(0)
  agent("task", "ask", task, "--title", "The toggle", "--question", "Where does the layout toggle go?",
    "--option", "Header", "--recommend", "Header", "--because", "Next to the search box", "--option", "Footer")
  await expect(card(page, task).locator("[data-questions-badge]")).toHaveText("Needs input")

  await caption(page, "The task shows the rounds as a thread: round 1 answered, round 2 open")
  await card(page, task).click()
  const questions = page.getByRole("region", { name: "Questions" })
  await expect(questions.locator("[data-round]")).toHaveText([/Round 1 · answered.*Search results layout/, /Round 2 · open.*The toggle/])
  await questions.getByRole("button", { name: /Round 1 · answered/ }).click()
  await expect(questions.locator("[data-ask-record] li[data-picked]")).toHaveCount(2)
  await expect(questions.locator("[data-none-of-these]")).toHaveCount(1)
  await expect(questions).toContainText("Keep the empty state from the old page.")
  // Round 2 in view, under round 1's record.
  await questions.locator('[data-round^="Round 2"]').scrollIntoViewIfNeeded()
  await expect(questions.locator('[data-round^="Round 2"]')).toBeInViewport()
  await page.screenshot({ path: path.join(SHOTS, "cel-47-rounds-thread.png") })

  await caption(page, "Lucas drags the card to Todo himself: round 2 is withdrawn, and the agent hears where it went")
  await page.goto(`/${key}`)
  await dragCard(page, task, "Todo")
  await expect(column(page, "Todo").locator(`[data-task-key="${task}"]`)).toBeVisible()
  await expect(card(page, task).locator("[data-questions-badge]")).toHaveCount(0)
  const notice = agent("inbox", "--new")
  await showTerminal(page, "cello inbox --new", notice)
  expect(notice).toContain(`moved ${task} to Todo; your ask "The toggle" was withdrawn.`)
  await expect(page.getByLabel("Agent terminal")).toContainText("your ask \"The toggle\" was withdrawn")
  await page.screenshot({ path: path.join(SHOTS, "cel-47-withdrawn-notice.png") })
  await hideTerminal(page)
  await card(page, task).click()
  await expect(page.getByRole("region", { name: "Questions" }).locator("[data-round]")).toHaveText([/Round 1 · answered/, /Round 2 · withdrawn/])
  await page.getByRole("region", { name: "Questions" }).locator('[data-round^="Round 2"]').scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(SHOTS, "cel-47-round-withdrawn.png") })
  fs.rmSync(dir, { recursive: true, force: true })
})
