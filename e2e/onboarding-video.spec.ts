// CEL-94: the board footage for the onboarding video, one test per scene, so each scene is its own
// MP4. A demo project, Acme Shop (ACME), worked on by Claude Code sessions that act through the real
// RPC API and the real `cello` CLI (claims, stages, asks, comments, packets): what the videos show is
// the app reacting to real writes. 1920×1080, light theme, cursor and ripples but no captions (the
// narration explains it); the captions still hold each beat in review mode. Record it with
// `CELLO_E2E_REVIEW=1 bun run test:e2e -- e2e/onboarding-video.spec.ts`; the MP4s are copied to
// art/setup-video/footage/. The scenes follow the script (`cello doc get setup-video-script-for-review-cel-94`)
// and share one project, each taking only what it needs, so any one of them can run alone.
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Browser, Locator, Page } from "@playwright/test"
import { newCommandId, openClient, type PromiseClient } from "../packages/client/test/support/promiseClient.ts"
import { agentAs, caption, card, column, defaultWorkspace, expect, hold, seedLabels, taskPanel, test } from "./fixtures.ts"
import { celloAs, celloInBackground, WEB_URL } from "./packets.ts"

const SIZE = { width: 1920, height: 1080 }
test.use({ viewport: SIZE, video: { mode: "on", size: SIZE }, colorScheme: "light", captions: false })
// Every beat holds in review mode, so a scene runs past the default timeout there.
test.describe.configure({ timeout: 300_000 })

const KEY = "ACME"

/** Claude Code sessions, by what they work on. Their short ids are what the board shows. */
const SESSIONS = {
  cart: "b71d03a8-5c2e-4f1a-9d3b-2e6f8a1c4d57",
  speed: "e9c45f27-81d3-4b6a-a2c4-7f19d0e3b862",
  email: "1a8e6d3b-f40c-4e27-8b51-c3a9e2d76f04",
  applePay: "4f2a9c1e-6b7d-4c3e-95a8-d1e0f2b3c4a6",
} as const

const TITLES = {
  applePay: "Add Apple Pay to checkout",
  cart: "Fix cart total rounding",
  speed: "Product page loads slowly",
  email: "Order confirmation email",
  sku: "Search by SKU",
} as const

/** The board before any scene: a few shipped features, a backlog, and three tasks agents are on. */
const SEED: ReadonlyArray<{
  title: string
  status: string
  labels: ReadonlyArray<string>
  description?: string
  agent?: keyof typeof SESSIONS
  stage?: string
}> = [
  { title: "Guest checkout", status: "Done", labels: ["checkout"] },
  { title: "Discount codes at checkout", status: "Done", labels: ["checkout"] },
  { title: "Shipping rates by region", status: "Done", labels: ["checkout"] },
  { title: "Product reviews", status: "Done", labels: ["catalog"] },
  { title: "Size and colour options", status: "Done", labels: ["catalog"] },
  { title: "Order history page", status: "Done", labels: ["checkout"] },
  { title: "Wishlist sharing", status: "Backlog", labels: ["catalog"] },
  { title: "Loyalty points", status: "Backlog", labels: ["checkout"] },
  { title: TITLES.sku, status: "Todo", labels: ["search"] },
  { title: "Low-stock alerts", status: "Todo", labels: ["catalog"] },
  { title: "Saved addresses", status: "Todo", labels: ["checkout"] },
  {
    title: TITLES.cart,
    status: "Todo",
    labels: ["bug", "checkout"],
    description: "Three mugs at $19.99 show a total of $59.96 in the cart. It should be $59.97.",
    agent: "cart",
    stage: "building",
  },
  {
    title: TITLES.speed,
    status: "Todo",
    labels: ["performance"],
    description: "Product pages take over 4 seconds to show on a phone. Most of it is the photo gallery.",
    agent: "speed",
    stage: "review",
  },
  {
    title: TITLES.email,
    status: "Todo",
    labels: ["email"],
    description: "The order confirmation email is plain text. Make it look like the shop, with a summary of the order.",
    agent: "email",
    stage: "fixing",
  },
]

const LABELS = [
  { name: "checkout", color: "#6366F1" },
  { name: "catalog", color: "#10B981" },
  { name: "search", color: "#0EA5E9" },
  { name: "bug", color: "#EF4444" },
  { name: "performance", color: "#F59E0B" },
  { name: "email", color: "#EC4899" },
]

/** A session over RPC, as the CLI calls; its process is this test worker, alive for the whole run. */
const agent = (name: keyof typeof SESSIONS) => agentAs(WEB_URL, SESSIONS[name], process.pid)

/** The `cello` CLI from source, as session `name`. */
const cli = (name: keyof typeof SESSIONS) => celloAs(SESSIONS[name])

/** Acme Shop and its seed board, made once for the whole run (the scenes share the server). */
async function seedAcme(human: PromiseClient) {
  const snapshot = await human.run((c) => c["snapshot.get"]({}))
  if (snapshot.projects.some((p) => p.key === KEY)) return
  const { workspaceId, statuses } = await defaultWorkspace(human)
  const project = (await human.run((c) => c["project.create"]({ commandId: newCommandId(), workspaceId, name: "Acme Shop", key: KEY }))).result
  const labels = new Map((await seedLabels(human, project.id, LABELS)).map((l) => [l.name, l.id]))
  for (const [i, task] of SEED.entries()) {
    await human.run((c) =>
      c["task.create"]({
        commandId: newCommandId(),
        projectId: project.id,
        title: task.title,
        statusId: statuses[task.status]!.id,
        labelIds: task.labels.map((l) => labels.get(l)!),
        ...(task.description ? { description: task.description } : {}),
      }))
    if (!task.agent) continue
    const session = await agent(task.agent)
    await session.run((c) => c["task.claim"]({ commandId: newCommandId(), key: `${KEY}-${i + 1}` }))
    await session.run((c) => c["task.stage"]({ commandId: newCommandId(), key: `${KEY}-${i + 1}`, stage: task.stage as "building" }))
    await session.close()
  }
}

/** Backlog shown fills the board's width; hidden, it makes room for the Needs input column. */
async function showBacklog(human: PromiseClient, shown: boolean) {
  const { statuses } = await defaultWorkspace(human)
  await human.run((c) => c["status.update"]({ commandId: newCommandId(), id: statuses.Backlog!.id, hidden: !shown }))
}

/** A task's key, by its title. */
async function keyOf(human: PromiseClient, title: string) {
  const snapshot = await human.run((c) => c["snapshot.get"]({}))
  const project = snapshot.projects.find((p) => p.key === KEY)!
  const task = snapshot.tasks.find((t) => t.projectId === project.id && t.title === title)
  if (!task) throw new Error(`no task "${title}" in ${KEY}`)
  return `${KEY}-${task.number}`
}

/** The cart page the "Fix cart total rounding" agent recorded as its evidence: three mugs, totalled right. */
const CART_PAGE = `<!doctype html><html><head><style>
  body { margin: 0; font: 16px/1.4 Inter, system-ui, sans-serif; background: #f6f5f2; color: #1d1d1f; }
  header { display: flex; align-items: center; gap: 10px; padding: 18px 32px; background: white; border-bottom: 1px solid #e7e5e0; font-weight: 700; font-size: 20px; }
  header i { width: 26px; height: 26px; border-radius: 7px; background: #ff7a2f; display: inline-block; }
  main { padding: 28px 32px; display: grid; grid-template-columns: 1fr 300px; gap: 24px; }
  .item, .sum { background: white; border-radius: 12px; padding: 20px; box-shadow: 0 1px 2px rgb(0 0 0 / .06); }
  .item { display: flex; align-items: center; gap: 16px; }
  .thumb { width: 72px; height: 72px; border-radius: 10px; background: linear-gradient(135deg, #f3d9c4, #e9a77d); }
  .qty { display: flex; align-items: center; gap: 10px; margin-left: auto; }
  button { width: 34px; height: 34px; border-radius: 8px; border: 1px solid #d9d6cf; background: white; font-size: 18px; }
  .row { display: flex; justify-content: space-between; margin: 8px 0; }
  .total { font-weight: 700; font-size: 22px; border-top: 1px solid #eee; padding-top: 12px; }
  h2 { margin: 0 0 6px; font-size: 18px; } small { color: #77736b; }
</style></head><body>
  <header><i></i>Acme Shop</header>
  <main>
    <div class="item"><div class="thumb"></div><div><h2>Ceramic mug</h2><small>$19.99 each</small></div>
      <div class="qty"><button id="minus">−</button><b id="qty">1</b><button id="plus">+</button></div></div>
    <div class="sum"><h2>Order summary</h2>
      <div class="row"><span>Subtotal</span><span id="sub">$19.99</span></div>
      <div class="row"><span>Shipping</span><span>Free</span></div>
      <div class="row total"><span>Total</span><span id="total">$19.99</span></div></div>
  </main>
  <script>
    let qty = 1
    const show = () => {
      const cents = qty * 1999
      const text = "$" + (cents / 100).toFixed(2)
      document.getElementById("qty").textContent = qty
      document.getElementById("sub").textContent = text
      document.getElementById("total").textContent = text
    }
    document.getElementById("plus").onclick = () => { qty++; show() }
    document.getElementById("minus").onclick = () => { qty = Math.max(1, qty - 1); show() }
  </script>
</body></html>`

/** The confirmation email the "Order confirmation email" agent screenshotted for its packet. */
const EMAIL_PAGE = `<!doctype html><html><head><style>
  body { margin: 0; background: #eef0f3; font: 15px/1.5 Inter, system-ui, sans-serif; color: #1d1d1f; }
  .mail { width: 560px; margin: 32px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgb(0 0 0 / .08); }
  .top { display: flex; align-items: center; gap: 10px; padding: 20px 28px; background: #1d1d1f; color: white; font-weight: 700; font-size: 18px; }
  .top i { width: 24px; height: 24px; border-radius: 6px; background: #ff7a2f; display: inline-block; }
  .body { padding: 24px 28px; } h1 { font-size: 22px; margin: 0 0 8px; }
  .line { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
  .total { font-weight: 700; border: 0; }
  .cta { display: inline-block; margin-top: 18px; padding: 10px 18px; border-radius: 8px; background: #ff7a2f; color: white; font-weight: 600; }
</style></head><body><div class="mail">
  <div class="top"><i></i>Acme Shop</div>
  <div class="body"><h1>Thanks, your order is on its way</h1><p>Order #10482 · arriving Thursday</p>
    <div class="line"><span>Ceramic mug × 3</span><span>$59.97</span></div>
    <div class="line"><span>Shipping</span><span>Free</span></div>
    <div class="line total"><span>Total</span><span>$59.97</span></div>
    <span class="cta">Track your order</span></div>
</div></body></html>`

/**
 * The evidence the agents hand in: a short video of the cart going from one mug to three (each state a
 * still of the real page, joined by ffmpeg into a WebM, which Chromium plays) and a screenshot of the email.
 */
async function makeEvidence(browser: Browser, dir: string) {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } })
  const page = await context.newPage()
  await page.setContent(CART_PAGE)
  const frames: string[] = []
  for (const qty of [1, 2, 3]) {
    if (qty > 1) await page.click("#plus")
    await expect(page.locator("#qty")).toHaveText(String(qty))
    frames.push(path.join(dir, `cart-${qty}.png`))
    await page.screenshot({ path: frames.at(-1)! })
  }
  await expect(page.locator("#total")).toHaveText("$59.97")
  await page.setViewportSize({ width: 760, height: 520 })
  await page.setContent(EMAIL_PAGE)
  const email = path.join(dir, "confirmation-email.png")
  await page.screenshot({ path: email })
  await context.close()
  // 1.5 s per state, the last held 2 s longer.
  const list = path.join(dir, "frames.txt")
  fs.writeFileSync(list, [...frames.map((f, i) => `file '${f}'\nduration ${i === frames.length - 1 ? 3.5 : 1.5}`), `file '${frames.at(-1)}'`].join("\n"))
  const cart = path.join(dir, "cart-total.webm")
  const ffmpeg = spawnSync("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-vf", "fps=25,format=yuv420p",
    "-c:v", "libvpx-vp9", "-deadline", "realtime", "-b:v", "0", "-crf", "32", cart,
  ])
  if (ffmpeg.status !== 0) throw new Error(`ffmpeg failed: ${ffmpeg.stderr}`)
  return { cart, email }
}

let human: PromiseClient
let evidence: { readonly cart: string; readonly email: string }
const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-onboarding-"))

// Made before any scene's page opens, so no video starts on a long blank page while it's made.
test.beforeAll(async ({ browser }) => {
  human = await openClient(`${WEB_URL.replace(/^http/, "ws")}/rpc`)
  await seedAcme(human)
  evidence = await makeEvidence(browser, evidenceDir)
})

test.afterAll(async () => {
  await human.close()
  fs.rmSync(evidenceDir, { recursive: true, force: true })
})

test.beforeEach(async ({ context }) => {
  // The filter panel folded to its rail, so the board has the room.
  await context.addInitScript(() => localStorage.setItem("cello:filter-panel", "rail"))
})

/** The Acme Shop board, drawn, with the three seed tasks in In Progress; Backlog shown unless the scene needs the room. */
async function openBoard(page: Page, { backlog = true }: { readonly backlog?: boolean } = {}) {
  await showBacklog(human, backlog)
  await page.goto(`/${KEY}/issues`)
  await expect(column(page, "In Progress").locator("[data-task-key]").first()).toBeVisible()
}

const comments = (page: Page, key: string) => taskPanel(page, key).getByRole("region", { name: "Comments" })
const receipt = (thread: Locator, n: number) => thread.locator("[data-comment-id]").nth(n).locator("[data-receipt]")

test("② The board: three tasks in progress, each with its agent at work", async ({ page }) => {
  await openBoard(page)
  const progress = column(page, "In Progress")
  for (const title of [TITLES.cart, TITLES.speed, TITLES.email]) {
    const taskCard = progress.locator("[data-task-key]").filter({ hasText: title })
    await expect(taskCard.locator('[data-presence="active"]')).toBeVisible()
  }
  await hold(page)
  // Each agent checks in as it works: its card flashes once in its colour.
  for (const name of ["cart", "speed", "email"] as const) {
    const session = await agent(name)
    await session.run((c) => c["whoami"]({ project: {} }))
    await session.close()
    await hold(page)
  }
})

test("④ Watch the work: an agent makes a card, claims it, and moves it through the stages; the panel says who did what", async ({ page }) => {
  await openBoard(page)
  await hold(page)

  const session = await agent("applePay")
  const { statuses } = await defaultWorkspace(human)
  const snapshot = await human.run((c) => c["snapshot.get"]({}))
  const projectId = snapshot.projects.find((p) => p.key === KEY)!.id
  const checkout = snapshot.labels.find((l) => l.projectId === projectId && l.name === "checkout")!
  const created = (await session.run((c) =>
    c["task.create"]({
      commandId: newCommandId(),
      projectId,
      title: TITLES.applePay,
      description: "Customers on iPhone asked to pay with Apple Pay. Add it as a payment option at checkout.",
      statusId: statuses.Todo!.id,
      labelIds: [checkout.id],
    }))).result
  const key = `${KEY}-${created.number}`
  await expect(column(page, "Todo").locator(`[data-task-key="${key}"]`)).toBeVisible()
  await caption(page, "An agent makes a card")

  await session.run((c) => c["task.claim"]({ commandId: newCommandId(), key }))
  const taskCard = column(page, "In Progress").locator(`[data-task-key="${key}"]`)
  await expect(taskCard.locator("[data-card-work]")).toContainText("4f2a9c1e active now")
  await caption(page, "It claims it: In Progress, active now")

  for (const [stage, label] of [["building", "Building"], ["review", "Agent review"], ["fixing", "Fixing findings"]] as const) {
    await session.run((c) => c["task.stage"]({ commandId: newCommandId(), key, stage }))
    await expect(taskCard.locator(`[data-stage="${stage}"]`)).toHaveText(label)
    await hold(page)
  }

  await taskCard.click()
  const panel = taskPanel(page, key)
  await expect(panel.locator("[data-created-by]")).toContainText("Claude Code session 4f2a9c1e")
  await expect(panel.locator("[data-working-on-it]")).toContainText("Claude Code session 4f2a9c1e active now")
  await caption(page, "Who made it, who's on it")
  const history = panel.locator('section[aria-labelledby="history-heading"]')
  await history.scrollIntoViewIfNeeded()
  await expect(history).toContainText("set the stage to Fixing findings")
  await hold(page)
  await session.close()
})

test("⑤ Decisions and comments: an agent asks on the card and gets the answer; a comment reaches the agent and it answers", async ({ page, context }) => {
  // Display → Needs input column, so the waiting card has its own column.
  await context.addInitScript(() => localStorage.setItem("cello:needs-input-column", "on"))
  const speed = await keyOf(human, TITLES.speed)
  const email = await keyOf(human, TITLES.email)
  await openBoard(page, { backlog: false })
  await hold(page)

  const asking = celloInBackground(SESSIONS.speed)(
    "task", "ask", speed,
    "--title", "Product page speed",
    "--question", "Which fix should go first?",
    "--option", "Lazy-load the gallery images|Only the first photo loads up front",
    "--recommend", "Lazy-load the gallery images",
    "--because", "Cuts the first load from 4.1 s to 1.6 s, with no new service to run",
    "--option", "Serve images from a CDN|Needs an account and DNS changes",
    "--wait",
  )
  await expect(column(page, "Needs input").locator(`[data-task-key="${speed}"]`)).toBeVisible()
  await caption(page, "An agent needs a decision: the card moves to Needs input")

  await card(page, speed).click()
  const pinned = taskPanel(page, speed).getByRole("region", { name: "Needs your input" })
  await expect(pinned.locator("[data-recommended]")).toHaveText("Recommended")
  await expect(pinned.getByText("Cuts the first load from 4.1 s to 1.6 s")).toBeVisible()
  await pinned.getByText("Cuts the first load from 4.1 s to 1.6 s").hover()
  await caption(page, "Its question, its recommendation and why")
  await pinned.getByRole("button", { name: "Send answers" }).click()
  const { code } = await asking
  expect(code).toBe(0)
  await expect(column(page, "In Progress").locator(`[data-task-key="${speed}"]`)).toBeVisible()
  await hold(page)
  await taskPanel(page, speed).getByRole("button", { name: "Close task" }).click()

  // The email agent waits for comments, the way the hooks' `cello inbox --wait` does between turns.
  const waiting = celloInBackground(SESSIONS.email)("inbox", "--wait")
  await waiting.printed
  await card(page, email).click()
  const thread = comments(page, email)
  await hold(page)
  const box = thread.getByLabel("New comment")
  await box.click()
  await box.pressSequentially("Please put the Acme logo at the top of the email.", { delay: 35 })
  await thread.getByRole("button", { name: "Comment", exact: true }).click()
  await expect(receipt(thread, 0)).toHaveAttribute("data-receipt", "delivered")
  expect((await waiting).code).toBe(0)
  await hold(page)

  // Out of the way of the reply.
  await page.mouse.move(1100, 900, { steps: 12 })
  cli("email")("task", "comment", email, "Done: the logo is in the header now, and it links to the shop.")
  await expect(thread.locator("[data-comment-id]").nth(1)).toContainText("the logo is in the header now")
  await expect(receipt(thread, 0)).toHaveAttribute("data-receipt", "answered")
  await caption(page, "And it answers on the card")
})

test("⑥ Nothing without proof: a packet with a video is approved and lands in Done; another is sent back to its agent", async ({ page }) => {
  const cart = await keyOf(human, TITLES.cart)
  const email = await keyOf(human, TITLES.email)
  cli("cart")(
    "task", "submit", cart,
    "--summary", "Cart totals are now added up in cents, so three $19.99 mugs come to **$59.97**, not $59.96.",
    "--step", "Add a ceramic mug to the cart",
    "--step", "Raise the quantity to 3",
    "--step", "The subtotal and the total both read $59.97",
    "--attach", evidence.cart, "--caption", "The cart with three mugs",
  )
  cli("email")(
    "task", "submit", email,
    "--summary", "The order confirmation email has the Acme logo in its header and a summary of the order.",
    "--step", "Place a test order",
    "--step", "Open the confirmation email",
    "--attach", evidence.email, "--caption", "The confirmation email",
  )
  await openBoard(page)
  await expect(column(page, "In Review").locator(`[data-task-key="${cart}"]`)).toBeVisible()
  await hold(page)

  await page.getByRole("navigation", { name: "Inbox" }).getByRole("link", { name: /^Review/ }).click()
  await expect(page).toHaveURL(/\/review$/)
  const first = page.getByRole("article", { name: new RegExp(cart) })
  await first.getByRole("button", { name: new RegExp(cart) }).click()
  await expect(first.getByRole("region", { name: "How to check" }).getByRole("listitem")).toHaveCount(3)
  await caption(page, "What changed, how to check it, and the evidence")

  const video = first.locator("video[data-evidence=video]")
  const played = video.evaluate(
    (v: HTMLVideoElement) =>
      new Promise<void>((resolve) => {
        const check = () => v.currentTime > 2.5 && resolve()
        v.addEventListener("timeupdate", check)
        check()
      }),
  )
  await video.click()
  await played
  await hold(page)

  await first.getByRole("button", { name: "Approve" }).click()
  await expect(first).toBeHidden()
  await hold(page)

  // The next packet opens by itself once the first is approved.
  const second = page.getByRole("article", { name: new RegExp(email) })
  await expect(page.locator(`[data-review-task="${email}"]`)).toHaveAttribute("data-open", "")
  await expect(second.locator("img[data-evidence=screenshot]")).toBeVisible()
  await hold(page)
  await second.getByRole("button", { name: "Send back" }).click()
  const dialog = page.getByRole("dialog", { name: `Send ${email} back` })
  const note = dialog.getByLabel("Note")
  await note.click()
  await note.pressSequentially("The logo looks blurry on a retina screen. Please use the SVG.", { delay: 30 })
  await dialog.getByRole("button", { name: "Send back" }).click()
  await expect(dialog).toBeHidden()
  await expect(second).toBeHidden()

  await page.getByRole("link", { name: "Acme Shop" }).click()
  await expect(column(page, "Done").locator(`[data-task-key="${cart}"]`)).toBeVisible()
  await expect(column(page, "In Progress").locator(`[data-task-key="${email}"]`)).toBeVisible()
  await hold(page)
})
