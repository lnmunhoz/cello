// Builds every icon the apps ship from the app icon's sources in this folder (docs/specs/app-icon).
//   bun art/icon/build-app-icons.mjs           write them
//   bun art/icon/build-app-icons.mjs --check   exit 1 if a committed file differs from a fresh build
// Needs resvg 0.47.0 (brew install resvg; another version may rasterise edges differently) and macOS's
// iconutil. The same sources and resvg version give the same bytes.
//
//   favicon.svg → apps/web/public/icons/icon.svg           the tab icon, and the manifest's SVG icon
//               → apps/web/public/favicon.ico              16, 32 and 48 px, for browsers that skip the SVG
//   icon.svg    → apps/web/public/icons/icon-192.png       manifest, purpose "any"
//               → apps/web/public/icons/icon-512.png       manifest, purpose "any"
//               → apps/web/public/icons/icon-maskable-512.png   the agent at 80%, inside the safe zone
//               → apps/web/public/icons/apple-touch-icon.png    180 px, full bleed (iOS rounds the corners)
//               → apps/desktop/resources/icon.png          1024 px in the macOS shape: the Dock icon in dev
//               → apps/desktop/resources/icon.icns         the same at every size: the packaged Cello.app
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "../..")
const check = process.argv.includes("--check")

/** A source: a 1024 canvas whose first element is the background, then the agent. */
const source = (file) => {
  const svg = fs.readFileSync(path.join(here, file), "utf8")
  const match = svg.match(/^<svg [^>]*viewBox="0 0 1024 1024"[^>]*><rect width="1024" height="1024" fill="(#[0-9A-Fa-f]{6})"\/>(.*)<\/svg>\s*$/s)
  if (!match) throw new Error(`${file}: expected a 1024 x 1024 SVG whose first element is the background rect`)
  return { svg, background: match[1], agent: match[2] }
}
const canvas = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${inner}</svg>\n`

const icon = source("icon.svg")
const favicon = source("favicon.svg")

// Maskable: launchers crop to any shape inside the centred circle of radius 40% (410 px here). At 80%
// the agent's farthest point, the tip, sits 366 px from the centre.
const MASKABLE_SCALE = 0.8
const maskable = canvas(
  `<rect width="1024" height="1024" fill="${icon.background}"/>` +
    `<g transform="translate(512 512) scale(${MASKABLE_SCALE}) translate(-512 -512)">${icon.agent}</g>`,
)

// macOS doesn't round icons itself: Apple's grid puts an 824 px rounded square (radius 185.4) in the
// middle of the 1024 canvas, with a soft shadow below. The full-bleed icon is scaled into it.
const BODY = 824
const INSET = (1024 - BODY) / 2
const body = `x="${INSET}" y="${INSET}" width="${BODY}" height="${BODY}" rx="185.4"`
const macos = canvas(
  `<defs><clipPath id="body"><rect ${body}/></clipPath>` +
    `<filter id="shadow" filterUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">` +
    `<feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#000" flood-opacity="0.3"/></filter></defs>` +
    `<rect ${body} fill="${icon.background}" filter="url(#shadow)"/>` +
    `<g clip-path="url(#body)"><g transform="translate(${INSET} ${INSET}) scale(${BODY / 1024})">${icon.agent}</g></g>`,
)

const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { encoding: "utf8" })
  if (result.error) throw new Error(`${cmd}: ${result.error.message} (is it installed?)`)
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${result.stderr}`)
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cello-icons-"))
let n = 0
/** The SVG rendered at size × size, as PNG bytes. */
const png = (svg, size) => {
  const input = path.join(temp, `${n}.svg`)
  const output = path.join(temp, `${n++}.png`)
  fs.writeFileSync(input, svg)
  run("resvg", ["-w", String(size), "-h", String(size), input, output])
  return fs.readFileSync(output)
}

/** A .ico holding the PNGs as they are (every current browser reads PNG entries). */
const ico = (images) => {
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, bytes }, i) => {
    const entry = 6 + 16 * i
    header.writeUInt8(size >= 256 ? 0 : size, entry)
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1)
    header.writeUInt16LE(1, entry + 4) // colour planes
    header.writeUInt16LE(32, entry + 6) // bits per pixel
    header.writeUInt32LE(bytes.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += bytes.length
  })
  return Buffer.concat([header, ...images.map((image) => image.bytes)])
}

/** A .icns from iconutil, with every size of an .iconset rendered from the SVG (not scaled down from 1024). */
const icns = (svg) => {
  const set = path.join(temp, "icon.iconset")
  fs.mkdirSync(set)
  for (const size of [16, 32, 128, 256, 512]) {
    fs.writeFileSync(path.join(set, `icon_${size}x${size}.png`), png(svg, size))
    fs.writeFileSync(path.join(set, `icon_${size}x${size}@2x.png`), png(svg, size * 2))
  }
  const output = path.join(temp, "icon.icns")
  run("iconutil", ["-c", "icns", set, "-o", output])
  return fs.readFileSync(output)
}

const outputs = {
  "apps/web/public/icons/icon.svg": Buffer.from(favicon.svg),
  "apps/web/public/favicon.ico": ico([16, 32, 48].map((size) => ({ size, bytes: png(favicon.svg, size) }))),
  "apps/web/public/icons/icon-192.png": png(icon.svg, 192),
  "apps/web/public/icons/icon-512.png": png(icon.svg, 512),
  "apps/web/public/icons/icon-maskable-512.png": png(maskable, 512),
  "apps/web/public/icons/apple-touch-icon.png": png(icon.svg, 180),
  "apps/desktop/resources/icon.png": png(macos, 1024),
  "apps/desktop/resources/icon.icns": icns(macos),
}
fs.rmSync(temp, { recursive: true, force: true })

const stale = []
for (const [file, bytes] of Object.entries(outputs)) {
  const target = path.join(root, file)
  const same = fs.existsSync(target) && fs.readFileSync(target).equals(bytes)
  if (check) {
    if (!same) stale.push(file)
    continue
  }
  if (!same) fs.writeFileSync(target, bytes)
  console.log(`${same ? "unchanged" : "wrote    "} ${file}`)
}
if (check) {
  if (stale.length > 0) {
    const resvg = spawnSync("resvg", ["--version"], { encoding: "utf8" }).stdout.trim()
    console.error(`Out of date (run bun art/icon/build-app-icons.mjs):\n  ${stale.join("\n  ")}`)
    console.error(`Built with resvg ${resvg}; the committed icons were made with resvg 0.47.0.`)
    process.exit(1)
  }
  console.log(`All ${Object.keys(outputs).length} icons match their sources.`)
}
