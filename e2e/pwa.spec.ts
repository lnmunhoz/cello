import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"

/** The app icon's colours (docs/specs/app-icon): the ink agent on orange. */
const INK = "#141416"
const ORANGE = "#FF7A2F"

/** Chrome's own reading of the page's manifest. */
const appManifest = async (page: Page) => {
  const cdp = await page.context().newCDPSession(page)
  const manifest = await cdp.send("Page.getAppManifest")
  return { cdp, manifest, data: JSON.parse(manifest.data ?? "{}") as Record<string, unknown> }
}

/** Width and height from a PNG's header (the IHDR chunk). */
const pngSize = (bytes: Buffer) => `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`

/** How many pixels of an image lie outside the centred circle of radius `radius` × width and aren't `colour`. */
const pixelsOutsideCircle = (page: Page, src: string, radius: number, colour: string) =>
  page.evaluate(
    async ([src, radius, colour]) => {
      const image = new Image()
      image.src = src
      await image.decode()
      const canvas = Object.assign(document.createElement("canvas"), { width: image.width, height: image.height })
      const context = canvas.getContext("2d")!
      context.drawImage(image, 0, 0)
      const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height)
      const want = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16))
      const r = width * radius
      let count = 0
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2) <= r) continue
          const i = (y * width + x) * 4
          if (want.some((c, k) => Math.abs(data[i + k]! - c) > 2)) count++
        }
      }
      return count
    },
    [src, radius, colour] as const,
  )

test("the app is installable: Chrome finds a valid manifest and no installability errors", async ({ page }) => {
  await page.goto("/")
  await page.waitForLoadState("networkidle")
  const { cdp, manifest, data } = await appManifest(page)
  expect(manifest.url).toMatch(/\/manifest\.webmanifest$/)
  expect(manifest.errors).toEqual([])
  expect(data).toMatchObject({ name: "Cello", short_name: "Cello", display: "standalone", start_url: "/" })
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors")
  expect(installabilityErrors).toEqual([])
})

test("CEL-27: every icon is the teardrop agent: manifest icons at their sizes, a maskable one inside the safe zone, favicons and the touch icon", async ({ page }) => {
  await page.goto("/")
  await page.waitForLoadState("networkidle")

  // The manifest takes its colours from the icon, and lists each size once.
  const { data } = await appManifest(page)
  expect(data).toMatchObject({ theme_color: INK, background_color: ORANGE })
  expect(data.icons).toEqual([
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
  ])
  for (const icon of data.icons as Array<{ src: string; sizes: string; type: string }>) {
    const response = await page.request.get(icon.src)
    expect(response.headers()["content-type"]).toBe(icon.type)
    if (icon.type === "image/png") expect(pngSize(await response.body())).toBe(icon.sizes)
  }

  // Maskable: the whole agent sits inside the 80% safe zone, so any mask shape keeps it whole. The plain
  // icon's tip reaches past that circle, which shows the check can tell the two apart.
  expect(await pixelsOutsideCircle(page, "/icons/icon-maskable-512.png", 0.4, ORANGE)).toBe(0)
  expect(await pixelsOutsideCircle(page, "/icons/icon-512.png", 0.4, ORANGE)).toBeGreaterThan(0)

  // The page head: an SVG favicon with an .ico fallback, the touch icon and the theme colour.
  const head = await page.evaluate(() => ({
    icons: [...document.querySelectorAll<HTMLLinkElement>("link[rel=icon]")].map((l) => ({
      href: l.getAttribute("href"),
      type: l.getAttribute("type"),
      sizes: l.getAttribute("sizes"),
    })),
    touch: document.querySelector("link[rel=apple-touch-icon]")?.getAttribute("href"),
    theme: document.querySelector("meta[name=theme-color]")?.getAttribute("content"),
  }))
  expect(head).toEqual({
    icons: [
      { href: "/favicon.ico", type: null, sizes: "32x32" },
      { href: "/icons/icon.svg", type: "image/svg+xml", sizes: null },
    ],
    touch: "/icons/apple-touch-icon.png",
    theme: INK,
  })
  const svg = await (await page.request.get("/icons/icon.svg")).text()
  expect(svg).toContain(`fill="${ORANGE}"`)
  expect(svg).toContain(`fill="${INK}"`)
  const ico = await (await page.request.get("/favicon.ico")).body()
  // An icon directory (reserved 0, type 1) holding 16, 32 and 48 px images.
  expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 3])
  expect([0, 1, 2].map((n) => ico[6 + n * 16])).toEqual([16, 32, 48])
  expect(pngSize(await (await page.request.get("/icons/apple-touch-icon.png")).body())).toBe("180x180")
})
