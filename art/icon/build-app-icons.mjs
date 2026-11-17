// Builds every icon the apps ship from the app icon's sources in this folder (docs/specs/app-icon).
//   bun art/icon/build-app-icons.mjs           write them
//   bun art/icon/build-app-icons.mjs --check   exit 1 if a committed file differs from a fresh build
// Needs resvg 0.47.0 (brew install resvg; another version may rasterise edges differently). The same
// sources and resvg version give the same bytes.
//
//   favicon.svg → apps/web/public/icons/icon.svg           the tab icon, and the manifest's SVG icon
//               → apps/web/public/favicon.ico              16, 32 and 48 px, for browsers that skip the SVG
//   icon.svg    → apps/web/public/icons/icon-192.png       manifest, purpose "any"
//               → apps/web/public/icons/icon-512.png       manifest, purpose "any"
//               → apps/web/public/icons/icon-maskable-512.png   the agent at 80%, inside the safe zone
//               → apps/web/public/icons/apple-touch-icon.png    180 px, full bleed (iOS rounds the corners)
//               → apps/desktop/resources/icon.png          1024 px in the macOS shape: the Dock icon in dev
//               → apps/desktop/resources/Cello.icon/       an Icon Composer document (icon.json and the agent
//                                                          layer): the packaged Cello.app, compiled by
//                                                          electron-builder with Xcode's actool
//               → apps/desktop/resources/CelloDev.icon/    the same with a "DEV" badge layer: Cello Dev.app, the
//                                                          build made on the Mac (CEL-149)
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

// The packaged app's icon is an Icon Composer document, so macOS 26 draws it flat instead of redrawing a
// plain .icns as glass (decided 2026-11-15, docs/specs/app-icon). One layer: the agent, its eyes cut out
// so the fill shows through. Glass, shadow, specular and translucency are off. The orange fill is pinned
// for the dark appearance too: without it macOS's dark icon style draws a black tile and the ink agent
// all but vanishes.
const roundedRect = (x, y, w, h, r) =>
  `M${x + r} ${y} H${x + w - r} A${r} ${r} 0 0 1 ${x + w} ${y + r} V${y + h - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h} ` +
  `H${x + r} A${r} ${r} 0 0 1 ${x} ${y + h - r} V${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z`
const iconComposer = (() => {
  const match = icon.agent.match(/^<g transform="([^"]+)"><path d="([^"]+)" fill="(#[0-9A-Fa-f]{6})"\/><g fill="(#[0-9A-Fa-f]{6})">((?:<rect [^>]*\/>)+)<\/g><\/g>$/)
  const holes = match ? [...match[5].matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="([\d.]+)"\/>/g)] : []
  if (!match || match[4] !== icon.background || holes.length !== match[5].split("<rect").length - 1) {
    throw new Error("icon.svg: expected the agent as <g transform><path fill=ink/><g fill=background>eye <rect>s</g></g>; update the .icon layer here")
  }
  const [, transform, body, ink] = match
  const eyes = holes.map(([, ...values]) => roundedRect(...values.map(Number)))
  const layer = canvas(`<g transform="${transform}"><path fill="${ink}" fill-rule="evenodd" d="${body} ${eyes.join(" ")}"/></g>`)
  const srgb = (hex) => `srgb:${[1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5)).join(",")},1.00000`
  const fill = { solid: srgb(icon.background) }
  const iconJson = {
    "fill-specializations": [{ value: fill }, { appearance: "dark", value: fill }],
    groups: [
      {
        layers: [{ glass: false, "image-name": "agent.svg", name: "agent" }],
        shadow: { kind: "none", opacity: 0 },
        specular: false,
        translucency: { enabled: false, value: 0 },
      },
    ],
    "supported-platforms": { squares: "shared" },
  }
  return { json: `${JSON.stringify(iconJson, null, 2)}\n`, layer, iconJson, ink }
})()

// Cello Dev's icon (CEL-149): the same document with a "DEV" badge layer on top, an ink pill below the agent with
// the letters cut out so the orange fill shows through, like the agent's eyes. Letters are paths (cap height 100,
// strokes 24), so actool needs no font.
const devIcon = (() => {
  const D = "M0 0 H38 A50 50 0 0 1 88 50 A50 50 0 0 1 38 100 H0 Z M24 24 V76 H38 A26 26 0 0 0 64 50 A26 26 0 0 0 38 24 Z"
  const E = "M0 0 H72 V22 H24 V39 H62 V61 H24 V78 H72 V100 H0 Z"
  const V = "M0 0 H26 L48 70 L70 0 H96 L62 100 H34 Z"
  const letters = [
    { d: D, width: 88 },
    { d: E, width: 72 },
    { d: V, width: 96 },
  ]
  const GAP = 18
  const CAP = 84
  const scale = CAP / 100
  const lettersWidth = (letters.reduce((sum, l) => sum + l.width, 0) + GAP * (letters.length - 1)) * scale
  const [padX, padY] = [52, 34]
  const [w, h] = [lettersWidth + 2 * padX, CAP + 2 * padY]
  const [x, y] = [512 - w / 2, 952 - h]
  let at = 0
  const placed = letters.map(({ d, width }) => {
    const g = `<path transform="translate(${(x + padX + at * scale).toFixed(2)} ${y + padY}) scale(${scale})" d="${d}"/>`
    at += width + GAP
    return g
  })
  // The ink pill, then the letters on it in the icon's orange: on a flat layer with no glass that reads the same as
  // holes cut through to the fill.
  const badge = canvas(
    `<path fill="${iconComposer.ink}" d="${roundedRect(x, y, w, h, h / 2)}"/>` + `<g fill="${icon.background}">${placed.join("")}</g>`,
  )
  const json = {
    ...iconComposer.iconJson,
    groups: [
      { ...iconComposer.iconJson.groups[0], layers: [{ glass: false, "image-name": "dev-badge.svg", name: "dev-badge" }] },
      ...iconComposer.iconJson.groups,
    ],
  }
  return { json: `${JSON.stringify(json, null, 2)}\n`, badge }
})()

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

const outputs = {
  "apps/web/public/icons/icon.svg": Buffer.from(favicon.svg),
  "apps/web/public/favicon.ico": ico([16, 32, 48].map((size) => ({ size, bytes: png(favicon.svg, size) }))),
  "apps/web/public/icons/icon-192.png": png(icon.svg, 192),
  "apps/web/public/icons/icon-512.png": png(icon.svg, 512),
  "apps/web/public/icons/icon-maskable-512.png": png(maskable, 512),
  "apps/web/public/icons/apple-touch-icon.png": png(icon.svg, 180),
  "apps/desktop/resources/icon.png": png(macos, 1024),
  "apps/desktop/resources/Cello.icon/icon.json": Buffer.from(iconComposer.json),
  "apps/desktop/resources/Cello.icon/Assets/agent.svg": Buffer.from(iconComposer.layer),
  "apps/desktop/resources/CelloDev.icon/icon.json": Buffer.from(devIcon.json),
  "apps/desktop/resources/CelloDev.icon/Assets/agent.svg": Buffer.from(iconComposer.layer),
  "apps/desktop/resources/CelloDev.icon/Assets/dev-badge.svg": Buffer.from(devIcon.badge),
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
  if (!same) {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, bytes)
  }
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
