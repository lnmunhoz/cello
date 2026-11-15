// CEL-47, the whole loop: an agent runs `cello task ask --wait` in the background (the real CLI, from
// source, as a Claude Code session) with two questions, option screenshots and a link. The card moves
// to Needs input, the sidebar counts it, and the Review page shows it first. Lucas answers in the
// browser: picks an option with the keyboard and one with the mouse, writes a comment, pastes a
// screenshot from the clipboard, and sends with ⌘Enter. The agent's command returns with his answers
// (the screenshot saved as a file), and the card is back in In Progress. Stills go to e2e/videos/.
import { spawn } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Page } from "@playwright/test"
import { caption, card, column, createProject, expect, test, uniqueKey } from "./fixtures.ts"
import { celloAs, SHOTS } from "./packets.ts"

const SESSION = "e2e0asks-agent-session"
const root = path.resolve(import.meta.dirname, "..")
const SERVER_PORT = Number(process.env.CELLO_E2E_SERVER_PORT ?? 4791)

/** `cello …` in the background, as the agent session: resolves with what it printed once it exits. */
const inBackground = (...args: string[]) => {
  const child = spawn("bun", [path.join(root, "apps/cli/src/bin.ts"), ...args], {
    cwd: root,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, CELLO_PORT: String(SERVER_PORT), CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_PID: String(process.pid) },
  })
  let out = ""
  child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()))
  child.stderr.on("data", (chunk: Buffer) => (out += chunk.toString()))
  return new Promise<{ code: number | null; out: string }>((resolve) => child.on("close", (code) => resolve({ code, out: out.trim() })))
}

/** The agent's terminal, drawn at the bottom left so the video shows its side next to the board. */
const showTerminal = async (page: Page, command: string, output: string) => {
  await page.evaluate(([cmd, out]) => {
    let el = document.getElementById("e2e-terminal")
    if (!el) {
      el = document.createElement("pre")
      el.id = "e2e-terminal"
      el.setAttribute("aria-label", "Agent terminal")
      Object.assign(el.style, {
        position: "fixed", zIndex: "2147483646", left: "24px", bottom: "84px", width: "760px", maxHeight: "70vh", overflow: "hidden",
        margin: "0", padding: "14px 16px", borderRadius: "10px", background: "rgb(16 16 20 / .94)", color: "#e8e8ec",
        font: "12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace", whiteSpace: "pre-wrap", boxShadow: "0 12px 40px rgb(0 0 0 / .35)",
      })
      document.body.append(el)
    }
    el.textContent = `${el.textContent ? `${el.textContent}\n\n` : ""}agent session $ ${cmd}\n${out}`
    el.scrollTop = el.scrollHeight
  }, [command, output] as const)
}

const hideTerminal = (page: Page) => page.evaluate(() => document.getElementById("e2e-terminal")?.remove())

/** Puts a PNG on the clipboard, the way a screenshot tool leaves one. */
const copyImage = async (page: Page, file: string) => {
  const base64 = fs.readFileSync(file).toString("base64")
  await page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) })])
  }, base64)
}

test("CEL-47: an agent asks with --wait; Lucas answers on the card, with a pasted screenshot; the agent gets the answers and the card is back in progress", async ({ page, context }) => {
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
  await expect(column(page, "Needs input").locator(`[data-task-key="${task}"]`)).toBeVisible()
  await expect(card(page, task).locator("[data-questions-badge]")).toHaveText("3 questions")
  await expect(page.locator("[data-input-count]")).toHaveText("1 waiting")
  await page.screenshot({ path: path.join(SHOTS, "cel-47-card-needs-input.png") })

  await caption(page, "Lucas opens Needs input in the sidebar: the questions sit first on the Review page")
  await page.getByRole("navigation", { name: "Inbox" }).getByRole("link", { name: /Needs input/ }).click()
  const row = page.locator(`[data-review-task="${task}"]`)
  await expect(row).toHaveAttribute("data-open", "")
  await expect(page.getByRole("list", { name: "Needs your input" })).toContainText(task)
  const ask = row.locator("[data-ask]")
  await expect(ask.getByRole("heading", { name: "Search results layout" })).toBeVisible()
  await expect(ask.locator("[data-recommended]")).toHaveText("Recommended")
  await expect(ask.getByText("Most results are long text")).toBeVisible()
  // Nothing is picked for him, so Send answers waits.
  await expect(ask.getByRole("radio", { checked: true })).toHaveCount(0)
  await expect(ask.getByRole("button", { name: "Send answers" })).toBeDisabled()
  await page.screenshot({ path: path.join(SHOTS, "cel-47-review-page-ask.png") })

  await caption(page, "An option's screenshot opens large")
  await ask.getByRole("button", { name: "Open the image for Peek: list + preview" }).click()
  const modal = page.locator("[data-image-modal]")
  await expect(modal).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(modal).toBeHidden()

  await caption(page, "Question 1: he presses 1 to pick Peek, and says what to change")
  const first = ask.locator('[data-question="q1"]')
  await first.getByRole("radio", { name: /Peek/ }).focus()
  await page.keyboard.press("1")
  await expect(first.getByRole("radio", { name: /Peek/ })).toHaveAttribute("aria-checked", "true")
  await first.getByRole("textbox", { name: "Comment on question 1" }).fill("Yes, but make the preview narrower, like this:")

  await caption(page, "He pastes a screenshot from the clipboard (⌘V) into the comment")
  const pasted = path.join(dir, "pasted.png")
  await page.screenshot({ path: pasted, clip: { x: 0, y: 0, width: 640, height: 400 } })
  await copyImage(page, pasted)
  await first.getByRole("textbox", { name: "Comment on question 1" }).focus()
  await page.keyboard.press("ControlOrMeta+V")
  await expect(first.locator("img[data-pasted-screenshot]")).toHaveCount(1)
  await expect(first.getByRole("textbox", { name: "Comment on question 1" })).toHaveValue("Yes, but make the preview narrower, like this:")

  await caption(page, "Question 2: he picks Filters with the mouse; question 3, a few words")
  await ask.locator('[data-question="q2"]').getByRole("checkbox", { name: /Filters/ }).click()
  await expect(ask.locator("[data-ask-progress]")).toHaveText("2 of 3 answered")
  await ask.getByRole("textbox", { name: "Comment on question 3" }).fill("Keep the empty state from the old page.")
  await expect(ask.locator("[data-ask-progress]")).toHaveText("All answered")
  await page.screenshot({ path: path.join(SHOTS, "cel-47-answers-drafted.png") })
  // Stills of the open ask, light and dark.
  await ask.locator('[data-question="q1"]').screenshot({ path: path.join(SHOTS, "cel-47-question-light.png") })
  await page.getByRole("button", { name: "Use dark theme" }).click()
  await expect(page.locator("html")).toHaveClass(/dark/)
  // The colors fade to the new theme: wait for the fades to end, so the still shows the dark one.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)))
  await ask.locator('[data-question="q1"]').screenshot({ path: path.join(SHOTS, "cel-47-question-dark.png") })
  await page.screenshot({ path: path.join(SHOTS, "cel-47-answers-drafted-dark.png") })
  await page.getByRole("button", { name: "Use light theme" }).click()

  await caption(page, "The draft survives a reload")
  await page.reload()
  await expect(row.locator('[data-question="q1"]').getByRole("radio", { name: /Peek/ })).toHaveAttribute("aria-checked", "true")
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
  expect(out).toContain("1. Which layout?\n   Picked: Peek: list + preview (your recommendation)\n   Comment: Yes, but make the preview narrower, like this:")
  expect(out).toContain("2. Which extras?\n   Picked: Filters")
  expect(out).toContain("3. Anything else before I build it?\n   Comment: Keep the empty state from the old page.")
  const saved = /Screenshot: (\S+)/.exec(out)![1]!
  // The clipboard re-encodes an image, so compare what it shows: a PNG of the same size as the one copied.
  const pngSize = (file: string) => {
    const bytes = fs.readFileSync(file)
    expect(bytes.subarray(1, 4).toString()).toBe("PNG")
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
  }
  expect(pngSize(saved)).toEqual(pngSize(pasted))
  await expect(page.getByLabel("Agent terminal")).toContainText("Picked: Filters")
  await page.screenshot({ path: path.join(SHOTS, "cel-47-agent-gets-answers.png") })

  await caption(page, "The card is back in In Progress, and the answers stay in the task's history")
  await hideTerminal(page)
  await page.goto(`/${key}`)
  await expect(column(page, "In Progress").locator(`[data-task-key="${task}"]`)).toBeVisible()
  await card(page, task).click()
  const questions = page.getByRole("region", { name: "Questions" })
  await expect(questions).toContainText("Search results layout")
  await questions.getByRole("button", { name: /Search results layout/ }).click()
  await expect(questions.locator("[data-ask-record] li[data-picked]")).toHaveCount(2)
  await expect(questions).toContainText("Keep the empty state from the old page.")
  await page.screenshot({ path: path.join(SHOTS, "cel-47-history-record.png") })
  fs.rmSync(dir, { recursive: true, force: true })
})
