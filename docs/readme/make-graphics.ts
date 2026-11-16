// Draws the README's graphics as light and dark SVGs: `bun docs/readme/make-graphics.ts`.
// Hand-written geometry, no fonts to load: GitHub shows SVGs as images, so text uses the system font.
// The agent marks (Cello's teardrop logo) move with CSS animations, which GitHub plays in SVG images;
// readers who ask for reduced motion get the still picture.
import { writeFileSync } from "node:fs"
import { join } from "node:path"

const dir = import.meta.dir

type Tint = { fill: string; stroke: string; accent: string }
type Theme = {
  bg: string
  text: string
  muted: string
  line: string
  chip: string
  chipText: string
  card: string
  tint: Record<"blue" | "orange" | "purple" | "green" | "yellow", Tint>
}

const light: Theme = {
  bg: "#FFFFFF",
  text: "#18181B",
  muted: "#52525B",
  line: "#A1A1AA",
  chip: "#F4F4F5",
  chipText: "#3F3F46",
  card: "#FFFFFF",
  tint: {
    blue: { fill: "#EFF6FF", stroke: "#93C5FD", accent: "#2563EB" },
    orange: { fill: "#FFF4EC", stroke: "#FDBA8C", accent: "#EA6A1F" },
    purple: { fill: "#F5F3FF", stroke: "#C4B5FD", accent: "#7C3AED" },
    green: { fill: "#ECFDF5", stroke: "#86EFAC", accent: "#16A34A" },
    yellow: { fill: "#FEFCE8", stroke: "#FACC15", accent: "#A16207" },
  },
}

const dark: Theme = {
  bg: "#0D1117",
  text: "#F4F4F5",
  muted: "#A1A1AA",
  line: "#52525B",
  chip: "#1F2328",
  chipText: "#D4D4D8",
  card: "#161B22",
  tint: {
    blue: { fill: "#0F1B2E", stroke: "#1E40AF", accent: "#60A5FA" },
    orange: { fill: "#24160D", stroke: "#9A4A1A", accent: "#FF8A47" },
    purple: { fill: "#1B1530", stroke: "#5B3FB0", accent: "#A78BFA" },
    green: { fill: "#0E2118", stroke: "#166534", accent: "#4ADE80" },
    yellow: { fill: "#221D0B", stroke: "#854D0E", accent: "#FACC15" },
  },
}

const ORANGE = "#FF7A2F"
const INK = "#141416"
const NAVY = "#0F1B3D"
const CREAM = "#FBF3E3"

const SANS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`
const MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const text = (x: number, y: number, s: string, o: { size?: number; weight?: number; fill: string; anchor?: string; mono?: boolean; italic?: boolean }) =>
  `<text x="${x}" y="${y}" font-family="${o.mono ? MONO : SANS}" font-size="${o.size ?? 16}" font-weight="${o.weight ?? 400}"${o.italic ? ` font-style="italic"` : ""} fill="${o.fill}" text-anchor="${o.anchor ?? "start"}">${esc(s)}</text>`

const arrowHead = (id: string, fill: string) =>
  `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${fill}"/></marker>`

// Shared motion: blinking eyes, and nothing at all for readers who ask for less motion.
const BASE_CSS = `
.blink { transform-box: fill-box; transform-origin: center; animation: blink 4.2s infinite; }
.d1 .blink { animation-delay: -1.3s; } .d2 .blink { animation-delay: -2.6s; } .d3 .blink { animation-delay: -3.4s; }
@keyframes blink { 0%, 92%, 100% { transform: scaleY(1); } 95% { transform: scaleY(0.1); } }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
`

const svg = (w: number, h: number, t: Theme, body: string, label: string, css: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}">
<style>${BASE_CSS}${css}</style>
<defs>${arrowHead("a", t.line)}${arrowHead("y", t.tint.yellow.accent)}${arrowHead("o", t.tint.orange.accent)}</defs>
<rect width="${w}" height="${h}" rx="16" fill="${t.bg}"/>
${body}
</svg>
`

// The agent mark, centred on its round body at (0, 0), `size` px across the body.
// An orange ring keeps it readable where marks overlap or sit on dark backgrounds, like the ensemble icon.
const BODY = "M205 185 L312.4 633 A270 270 0 1 0 648.4 310.2 Z"
function mark(size: number, body: string, o: { eyes?: string; ring?: string; eyesClass?: string } = {}) {
  const s = size / 540
  const eyes = o.eyes ?? ORANGE
  const ring = o.ring ?? ORANGE
  return `<g transform="scale(${s.toFixed(4)}) translate(-575 -570)">
<path d="${BODY}" fill="${ring}" stroke="${ring}" stroke-width="70" stroke-linejoin="round"/>
<path d="${BODY}" fill="${body}"/>
<g class="${o.eyesClass ?? ""}"><g class="blink" fill="${eyes}"><rect x="470" y="513" width="80" height="124" rx="40"/><rect x="600" y="513" width="80" height="124" rx="40"/></g></g>
</g>`
}

// Keyframes that move an element through (percent, x, y) stops, holding where two stops repeat.
const path = (name: string, stops: Array<[number, number, number]>) =>
  `@keyframes ${name} {${stops.map(([p, x, y]) => ` ${p}% { transform: translate(${x}px, ${y}px); }`).join("")} }`
// Keyframes that show an element (opacity 1) during the given percent windows.
const windows = (name: string, ws: Array<[number, number]>, on = 1) => {
  const parts: string[] = [` 0% { opacity: 0; }`]
  for (const [a, b] of ws) parts.push(` ${Math.max(a - 1.5, 0)}% { opacity: 0; } ${a}% { opacity: ${on}; } ${b}% { opacity: ${on}; } ${Math.min(b + 1.5, 100)}% { opacity: 0; }`)
  parts.push(` 100% { opacity: 0; }`)
  return `@keyframes ${name} {${parts.join("")} }`
}

// ── The loop: how one piece of work goes from a request to Done ──────────────

function loop(t: Theme) {
  const W = 1100
  const X = 200 // main column
  const BW = 520
  const BH = 112
  const CX = X + BW / 2
  const gap = 150
  const top = 130
  const LANE = X + BW + 55 // where the travelling agent walks
  const steps: Array<{ n: string; tint: keyof Theme["tint"]; who: string; title: string; sub: string; cmd: string }> = [
    { n: "1", tint: "blue", who: "YOU", title: "You ask for something", sub: "In chat with your agent, or as a card on the board", cmd: `cello task create "Gift cards at checkout"` },
    { n: "2", tint: "orange", who: "AGENT", title: "An agent claims it", sub: "The card moves to In Progress and shows who is on it", cmd: "cello task claim SHOP-8" },
    { n: "3", tint: "orange", who: "AGENT", title: "It builds and tests, in its own worktree", sub: "Test first, then a fresh reviewer agent reads the diff", cmd: "cello task stage SHOP-8 review" },
    { n: "4", tint: "purple", who: "AGENT", title: "It hands you a review packet", sub: "A summary, steps to check, videos and screenshots", cmd: "cello task submit SHOP-8 --attach flow.mp4" },
    { n: "5", tint: "blue", who: "YOU", title: "You decide, on the Review page", sub: "Watch the evidence, then approve or send it back", cmd: "Approve  ·  Send back  ·  Comment" },
  ]
  const mid = (i: number) => top + i * gap + BH / 2
  const y5 = top + 4 * gap
  const doneY = y5 + BH + 44
  const y3 = top + 2 * gap
  const nx = X + BW + 110
  const nw = W - nx - 30
  const ny = y3 - 34
  const cy = top + 4 * gap - 6

  // One 22 s story: claim, work, ask, hand over, get sent back, fix, hand over again, approved.
  const sy = mid(1) // the traveller's home (step 2)
  const at = (i: number) => mid(i) - sy
  const doneDy = doneY + 24 - sy
  const css = `
.trav { animation: trav 22s ease-in-out infinite; }
.trav-hop { transform-box: fill-box; transform-origin: 50% 100%; animation: travHop 22s ease-in-out infinite; }
.trav-fade { animation: travFade 22s linear infinite; }
${path("trav", [
  [0, 0, 0], [8, 0, 0], [13, 0, at(2)], [16, 0, at(2)], [18, 34, at(2)], [22, 34, at(2)], [24, 0, at(2)], [27, 0, at(2)],
  [31, 0, at(3)], [35, 0, at(3)], [38, 0, at(4)], [44, 0, at(4)], [52, 0, at(2)], [60, 0, at(2)], [63, 0, at(3)], [67, 0, at(3)],
  [70, 0, at(4)], [76, 0, at(4)], [80, 0, doneDy], [84, CX + 128 - LANE, doneDy], [100, CX + 128 - LANE, doneDy],
])}
@keyframes travHop { 0%, 3%, 7.5%, 85%, 89%, 93%, 100% { transform: translateY(0) scale(1, 1); }
  5% { transform: translateY(-18px) scale(.95, 1.06); } 87% { transform: translateY(-22px) scale(.95, 1.06); } 91% { transform: translateY(-12px); }
  27.5%, 29%, 64%, 65.5% { transform: rotate(-8deg); } 28.2%, 64.8% { transform: rotate(8deg); } }
@keyframes travFade { 0% { opacity: 0; } 2% { opacity: 1; } 95% { opacity: 1; } 98%, 100% { opacity: 0; } }
${windows("g1", [[1, 12]])} ${windows("g2", [[13, 31], [52, 67]])} ${windows("gAsk", [[17, 24]])} ${windows("g3", [[31, 38], [67, 72]])}
${windows("g4", [[38, 46], [72, 80]])} ${windows("gDone", [[84, 96]])} ${windows("gWords", [[44, 54]])}
.g1 { animation: g1 22s infinite; } .g2 { animation: g2 22s infinite; } .gAsk { animation: gAsk 22s infinite; }
.g3 { animation: g3 22s infinite; } .g4 { animation: g4 22s infinite; } .gDone { animation: gDone 22s infinite; } .gWords { animation: gWords 22s infinite; }
.bubbleAsk { animation: gAsk 22s infinite; } .bubbleWords { animation: gWords 22s infinite; }
.note { offset-path: path("M ${X} ${y5 + 56} H ${X - 70} V ${y3 + 56} H ${X}"); offset-rotate: 0deg; animation: noteGo 22s ease-in-out infinite; }
@keyframes noteGo { 0%, 45% { offset-distance: 0%; opacity: 0; } 46% { opacity: 1; offset-distance: 0%; } 52% { offset-distance: 100%; opacity: 1; } 53%, 100% { offset-distance: 100%; opacity: 0; } }
.think { transform-box: fill-box; transform-origin: 50% 100%; animation: think 3.2s ease-in-out infinite alternate; }
@keyframes think { from { transform: rotate(-7deg); } to { transform: rotate(5deg); } }
.look { animation: look 22s ease-in-out infinite; }
@keyframes look { 0%, 16%, 25%, 100% { transform: translate(0, 0); } 18%, 23% { transform: translate(-60px, 10px); } }
.bob { animation: bob 2.6s ease-in-out infinite alternate; }
@keyframes bob { to { transform: translateY(-5px); } }
`

  let b = ""
  b += text(40, 56, "How work flows through Cello", { size: 30, weight: 700, fill: t.text })
  b += text(40, 88, "Agents do the work through the cello CLI. You stay in the loop on a live board.", { size: 17, fill: t.muted })

  const glowFor = ["", "g1", "g2", "g3", "g4"]
  steps.forEach((s, i) => {
    const y = top + i * gap
    const c = t.tint[s.tint]
    b += `<rect x="${X}" y="${y}" width="${BW}" height="${BH}" rx="14" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/>`
    if (glowFor[i]) b += `<rect class="${glowFor[i]}" x="${X - 3}" y="${y - 3}" width="${BW + 6}" height="${BH + 6}" rx="16" fill="none" stroke="${c.accent}" stroke-width="3" opacity="0"/>`
    b += `<circle cx="${X + 36}" cy="${y + 38}" r="17" fill="${c.accent}"/>`
    b += text(X + 36, y + 44, s.n, { size: 17, weight: 700, fill: t.bg, anchor: "middle" })
    b += text(X + BW - 22, y + 30, s.who, { size: 12, weight: 700, fill: c.accent, anchor: "end" })
    b += text(X + 68, y + 36, s.title, { size: 20, weight: 650, fill: t.text })
    b += text(X + 68, y + 62, s.sub, { size: 15, fill: t.muted })
    b += `<rect x="${X + 68}" y="${y + 74}" width="${BW - 90}" height="26" rx="6" fill="${t.chip}"/>`
    b += text(X + 80, y + 92, s.cmd, { size: 13.5, fill: t.chipText, mono: true })
    if (i < steps.length - 1) b += `<line x1="${CX}" y1="${y + BH}" x2="${CX}" y2="${y + gap - 4}" stroke="${t.line}" stroke-width="2" marker-end="url(#a)"/>`
  })

  // Done
  const g = t.tint.green
  b += `<line x1="${CX}" y1="${y5 + BH}" x2="${CX}" y2="${doneY - 4}" stroke="${t.line}" stroke-width="2" marker-end="url(#a)"/>`
  b += text(CX + 12, y5 + BH + 28, "Approve", { size: 14, weight: 600, fill: g.accent })
  b += `<rect x="${CX - 90}" y="${doneY}" width="180" height="48" rx="24" fill="${g.fill}" stroke="${g.stroke}" stroke-width="1.5"/>`
  b += `<rect class="gDone" x="${CX - 93}" y="${doneY - 3}" width="186" height="54" rx="27" fill="none" stroke="${g.accent}" stroke-width="3" opacity="0"/>`
  b += text(CX, doneY + 31, "Done", { size: 19, weight: 700, fill: g.accent, anchor: "middle" })

  // Send back: from step 5's left edge, around the left, into step 3
  const o = t.tint.orange
  const lx = X - 70
  b += `<path d="M ${X} ${y5 + 56} H ${lx} V ${y3 + 56} H ${X - 4}" fill="none" stroke="${o.accent}" stroke-width="2" stroke-dasharray="7 6" marker-end="url(#o)"/>`
  b += `<g transform="translate(${lx - 14} ${(y3 + y5) / 2 + 56}) rotate(-90)">${text(0, 0, "Send back with a note", { size: 14, weight: 600, fill: o.accent, anchor: "middle" })}</g>`
  // the note travelling back to the agent
  b += `<g class="note" opacity="0"><g transform="translate(-15 -11)"><rect width="30" height="22" rx="5" fill="${o.accent}"/><rect x="6" y="6" width="18" height="2.5" rx="1" fill="${t.bg}"/><rect x="6" y="12" width="12" height="2.5" rx="1" fill="${t.bg}"/></g></g>`

  // Side note: asking for a decision
  const yl = t.tint.yellow
  b += `<rect x="${nx}" y="${ny}" width="${nw}" height="196" rx="14" fill="${yl.fill}" stroke="${yl.stroke}" stroke-width="1.5" stroke-dasharray="6 5"/>`
  b += `<rect class="gAsk" x="${nx - 3}" y="${ny - 3}" width="${nw + 6}" height="202" rx="16" fill="none" stroke="${yl.accent}" stroke-width="3" opacity="0"/>`
  b += text(nx + 18, ny + 32, "Stuck on a decision?", { size: 16, weight: 700, fill: t.text })
  ;["The agent asks on the card:", "options, its pick and why.", "The task waits in Needs input;", "you answer next to the", "screenshots, and it carries on."].forEach((l, i) => {
    b += text(nx + 18, ny + 60 + i * 21, l, { size: 14, fill: t.muted })
  })
  b += `<rect x="${nx + 18}" y="${ny + 158}" width="${nw - 36}" height="22" rx="5" fill="${t.chip}"/>`
  b += text(nx + 28, ny + 173, "cello task ask SHOP-8", { size: 12.5, fill: t.chipText, mono: true })
  // a thinking agent in the note's corner, with a question bubble when the traveller asks
  b += `<g transform="translate(${nx + nw - 34} ${ny + 30})"><g class="think d2">${mark(30, INK, { eyesClass: "look" })}</g></g>`
  b += `<g class="bubbleAsk" opacity="0"><circle cx="${nx + nw - 58}" cy="${ny + 4}" r="11" fill="${yl.accent}"/>${text(nx + nw - 58, ny + 9, "?", { size: 15, weight: 800, fill: t.bg, anchor: "middle" })}</g>`

  // Side note: comments reach the agent
  b += `<rect x="${nx}" y="${cy}" width="${nw}" height="124" rx="14" fill="none" stroke="${t.line}" stroke-width="1.5" stroke-dasharray="6 5"/>`
  b += `<rect class="gWords" x="${nx - 3}" y="${cy - 3}" width="${nw + 6}" height="130" rx="16" fill="none" stroke="${o.accent}" stroke-width="3" opacity="0"/>`
  b += text(nx + 18, cy + 30, "Your words reach it", { size: 16, weight: 700, fill: t.text })
  ;["Comments, notes and emoji", "land in the agent's session", "by themselves, even when", "it's idle."].forEach((l, i) => {
    b += text(nx + 18, cy + 56 + i * 20, l, { size: 14, fill: t.muted })
  })
  b += `<g transform="translate(${nx + nw - 30} ${cy + 26})"><g class="bob d3">${mark(28, CREAM)}</g></g>`
  b += `<g class="bubbleWords" opacity="0"><rect x="${nx + nw - 76}" y="${cy - 14}" width="34" height="22" rx="8" fill="${o.accent}"/>${text(nx + nw - 59, cy + 2, "✎", { size: 14, weight: 700, fill: t.bg, anchor: "middle" })}</g>`

  // The travelling agent, last so it walks over everything
  b += `<g transform="translate(${LANE} ${sy})"><g class="trav"><g class="trav-fade"><g class="trav-hop d1">${mark(40, INK)}</g></g></g></g>`

  const H = doneY + 48 + 70
  b += text(40, H - 30, "Every change is an event: which agent, which conversation, when. The board replays it live.", { size: 15, fill: t.muted })
  return svg(W, H, t, b, "How work flows through Cello: you ask, an agent claims, builds and tests, submits a review packet, and you approve or send it back.", css)
}

// ── How the pieces fit ───────────────────────────────────────────────────────

function architecture(t: Theme) {
  const W = 1040
  const o = t.tint.orange
  const p = t.tint.purple
  const bl = t.tint.blue
  let b = ""
  let css = ""
  b += text(40, 56, "One local server, many agents, one board", { size: 30, weight: 700, fill: t.text })
  b += text(40, 88, "Everything runs on your machine. No accounts, no cloud, no waiting on the network.", { size: 17, fill: t.muted })

  // Agents row: each with its own mark
  const agents: Array<{ name: string; body: string; eyes?: string }> = [
    { name: "Claude Code", body: INK },
    { name: "Codex", body: NAVY },
    { name: "Cursor", body: CREAM },
    { name: "any shell", body: ORANGE, eyes: INK },
  ]
  const aw = 210
  const ag = 22
  const ax0 = (W - (agents.length * aw + (agents.length - 1) * ag)) / 2
  const ay = 130
  const CX = W / 2
  const sy = 300
  agents.forEach((a, i) => {
    const x = ax0 + i * (aw + ag)
    b += `<rect x="${x}" y="${ay}" width="${aw}" height="64" rx="12" fill="${o.fill}" stroke="${o.stroke}" stroke-width="1.5"/>`
    b += `<g transform="translate(${x + 34} ${ay + 34})"><g class="hop d${i}" style="animation-delay:${-i * 0.9}s">${mark(30, a.body, { eyes: a.eyes, ring: a.body === ORANGE ? INK : ORANGE })}</g></g>`
    b += text(x + 128, ay + 30, a.name, { size: 17, weight: 650, fill: t.text, anchor: "middle" })
    b += text(x + 128, ay + 50, "runs  cello …", { size: 13, fill: t.muted, anchor: "middle", mono: true })
    // the curve to the server, and a command travelling down it
    const fx = x + aw / 2
    const tx = CX + (fx - CX) * 0.35
    const d = `M ${fx} ${ay + 64} C ${fx} ${ay + 110}, ${tx} ${sy - 50}, ${tx} ${sy - 4}`
    b += `<path d="${d}" fill="none" stroke="${t.line}" stroke-width="2" marker-end="url(#a)"/>`
    b += `<circle class="cmd${i}" r="5" fill="${o.accent}"/>`
    css += `.cmd${i} { offset-path: path("${d}"); animation: flow 2.4s ease-in ${(i * 0.6).toFixed(1)}s infinite; opacity: 0; }\n`
  })
  css += `@keyframes flow { 0% { offset-distance: 0%; opacity: 0; } 10% { opacity: 1; } 85% { opacity: 1; } 100% { offset-distance: 100%; opacity: 0; } }
.hop { transform-box: fill-box; transform-origin: 50% 100%; animation: hop 3.6s ease-in-out infinite; }
@keyframes hop { 0%, 30%, 100% { transform: translateY(0) scale(1, 1); } 6% { transform: translateY(-8px) scale(.95, 1.05); } 12% { transform: translateY(0) scale(1.06, .94); } 16% { transform: scale(1, 1); } }
.pulse { animation: pulse 0.6s ease-out infinite alternate; }
@keyframes pulse { from { opacity: .15; } to { opacity: .9; } }
`

  // Server
  const sw = 640
  const sx = CX - sw / 2
  b += `<rect x="${sx}" y="${sy}" width="${sw}" height="150" rx="16" fill="${p.fill}" stroke="${p.stroke}" stroke-width="1.5"/>`
  b += text(CX, sy + 36, "Cello server", { size: 22, weight: 700, fill: t.text, anchor: "middle" })
  b += text(CX, sy + 60, "one process · one SQLite file in ~/.cello", { size: 15, fill: t.muted, anchor: "middle" })
  const chips = ["tasks", "events", "reviews", "pages", "backups"]
  let cx = sx + 40
  const cw = (sw - 80 - (chips.length - 1) * 12) / chips.length
  chips.forEach((c) => {
    b += `<rect x="${cx}" y="${sy + 86}" width="${cw}" height="38" rx="8" fill="${t.bg}" stroke="${p.stroke}"/>`
    if (c === "events") b += `<rect class="pulse" x="${cx - 2}" y="${sy + 84}" width="${cw + 4}" height="42" rx="9" fill="none" stroke="${p.accent}" stroke-width="2"/>`
    b += text(cx + cw / 2, sy + 110, c, { size: 14.5, weight: 600, fill: p.accent, anchor: "middle" })
    cx += cw + 12
  })

  // Board (with a live mini board) and the desktop app
  const by = sy + 150 + 80
  const bh = 170
  const boardX = CX - 400
  const boardW = 450
  const deskX = CX + 70
  const deskW = 330
  const live = [
    { x: boardX + boardW / 2, d: `M ${boardX + boardW / 2} ${sy + 150} V ${by - 4}` },
    { x: deskX + deskW / 2, d: `M ${deskX + deskW / 2} ${sy + 150} V ${by - 4}` },
  ]
  live.forEach((l, i) => {
    b += `<path d="${l.d}" fill="none" stroke="${t.line}" stroke-width="2" marker-end="url(#a)"/>`
    b += `<circle class="ev${i}" r="5" fill="${p.accent}"/>`
    css += `.ev${i} { offset-path: path("${l.d}"); animation: flow 1.2s ease-in ${(i * 0.6).toFixed(1)}s infinite; opacity: 0; }\n`
  })
  b += text(CX + 10, sy + 150 + 46, "live, in well under 100 ms", { size: 13.5, fill: t.muted, italic: true, anchor: "middle" })

  b += `<rect x="${boardX}" y="${by}" width="${boardW}" height="${bh}" rx="12" fill="${bl.fill}" stroke="${bl.stroke}" stroke-width="1.5"/>`
  b += text(boardX + 20, by + 30, "Board in the browser", { size: 17, weight: 650, fill: t.text })
  b += text(boardX + boardW - 20, by + 30, "kanban · list · review · pages", { size: 13, fill: t.muted, anchor: "end" })
  const cols = ["Todo", "In Progress", "In Review"]
  const colW = (boardW - 40 - 2 * 10) / 3
  const colY = by + 46
  cols.forEach((c, i) => {
    const x = boardX + 20 + i * (colW + 10)
    b += `<rect x="${x}" y="${colY}" width="${colW}" height="${bh - 62}" rx="8" fill="${t.chip}"/>`
    b += text(x + 10, colY + 20, c, { size: 12, weight: 600, fill: t.muted })
    // a resting card per column
    b += `<rect x="${x + 8}" y="${colY + 66}" width="${colW - 16}" height="26" rx="5" fill="${t.card}" stroke="${t.line}" stroke-opacity=".5"/>`
    b += `<rect x="${x + 16}" y="${colY + 76}" width="${colW * 0.45}" height="5" rx="2" fill="${t.line}" opacity=".6"/>`
  })
  // the card an agent carries across, with the agent riding on it
  const step = colW + 10
  const cardX = boardX + 28
  const cardY = colY + 33
  b += `<g transform="translate(${cardX} ${cardY})"><g class="carry">
<rect width="${colW - 16}" height="28" rx="5" fill="${t.card}" stroke="${o.accent}" stroke-width="1.8"/>
<rect x="8" y="8" width="${colW * 0.5}" height="5" rx="2" fill="${o.accent}"/><rect x="8" y="17" width="${colW * 0.3}" height="4" rx="2" fill="${t.line}"/>
<g transform="translate(${colW - 22} -2)"><g class="lift">${mark(24, INK)}</g></g>
</g></g>`
  css += `.carry { animation: carry 7s ease-in-out infinite; }
@keyframes carry { 0%, 18% { transform: translate(0, 0); } 30%, 52% { transform: translate(${step}px, 0); } 64%, 88% { transform: translate(${step * 2}px, 0); } 96%, 100% { transform: translate(${step * 2}px, 0); opacity: 1; } }
.lift { transform-box: fill-box; transform-origin: 50% 100%; animation: lift 7s ease-in-out infinite; }
@keyframes lift { 0%, 14%, 34%, 48%, 68%, 100% { transform: translateY(0); } 18%, 52% { transform: translateY(-7px) rotate(-6deg); } 24%, 58% { transform: translateY(-4px) rotate(4deg); } }
`

  b += `<rect x="${deskX}" y="${by}" width="${deskW}" height="${bh}" rx="12" fill="${bl.fill}" stroke="${bl.stroke}" stroke-width="1.5"/>`
  b += text(deskX + 20, by + 30, "Desktop app", { size: 17, weight: 650, fill: t.text })
  // a little window: the board on the left, the evidence panel on the right
  const wx = deskX + 20
  const wy = by + 46
  const ww = deskW - 40
  const wh = bh - 62
  b += `<rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" rx="8" fill="${t.chip}"/>`
  b += `<rect x="${wx + ww * 0.55}" y="${wy + 8}" width="${ww * 0.45 - 8}" height="${wh - 16}" rx="6" fill="${t.card}" stroke="${t.line}" stroke-opacity=".5"/>`
  b += `<rect x="${wx + ww * 0.55 + 10}" y="${wy + 18}" width="${ww * 0.45 - 28}" height="${wh * 0.45}" rx="4" fill="${p.accent}" opacity=".25"/>`
  b += `<path d="M ${wx + ww * 0.55 + ww * 0.2} ${wy + 18 + wh * 0.13} l 12 9 l -12 9 z" fill="${p.accent}"/>`
  b += text(wx + ww * 0.55 + 10, wy + wh - 18, "evidence, pages", { size: 11, fill: t.muted })
  ;[0, 1].forEach((r) => {
    b += `<rect x="${wx + 10}" y="${wy + 12 + r * 30}" width="${ww * 0.55 - 22}" height="22" rx="4" fill="${t.card}" stroke="${t.line}" stroke-opacity=".5"/>`
  })
  b += text(wx + 10, wy + wh - 6, "cello:// links", { size: 11, fill: t.muted, mono: true })

  // You
  const yy = by + bh + 56
  b += `<rect x="${CX - 110}" y="${yy}" width="220" height="50" rx="25" fill="${t.chip}" stroke="${t.line}"/>`
  b += text(CX, yy + 32, "You", { size: 18, weight: 700, fill: t.text, anchor: "middle" })
  ;[boardX + boardW / 2, deskX + deskW / 2].forEach((x) => {
    b += `<line x1="${x}" y1="${by + bh}" x2="${CX + (x - CX) * 0.4}" y2="${yy - 4}" stroke="${t.line}" stroke-width="2" marker-end="url(#a)"/>`
  })

  // Back channel: your comments reach the agents (route around the right side)
  const rx = W - 30
  const back = `M ${CX + 110} ${yy + 25} H ${rx} V ${ay + 32} H ${ax0 + 4 * aw + 3 * ag + 4}`
  b += `<path d="${back}" fill="none" stroke="${o.accent}" stroke-width="2" stroke-dasharray="7 6" marker-end="url(#o)"/>`
  b += text(CX + 128, yy + 16, "your comments and answers reach the agent", { size: 13.5, weight: 600, fill: o.accent })
  b += `<g class="msg"><g transform="translate(-13 -10)"><rect width="26" height="20" rx="5" fill="${o.accent}"/><rect x="5" y="6" width="16" height="2.5" rx="1" fill="${t.bg}"/><rect x="5" y="11" width="10" height="2.5" rx="1" fill="${t.bg}"/></g></g>`
  css += `.msg { offset-path: path("${back}"); offset-rotate: 0deg; animation: msg 5s ease-in-out infinite; }
@keyframes msg { 0% { offset-distance: 0%; opacity: 0; } 8% { opacity: 1; } 90% { opacity: 1; } 100% { offset-distance: 100%; opacity: 0; } }
`

  const H = yy + 50 + 40
  return svg(W, H, t, b, "Agents run the cello CLI against one local server; the board and desktop app update live; your comments flow back to the agents.", css)
}

for (const [name, t] of [["light", light], ["dark", dark]] as const) {
  writeFileSync(join(dir, `loop-${name}.svg`), loop(t))
  writeFileSync(join(dir, `architecture-${name}.svg`), architecture(t))
}

// ── Banner: the ensemble, the name and the line ──────────────────────────────

// The three marks of art/icon/ensemble.svg (cream, navy, and ink in front), each with its own motion.
const ensembleMark = (x: number, y: number, k: number, body: string, cls: string) =>
  `<g transform="translate(${x} ${y})"><g class="${cls}"><g transform="scale(${k}) translate(-525 -512)">
<path d="${BODY}" fill="${ORANGE}" stroke="${ORANGE}" stroke-width="70" stroke-linejoin="round"/>
<path d="${BODY}" fill="${body}"/>
<g class="eyes-${cls}"><g class="blink" fill="${ORANGE}"><rect x="470" y="513" width="80" height="124" rx="40"/><rect x="600" y="513" width="80" height="124" rx="40"/></g></g>
</g></g></g>`

const bannerCss = `${BASE_CSS}
.cream { transform-box: fill-box; transform-origin: 50% 100%; animation: bob 3.4s ease-in-out infinite alternate; }
.cream .blink { animation-delay: -1.1s; }
@keyframes bob { to { transform: translateY(-9px); } }
.navy { transform-box: fill-box; transform-origin: 50% 100%; animation: hop2 5s ease-in-out 1.2s infinite; }
.navy .blink { animation-delay: -2.7s; }
@keyframes hop2 { 0%, 30%, 100% { transform: translateY(0) scale(1, 1); } 8% { transform: translateY(-16px) scale(.95, 1.06); } 16% { transform: translateY(0) scale(1.07, .93); } 22% { transform: translateY(-8px); } }
.eyes-ink { animation: look 6.4s cubic-bezier(.3, 1.5, .5, 1) infinite; }
@keyframes look { 0%, 100% { transform: translate(0, 0); } 8%, 28% { transform: translate(-62px, 6px); } 36%, 56% { transform: translate(62px, 6px); } 64%, 84% { transform: translate(-40px, -52px); } 92% { transform: translate(0, 0); } }
.ink { transform-box: fill-box; transform-origin: 50% 100%; animation: tilt 6.4s ease-in-out infinite; }
@keyframes tilt { 0%, 100% { transform: rotate(0); } 8%, 28% { transform: rotate(-3deg); } 36%, 56% { transform: rotate(3deg); } }
.note { transform-box: fill-box; transform-origin: center; animation: float 3s ease-in-out infinite alternate; }
@keyframes float { from { transform: translateY(0) rotate(-6deg); } to { transform: translateY(-10px) rotate(6deg); } }
`

// ensemble.svg's marks sit at (300,560) k .5, (760,560) k .5, (530,470) k .66 in a 1024 box;
// here that box is scaled by .4 and centred on (300, 215).
const E = 0.4
const ex = (x: number) => 300 + (x - 530) * E
const ey = (y: number) => 215 + (y - 490) * E
const banner = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 420" width="1280" height="420" role="img" aria-label="Cello: your agents, in harmony">
<style>${bannerCss}</style>
<rect width="1280" height="420" rx="24" fill="${ORANGE}"/>
${ensembleMark(ex(300), ey(560), 0.5 * E, CREAM, "cream")}
${ensembleMark(ex(760), ey(560), 0.5 * E, NAVY, "navy")}
${ensembleMark(ex(530), ey(470), 0.66 * E, INK, "ink")}
<g transform="translate(${ex(800)} ${ey(250)})"><g class="note"><g fill="${INK}" transform="scale(0.9)">
  <ellipse cx="12" cy="44" rx="13" ry="9.5" transform="rotate(-22 12 44)"/>
  <rect x="21" y="0" width="5" height="44"/>
  <path d="M26 0 C 30 14, 46 14, 44 34 C 42 22, 32 20, 26 18 Z"/>
</g></g></g>
${text(560, 200, "Cello", { size: 120, weight: 800, fill: INK })}
${text(566, 256, "Your agents, in harmony.", { size: 38, weight: 500, fill: INK })}
${text(566, 312, "A local task board for you and your AI coding agents.", { size: 24, fill: "#3A1C0B" })}
<rect x="1060" y="34" width="186" height="38" rx="19" fill="${INK}"/>
${text(1153, 59, "EXPERIMENTAL", { size: 15, weight: 700, fill: ORANGE, anchor: "middle" })}
</svg>
`
writeFileSync(join(dir, "banner.svg"), banner)
console.log("wrote banner.svg, loop-{light,dark}.svg, architecture-{light,dark}.svg")
