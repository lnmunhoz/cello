// The ⌘K bar (CEL-43): search everything in Cello, and run actions, from anywhere, against a real
// server's FTS5 search (the one `cello search` uses). Peek is the default (a result list and a preview),
// the footer and Settings switch to Palette and the choice is remembered; Peek shows as Palette in a
// narrow window. Enter on a comment lands on it, flashed once. A key jumps; ⌘Enter opens the full
// page; the actions create a task, go to Review, switch project, toggle the sidebar and the theme.
// One test also saves light and dark screenshots of both layouts, for the review packet.
import * as fs from "node:fs"
import * as path from "node:path"
import type { Browser, Page } from "@playwright/test"
import { openClient, type PromiseClient } from "../packages/client/test/support/promiseClient.ts"
import { caption, card, defaultWorkspace, expect, newCommandId, seedLabels, seedProject, taskPanel, test } from "./fixtures.ts"
import { SHOTS, WEB_URL } from "./packets.ts"

const OUT = path.join(SHOTS, "search")

type Seed = { title: string; status?: string; priority?: 0 | 1 | 2 | 3 | 4; labels?: ReadonlyArray<string>; description?: string }

// A board like Lucas's: realistic titles and descriptions, so the screenshots read like the real thing.
const CEL: ReadonlyArray<Seed> = [
  { title: "Board: drag cards between columns", status: "Done", labels: ["ui"] },
  { title: "Task panel beside the board", status: "Done", labels: ["ui"] },
  { title: "cello task claim for agents", status: "Done", labels: ["cli"] },
  { title: "Live updates over the socket", status: "Done", labels: ["server"] },
  { title: "Backups every 24 hours, restore while no server runs", status: "Done", labels: ["server"] },
  { title: "Drag between columns breaks in Safari", status: "Done", priority: 2, labels: ["ui"], description: "Dropping a card in Safari lands it one column to the left when the board is scrolled." },
  {
    title: "cello search over tasks and comments",
    status: "Todo",
    priority: 2,
    labels: ["cli", "server"],
    description: "SQLite FTS5 over titles, descriptions and comments; `cello search` for agents. Shares one search service with the ⌘K bar.",
  },
  {
    title: "Review packets: summary, steps and evidence",
    status: "Done",
    labels: ["server", "ui"],
    description: "An agent hands finished work over with `cello task submit`: a summary, how-to-check steps and evidence (videos, screenshots, links). The task moves to In Review and the packet plays on the Review page.",
  },
  {
    title: "Comments from Lucas reach the agent's session",
    status: "In Progress",
    priority: 1,
    labels: ["cli", "server"],
    description: "When Lucas comments on a task an agent claimed, the comment reaches that agent's session: Claude Code hooks deliver it after the next tool call and when the agent stops. Each comment arrives once.\n\nEvidence: a review-mode video of the hook delivering a comment.",
  },
  {
    title: "Evidence videos recorded in review mode",
    status: "Done",
    labels: ["ui"],
    description: "CELLO_E2E_REVIEW=1 slows every browser action and holds each step, so the evidence video in a review packet can be followed. Captions say what each step shows.",
  },
  { title: "Review page uses the full width", status: "In Progress", priority: 3, labels: ["ui"], description: "From 1152 px the packet splits in two: summary and steps on the left, evidence on the right. Needs CEL-9 first, so a send-back note reaches the agent." },
  { title: "Desktop app: trackpad swipe goes back", status: "Todo", labels: ["ui"], description: "A two-finger swipe goes back and forward in the board, or in the panel's page when it has focus." },
  { title: "⌘K: search everything in Cello", status: "In Progress", priority: 2, labels: ["ui"], description: "A command bar from anywhere: tasks, comments, review packets, pages and docs, projects and labels, grouped by kind with the matching words highlighted." },
]

const THAI: ReadonlyArray<Seed> = [
  { title: "Pricing page in baht", status: "Done", labels: ["ui"] },
  { title: "Baht prices in Checkout", status: "Todo", priority: 2, labels: ["server"], description: "Checkout shows baht for Thai cards; evidence from Stripe test mode." },
  { title: "Word lookup from the share sheet", status: "In Progress", labels: ["ui"] },
]

const DOCS = [
  { slug: "evidence-videos", kind: "doc", body: "---\ntitle: How evidence videos and screenshots are made\nsummary: Every video in a review packet comes from a real test run against a real Cello server, recorded by Playwright and converted with ffmpeg.\n---\n\n# How evidence videos are made\n\nRecord in review mode, then attach the MP4 with cello task submit." },
  { slug: "search-index", kind: "spec", body: "---\ntitle: Search, one FTS5 index for the bar and the CLI\nsummary: SQLite FTS5 over tasks, comments, review packets and documents, kept current in the same transaction as each change.\n---\n\n# Search\n\nPorter stemming and prefix terms." },
] as const

/** Comments on CEL-9 (the long thread), the last one about evidence, which the comment test opens. */
const THREAD = [
  "Started: the Stop hook reads the inbox and prints new comments as context.",
  "The PostToolUse hook runs after every tool call; parallel calls race for the same comment.",
  "Fixed the race: taking a comment marks it read in one statement.",
  "Subagents share the parent's session id, so the hook skips tool calls made inside one.",
  "`cello inbox` hands comments over without hooks; `cello context` only lists them.",
  "Recorded the terminal session for the packet.",
  "Lucas: the send-back note should arrive the same way as a comment.",
  "Send-back notes now go through the inbox too, marked as sent back.",
  "Docs updated: Comments from Lucas reach your session.",
]
const TARGET = "The evidence video stops before the inbox shows the comment. Can you record it again in review mode so the last step is held?"

/** Seeds the board once per run: a test retried in a new worker finds it there. */
async function seed(human: PromiseClient, baseURL: string) {
  const { statuses } = await defaultWorkspace(human)
  if ((await human.run((c) => c["snapshot.get"]({}))).projects.some((p) => p.key === "CEL")) return
  const labels = Object.fromEntries((await seedLabels(human, [
    { name: "ui", color: "#5E6AD2" },
    { name: "server", color: "#26B5CE" },
    { name: "cli", color: "#4CB782" },
  ])).map((l) => [l.name, l.id]))
  const agent = await openClient(`${baseURL.replace(/^http/, "ws")}/rpc`, { "x-cello-session": "e2e-search-agent", "x-cello-client": "Claude Code" })
  for (const [key, name, tasks] of [["CEL", "Cello", CEL], ["THAI", "ThaiLookup", THAI]] as const) {
    const project = await seedProject(human, name, key)
    for (const t of tasks) {
      await human.run((c) => c["task.create"]({
        commandId: newCommandId(),
        projectId: project.id,
        title: t.title,
        description: t.description ?? "",
        statusId: statuses[t.status ?? "Todo"]!.id,
        priority: t.priority ?? 0,
        labelIds: (t.labels ?? []).map((l) => labels[l]!),
      }))
    }
  }
  for (const doc of DOCS) {
    await agent.run((c) => c["document.publish"]({ commandId: newCommandId(), project: { key: "CEL" }, body: doc.body, kind: doc.kind, slug: doc.slug }))
  }
  // The long thread on CEL-9, agent and Lucas taking turns, then Lucas's comment about the evidence video.
  const cel9 = (await human.run((c) => c["task.get"]({ key: "CEL-9" }))).task
  for (const [i, body] of THREAD.entries()) {
    await (i % 3 === 2 ? human : agent).run((c) => c["comment.add"]({ commandId: newCommandId(), taskId: cel9.id, body }))
  }
  await human.run((c) => c["comment.add"]({ commandId: newCommandId(), taskId: cel9.id, body: TARGET }))
  await agent.run((c) => c["comment.add"]({ commandId: newCommandId(), taskId: cel9.id, body: "Re-recorded with CELLO_E2E_REVIEW=1: the video now holds on the delivered comment." }))
  // A packet waiting on the Review page (CEL-12), and one approved (CEL-8).
  for (const [key, summary] of [["CEL-12", "Two-finger swipes go back and forward; evidence: a video of the board and the panel."], ["CEL-8", "Review packets with evidence: videos, screenshots and links play on the Review page."]] as const) {
    await agent.run((c) => c["task.claim"]({ commandId: newCommandId(), key }))
    await agent.run((c) => c["review.submit"]({ commandId: newCommandId(), key, summary, steps: ["Open it", "Watch the evidence video"], files: [], links: [{ url: "https://github.com/lnmunhoz/cello/pull/1", caption: "The PR" }] }))
  }
  await human.run((c) => c["review.approve"]({ commandId: newCommandId(), key: "CEL-8" }))
  await agent.close()
}

const bar = (page: Page) => page.getByRole("dialog", { name: "Search Cello" })
const field = (page: Page) => bar(page).getByRole("combobox", { name: "Search Cello" })
const option = (page: Page, name: string | RegExp) => bar(page).getByRole("option", { name })
const preview = (page: Page) => bar(page).locator("[data-search-preview]")

/** Presses ↓ until `row` is highlighted. */
async function highlight(page: Page, row: ReturnType<Page["locator"]>) {
  for (let i = 0; i < 40 && (await row.getAttribute("data-highlighted")) === null; i++) await page.keyboard.press("ArrowDown")
  await expect(row).toHaveAttribute("data-highlighted", /.*/)
}

async function openBar(page: Page) {
  await page.keyboard.press("ControlOrMeta+k")
  await expect(bar(page)).toBeVisible()
  await expect(field(page)).toBeFocused()
}

async function boardOf(page: Page, key: string) {
  await page.goto(`/${key}/issues`)
  await expect(card(page, `${key}-1`)).toBeVisible()
}

/** Each test starts on Peek, the default, whatever an earlier test picked. */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-search-reset")) {
      localStorage.removeItem("cello:search-layout")
      localStorage.removeItem("cello:search-recent")
      sessionStorage.setItem("e2e-search-reset", "1")
    }
  })
})

test("⌘K: Peek lists results by kind with the words highlighted, previews the highlighted one, Tab narrows, Enter opens", async ({ cello, page, baseURL }) => {
  await seed(cello, baseURL!)
  await boardOf(page, "CEL")
  await caption(page, "⌘K opens the bar from the board: Peek, the default, with recent tasks and the actions")
  await openBar(page)
  await expect(bar(page)).toHaveAttribute("data-layout", "peek")
  await expect(bar(page).getByText("Recent")).toBeVisible()
  await expect(option(page, /Go to Review/)).toBeVisible()

  await caption(page, "Type “evidence”: tasks, comments, review packets and docs, best match first, the word highlighted")
  await field(page).pressSequentially("evidence", { delay: 60 })
  for (const section of ["task", "comment", "packet", "document"]) await expect(bar(page).locator(`[data-section="${section}"]`)).toBeVisible()
  const firstTask = bar(page).locator('[data-section="task"] [role="option"]').first()
  await expect(firstTask.locator("mark").first()).toHaveText(/^evidence$/i)
  // The preview shows the first result before any arrow key.
  await expect(preview(page).locator('[data-preview="task"] h3')).toHaveText(/evidence/i)

  await caption(page, "↓ moves; the preview follows: a comment, whole, in its card")
  await highlight(page, bar(page).locator('[data-section="comment"] [role="option"]').first())
  await expect(preview(page).locator('[data-preview="comment"]')).toContainText("Can you record it again in review mode")
  await expect(preview(page).locator("mark").first()).toHaveText("evidence")

  await caption(page, "Tab narrows to one kind: Comments, then Packets")
  await page.keyboard.press("Tab")
  await expect(bar(page).getByRole("tab", { name: /Tasks/, selected: true })).toBeVisible()
  await page.keyboard.press("Tab")
  await expect(bar(page).getByRole("tab", { name: /Comments/, selected: true })).toBeVisible()
  await expect(bar(page).locator('[data-section="task"]')).toHaveCount(0)
  await page.keyboard.press("Tab")
  await expect(bar(page).getByRole("tab", { name: /Packets/, selected: true })).toBeVisible()
  await expect(preview(page).locator('[data-preview="packet"]')).toContainText(/Waiting for review|Approved/)

  await caption(page, "Esc closes it, even with text typed; ⌘K again, “safari”, Enter: the task opens in the panel")
  await page.keyboard.press("Escape")
  await expect(bar(page)).toBeHidden()
  await openBar(page)
  await expect(field(page)).toHaveValue("")
  await field(page).pressSequentially("safari", { delay: 60 })
  await expect(option(page, /Drag between columns breaks in Safari/)).toBeVisible()
  await page.keyboard.press("Enter")
  await expect(bar(page)).toBeHidden()
  await expect(page).toHaveURL(/\/CEL\/6$/)
  await expect(taskPanel(page, "CEL-6")).toBeVisible()
})

test("⌘K: Enter on a comment opens its task scrolled to that comment, which flashes once", async ({ cello, page, baseURL }) => {
  await seed(cello, baseURL!)
  await page.setViewportSize({ width: 1280, height: 640 })
  await boardOf(page, "THAI")
  await caption(page, "From another project: ⌘K, “record it again”")
  await openBar(page)
  await field(page).pressSequentially("record it again", { delay: 60 })
  const comment = bar(page).locator('[data-section="comment"] [role="option"]').first()
  await expect(comment).toContainText("Can you record it again")
  await caption(page, "Enter on the comment: CEL-9 opens, scrolled down to it, which flashes once")
  await highlight(page, comment)
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/\/CEL\/9\?comment=/)
  const target = taskPanel(page, "CEL-9").locator("li[data-target]")
  await expect(target).toContainText(TARGET)
  await expect(target).toBeInViewport()
  await expect(target).toHaveClass(/comment-flash/)
  // One run of the flash, not a loop.
  expect(await target.evaluate((el) => getComputedStyle(el).animationIterationCount)).toBe("1")
  // The first comment of the thread is scrolled away above it.
  await expect(taskPanel(page, "CEL-9").locator("li[data-comment-id]").first()).not.toBeInViewport()
})

test("⌘K: a key jumps to the task; ⌘Enter opens it as a full page; the key's mentions are listed", async ({ cello, page, baseURL }) => {
  await seed(cello, baseURL!)
  await boardOf(page, "CEL")
  await caption(page, "Type CEL-9: a Go to row on top, then what mentions it")
  await openBar(page)
  await field(page).pressSequentially("CEL-9", { delay: 60 })
  await expect(option(page, /Comments from Lucas reach the agent's session/).first()).toBeVisible()
  await expect(bar(page).getByText("Jump")).toBeVisible()
  await expect(bar(page).locator('[data-section="mentions"]')).toContainText("Review page uses the full width")
  await caption(page, "⌘Enter opens it as a full page")
  await page.keyboard.press("ControlOrMeta+Enter")
  await expect(page).toHaveURL(/\/CEL\/9\?view=full$/)
})

test("⌘K: the footer switches to Palette, remembered after a reload; Settings shows and changes it; a narrow window shows Palette", async ({ cello, page, baseURL }) => {
  await seed(cello, baseURL!)
  await boardOf(page, "CEL")
  await openBar(page)
  await caption(page, "The footer's toggle: Palette, one line per result, centred")
  await bar(page).getByRole("radio", { name: "Palette" }).click()
  await expect(bar(page)).toHaveAttribute("data-layout", "palette")
  await field(page).fill("evidence")
  // Other specs share the server, so their tasks can match too: look for this spec's own.
  await expect(bar(page).locator('[data-section="task"] [role="option"]').filter({ hasText: "Evidence" }).first()).toBeVisible()
  await expect(preview(page)).toHaveCount(0)

  await caption(page, "Reload: ⌘K opens as Palette again")
  await page.reload()
  await expect(card(page, "CEL-1")).toBeVisible()
  await openBar(page)
  await expect(bar(page)).toHaveAttribute("data-layout", "palette")
  await page.keyboard.press("Escape")
  await expect(bar(page)).toBeHidden()

  await caption(page, "Settings → Search shows the choice, and switches back to Peek")
  await page.getByRole("link", { name: "Settings" }).click()
  const setting = page.getByRole("radiogroup", { name: "Search layout" })
  await expect(setting.getByRole("radio", { name: "Palette" })).toBeChecked()
  await setting.getByRole("radio", { name: "Peek" }).click()
  await openBar(page)
  await expect(bar(page)).toHaveAttribute("data-layout", "peek")
  await page.keyboard.press("Escape")
  await expect(bar(page)).toBeHidden()

  await caption(page, "In a narrow window Peek shows as Palette: no room for the preview")
  await page.setViewportSize({ width: 820, height: 760 })
  await openBar(page)
  await expect(bar(page)).toHaveAttribute("data-layout", "palette")
  await expect(bar(page).getByRole("radio", { name: "Peek" })).toBeChecked()
})

test("⌘K actions: create a task from what's typed, go to Review, switch project, toggle the sidebar, switch the theme", async ({ cello, page, baseURL }) => {
  await seed(cello, baseURL!)
  await boardOf(page, "CEL")

  await caption(page, "Type a title, pick “Create task …”: it's created in Cello and opens")
  await openBar(page)
  await field(page).pressSequentially("Zoom levels in the panel", { delay: 40 })
  await option(page, /Create task “Zoom levels in the panel” in Cello/).click()
  await expect(bar(page)).toBeHidden()
  await expect(page).toHaveURL(/\/CEL\/\d+$/)
  const created = page.url().split("/").at(-1)!
  await expect(taskPanel(page, `CEL-${created}`).getByLabel("Title")).toHaveValue("Zoom levels in the panel")

  await caption(page, "> shows only actions: Go to Review, with how many packets wait")
  await openBar(page)
  await field(page).pressSequentially(">review", { delay: 60 })
  await expect(option(page, /Go to Review/)).toContainText(/\d+ waiting/)
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/\/review/)

  await caption(page, "Switch project…: pick ThaiLookup")
  await openBar(page)
  await field(page).pressSequentially(">switch", { delay: 60 })
  await option(page, /Switch project/).click()
  await expect(bar(page)).toBeVisible()
  await field(page).pressSequentially("thai", { delay: 60 })
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/\/THAI\/issues$/)

  await caption(page, "Toggle sidebar: it collapses to the rail")
  await expect(page.locator('[data-sidebar="expanded"]')).toBeVisible()
  await openBar(page)
  await field(page).pressSequentially(">sidebar", { delay: 60 })
  await page.keyboard.press("Enter")
  await expect(page.locator('[data-sidebar="rail"]')).toBeVisible()

  await caption(page, "Switch to dark theme: the app and the sidebar's theme button follow")
  const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"))
  await openBar(page)
  await field(page).pressSequentially(">theme", { delay: 60 })
  await page.keyboard.press("Enter")
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(!dark)
  await expect(page.getByRole("button", { name: dark ? "Use dark theme" : "Use light theme" })).toBeVisible()
})

async function shots(browser: Browser, layout: "peek" | "palette", scheme: "light" | "dark") {
  const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme, reducedMotion: "reduce" })
  await context.addInitScript((l) => localStorage.setItem("cello:search-layout", l), layout)
  const page = await context.newPage()
  const name = (state: string) => path.join(OUT, `${layout}-${state}-${scheme}.png`)
  await boardOf(page, "CEL")
  await openBar(page)
  await page.screenshot({ path: name("1-empty") })
  await field(page).fill("evidence")
  await expect(bar(page).locator('[data-section="comment"]')).toBeVisible()
  if (layout === "peek") await page.keyboard.press("ArrowDown")
  await page.screenshot({ path: name("2-word") })
  await field(page).fill("CEL-9")
  await expect(bar(page).getByText("Jump")).toBeVisible()
  await page.screenshot({ path: name("3-key") })
  await field(page).fill(">")
  await expect(option(page, /Go to Review/)).toBeVisible()
  await page.screenshot({ path: name("4-actions") })
  await context.close()
}

test("⌘K: screenshots of both layouts, light and dark", async ({ cello, browser, baseURL }) => {
  await seed(cello, baseURL!)
  fs.mkdirSync(OUT, { recursive: true })
  for (const layout of ["peek", "palette"] as const) {
    for (const scheme of ["light", "dark"] as const) await shots(browser, layout, scheme)
  }
})
