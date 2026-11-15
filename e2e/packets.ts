// Review packets for the e2e tests: an agent hands one in through the real `cello` CLI (from source,
// as a Claude Code session) with a real MP4, a real screenshot and a link.
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Page } from "@playwright/test"
import { expect } from "./fixtures.ts"

const root = path.resolve(import.meta.dirname, "..")
const SERVER_PORT = Number(process.env.CELLO_E2E_SERVER_PORT ?? 4791)
export const WEB_URL = `http://localhost:${process.env.CELLO_WEB_PORT ?? 5199}`
/** Where the specs save stills for the report, next to the videos. */
export const SHOTS = path.join(import.meta.dirname, "videos")

/**
 * Runs the `cello` CLI from source against the e2e server, as Claude Code session `session` (null: no
 * session in the environment, the way Claude Code runs a hook), with `stdin` piped in.
 */
export const celloAs = (session: string | null, options: { readonly stdin?: string } = {}) => (...args: string[]) => {
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
  if (result.status !== 0) throw new Error(`cello ${args.join(" ")} failed: ${result.stderr}`)
  return result.stdout.trim()
}

/** Runs the `cello` CLI from source as a Claude Code session, against the e2e server. */
export const cello = celloAs("e2e0review-agent-session")

/**
 * An agent's packet for task 1 of `key`: a real MP4 ("The whole flow"), a real screenshot of the
 * board ("The board") and a link to the PR ("The PR"). Remove `dir` when the test is done.
 */
export async function submitPacket(page: Page, key: string): Promise<{ dir: string }> {
  cello("task", "create", "Review packets on the board", "--project", key)
  cello("task", "claim", `${key}-1`)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-evidence-"))
  // A real MP4 (a test pattern). VP9 inside: Playwright's Chromium has no H.264.
  const video = path.join(dir, "board-flow.mp4")
  const ffmpeg = spawnSync("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=4:size=640x360:rate=25",
    "-c:v", "libvpx-vp9", "-deadline", "realtime", "-b:v", "0", "-crf", "40", "-pix_fmt", "yuv420p", "-movflags", "+faststart", video,
  ])
  if (ffmpeg.status !== 0) throw new Error(`ffmpeg failed: ${ffmpeg.stderr}`)
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
  const ffmpeg = spawnSync("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=4:size=640x360:rate=25",
    "-c:v", "libvpx-vp9", "-deadline", "realtime", "-b:v", "0", "-crf", "40", "-pix_fmt", "yuv420p", "-movflags", "+faststart", video,
  ])
  if (ffmpeg.status !== 0) throw new Error(`ffmpeg failed: ${ffmpeg.stderr}`)
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
