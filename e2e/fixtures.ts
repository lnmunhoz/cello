// Shared steps for the e2e tests, plus a visible cursor, click ripples and captions in the videos.
import { expect, test as base, type Page } from "@playwright/test"

/** Draws the pointer, a ripple on each press, and a caption box. Runs in every page. */
const overlay = () => {
  const install = () => {
    const style = document.createElement("style")
    style.textContent = `
      #e2e-cursor { position: fixed; z-index: 2147483647; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%;
        background: rgb(94 106 210 / .35); border: 2px solid rgb(94 106 210); pointer-events: none; left: -50px; top: -50px; }
      .e2e-ripple { position: fixed; z-index: 2147483646; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%;
        border: 2px solid rgb(94 106 210); pointer-events: none; animation: e2e-ripple .5s ease-out forwards; }
      @keyframes e2e-ripple { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.4); opacity: 0 } }
      #e2e-caption { position: fixed; z-index: 2147483647; left: 50%; bottom: 28px; translate: -50% 0; padding: 8px 14px; border-radius: 8px;
        background: rgb(20 20 24 / .88); color: white; font: 500 15px system-ui; pointer-events: none; }
      #e2e-caption:empty { display: none; }`
    document.head.append(style)
    const cursor = document.createElement("div")
    cursor.id = "e2e-cursor"
    const caption = document.createElement("div")
    caption.id = "e2e-caption"
    document.body.append(cursor, caption)
    const follow = (e: MouseEvent) => { cursor.style.left = `${e.clientX}px`; cursor.style.top = `${e.clientY}px` }
    window.addEventListener("pointermove", follow, true)
    window.addEventListener("mousemove", follow, true)
    window.addEventListener("pointerdown", (e) => {
      const ripple = document.createElement("div")
      ripple.className = "e2e-ripple"
      ripple.style.left = `${e.clientX}px`
      ripple.style.top = `${e.clientY}px`
      document.body.append(ripple)
      ripple.addEventListener("animationend", () => ripple.remove())
    }, true)
  }
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", install)
  else install()
}

/** Shows what the test is doing, at the bottom of the video. */
export const caption = (page: Page, text: string) =>
  page.evaluate((t) => {
    const el = document.getElementById("e2e-caption")
    if (el) el.textContent = t
  }, text)

/** A project key no other test uses. */
export const uniqueKey = (prefix: string) => `${prefix}${Date.now().toString(36).toUpperCase().slice(-5)}`.replace(/[^A-Z0-9]/g, "").slice(0, 10)

/** "17: drag a card in tab 1; it moves in tab 2" → "17-drag-a-card-in-tab-1-it-moves-in-tab-2" */
const slug = (title: string) => {
  const full = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  return full.length <= 80 ? full : full.slice(0, 80).replace(/-[^-]*$/, "")
}

export const test = base.extend({
  context: async ({ context }, use, testInfo) => {
    await context.addInitScript(overlay)
    const videos: Array<ReturnType<Page["video"]>> = []
    context.on("page", (page) => videos.push(page.video()))
    await use(context)
    // Name each tab's video after the test, in the order the tabs opened; teardown makes MP4s.
    await context.close()
    const name = slug(testInfo.title)
    await Promise.all(
      videos.map((video, i) => video?.saveAs(`${import.meta.dirname}/videos/raw/${name}${videos.length > 1 ? `-tab-${i + 1}` : ""}.webm`)),
    )
  },
})

export { expect }

export const column = (page: Page, name: string) => page.locator(`section[data-column="${name}"]`)
export const card = (page: Page, key: string) => page.locator(`[data-task-key="${key}"]`)

/** Creates a project from the sidebar and lands on its board. */
export async function createProject(page: Page, name: string, key: string) {
  await page.goto("/")
  await caption(page, `New project “${name}”`)
  await page.getByRole("button", { name: "New project" }).first().click()
  await page.getByLabel("Name").fill(name)
  await page.getByLabel("Key").fill(key)
  await page.getByRole("button", { name: "Create project" }).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/issues$`))
  await expect(page.getByRole("dialog")).toBeHidden()
}

/** Adds tasks to a column with its `+`, typing each title and pressing Enter. */
export async function addTasks(page: Page, status: string, titles: ReadonlyArray<string>) {
  await page.getByRole("button", { name: `New task in ${status}` }).click()
  const input = page.getByLabel(`New task title in ${status}`)
  for (const title of titles) {
    await input.fill(title)
    await input.press("Enter")
    await expect(column(page, status).getByText(title, { exact: true })).toBeVisible()
  }
  await input.press("Escape")
}

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
