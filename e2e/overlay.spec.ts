// The video overlay itself (e2e/fixtures.ts): the cursor and click ripple, also for clicks inside
// iframes (the viewer frames pages), and captions that can show the URL and last through a reload.
import { caption, captionWithUrl, expect, test } from "./fixtures.ts"

const FRAMED = "http://framed.cello.test/"

test("the overlay follows a click inside an iframe: one cursor, on the page, with the ripple where the click lands", async ({ page }) => {
  // Another origin, as the viewer's framed sites are; Playwright serves it, nothing listens there.
  await page.route(`${FRAMED}**`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><body style="margin:0;font:16px system-ui">
        <button style="position:absolute;left:120px;top:80px;width:160px;height:40px">Inside the frame</button></body>`,
    }))
  await page.goto("/")
  await page.evaluate((src) => {
    const frame = Object.assign(document.createElement("iframe"), { src, title: "Framed page" })
    frame.style.cssText = "position:fixed;left:300px;top:200px;width:600px;height:400px;border:0;z-index:2147483600"
    document.body.append(frame)
  }, FRAMED)
  const framed = page.frameLocator('iframe[title="Framed page"]')

  await caption(page, "Click a button inside an iframe: the cursor and its ripple follow it")
  await framed.getByRole("button", { name: "Inside the frame" }).click()
  // The button's centre: the frame's corner (300, 200) plus the button's centre in the frame (200, 100).
  await expect(page.locator("#e2e-cursor")).toHaveAttribute("data-press", "500,300")
  await expect(page.locator("#e2e-cursor")).toHaveCSS("left", "500px")
  await expect(framed.locator("#e2e-cursor")).toHaveCount(0)
})

test("a caption can show the page's URL, follows in-app navigation, and stays through a reload", async ({ page }) => {
  await page.goto("/settings")
  const box = page.locator("#e2e-caption")
  const path = () => {
    const url = new URL(page.url())
    return `${url.pathname}${url.search}`
  }

  await captionWithUrl(page, "Reload: the URL stays")
  await expect(box).toContainText("Reload: the URL stays")
  await expect(box.locator("[data-url]")).toHaveText(path())

  await page.evaluate(() => history.pushState(null, "", `${location.pathname}?from=e2e`))
  await expect(box.locator("[data-url]")).toHaveText(path())
  expect(path()).toContain("?from=e2e")

  await page.reload()
  await expect(box).toContainText("Reload: the URL stays")
  await expect(box.locator("[data-url]")).toHaveText(path())

  await caption(page, "A plain caption has no URL")
  await expect(box.locator("[data-url]")).toHaveCount(0)
})
