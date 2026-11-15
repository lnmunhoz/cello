// Shared steps for the e2e tests, plus a visible cursor, click ripples and captions in the videos.
// CELLO_E2E_REVIEW=1 records review videos (e2e/recording.ts): slow motion, and each state held
// about 1.5 s after a caption, around reloads and at the end. Off by default, it waits on nothing:
// the holds are a recording aid, never what a test relies on.
import * as fs from "node:fs"
import { expect, test as base, type Page, type Video } from "@playwright/test"
import type { Label, Project, Status } from "../packages/contract/src/entities.ts"
import { defaultWorkspaceId } from "../packages/client/src/sync/follow.ts"
import { newCommandId, openClient, type PromiseClient } from "../packages/client/test/support/promiseClient.ts"
import { cropFor, holdMs } from "./recording.ts"

declare global {
  interface Window {
    /** Set by the overlay in the top page: shows a caption, with the page's URL under it when `url`. */
    __e2eCaption?: (text: string, url: boolean) => void
  }
}

/**
 * Draws the pointer, a ripple on each press, and a caption box. Runs in every page and frame, but
 * draws only in the top page: a frame hands its pointer to its parent (postMessage, which works
 * across origins), each window adds the frame's position on its own page, and the top page draws
 * it, so clicks inside iframes (the viewer frames pages) show the cursor and ripple too. The
 * caption is kept in sessionStorage, so it stays through a reload.
 */
const overlay = () => {
  type Point = { kind: "move" | "press"; x: number; y: number }
  const isTop = window === window.top
  let show = (_point: Point) => {}
  const relay = (point: Point) => (isTop ? show(point) : parent.postMessage({ e2ePointer: point }, "*"))
  const own = (kind: Point["kind"]) => (e: MouseEvent) => relay({ kind, x: e.clientX, y: e.clientY })
  addEventListener("pointermove", own("move"), true)
  addEventListener("mousemove", own("move"), true)
  addEventListener("pointerdown", own("press"), true)
  addEventListener("message", (e) => {
    const point = (e.data as { e2ePointer?: Point } | null)?.e2ePointer
    if (!point) return
    const frame = [...document.querySelectorAll("iframe")].find((f) => f.contentWindow === e.source)
    if (!frame) return
    const rect = frame.getBoundingClientRect()
    const style = getComputedStyle(frame)
    relay({
      kind: point.kind,
      x: point.x + rect.left + frame.clientLeft + parseFloat(style.paddingLeft),
      y: point.y + rect.top + frame.clientTop + parseFloat(style.paddingTop),
    })
  })
  if (!isTop) return

  const KEY = "e2e-caption"
  const saved = (): { text: string; url: boolean } => {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) ?? "null") ?? { text: "", url: false }
    } catch {
      return { text: "", url: false }
    }
  }
  let render = () => {}
  window.__e2eCaption = (text, url) => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ text, url }))
    } catch {}
    render()
  }
  // In-app navigation changes the URL without a new page: a caption showing it follows.
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method]
    history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
      original.apply(this, args)
      render()
    }
  }
  addEventListener("popstate", () => render())

  const install = () => {
    const style = document.createElement("style")
    style.textContent = `
      #e2e-cursor { position: fixed; z-index: 2147483647; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%;
        background: rgb(94 106 210 / .35); border: 2px solid rgb(94 106 210); pointer-events: none; left: -50px; top: -50px; }
      .e2e-ripple { position: fixed; z-index: 2147483646; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%;
        border: 2px solid rgb(94 106 210); pointer-events: none; animation: e2e-ripple .5s ease-out forwards; }
      @keyframes e2e-ripple { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.4); opacity: 0 } }
      #e2e-caption { position: fixed; z-index: 2147483647; left: 50%; bottom: 28px; translate: -50% 0; padding: 8px 14px; border-radius: 8px;
        background: rgb(20 20 24 / .88); color: white; font: 500 15px system-ui; pointer-events: none; max-width: calc(100vw - 48px); }
      #e2e-caption:empty { display: none; }
      #e2e-caption [data-url] { display: block; margin-top: 3px; font: 12px ui-monospace, monospace; opacity: .8; overflow-wrap: anywhere; }`
    document.head.append(style)
    const cursor = document.createElement("div")
    cursor.id = "e2e-cursor"
    const caption = document.createElement("div")
    caption.id = "e2e-caption"
    document.body.append(cursor, caption)
    show = ({ kind, x, y }) => {
      cursor.style.left = `${x}px`
      cursor.style.top = `${y}px`
      if (kind !== "press") return
      cursor.dataset.press = `${Math.round(x)},${Math.round(y)}`
      const ripple = document.createElement("div")
      ripple.className = "e2e-ripple"
      ripple.style.left = `${x}px`
      ripple.style.top = `${y}px`
      document.body.append(ripple)
      ripple.addEventListener("animationend", () => ripple.remove())
    }
    render = () => {
      const { text, url } = saved()
      caption.textContent = text
      if (!text || !url) return
      const line = document.createElement("span")
      line.dataset.url = ""
      line.textContent = `${location.pathname}${location.search}${location.hash}`
      caption.append(line)
    }
    render()
  }
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", install)
  else install()
}

const HOLD_MS = holdMs(process.env)
/** Review videos only: keeps what's on screen for a moment. Without CELLO_E2E_REVIEW=1 it returns at once. */
const hold = (page: Page) => (HOLD_MS > 0 && !page.isClosed() ? page.waitForTimeout(HOLD_MS) : Promise.resolve())

/**
 * Shows what the test is doing, at the bottom of the video; `url` adds the page's current URL under
 * it (for checks like a reload keeping `?open=`). In review videos the previous step's result is
 * held under its own caption first, then the new caption is held before the step runs.
 */
export const caption = async (page: Page, text: string, options: { readonly url?: boolean } = {}) => {
  await hold(page)
  await page.evaluate(([t, url]) => window.__e2eCaption?.(t, url), [text, options.url ?? false] as const)
  await hold(page)
}

/** A caption with the page's URL under it, kept up to date as the app navigates and reloads. */
export const captionWithUrl = (page: Page, text: string) => caption(page, text, { url: true })

/** A project key no other test uses. */
export const uniqueKey = (prefix: string) => `${prefix}${Date.now().toString(36).toUpperCase().slice(-5)}`.replace(/[^A-Z0-9]/g, "").slice(0, 10)

/** "17: drag a card in tab 1; it moves in tab 2" → "17-drag-a-card-in-tab-1-it-moves-in-tab-2" */
const slug = (title: string) => {
  const full = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  return full.length <= 80 ? full : full.slice(0, 80).replace(/-[^-]*$/, "")
}

export const test = base.extend<{ cello: PromiseClient }>({
  /** An RPC client for seeding data, through the preview server's /rpc proxy like the page itself. */
  cello: async ({ baseURL }, use) => {
    const client = await openClient(`${baseURL!.replace(/^http/, "ws")}/rpc`)
    await use(client)
    await client.close()
  },
  context: async ({ context }, use, testInfo) => {
    await context.addInitScript(overlay)
    // Each tab's video, and the viewport sizes it showed, so teardown can crop away the grey
    // Playwright draws around a page smaller than the video (a phone width, a short window).
    const tabs: Array<{ video: Video | null; viewports: Array<{ width: number; height: number } | null> }> = []
    context.on("page", (page) => {
      const tab = { video: page.video(), viewports: [page.viewportSize()] }
      tabs.push(tab)
      const setViewportSize = page.setViewportSize.bind(page)
      page.setViewportSize = async (size) => {
        // Before the first page loads nothing was shown at the old size, so it doesn't count.
        tab.viewports = page.url() === "about:blank" ? [size] : [...tab.viewports, size]
        await setViewportSize(size)
      }
      if (HOLD_MS > 0) {
        // Review videos hold the state before a reload and the reloaded page after it.
        const reload = page.reload.bind(page)
        page.reload = async (options) => {
          await hold(page)
          const response = await reload(options)
          await hold(page)
          return response
        }
      }
    })
    await use(context)
    // Review videos end on the final state for a moment.
    const last = context.pages().at(-1)
    if (last) await hold(last)
    await context.close()
    // Name each tab's video after the test, in the order the tabs opened; teardown makes MP4s.
    const name = slug(testInfo.title)
    await Promise.all(
      tabs.map(async ({ video, viewports }, i) => {
        if (!video) return
        const file = `${import.meta.dirname}/videos/raw/${name}${tabs.length > 1 ? `-tab-${i + 1}` : ""}`
        await video.saveAs(`${file}.webm`)
        const crop = cropFor(viewports)
        if (crop) fs.writeFileSync(`${file}.crop.json`, JSON.stringify(crop))
      }),
    )
  },
})

export { expect }

export const column = (page: Page, name: string) => page.locator(`section[data-column="${name}"]`)
export const card = (page: Page, key: string) => page.locator(`[data-task-key="${key}"]`)

export const taskPanel = (page: Page, key: string) => page.getByRole("complementary", { name: `${key} details` })

/** Creates a project from the sidebar and lands on its board. Loads the app first, so it's in the default workspace. */
export async function createProject(page: Page, name: string, key: string) {
  await page.goto("/")
  await createProjectHere(page, name, key)
}

/** Creates a project in the workspace on screen, without reloading (a reload goes back to the default workspace). */
export async function createProjectHere(page: Page, name: string, key: string) {
  await caption(page, `New project “${name}”`)
  await page.getByRole("button", { name: "New project" }).first().click()
  await page.getByLabel("Name").fill(name)
  await page.getByLabel("Key").fill(key)
  await page.getByRole("button", { name: "Create project" }).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/issues$`))
  await expect(page.getByRole("dialog")).toBeHidden()
}

/** Adds tasks to a column with its `+`, typing each title and pressing Enter. Each new card lands at the bottom. */
export async function addTasks(page: Page, status: string, titles: ReadonlyArray<string>) {
  await page.getByRole("button", { name: `New task in ${status}` }).click()
  const input = page.getByLabel(`New task title in ${status}`)
  for (const title of titles) {
    await input.fill(title)
    await input.press("Enter")
    await expect(column(page, status).locator("[data-task-key]").last().locator("[data-card-title]")).toHaveText(title)
  }
  await input.press("Escape")
}

/** Creates a workspace in Settings and switches to it with the sidebar's switcher. */
export async function openNewWorkspace(page: Page, name: string) {
  await page.getByRole("link", { name: "Settings" }).click()
  await caption(page, `Create the workspace “${name}” and switch to it`)
  await page.getByLabel("New workspace name").fill(name)
  await page.getByRole("button", { name: "Create workspace" }).click()
  await switchWorkspace(page, name)
}

export async function switchWorkspace(page: Page, name: string) {
  await page.getByRole("button", { name: "Switch workspace" }).click()
  await page.getByRole("menuitem", { name }).click()
  await expect(page.getByRole("button", { name: "Switch workspace" })).toContainText(name)
}

/** The default workspace's id, its statuses by name, and its labels. */
export async function defaultWorkspace(cello: PromiseClient) {
  const snapshot = await cello.run((c) => c["snapshot.get"]({}))
  const workspaceId = defaultWorkspaceId(snapshot)
  const statuses = Object.fromEntries(snapshot.statuses.filter((s) => s.workspaceId === workspaceId).map((s) => [s.name, s])) as Record<string, Status>
  return { workspaceId, statuses, labels: snapshot.labels }
}

/** A project in the default workspace, made through the RPC client. */
export async function seedProject(cello: PromiseClient, name: string, key: string): Promise<Project> {
  const { workspaceId } = await defaultWorkspace(cello)
  return (await cello.run((c) => c["project.create"]({ commandId: newCommandId(), workspaceId, name, key }))).result
}

/** Labels in the default workspace, reusing any that already exist with the same name. */
export async function seedLabels(cello: PromiseClient, labels: ReadonlyArray<{ name: string; color: string }>): Promise<Label[]> {
  const { workspaceId, labels: existing } = await defaultWorkspace(cello)
  const out: Label[] = []
  for (const { name, color } of labels) {
    const found = existing.find((l) => l.name === name && l.archivedAt === null)
    out.push(found ?? (await cello.run((c) => c["label.create"]({ commandId: newCommandId(), workspaceId, name, color }))).result)
  }
  return out
}

export { newCommandId }

/** Drags a card onto a column with the mouse, in small steps like a person would. */
export async function dragCard(page: Page, key: string, to: string) {
  const from = await card(page, key).boundingBox()
  const target = await column(page, to).locator('[role="list"]').boundingBox()
  if (!from || !target) throw new Error("card or column not on screen")
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
  const end = { x: target.x + target.width / 2, y: target.y + 30 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 25 })
  await page.mouse.up()
}
