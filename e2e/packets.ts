// Review packets for the e2e tests: an agent hands one in through the real `cello` CLI (from source,
// as a Claude Code session) with a real MP4, a real screenshot and a link.
import { spawn, spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Locator, Page } from "@playwright/test"
import { expect } from "./fixtures.ts"

const root = path.resolve(import.meta.dirname, "..")
const SERVER_PORT = Number(process.env.CELLO_E2E_SERVER_PORT ?? 4791)
export const WEB_URL = `http://localhost:${process.env.CELLO_WEB_PORT ?? 5199}`
/** Where the specs save stills for the report, next to the videos. */
export const SHOTS = path.join(import.meta.dirname, "videos")

/** The same as celloAs, but a failing command is returned, not thrown: its exit code, stdout and stderr. */
export const celloRun = (session: string | null, options: { readonly stdin?: string } = {}) => (...args: string[]) => {
  const result = spawnSync("bun", [path.join(root, "apps/cli/src/bin.ts"), ...args], {
    cwd: root,
    encoding: "utf8",
    input: options.stdin ?? "",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      CELLO_PORT: String(SERVER_PORT),
      ...(session === null ? {} : { CLAUDE_CODE_SESSION_ID: session, CLAUDE_PID: String(process.pid) }),
    },
  })
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() }
}

/**
 * Runs the `cello` CLI from source against the e2e server, as Claude Code session `session` (null: no
 * session in the environment, the way Claude Code runs a hook), with `stdin` piped in.
 */
export const celloAs = (session: string | null, options: { readonly stdin?: string } = {}) => (...args: string[]) => {
  const result = celloRun(session, options)(...args)
  if (result.status !== 0) throw new Error(`cello ${args.join(" ")} failed: ${result.stderr}`)
  return result.stdout
}

/** Runs the `cello` CLI from source as a Claude Code session, against the e2e server. */
export const cello = celloAs("e2e0review-agent-session")

/**
 * `cello …` in the background, as Claude Code session `session`: resolves with what it printed (stdout
 * and stderr) once it exits, and its stdout alone. `printed` resolves with its first output on stderr,
 * which a waiting command (`cello inbox --wait`) prints once it's waiting.
 */
export const celloInBackground = (session: string) => (...args: string[]) => {
  const child = spawn("bun", [path.join(root, "apps/cli/src/bin.ts"), ...args], {
    cwd: root,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, CELLO_PORT: String(SERVER_PORT), CLAUDE_CODE_SESSION_ID: session, CLAUDE_PID: String(process.pid) },
  })
  let out = ""
  let stdout = ""
  let markPrinted = (_line: string) => {}
  const printed = new Promise<string>((resolve) => (markPrinted = resolve))
  child.stdout.on("data", (chunk: Buffer) => {
    out += chunk.toString()
    stdout += chunk.toString()
  })
  child.stderr.on("data", (chunk: Buffer) => {
    out += chunk.toString()
    markPrinted(chunk.toString().trim())
  })
  const done = new Promise<{ code: number | null; out: string; stdout: string }>((resolve) =>
    child.on("close", (code) => {
      markPrinted("")
      resolve({ code, out: out.trim(), stdout: stdout.trim() })
    })
  )
  return Object.assign(done, { printed })
}

/** A real MP4 (a test pattern) at `file`. VP9 inside: Playwright's Chromium has no H.264. */
export const testVideo = (file: string) => {
  const ffmpeg = spawnSync("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=4:size=640x360:rate=25",
    "-c:v", "libvpx-vp9", "-deadline", "realtime", "-b:v", "0", "-crf", "40", "-pix_fmt", "yuv420p", "-movflags", "+faststart", file,
  ])
  if (ffmpeg.status !== 0) throw new Error(`ffmpeg failed: ${ffmpeg.stderr}`)
}

/**
 * An agent's packet for task 1 of `key`: a real MP4 ("The whole flow"), a real screenshot of the
 * board ("The board") and a link to the PR ("The PR"). Remove `dir` when the test is done.
 */
export async function submitPacket(page: Page, key: string): Promise<{ dir: string }> {
  cello("task", "create", "Review packets on the board", "--project", key)
  cello("task", "claim", `${key}-1`)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-evidence-"))
  const video = path.join(dir, "board-flow.mp4")
  testVideo(video)
  const screenshot = path.join(dir, "board.png")
  await page.screenshot({ path: screenshot })
  const out = cello(
    "task", "submit", `${key}-1`,
    "--summary", "Adds **review packets**: a summary, steps and evidence on every task in In Review.",
    "--step", "Open Review in the sidebar",
    "--step", "Play the video and open the screenshot",
    "--step", "Approve it; the card lands in Done",
    "--attach", video, "--caption", "The whole flow",
    "--attach", screenshot, "--caption", "The board",
    "--link", "https://github.com/lnmunhoz/cello/pull/10", "--caption", "The PR",
  )
  expect(out).toContain(`Submitted ${key}-1 for review  In Progress → In Review`)
  return { dir }
}

/**
 * One task per title in `key` (KEY-1, KEY-2…), each submitted in order with a small packet: a summary
 * and a step naming the task, a real screenshot of the board with the tasks on it, and a link. `page`
 * shows the project's board. Remove `dir` when done.
 */
export async function submitPackets(page: Page, key: string, titles: ReadonlyArray<string>): Promise<{ dir: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-evidence-"))
  const screenshot = path.join(dir, "board.png")
  for (const title of titles) cello("task", "create", title, "--project", key)
  await expect(page.locator(`[data-task-key="${key}-${titles.length}"]`)).toBeVisible()
  await page.screenshot({ path: screenshot })
  titles.forEach((title, i) => {
    const task = `${key}-${i + 1}`
    cello("task", "claim", task)
    cello(
      "task", "submit", task,
      "--summary", `${title}: the packet for ${task}.`,
      "--step", `Open ${task} on the Review page`,
      "--attach", screenshot, "--caption", "The board",
      "--link", "https://github.com/lnmunhoz/cello/pull/22", "--caption", "The PR",
    )
  })
  return { dir }
}

/**
 * Task 1 of `key` handed in with three real screenshots of different shapes, to step through in the
 * image modal: "The board" (the whole 1440×900 window), "The sidebar" (tall) and "The header" (a wide
 * strip); plus a real MP4 ("The whole flow") and a link ("The PR"). `page` shows the board. Remove
 * `dir` when done.
 */
export async function submitScreenshotsPacket(page: Page, key: string, title: string): Promise<{ dir: string }> {
  cello("task", "create", title, "--project", key)
  cello("task", "claim", `${key}-1`)
  await expect(page.locator(`[data-task-key="${key}-1"]`)).toBeVisible()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-evidence-"))
  const video = path.join(dir, "flow.mp4")
  testVideo(video)
  const shot = (name: string) => path.join(dir, name)
  await page.screenshot({ path: shot("board.png") })
  await page.screenshot({ path: shot("sidebar.png"), clip: { x: 0, y: 0, width: 320, height: 900 } })
  await page.screenshot({ path: shot("header.png"), clip: { x: 0, y: 0, width: 1440, height: 160 } })
  const out = cello(
    "task", "submit", `${key}-1`,
    "--summary", "Screenshots open in a **zoomable modal**, and show at full width in the packet.",
    "--step", "Click a screenshot: it opens over the page, fitted",
    "--step", "Zoom with the wheel, drag it around, step with ← and →",
    "--attach", video, "--caption", "The whole flow",
    "--attach", shot("board.png"), "--caption", "The board",
    "--attach", shot("sidebar.png"), "--caption", "The sidebar",
    "--attach", shot("header.png"), "--caption", "The header",
    "--link", "https://github.com/lnmunhoz/cello/pull/44", "--caption", "The PR",
  )
  expect(out).toContain(`Submitted ${key}-1 for review  In Progress → In Review`)
  return { dir }
}

/** Where an open packet's parts sit on screen, and how its evidence is positioned. For `submitDiagramPacket`'s packet. */
export async function packetLayout(packet: Locator) {
  const box = async (locator: Locator) => (await locator.boundingBox())!
  const evidence = packet.getByRole("region", { name: "Evidence" })
  return {
    diagram: await box(packet.locator("figure[data-mermaid]")),
    steps: await box(packet.getByRole("region", { name: "How to check" })),
    evidence: await box(evidence),
    approve: await box(packet.getByRole("button", { name: "Approve" })),
    position: await evidence.evaluate((el) => getComputedStyle(el).position),
  }
}

/** Two columns: the summary's diagram, the steps and Approve on the left; the evidence beside them on the right, sticky. */
export async function expectTwoColumns(packet: Locator) {
  const at = await packetLayout(packet)
  expect(at.evidence.x).toBeGreaterThanOrEqual(at.diagram.x + at.diagram.width)
  expect(at.evidence.x).toBeGreaterThanOrEqual(at.steps.x + at.steps.width)
  expect(at.approve.x + at.approve.width).toBeLessThanOrEqual(at.evidence.x)
  // Side by side: the evidence starts level with the summary, above the steps.
  expect(at.evidence.y).toBeLessThan(at.steps.y)
  expect(at.position).toBe("sticky")
  return at
}

/** One column, as before: the evidence under the steps, Approve under the evidence. */
export async function expectOneColumn(packet: Locator) {
  const at = await packetLayout(packet)
  expect(at.evidence.y).toBeGreaterThanOrEqual(at.steps.y + at.steps.height)
  expect(Math.abs(at.evidence.x - at.steps.x)).toBeLessThan(1)
  expect(at.approve.y).toBeGreaterThanOrEqual(at.evidence.y + at.evidence.height)
  expect(at.position).toBe("static")
}

/** The open packet's diagram is drawn, so the layout has settled (videos and screenshots keep their box's shape while they load). */
export async function packetDrawn(packet: Locator) {
  await expect(packet.locator("figure[data-mermaid] svg")).toBeVisible()
}

/** The summary of `submitDiagramPacket`: a paragraph, then a mermaid flowchart (top to bottom). */
export const DIAGRAM_SUMMARY = [
  "Review packets get the **whole width**: on a wide panel the summary and steps sit on the left and the evidence stays in view on the right.",
  "",
  "```mermaid",
  "flowchart TD",
  '    A["An agent runs cello task submit"] --> B["The packet lands in Review"]',
  '    B --> C{"Is the panel wide enough?"}',
  '    C -- "Yes" --> D["Two columns: read on the left, watch on the right"]',
  '    C -- "No" --> E["One column, as before"]',
  '    D --> F(["Approve or send back"])',
  "    E --> F",
  "```",
  "",
  "The evidence column is sticky, so the video stays next to the steps while you scroll.",
].join("\n")

/**
 * Task 1 of `key` handed in with a packet that explains a flow: a summary with a mermaid diagram
 * (`DIAGRAM_SUMMARY`), six steps, a real MP4, two screenshots and a link. Remove `dir` when done.
 */
export async function submitDiagramPacket(page: Page, key: string, title: string): Promise<{ dir: string }> {
  cello("task", "create", title, "--project", key)
  cello("task", "claim", `${key}-1`)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-evidence-"))
  const video = path.join(dir, "review-flow.mp4")
  testVideo(video)
  const board = path.join(dir, "board.png")
  await page.screenshot({ path: board })
  const out = celloAs("e2e0review-agent-session", { stdin: DIAGRAM_SUMMARY })(
    "task", "submit", `${key}-1`,
    "--summary-file", "-",
    "--step", `Open ${key}-1 on the Review page in a wide window`,
    "--step", "The summary, the diagram and these steps are on the left",
    "--step", "The video and the screenshots are on the right",
    "--step", "Scroll down: the evidence stays in view",
    "--step", "Make the window narrow: it goes back to one column",
    "--step", "Open the viewer beside the board: the packet narrows to one column too",
    "--step", "The task panel's pinned packet stays in one column",
    "--step", "Approve it, or send it back",
    "--attach", video, "--caption", "The whole flow",
    "--attach", board, "--caption", "The board",
    "--link", "https://github.com/lnmunhoz/cello/pull/38", "--caption", "The PR",
  )
  expect(out).toContain(`Submitted ${key}-1 for review  In Progress → In Review`)
  return { dir }
}

/**
 * CEL-163: a page's content column starts at its scroll area's left edge plus the page padding (`px-8`, 32 px), at every
 * width: it never centres when the area is narrower than the column's cap.
 */
export async function expectLeftAligned(scroller: Locator, content: Locator) {
  const [area, list] = [(await scroller.boundingBox())!, (await content.boundingBox())!]
  expect(list.x - area.x).toBe(32)
}

type RpcMessage = {
  readonly _tag?: string
  readonly id?: string | number
  readonly tag?: string
  readonly requestId?: string | number
  readonly payload?: Record<string, unknown>
}

/** Each frame of the page's /rpc socket carries one protocol message or a batch of them. */
const rpcMessagesIn = (frame: string | Buffer): RpcMessage[] => {
  const parsed = JSON.parse(typeof frame === "string" ? frame : frame.toString("utf8")) as RpcMessage | RpcMessage[]
  return Array.isArray(parsed) ? parsed : [parsed]
}
const rpcFrame = (messages: ReadonlyArray<RpcMessage>) => JSON.stringify(messages.length === 1 ? messages[0] : messages)

const DECISIONS = new Set(["review.approve", "review.sendBack"])

/**
 * CEL-187: the page's Approve and Send back commands go through the test, so it can look at the page
 * while one runs and when one fails, without waiting on time. Call it before the page loads.
 * `holdNext()`: the server's answer to the next decision waits for `release()` (its events still arrive).
 * `failNext()`: the next decision reaches the server about a task that doesn't exist, so the server refuses it.
 */
export async function decisionsThroughTest(page: Page) {
  let hold = false
  let fail = false
  const held = new Set<string>()
  const waiting: Array<() => void> = []
  /** CEL-191: every decision that reached the socket, as "review.approve" or "review.sendBack": what was sent, however it was answered. */
  const sent: string[] = []
  /** CEL-191: the page loads that lost their socket's decisions (`dropFromThisPage`), by the count of sockets opened so far. */
  const dropping = new Set<number>()
  let sockets = 0
  await page.routeWebSocket(/\/rpc$/, (ws) => {
    const mine = ++sockets
    const server = ws.connectToServer()
    ws.onMessage((frame) => {
      const messages = rpcMessagesIn(frame).flatMap((m) => {
        if (m._tag === "Request" && DECISIONS.has(m.tag ?? "") && dropping.has(mine)) return []
        return [m]
      }).map((m) => {
        if (m._tag !== "Request" || !DECISIONS.has(m.tag ?? "")) return m
        sent.push(m.tag!)
        if (fail) {
          fail = false
          return { ...m, payload: { ...m.payload, key: "GONE-404" } }
        }
        if (hold) {
          hold = false
          held.add(String(m.id))
        }
        return m
      })
      if (messages.length > 0) server.send(rpcFrame(messages))
    })
    server.onMessage((frame) => {
      const messages = rpcMessagesIn(frame)
      const isHeld = (m: RpcMessage) => m._tag === "Exit" && held.has(String(m.requestId))
      const now = messages.filter((m) => !isHeld(m))
      if (now.length > 0) ws.send(rpcFrame(now))
      for (const m of messages.filter(isHeld)) waiting.push(() => ws.send(rpcFrame([m])))
    })
  })
  return {
    sent: (): ReadonlyArray<string> => [...sent],
    /** The page now open never gets a decision to the server (it is closing before its send leaves): what it sends is lost, as in a tab that died. A page opened after it is not affected. */
    dropFromThisPage: () => void dropping.add(sockets),
    holdNext: () => void (hold = true),
    failNext: () => void (fail = true),
    /** The held answers reach the page. */
    release: () => {
      held.clear()
      for (const send of waiting.splice(0)) send()
    },
  }
}

/**
 * CEL-187: from now on, every "Approved" or "Sent back" a Review row shows is noted, as "KEY-1: Approved".
 * The words stay on the row only for a moment, so a test reads them back with `decidedSeen` afterwards
 * instead of racing them.
 */
export const watchDecided = (page: Page) =>
  page.evaluate(() => {
    const seen: string[] = []
    Object.assign(window, { __decidedSeen: seen })
    new MutationObserver(() => {
      for (const mark of document.querySelectorAll("[data-decided]")) {
        const words = `${mark.closest("[data-review-task]")?.getAttribute("data-review-task")}: ${mark.textContent}`
        if (!seen.includes(words)) seen.push(words)
      }
    }).observe(document.body, { childList: true, subtree: true })
  })

export const decidedSeen = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __decidedSeen: string[] }).__decidedSeen)
