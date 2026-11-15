// CEL-13: an agent publishes a report through the real `cello` CLI (a real screenshot, a table, code
// and a Mermaid diagram); Lucas opens it from the Docs tab, reads it with the section list, and sees it
// update live when the agent republishes. The reader also loads as `?embed=1` in a panel's iframe.
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Browser, Page } from "@playwright/test"
import { caption, createProject, expect, taskPanel, test, uniqueKey } from "./fixtures.ts"

const root = path.resolve(import.meta.dirname, "..")
const SERVER_PORT = Number(process.env.CELLO_E2E_SERVER_PORT ?? 4791)
const WEB_URL = `http://localhost:${process.env.CELLO_WEB_PORT ?? 5199}`
const shots = path.join(import.meta.dirname, "videos")

/** Runs the `cello` CLI from source as a Claude Code session, against the e2e server. */
const cello = (...args: string[]) => {
  const result = spawnSync("bun", [path.join(root, "apps/cli/src/bin.ts"), ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      CELLO_PORT: String(SERVER_PORT),
      CLAUDE_CODE_SESSION_ID: "e2e0pages-agent-session",
      CLAUDE_PID: String(process.pid),
    },
  })
  if (result.status !== 0) throw new Error(`cello ${args.join(" ")} failed: ${result.stderr}`)
  return result.stdout.trim()
}

const report = (findings: string, extra = "") =>
  [
    "# Billing audit",
    "",
    "We checked every invoice since March against Stripe, looking for customers charged twice.",
    "",
    "## Findings",
    "",
    findings,
    "",
    "| Invoice | Amount | Status |",
    "| --- | ---: | --- |",
    "| INV-1042 | $120.00 | Duplicate |",
    "| INV-1043 | $120.00 | Duplicate |",
    "",
    "![The board after the fix](board.png \"The board after the fix\")",
    "",
    "## How it flows",
    "",
    "```mermaid",
    "flowchart TD",
    "  A[Agent runs cello doc publish] --> B[Cello keeps the version]",
    "  B --> C[Lucas reads the page]",
    "```",
    "",
    "### The query",
    "",
    "```sql",
    "SELECT id, amount FROM invoices WHERE charged_twice = 1;",
    "```",
    "",
    "## Next steps",
    "",
    "- Refund the duplicates",
    "- Add a unique index on `(customer_id, period)`",
    extra,
  ].join("\n")

/** The reader in its own unrecorded tall window, saved to e2e/videos/page-reader-<scheme>.png. */
async function screenshotReader(browser: Browser, url: string, colorScheme: "light" | "dark") {
  const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 2300 }, colorScheme })
  const page = await context.newPage()
  await page.goto(url)
  await expect(page.locator("figure[data-mermaid] svg")).toBeVisible()
  await expect(page.getByRole("img", { name: "The board after the fix" })).toHaveJSProperty("complete", true)
  await page.screenshot({ path: path.join(shots, `page-reader-${colorScheme}.png`) })
  await context.close()
}

/** The board with the reader in a 480 px panel on the right, the way a side panel frames it. */
async function openInPanel(page: Page, url: string) {
  await page.evaluate((src) => {
    const frame = document.createElement("iframe")
    frame.src = src
    frame.dataset["panel"] = ""
    frame.title = "Page panel"
    Object.assign(frame.style, {
      // An iframe is a replaced element: top + bottom don't size it, so give it a height.
      position: "fixed", top: "8px", right: "8px", width: "480px", height: "calc(100vh - 16px)", zIndex: "50",
      border: "1px solid rgb(0 0 0 / .12)", borderRadius: "10px", boxShadow: "0 10px 30px rgb(0 0 0 / .2)", background: "white",
    })
    document.body.append(frame)
  }, url)
  return page.frameLocator("iframe[data-panel]")
}

test("CEL-13: an agent publishes a report with an image and a Mermaid diagram through the CLI; Lucas reads it from the Docs tab and sees the republish live", async ({ page, browser }) => {
  const key = uniqueKey("PAGE")
  await createProject(page, "Pages test", key)
  cello("task", "create", "Audit billing", "--project", key)

  await caption(page, "An agent runs `cello doc publish report.md --task` with a screenshot")
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-page-"))
  await page.screenshot({ path: path.join(dir, "board.png") })
  const file = path.join(dir, "report.md")
  fs.writeFileSync(file, report("Two invoices were charged twice in April."))
  const published = cello("doc", "publish", file, "--project", key, "--task", `${key}-1`)
  expect(published).toBe(
    `Published page "Billing audit" (version 1), linked to ${key}-1, with 1 file\nhttp://127.0.0.1:${SERVER_PORT}/${key}/pages/billing-audit`,
  )

  await caption(page, "It shows up in the Docs tab")
  await page.getByRole("link", { name: "Docs", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/docs$`))
  const documents = page.getByRole("list", { name: "Documents" })
  const row = documents.getByRole("link", { name: /Billing audit/ })
  await expect(row).toContainText("We checked every invoice since March")
  await expect(row).toContainText(`${key}-1`)
  await expect(row).toContainText("Claude Code")

  await caption(page, "The kind filter: no specs yet")
  await page.getByRole("radio", { name: "Specs" }).click()
  await expect(page).toHaveURL(/kind=spec/)
  await expect(page.getByText("No specs yet", { exact: true })).toBeVisible()
  await page.getByRole("radio", { name: "All" }).click()
  await expect(row).toBeVisible()

  await caption(page, "Open the page")
  await row.click()
  await expect(page).toHaveURL(new RegExp(`/${key}/pages/billing-audit$`))
  await expect(page.getByRole("heading", { level: 1, name: "Billing audit" })).toBeVisible()
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Docs")

  const sections = page.getByRole("navigation", { name: "Sections" })
  await expect(sections.getByRole("link")).toHaveText(["Findings", "How it flows", "The query", "Next steps"])
  await expect(sections.getByRole("link", { name: "Findings" })).toHaveAttribute("aria-current", "location")

  await caption(page, "Tables, code, the screenshot and the Mermaid diagram render")
  const article = page.getByRole("article")
  await expect(article.locator(".page-table table")).toContainText("INV-1043")
  await expect(article.locator(".page-code code")).toContainText("SELECT id, amount FROM invoices")
  const image = article.getByRole("img", { name: "The board after the fix" })
  await expect(image).toHaveAttribute("src", /^\/attachments\/\w+$/)
  await image.scrollIntoViewIfNeeded()
  await expect(image).toHaveJSProperty("naturalWidth", 1440)
  const diagram = article.locator("figure[data-mermaid]")
  await expect(diagram.locator("svg")).toBeVisible()
  await expect(diagram).toContainText("Lucas reads the page")
  await expect(page.locator(`[data-task-chip="${key}-1"]`)).toContainText("Audit billing")

  await caption(page, "The section list follows the reading position")
  await sections.getByRole("link", { name: "Next steps" }).click()
  await expect(sections.getByRole("link", { name: "Next steps" })).toHaveAttribute("aria-current", "location")
  await expect(page.getByRole("heading", { name: "Next steps" })).toBeInViewport()
  await sections.getByRole("link", { name: "Findings" }).click()
  await expect(sections.getByRole("link", { name: "Findings" })).toHaveAttribute("aria-current", "location")

  await caption(page, "The agent republishes: the page updates in place and the changed sections flash")
  await page.evaluate(() => Object.assign(window, { stillTheSamePage: true }))
  fs.writeFileSync(file, report("Three invoices were charged twice, in April and May.", "\n## Refunds\n\nRefunded both on May 12."))
  expect(cello("doc", "publish", file, "--project", key)).toBe(
    `Updated page "Billing audit" to version 2, linked to ${key}-1, with 1 file\nhttp://127.0.0.1:${SERVER_PORT}/${key}/pages/billing-audit`,
  )
  await expect(article).toContainText("Three invoices were charged twice")
  await expect(article.getByRole("status")).toContainText("Updated to version 2 by Claude Code")
  await expect(article.locator('section[data-section="findings"]')).toHaveAttribute("data-changed", "")
  await expect(article.locator('section[data-section="refunds"]')).toHaveAttribute("data-changed", "")
  await expect(article.locator('section[data-section="how-it-flows"]')).not.toHaveAttribute("data-changed")
  await expect(page.getByRole("heading", { name: "Findings" })).toBeInViewport()
  expect(await page.evaluate(() => (window as { stillTheSamePage?: boolean }).stillTheSamePage)).toBe(true)
  await expect(sections.getByRole("link")).toHaveText(["Findings", "How it flows", "The query", "Next steps", "Refunds"])
  // The flash ends by itself.
  await expect(article.locator('section[data-section="findings"]')).not.toHaveAttribute("data-changed", "", { timeout: 6000 })

  await caption(page, "Version history: read version 1, then back to the latest")
  await page.getByRole("button", { name: "Version history" }).click()
  await expect(page.getByRole("menuitem")).toHaveCount(2)
  await page.getByRole("menuitem", { name: /Version 1/ }).click()
  await expect(page).toHaveURL(/version=1/)
  await expect(page.getByRole("note")).toContainText("You’re reading version 1 of 2")
  await expect(article).toContainText("Two invoices were charged twice in April.")
  await page.getByRole("link", { name: "Read the latest" }).click()
  await expect(article).toContainText("Three invoices were charged twice")
  await expect(page).not.toHaveURL(/version=/)

  await caption(page, "In dark mode too")
  await page.getByRole("button", { name: "Use dark theme" }).click()
  await expect(page.locator("html")).toHaveClass(/dark/)
  await expect(diagram.locator("svg")).toBeVisible()
  await page.getByRole("button", { name: "Use light theme" }).click()

  await caption(page, "Its task chip opens the task, which lists the page")
  await page.getByRole("link", { name: `${key}-1 Audit billing` }).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/1$`))
  const panel = taskPanel(page, `${key}-1`)
  const pages = panel.getByRole("region", { name: "Pages" })
  await expect(pages.getByRole("link", { name: /Billing audit/ })).toContainText("version 2")
  await pages.getByRole("link", { name: /Billing audit/ }).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/pages/billing-audit$`))

  await caption(page, "In a side panel (?embed=1): no app shell, sections fold into a menu")
  await page.goto(`/${key}/issues`)
  const embedded = await openInPanel(page, `/${key}/pages/billing-audit?embed=1`)
  await expect(embedded.getByRole("heading", { level: 1, name: "Billing audit" })).toBeVisible()
  await expect(embedded.getByRole("navigation", { name: "Projects" })).toHaveCount(0)
  await expect(embedded.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0)
  await expect(embedded.getByRole("navigation", { name: "Sections" })).toBeHidden()
  await expect(embedded.getByRole("button", { name: "On this page" })).toContainText("Findings")
  await page.locator("iframe[data-panel]").screenshot({ path: path.join(shots, "page-reader-panel.png") })
  await embedded.getByRole("button", { name: "On this page" }).click()
  await embedded.getByRole("menuitem", { name: "Next steps" }).click()
  await expect(embedded.getByRole("menu")).toBeHidden()
  await expect(embedded.getByRole("heading", { name: "Next steps" })).toBeInViewport()
  await expect(embedded.getByRole("button", { name: "On this page" })).toContainText("Next steps")
  await expect(embedded.locator("figure[data-mermaid] svg")).toBeVisible()

  await caption(page, "")
  for (const colorScheme of ["light", "dark"] as const) await screenshotReader(browser, `/${key}/pages/billing-audit`, colorScheme)
  fs.rmSync(dir, { recursive: true, force: true })
})

// CEL-19: diagrams like a real "how it flows" page has: long labels, a decision with Yes/No edge
// labels, the CEL-24 packet's loop (whose start used to land at the bottom), and one diagram that
// widens its own boxes with an init directive.
const flowPage = (note: string) =>
  [
    "# How a review flows",
    "",
    note,
    "",
    "## The decision",
    "",
    "```mermaid",
    "flowchart TD",
    '  S["An agent submits a review packet with a summary, steps and evidence"] --> D{"Does the packet show it working?"}',
    '  D -->|Yes| A["Approve: the task moves to Done and the claim ends"]',
    '  D -->|No| B["Send back: the note reaches the agent\'s session as a comment"]',
    '  B --> F["The agent fixes it and records new evidence"]',
    "  F --> S",
    "```",
    "",
    "## The sidebar's modes",
    "",
    "```mermaid",
    "flowchart TD",
    '    E["Expanded<br/>drag the edge: 200–400 px, remembered on this device"] -->|"⌘B, or Collapse sidebar"| R["Rail: icons only<br/>Review badge and tooltips stay"]',
    '    R -->|"⌘B, or Expand sidebar"| E',
    '    R -->|"Hide sidebar"| H["Hidden<br/>Show sidebar button top left on every page"]',
    '    H -->|"⌘B, or Show sidebar"| E',
    '    N["Window narrower than 768 px"] -.->|"starts as the rail, not saved as your choice"| R',
    "```",
    "",
    "## Its own width",
    "",
    "```mermaid",
    "%%{init: {'flowchart': {'wrappingWidth': 460}}}%%",
    "flowchart TD",
    '  W["This label is about sixty characters long and fits one line"] --> X["Done"]',
    "```",
  ].join("\n")

const section = (page: Page, id: string) => page.locator(`section[data-section="${id}"]`)

/** Each node of a section's diagram: its label, and its size and top in the SVG's own units. */
const diagramNodes = (page: Page, id: string) =>
  section(page, id)
    .locator("figure[data-mermaid] svg")
    .evaluate((svg) =>
      [...svg.querySelectorAll<SVGGraphicsElement>("g.node")].map((node) => {
        const box = node.getBBox()
        const top = node.transform.baseVal.consolidate()?.matrix.f ?? 0
        return { label: node.textContent ?? "", width: box.width, height: box.height, top: top + box.y }
      }),
    )

/** The background of each edge label in a section's diagram, and of the figure it's drawn on. */
const edgeLabelBackgrounds = (page: Page, id: string) =>
  section(page, id)
    .locator("figure[data-mermaid]")
    .evaluate((figure) => ({
      figure: getComputedStyle(figure).backgroundColor,
      labels: [...figure.querySelectorAll("span.edgeLabel")].filter((l) => l.textContent !== "").map((l) => getComputedStyle(l).backgroundColor),
    }))

test("CEL-19: diagrams wrap long labels wide, keep their own init directive and their start on top, edge labels draw no grey box, and the version label follows a republish", async ({ page, browser }) => {
  const key = uniqueKey("FLOW")
  await createProject(page, "Flows test", key)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-flow-"))
  const file = path.join(dir, "flow.md")
  fs.writeFileSync(file, flowPage("Version one of the page."))
  cello("doc", "publish", file, "--project", key)

  await caption(page, "A page whose diagrams have long labels")
  await page.goto(`/${key}/pages/how-a-review-flows`)
  const article = page.getByRole("article")
  const figures = article.locator("figure[data-mermaid]")
  await expect(figures.locator("svg")).toHaveCount(3)
  // The whole page in a tall window, light and dark, for the review packet.
  for (const colorScheme of ["light", "dark"] as const) {
    const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 2600 }, colorScheme })
    const reader = await context.newPage()
    await reader.goto(`/${key}/pages/how-a-review-flows`)
    await expect(reader.locator("figure[data-mermaid] svg")).toHaveCount(3)
    await reader.screenshot({ path: path.join(shots, `diagrams-${colorScheme}.png`) })
    await context.close()
  }

  await caption(page, "Long labels wrap into wide boxes of two or three lines, not tall narrow ones")
  const decision = await diagramNodes(page, "the-decision")
  const submit = decision.find((n) => n.label.startsWith("An agent submits"))!
  expect(submit.width).toBeGreaterThan(260)
  expect(submit.height).toBeLessThan(90)
  for (const node of decision.filter((n) => !n.label.startsWith("Does"))) expect(node.width, node.label).toBeGreaterThan(240)

  await caption(page, "flowchart TD keeps its start on top, even with loops back to it")
  await section(page, "the-sidebars-modes").scrollIntoViewIfNeeded()
  const modes = await diagramNodes(page, "the-sidebars-modes")
  const expanded = modes.find((n) => n.label.startsWith("Expanded"))!
  expect(Math.min(...modes.map((n) => n.top))).toBe(expanded.top)
  expect(Math.min(...decision.map((n) => n.top))).toBe(submit.top)

  await caption(page, "A diagram's own init directive still counts: wrappingWidth 460 keeps a long label on one line")
  await section(page, "its-own-width").scrollIntoViewIfNeeded()
  const long = (await diagramNodes(page, "its-own-width")).find((n) => n.label.startsWith("This label"))!
  expect(long.width).toBeGreaterThan(400)
  expect(long.height).toBeLessThan(60)

  await caption(page, "Edge labels (Yes, No) sit on the diagram's own background: no grey box")
  await section(page, "the-decision").scrollIntoViewIfNeeded()
  const light = await edgeLabelBackgrounds(page, "the-decision")
  expect(light.labels.length).toBeGreaterThanOrEqual(2)
  for (const label of light.labels) expect(label).toBe(light.figure)

  await caption(page, "In dark mode too")
  await page.getByRole("button", { name: "Use dark theme" }).click()
  await expect(page.locator("html")).toHaveClass(/dark/)
  for (const figure of await figures.all()) await expect(figure).toHaveAttribute("data-theme", "dark")
  const dark = await edgeLabelBackgrounds(page, "the-decision")
  expect(dark.figure).not.toBe(light.figure)
  for (const label of dark.labels) expect(label).toBe(dark.figure)
  await page.getByRole("button", { name: "Use light theme" }).click()
  for (const figure of await figures.all()) await expect(figure).toHaveAttribute("data-theme", "light")
  fs.rmSync(dir, { recursive: true, force: true })
})

test("CEL-19: the version label follows a republish, live, after a reload, and when coming back to the page", async ({ page }) => {
  const key = uniqueKey("VERS")
  await createProject(page, "Versions test", key)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-versions-"))
  const file = path.join(dir, "flow.md")
  fs.writeFileSync(file, flowPage("Version one of the page."))
  cello("doc", "publish", file, "--project", key)

  await caption(page, "The reader shows version 1")
  await page.goto(`/${key}/pages/how-a-review-flows`)
  const article = page.getByRole("article")
  const versions = page.getByRole("button", { name: "Version history" })
  await expect(article).toContainText("Version one of the page.")
  await expect(versions).toHaveText("Version 1")

  await caption(page, "The agent republishes: the version label follows, live")
  fs.writeFileSync(file, flowPage("Version two of the page."))
  cello("doc", "publish", file, "--project", key)
  await expect(article).toContainText("Version two of the page.")
  await expect(versions).toHaveText("Version 2")
  await versions.click()
  await expect(page.getByRole("menuitem")).toHaveCount(2)
  await expect(page.getByRole("menuitem", { name: /Version 2/ })).toContainText("Latest")
  await page.keyboard.press("Escape")

  await caption(page, "After a reload it still says version 2")
  await page.reload()
  await expect(article).toContainText("Version two of the page.")
  await expect(versions).toHaveText("Version 2")

  await caption(page, "Away on the Docs tab while the agent publishes version 3, then back to the page")
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Docs" }).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/docs$`))
  fs.writeFileSync(file, flowPage("Version three of the page."))
  cello("doc", "publish", file, "--project", key)
  const row = page.getByRole("list", { name: "Documents" }).getByRole("link", { name: /How a review flows/ })
  await expect(row).toContainText("Version three of the page.")
  await row.click()
  await expect(article).toContainText("Version three of the page.")
  await expect(versions).toHaveText("Version 3")
  await versions.click()
  await expect(page.getByRole("menuitem")).toHaveCount(3)
  await expect(page.getByRole("menuitem", { name: /Version 3/ })).toContainText("Latest")
  await page.keyboard.press("Escape")
  fs.rmSync(dir, { recursive: true, force: true })
})
