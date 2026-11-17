// CEL-142: resting the pointer on a task link (a key in an ask, a packet, a doc, a description) shows a
// card about the task, so it can be read without opening it: status, priority, labels, milestone, who's
// on it and its stage, what waits on Lucas, the first lines of its description, who changed it last.
// The card stays while the pointer is over it (its links work), Esc closes it, keyboard focus opens it
// too, and a click on the link still opens the task in the page's side panel (CEL-141). A link to a
// task of another workspace reads it from the server. Stills of the card, in light and dark, go to e2e/videos/.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Browser, Page } from "@playwright/test"
import { animationsSettled, caption, captionWithUrl, createProject, expect, newCommandId, test, uniqueKey } from "./fixtures.ts"
import { cello, SHOTS, WEB_URL } from "./packets.ts"
import { isReview } from "./recording.ts"

// Review videos hold every step (e2e/recording.ts), which takes this flow past the default timeout.
test.beforeEach(() => {
  if (isReview(process.env)) test.setTimeout(180_000)
})

const viewerOf = (page: Page) => page.getByRole("complementary", { name: "Viewer" })
const previewOf = (page: Page, key: string) => page.locator(`[data-task-preview="${key}"]`)

/** The page is at `pathname`, with task `key` in its side panel. */
const showsBeside = (pathname: string, key: string) => (url: URL) => {
  const [projectKey, number] = key.split("-")
  return url.pathname === pathname && url.searchParams.get("viewer") === `/${projectKey}/${number}`
}

/**
 * KEY-1 asks a question whose intro names KEY-2. KEY-2 has a description that names KEY-3, a priority,
 * a label and a milestone, and an agent on it, building. Returns the folder to remove.
 */
function seed(key: string): string {
  cello("task", "create", "Saved library: the design", "--project", key)
  cello("label", "create", "Import", "--color", "#3B82F6", "--project", key)
  cello("milestone", "create", "Launch", "--project", key)
  cello(
    "task", "create", "Import the bookmarks", "--project", key, "--priority", "high", "--label", "Import", "--milestone", "Launch",
    "--description", [
      "Reads the browser's **bookmarks file** and adds each link to the library.",
      `Exports go in ${key}-3, once this is in.`,
      "- Folders become labels\n- Duplicates are skipped",
      "A fourth paragraph the card leaves out.",
    ].join("\n\n"),
  )
  cello("task", "create", "Export the library", "--project", key)
  cello("task", "claim", `${key}-2`)
  cello("task", "stage", `${key}-2`, "building")
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-taskpreview-"))
  cello("task", "claim", `${key}-1`)
  fs.writeFileSync(
    path.join(dir, "ask.yaml"),
    [
      "title: Which import first?",
      `intro: The import is ${key}-2.`,
      "questions:",
      "  - prompt: Ship the import before the export?",
      "    options:",
      "      - label: Import first",
      "        recommended: true",
      "        because: Nothing to export until it's in",
      "      - label: Both together",
    ].join("\n"),
  )
  cello("task", "ask", `${key}-1`, "--file", path.join(dir, "ask.yaml"))
  return dir
}

/** The card for KEY-2 over the Review page, in an unrecorded window: e2e/videos/cel-142-task-preview-<scheme>.png. */
async function still(browser: Browser, key: string, colorScheme: "light" | "dark") {
  const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 }, colorScheme })
  const page = await context.newPage()
  await page.goto(`/review?open=${key}-1`)
  await page.locator(`[data-review-task="${key}-1"] [data-ask] [data-task-link="${key}-2"]`).hover()
  await expect(previewOf(page, `${key}-2`).locator("[data-preview-description]")).toBeVisible()
  // Once its fade-in is over.
  await expect(page.locator('[data-slot="hover-card-content"]')).not.toHaveAttribute("data-starting-style")
  await animationsSettled(page)
  await page.screenshot({ path: path.join(SHOTS, `cel-142-task-preview-${colorScheme}.png`) })
  await context.close()
}

test("CEL-142: hovering a task key shows a card about the task; it stays while the pointer is on it, its links work, Esc closes it, focus opens it, and a click still opens the task", async ({ page, browser }) => {
  const key = uniqueKey("PRV")
  await createProject(page, "Task previews", key)
  const dir = seed(key)

  await caption(page, `${key}-1 asks a question that names ${key}-2: open it on the Review page`)
  await page.goto(`/review?open=${key}-1`)
  const inAsk = page.locator(`[data-review-task="${key}-1"] [data-ask] [data-task-link="${key}-2"]`)
  await expect(inAsk).toBeVisible()
  const card = previewOf(page, `${key}-2`)
  await expect(card).toHaveCount(0)

  await caption(page, `Rest the pointer on ${key}-2: a card about it, without opening it`)
  await inAsk.hover()
  await expect(card).toBeVisible()
  await expect(card.locator("[data-preview-title]")).toHaveText("Import the bookmarks")
  await expect(card.locator("[data-preview-status]")).toHaveText("In Progress")
  await expect(card.getByRole("img", { name: "High" })).toBeVisible()
  await expect(card.locator("[data-card-chips]")).toContainText("Import")
  await expect(card.locator("[data-card-milestone]")).toHaveText("Launch")
  // Who's on it (the agent, where it runs) and its stage.
  await expect(card.locator("[data-preview-work] .agent-mark")).toBeVisible()
  await expect(card.locator("[data-preview-work] [data-stage='building']")).toHaveText("Building")
  // The first lines of the description, rendered; the fourth paragraph is left out.
  const description = card.locator("[data-preview-description]")
  await expect(description.locator("strong")).toHaveText("bookmarks file")
  await expect(description.locator("li")).toHaveCount(2)
  await expect(description).not.toContainText("A fourth paragraph")
  await expect(card.locator("[data-provenance]")).toContainText("created")
  // The page didn't change: no side panel opened.
  await expect(viewerOf(page)).toHaveCount(0)

  await caption(page, `Move into the card: it stays, and ${key}-3 in its description is a link`)
  await card.locator("[data-preview-title]").hover()
  await expect(card).toBeVisible()
  const inCard = description.locator(`[data-task-link="${key}-3"]`)
  await expect(inCard).toHaveAttribute("href", `/${key}/3`)

  await captionWithUrl(page, `Click ${key}-3 in the card: it opens in the side panel, and Review stays`)
  await inCard.click()
  await expect(page).toHaveURL(showsBeside("/review", `${key}-3`))
  await expect(viewerOf(page).getByLabel("Title")).toHaveValue("Export the library")
  await viewerOf(page).getByRole("button", { name: "Close viewer" }).click()
  await expect(viewerOf(page)).toHaveCount(0)

  await caption(page, `Hover ${key}-2 again, then move the pointer away: the card closes on its own`)
  await inAsk.hover()
  await expect(card).toBeVisible()
  await page.mouse.move(5, 5)
  await expect(card).toHaveCount(0)

  await caption(page, `Hover it once more, then press Esc: the card closes, and only the card`)
  await inAsk.hover()
  await expect(card).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(card).toHaveCount(0)
  // The Review page's own Esc (closing the open row) waits while a card is open.
  await expect(inAsk).toBeVisible()

  await caption(page, `With the keyboard: focus ${key}-2 and the card shows too`)
  await inAsk.focus()
  await expect(card).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(card).toHaveCount(0)
  await expect(inAsk).toBeFocused()

  await captionWithUrl(page, `Click ${key}-2: it opens in the side panel, as before`)
  await inAsk.click()
  await expect(page).toHaveURL(showsBeside("/review", `${key}-2`))
  await expect(viewerOf(page).getByLabel("Title")).toHaveValue("Import the bookmarks")
  await caption(page, "A task link previews its task on hover")

  for (const scheme of ["light", "dark"] as const) await still(browser, key, scheme)
  fs.rmSync(dir, { recursive: true, force: true })
})

test("CEL-142: a link to a task of another workspace shows its card too, read from the server", async ({ page, cello: client }) => {
  const key = uniqueKey("PRH")
  const other = uniqueKey("PRO")
  await createProject(page, "Preview home", key)
  const workspace = (await client.run((c) => c["workspace.create"]({ commandId: newCommandId(), name: `Elsewhere ${other}` }))).result
  await client.run((c) => c["project.create"]({ commandId: newCommandId(), workspaceId: workspace.id, name: "Elsewhere", key: other }))
  cello("task", "create", "Sync the reading list", "--project", other, "--description", "Pulls the **reading list** every hour.")
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-taskpreview-"))
  fs.writeFileSync(path.join(dir, "plan.md"), ["# Plan", "", `The sync lives elsewhere: [the reading list](/${other}/1).`].join("\n"))
  cello("doc", "publish", path.join(dir, "plan.md"), "--project", key)

  await captionWithUrl(page, `A doc links ${other}-1, a task in another workspace: hover the link`)
  await page.goto(`/${key}/pages/plan`)
  const link = page.locator("[data-page-reader]").getByRole("link", { name: "the reading list" })
  await expect(link).toHaveAttribute("href", `/${other}/1`)
  await link.hover()
  const card = previewOf(page, `${other}-1`)
  await expect(card.locator("[data-preview-title]")).toHaveText("Sync the reading list")
  await expect(card.locator("[data-preview-status]")).toHaveText("Todo")
  await expect(card.locator("[data-preview-work]")).toHaveText("Nobody on it")
  await expect(card.locator("[data-preview-description] strong")).toHaveText("reading list")
  await caption(page, "Its card, read from the server")
  fs.rmSync(dir, { recursive: true, force: true })
})
