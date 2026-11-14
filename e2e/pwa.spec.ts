import { expect, test } from "./fixtures.ts"

test("the app is installable: Chrome finds a valid manifest and no installability errors", async ({ page }) => {
  await page.goto("/")
  await page.waitForLoadState("networkidle")
  const cdp = await page.context().newCDPSession(page)
  const manifest = await cdp.send("Page.getAppManifest")
  expect(manifest.url).toMatch(/\/manifest\.webmanifest$/)
  expect(manifest.errors).toEqual([])
  expect(JSON.parse(manifest.data ?? "{}")).toMatchObject({ name: "Cello", short_name: "Cello", display: "standalone", start_url: "/" })
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors")
  expect(installabilityErrors).toEqual([])
  for (const icon of ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"]) {
    expect((await page.request.get(icon)).headers()["content-type"]).toBe("image/png")
  }
})
