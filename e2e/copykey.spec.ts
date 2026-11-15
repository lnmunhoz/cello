// CEL-67: copy a task from its panel to paste it to an agent. A click on the key in the header copies
// the key; the ••• menu copies the key, or the task as a message for an agent (key and title, the
// description, and the command that reads the whole card); ⌘. copies the key while the panel is open.
import * as fs from "node:fs"
import * as path from "node:path"
import type { Browser, Page } from "@playwright/test"
import { caption, card, createProject, defaultWorkspace, expect, newCommandId, taskPanel, test, uniqueKey } from "./fixtures.ts"
import { SHOTS, WEB_URL } from "./packets.ts"
import { isReview } from "./recording.ts"

const TITLE = "Pages open in the side panel"
const DESCRIPTION = "Open a page **beside** the board.\n\n- keep the scroll\n- keep the tab"

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText())
const notice = (page: Page, text: string) => page.getByRole("region", { name: "Notifications" }).getByText(text, { exact: true })

/** The header's key under the pointer, and the open ••• menu, light and dark, saved to e2e/videos/copykey-*.png. */
async function screenshots(browser: Browser, key: string) {
  fs.mkdirSync(SHOTS, { recursive: true })
  const [projectKey, number] = key.split("-") as [string, string]
  for (const colorScheme of ["light", "dark"] as const) {
    const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1440, height: 900 }, colorScheme })
    const page = await context.newPage()
    await page.goto(`/${projectKey}/${number}`)
    const panel = taskPanel(page, key)
    await expect(panel.getByLabel("Title")).toBeVisible()
    const box = (await panel.boundingBox())!
    const top = { x: box.x, y: box.y, width: box.width, height: 220 }
    await panel.getByRole("button", { name: `Copy key ${key}` }).hover()
    await page.screenshot({ path: path.join(SHOTS, `copykey-hover-${colorScheme}.png`), clip: top })
    await panel.getByRole("button", { name: "Task actions" }).click()
    const menu = page.getByRole("menu")
    await expect(menu.getByRole("menuitem", { name: "Copy for an agent" })).toBeVisible()
    // The menu fades in; shoot it once that's done.
    await menu.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)))
    await page.screenshot({ path: path.join(SHOTS, `copykey-menu-${colorScheme}.png`), clip: top })
    await context.close()
  }
}

test("CEL-67: click the key to copy it; the ••• menu copies the key, or the task for an agent; ⌘. copies the key", async ({ page, cello, browser }) => {
  if (isReview(process.env)) test.setTimeout(240_000)
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  const projectKey = uniqueKey("COPY")
  await createProject(page, "Copy for agents", projectKey)
  const { statuses } = await defaultWorkspace(cello)
  const project = (await cello.run((c) => c["snapshot.get"]({}))).projects.find((p) => p.key === projectKey)!
  await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title: TITLE, description: DESCRIPTION, statusId: statuses["Todo"]!.id }))
  await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "No description yet", statusId: statuses["Todo"]!.id }))
  const key = `${projectKey}-1`
  const panel = taskPanel(page, key)

  await caption(page, "Open the task: its key sits in the panel's header")
  await card(page, key).click()
  await expect(panel.getByLabel("Title")).toHaveValue(TITLE)
  const keyButton = panel.getByRole("button", { name: `Copy key ${key}` })
  await expect(keyButton).toHaveText(key)
  await expect(keyButton).toHaveAttribute("title", /^Copy key/)

  await caption(page, "Click the key: it's on the clipboard, and a quiet note says so")
  await keyButton.click()
  await expect(notice(page, `Copied ${key}`)).toBeVisible()
  expect(await clipboard(page)).toBe(key)

  await caption(page, "The ••• menu has Copy key and Copy for an agent, above Archive")
  await page.evaluate(() => navigator.clipboard.writeText(""))
  await panel.getByRole("button", { name: "Task actions" }).click()
  const items = page.getByRole("menuitem")
  await expect(items).toHaveText([/^Copy key/, /^Copy for an agent/, "Archive task"])
  await expect(page.getByRole("menuitem", { name: "Copy key" })).toHaveAttribute("aria-keyshortcuts", /\.$/)

  await caption(page, "Copy for an agent: key and title, the description as written, and where to read the whole card")
  await page.getByRole("menuitem", { name: "Copy for an agent" }).click()
  await expect(notice(page, `Copied ${key} for an agent`)).toBeVisible()
  const forAgent = `${key}: ${TITLE}\n\n${DESCRIPTION}\n\nFull card, comments and history: cello task get ${key}`
  expect(await clipboard(page)).toBe(forAgent)

  await caption(page, "To show what was copied, paste it (⌘V) into the comment box; it isn't sent")
  const comment = panel.getByLabel("New comment")
  await comment.click()
  await page.keyboard.press("ControlOrMeta+KeyV")
  await expect(comment).toHaveValue(forAgent)
  // The box keeps its height and scrolls; stretch it here, for the video only, so all of the text shows.
  await comment.evaluate((el) => (el.style.height = `${el.scrollHeight + 4}px`))
  await caption(page, "Clear the comment box again")
  await comment.evaluate((el) => (el.style.height = ""))
  await comment.fill("")

  await caption(page, "Copy key from the menu")
  await page.evaluate(() => navigator.clipboard.writeText(""))
  await panel.getByRole("button", { name: "Task actions" }).click()
  await page.getByRole("menuitem", { name: "Copy key" }).click()
  expect(await clipboard(page)).toBe(key)

  await caption(page, "A task with no description: just the first and last lines")
  const other = `${projectKey}-2`
  await card(page, other).click()
  const otherPanel = taskPanel(page, other)
  await expect(otherPanel.getByLabel("Title")).toHaveValue("No description yet")
  await otherPanel.getByRole("button", { name: "Task actions" }).click()
  await page.getByRole("menuitem", { name: "Copy for an agent" }).click()
  await expect(notice(page, `Copied ${other} for an agent`)).toBeVisible()
  expect(await clipboard(page)).toBe(`${other}: No description yet\n\nFull card, comments and history: cello task get ${other}`)

  await caption(page, "⌘. (Ctrl+. elsewhere) copies the open task's key")
  await page.evaluate(() => navigator.clipboard.writeText(""))
  await page.keyboard.press("ControlOrMeta+Period")
  await expect(notice(page, `Copied ${other}`)).toBeVisible()
  expect(await clipboard(page)).toBe(other)

  await screenshots(browser, key)
})
