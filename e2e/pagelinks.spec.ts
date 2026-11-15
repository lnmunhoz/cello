// CEL-54: Lucas clicked a video link on a page and landed on a Not found screen he couldn't leave. An
// agent publishes a page through the real `cello` CLI that links a video as a plain link and a file
// that isn't on disk; the video plays inline without leaving the page, the missing file is inert,
// and every Not found screen has Back and a link to the board.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Browser } from "@playwright/test"
import { caption, captionWithUrl, createProject, expect, test, uniqueKey } from "./fixtures.ts"
import { celloAs, SHOTS, testVideo, WEB_URL } from "./packets.ts"

const cello = celloAs("e2e0pagelinks-agent-session")

const SCOPE = [
  "# Palette scope",
  "",
  "The palette opens with ⌘K and filters as you type.",
  "",
  "## Typing in the palette",
  "",
  "[a-palette-typing.mp4](a-palette-typing.mp4)",
  "",
  "## Still to record",
  "",
  "The empty state: [palette-empty.mp4](palette-empty.mp4).",
].join("\n")

/** `url` in its own unrecorded window, saved to e2e/videos/<name>-<scheme>.png once `ready` holds. */
async function still(browser: Browser, url: string, name: string, colorScheme: "light" | "dark", ready: (page: import("@playwright/test").Page) => Promise<void>) {
  const context = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1280, height: 1200 }, colorScheme })
  const page = await context.newPage()
  await page.goto(url)
  await ready(page)
  await page.screenshot({ path: path.join(SHOTS, `${name}-${colorScheme}.png`) })
  await context.close()
}

test("CEL-54: a page's linked video plays inline without leaving the page; a missing file is inert; Not found screens have Back and the board", async ({ page, browser }) => {
  const key = uniqueKey("LINK")
  await createProject(page, "Page links", key)

  await caption(page, "An agent publishes a page that links a video as a plain link, and a file that isn't on disk")
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-e2e-pagelinks-"))
  testVideo(path.join(dir, "a-palette-typing.mp4"))
  const file = path.join(dir, "scope.md")
  fs.writeFileSync(file, SCOPE)
  expect(cello("doc", "publish", file, "--project", key).split("\n")[0]).toBe('Published page "Palette scope" (version 1), with 1 file')
  const pagePath = `/${key}/pages/palette-scope`

  await captionWithUrl(page, "Open the page from the Docs tab")
  await page.getByRole("link", { name: "Docs", exact: true }).click()
  await page.getByRole("list", { name: "Documents" }).getByRole("link", { name: /Palette scope/ }).click()
  await expect(page).toHaveURL(new RegExp(`${pagePath}$`))
  const article = page.getByRole("article")

  await captionWithUrl(page, "The linked video is a player in the page, not a link")
  const video = article.locator("video[data-evidence=video]")
  await expect(video).toHaveAttribute("aria-label", "a-palette-typing.mp4")
  await expect(video).toHaveAttribute("src", /^\/attachments\/\w+$/)
  await expect(article.getByRole("link", { name: "a-palette-typing.mp4" })).toHaveCount(0)
  await video.scrollIntoViewIfNeeded()
  const played = video.evaluate(
    (v: HTMLVideoElement) =>
      new Promise<number>((resolve) => {
        const check = () => v.currentTime > 1 && resolve(v.currentTime)
        v.addEventListener("timeupdate", check)
        check()
      }),
  )
  await video.click()
  expect(await played).toBeGreaterThan(1)
  await video.evaluate((v: HTMLVideoElement) => v.pause())
  await expect(page).toHaveURL(new RegExp(`${pagePath}$`))

  await captionWithUrl(page, "The file that never went up says so, and clicking it goes nowhere")
  const missing = article.locator("[data-missing-file]")
  await expect(missing).toHaveText(/palette-empty\.mp4\s*missing file/)
  await expect(missing).toHaveAttribute("title", "palette-empty.mp4 didn't go up with the page")
  await expect(article.locator('a[href="palette-empty.mp4"]')).toHaveCount(0)
  await missing.click()
  await expect(page).toHaveURL(new RegExp(`${pagePath}$`))

  await captionWithUrl(page, "An address with no page behind it: Cello's Not found screen, with Back and the board")
  await page.goto(`/${key}/pages/old-plan`)
  const notFound = page.getByRole("region", { name: "Not found" })
  await expect(notFound.getByRole("heading", { name: "No page “old-plan” in Page links" })).toBeVisible()
  await expect(notFound.getByRole("link", { name: `Go to the ${key} board` })).toBeVisible()

  await captionWithUrl(page, "Back returns to the page")
  await notFound.getByRole("button", { name: "Back" }).click()
  await expect(page).toHaveURL(new RegExp(`${pagePath}$`))
  await expect(article.locator("video[data-evidence=video]")).toBeVisible()

  await captionWithUrl(page, "A dead file address in the project: the same way out, here the board link")
  await page.goto(`/${key}/a-palette-typing.mp4`)
  await expect(notFound.getByRole("heading", { name: "Nothing here" })).toBeVisible()
  await expect(notFound).toContainText(`Cello has no page at /${key}/a-palette-typing.mp4.`)
  await notFound.getByRole("link", { name: `Go to the ${key} board` }).click()
  await expect(page).toHaveURL(new RegExp(`/${key}/issues$`))
  await expect(notFound).toHaveCount(0)

  await captionWithUrl(page, "Outside any project, Not found offers Home")
  await page.goto("/nope/b/c")
  await expect(notFound.getByRole("heading", { name: "No project with the key NOPE" })).toBeVisible()
  await notFound.getByRole("link", { name: "Go home" }).click()
  // Home opens the workspace's first project.
  await expect(page).toHaveURL(/\/[A-Z0-9]+\/issues$/)

  for (const scheme of ["light", "dark"] as const) {
    await still(browser, pagePath, "page-video", scheme, async (p) => {
      const v = p.locator("video[data-evidence=video]")
      await v.scrollIntoViewIfNeeded()
      await expect(v).toHaveJSProperty("readyState", 4)
    })
    await still(browser, `/${key}/pages/old-plan`, "not-found", scheme, async (p) => {
      await expect(p.getByRole("region", { name: "Not found" })).toBeVisible()
    })
  }
  fs.rmSync(dir, { recursive: true, force: true })
})
