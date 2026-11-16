// CEL-47, comparing a question's options full screen (Lucas, Nov 15: "expand this question to view all
// the three options side by side"). An agent asks with three option images; Lucas expands the question
// from the task panel, sees the options in columns, switches to rows (remembered on this device), picks
// with a key and a click, comments, looks closer at one image, and closes back to the question with his
// picks kept. It works on the Review page too, and narrow windows fall back to rows. Stills go to e2e/videos/.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Locator, Page } from "@playwright/test"
import { animationsSettled, caption, card, createProject, expect, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { celloAs, SHOTS } from "./packets.ts"

const SESSION = "e2e0compare-agent-session"

/** A mock-up of a layout, drawn on a canvas: a PNG distinct enough to compare at a glance. */
const mockup = async (page: Page, file: string, name: string, accent: string, columns: number) => {
  const data = await page.evaluate(([label, color, n]) => {
    const canvas = document.createElement("canvas")
    canvas.width = 1200
    canvas.height = 750
    const g = canvas.getContext("2d")!
    g.fillStyle = "#f6f6f8"
    g.fillRect(0, 0, 1200, 750)
    g.fillStyle = color
    g.fillRect(0, 0, 1200, 90)
    g.fillStyle = "#fff"
    g.font = "bold 44px sans-serif"
    g.fillText(label, 40, 60)
    const gap = 30
    const width = (1200 - gap * (n + 1)) / n
    for (let i = 0; i < n; i++) {
      g.fillStyle = "#fff"
      g.fillRect(gap + i * (width + gap), 130, width, 580)
      g.fillStyle = color
      g.globalAlpha = 0.35
      g.fillRect(gap + i * (width + gap) + 20, 150, width - 40, 160)
      g.globalAlpha = 1
      g.fillStyle = "#c9c9d1"
      for (let line = 0; line < 6; line++) g.fillRect(gap + i * (width + gap) + 20, 340 + line * 50, (width - 40) * (line % 2 ? 0.7 : 1), 20)
    }
    return canvas.toDataURL("image/png").split(",")[1]!
  }, [name, accent, columns] as const)
  fs.writeFileSync(file, Buffer.from(data, "base64"))
}

/** The options' boxes in the compare view, in order. */
const boxes = async (view: Locator) => {
  const options = view.locator("[data-compare-option]")
  return Promise.all((await options.all()).map(async (o) => (await o.boundingBox())!))
}

const sideBySide = async (view: Locator) => {
  const [a, b, c] = await boxes(view)
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(2)
  expect(Math.abs(b!.y - c!.y)).toBeLessThan(2)
  expect(a!.x).toBeLessThan(b!.x)
  expect(b!.x).toBeLessThan(c!.x)
}

const stacked = async (view: Locator) => {
  const [a, b, c] = await boxes(view)
  expect(Math.abs(a!.x - b!.x)).toBeLessThan(2)
  expect(a!.y + a!.height).toBeLessThanOrEqual(b!.y)
  expect(b!.y + b!.height).toBeLessThanOrEqual(c!.y)
}

const settle = (page: Page) => animationsSettled(page)

test("CEL-47: Lucas expands a question full screen, compares its three options in columns and rows, picks from there, and closes with his picks kept", async ({ page }) => {
  const key = uniqueKey("CMP")
  const task = `${key}-1`
  const agent = celloAs(SESSION)
  await createProject(page, "Search", key)

  await caption(page, `An agent asks on ${task}: which card layout? Three options, each with a mock-up`)
  agent("task", "create", "Result cards", "--project", key)
  agent("task", "claim", task)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-compare-"))
  await mockup(page, path.join(dir, "grid.png"), "Grid: three across", "#6d5dfc", 3)
  await mockup(page, path.join(dir, "list.png"), "List: one per row", "#0f9d76", 1)
  await mockup(page, path.join(dir, "split.png"), "Split: two across", "#e0702a", 2)
  fs.writeFileSync(path.join(dir, "ask.yaml"), [
    "title: Result cards",
    "questions:",
    "  - prompt: Which card layout?",
    "    options:",
    "      - label: Grid",
    "        description: Three cards across; the most results on one screen, the shortest previews.",
    "        image: grid.png",
    "        recommended: true",
    "        because: Most searches return many short results",
    "      - label: List",
    "        description: One card per row with the longest preview.",
    "        image: list.png",
    "      - label: Split",
    "        description: Two across, a middle ground.",
    "        image: split.png",
    "  - prompt: Anything else?",
  ].join("\n"))
  agent("task", "ask", task, "--file", path.join(dir, "ask.yaml"))
  await expect(card(page, task).locator("[data-questions-badge]")).toHaveText("Needs input")

  await caption(page, "Lucas opens the task: the option images are small thumbnails, so he expands the question")
  await card(page, task).click()
  const pinned = taskPanel(page, task).getByRole("region", { name: "Needs your input" })
  const question = pinned.locator('[data-question="q1"]')
  await expect(question.getByRole("checkbox", { name: /Grid/ })).toHaveAttribute("aria-checked", "true")
  // A question without options has nothing to compare: no expand button.
  await expect(pinned.locator('[data-question="q2"]').getByRole("button", { name: /Compare/ })).toHaveCount(0)
  await question.getByRole("button", { name: "Compare question 1's options full screen" }).click()

  const view = page.getByRole("dialog", { name: "Which card layout?" })
  await expect(view).toBeVisible()
  await expect(view).toHaveAttribute("data-layout", "columns")
  await expect(view.locator("[data-compare-option] img")).toHaveCount(3)
  await expect(view.getByText("Most searches return many short results")).toBeVisible()
  await settle(page)
  await sideBySide(view)
  await page.screenshot({ path: path.join(SHOTS, "cel-47-compare-columns-light.png") })

  await caption(page, "Rows: each option stacked, its image full width")
  await view.getByRole("radio", { name: "Rows" }).click()
  await expect(view).toHaveAttribute("data-layout", "rows")
  await settle(page)
  await stacked(view)
  await page.screenshot({ path: path.join(SHOTS, "cel-47-compare-rows-light.png") })
  await view.getByRole("radio", { name: "Columns" }).click()
  await expect(view).toHaveAttribute("data-layout", "columns")

  await caption(page, "He picks right there: 3 picks Split too, a click takes Grid off, and he comments")
  await view.getByRole("checkbox", { name: /List/ }).focus()
  await page.keyboard.press("3")
  await expect(view.getByRole("checkbox", { name: /Split/ })).toHaveAttribute("aria-checked", "true")
  await view.getByRole("checkbox", { name: /Grid/ }).click()
  await expect(view.getByRole("checkbox", { name: /Grid/ })).toHaveAttribute("aria-checked", "false")
  await view.getByRole("textbox", { name: "Comment on question 1" }).fill("Split, with the list's longer preview.")

  await caption(page, "An option's image still opens large, to zoom; Esc goes back to the comparison")
  await view.getByRole("button", { name: "Open the image for List" }).click()
  const modal = page.locator("[data-image-modal]")
  await expect(modal).toBeVisible()
  await expect(modal.locator("img[data-modal-image]")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(modal).toBeHidden()
  await expect(view).toBeVisible()

  await caption(page, "Esc closes the comparison: the question has his picks and comment")
  await page.keyboard.press("Escape")
  await expect(view).toBeHidden()
  await expect(question.getByRole("checkbox", { name: /Grid/ })).toHaveAttribute("aria-checked", "false")
  await expect(question.getByRole("checkbox", { name: /List/ })).toHaveAttribute("aria-checked", "false")
  await expect(question.getByRole("checkbox", { name: /Split/ })).toHaveAttribute("aria-checked", "true")
  await expect(question.getByRole("textbox", { name: "Comment on question 1" })).toHaveValue("Split, with the list's longer preview.")

  await caption(page, "In the dark theme, rows is remembered: it opens the way he left it")
  await question.getByRole("button", { name: "Compare question 1's options full screen" }).click()
  await view.getByRole("radio", { name: "Rows" }).click()
  await view.getByRole("button", { name: "Close" }).click()
  await expect(view).toBeHidden()
  await page.getByRole("button", { name: "Use dark theme" }).click()
  await expect(page.locator("html")).toHaveClass(/dark/)
  await page.reload()
  await taskPanel(page, task).getByRole("region", { name: "Needs your input" }).locator('[data-question="q1"]').getByRole("button", { name: /Compare/ }).click()
  await expect(view).toHaveAttribute("data-layout", "rows")
  await expect(view.getByRole("checkbox", { name: /Split/ })).toHaveAttribute("aria-checked", "true")
  await settle(page)
  await stacked(view)
  await page.screenshot({ path: path.join(SHOTS, "cel-47-compare-rows-dark.png") })
  await view.getByRole("radio", { name: "Columns" }).click()
  await settle(page)
  await sideBySide(view)
  await page.screenshot({ path: path.join(SHOTS, "cel-47-compare-columns-dark.png") })
  await view.getByRole("button", { name: "Close" }).click()
  await page.getByRole("button", { name: "Use light theme" }).click()

  await caption(page, "On the task's full page, the question expands the same way")
  await page.goto(`/${key}/1?view=full`)
  await taskPanel(page, task).getByRole("region", { name: "Needs your input" }).locator('[data-question="q1"]').getByRole("button", { name: /Compare/ }).click()
  await expect(view.getByRole("checkbox", { name: /Split/ })).toHaveAttribute("aria-checked", "true")
  await page.keyboard.press("Escape")
  await expect(view).toBeHidden()

  await caption(page, "On the Review page, the same question expands too, with the same picks")
  await page.getByRole("navigation", { name: "Inbox" }).getByRole("link", { name: /Needs input/ }).click()
  const row = page.locator(`[data-review-task="${task}"]`)
  await expect(row).toHaveAttribute("data-open", "")
  await row.locator('[data-question="q1"]').getByRole("button", { name: /Compare/ }).click()
  await expect(view).toHaveAttribute("data-layout", "columns")
  await expect(view.getByRole("checkbox", { name: /Split/ })).toHaveAttribute("aria-checked", "true")
  await settle(page)
  await sideBySide(view)

  await caption(page, "In a narrow window, columns fall back to rows")
  await page.setViewportSize({ width: 600, height: 900 })
  await settle(page)
  await stacked(view)
  await expect(view.getByRole("radio", { name: "Rows" })).toBeHidden()
  await page.screenshot({ path: path.join(SHOTS, "cel-47-compare-narrow.png") })
  await view.getByRole("button", { name: "Close" }).click()
  await expect(view).toBeHidden()
  // The specs share one server: no ask left open to count in the next one's sidebar, and no claim held
  // by an active agent, whose mark would keep thinking in the next ones' Agents working (CEL-69).
  agent("task", "ask", task, "--withdraw")
  agent("task", "release", task)
  fs.rmSync(dir, { recursive: true, force: true })
})
