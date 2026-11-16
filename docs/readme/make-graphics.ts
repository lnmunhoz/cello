// Draws the README's graphics as light and dark SVGs: `bun docs/readme/make-graphics.ts`.
// Hand-written geometry, no fonts to load: GitHub shows SVGs as images, so text uses the system font.
import { writeFileSync } from "node:fs"
import { join } from "node:path"

const dir = import.meta.dir

type Theme = {
  bg: string
  text: string
  muted: string
  line: string
  chip: string
  chipText: string
  tint: Record<"blue" | "orange" | "purple" | "green" | "yellow", { fill: string; stroke: string; accent: string }>
}

const light: Theme = {
  bg: "#FFFFFF",
  text: "#18181B",
  muted: "#52525B",
  line: "#A1A1AA",
  chip: "#F4F4F5",
  chipText: "#3F3F46",
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
  tint: {
    blue: { fill: "#0F1B2E", stroke: "#1E40AF", accent: "#60A5FA" },
    orange: { fill: "#24160D", stroke: "#9A4A1A", accent: "#FF8A47" },
    purple: { fill: "#1B1530", stroke: "#5B3FB0", accent: "#A78BFA" },
    green: { fill: "#0E2118", stroke: "#166534", accent: "#4ADE80" },
    yellow: { fill: "#221D0B", stroke: "#854D0E", accent: "#FACC15" },
  },
}

const SANS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`
const MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const text = (x: number, y: number, s: string, o: { size?: number; weight?: number; fill: string; anchor?: string; mono?: boolean; italic?: boolean }) =>
  `<text x="${x}" y="${y}" font-family="${o.mono ? MONO : SANS}" font-size="${o.size ?? 16}" font-weight="${o.weight ?? 400}"${o.italic ? ` font-style="italic"` : ""} fill="${o.fill}" text-anchor="${o.anchor ?? "start"}">${esc(s)}</text>`

const arrowHead = (id: string, fill: string) =>
  `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${fill}"/></marker>`

const svg = (w: number, h: number, t: Theme, body: string, label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}">
<defs>${arrowHead("a", t.line)}${arrowHead("y", t.tint.yellow.accent)}${arrowHead("o", t.tint.orange.accent)}</defs>
<rect width="${w}" height="${h}" rx="16" fill="${t.bg}"/>
${body}
</svg>
`

// ── The loop: how one piece of work goes from a request to Done ──────────────

function loop(t: Theme) {
  const W = 1040
  const X = 190 // main column
  const BW = 540
  const BH = 112
  const CX = X + BW / 2
  const gap = 150
  const top = 130
  const steps: Array<{ n: string; tint: keyof Theme["tint"]; who: string; title: string; sub: string; cmd: string }> = [
    { n: "1", tint: "blue", who: "YOU", title: "You ask for something", sub: "In chat with your agent, or as a card on the board", cmd: `cello task create "Gift cards at checkout"` },
    { n: "2", tint: "orange", who: "AGENT", title: "An agent claims it", sub: "The card moves to In Progress and shows who is on it", cmd: "cello task claim SHOP-8" },
    { n: "3", tint: "orange", who: "AGENT", title: "It builds and tests, in its own worktree", sub: "Test first, then a fresh reviewer agent reads the diff", cmd: "cello task stage SHOP-8 review" },
    { n: "4", tint: "purple", who: "AGENT", title: "It hands you a review packet", sub: "A summary, steps to check, videos and screenshots", cmd: "cello task submit SHOP-8 --attach flow.mp4" },
    { n: "5", tint: "blue", who: "YOU", title: "You decide, on the Review page", sub: "Watch the evidence, then approve or send it back", cmd: "Approve  ·  Send back  ·  Comment" },
  ]

  let b = ""
  b += text(40, 56, "How work flows through Cello", { size: 30, weight: 700, fill: t.text })
  b += text(40, 88, "Agents do the work through the cello CLI. You stay in the loop on a live board.", { size: 17, fill: t.muted })

  steps.forEach((s, i) => {
    const y = top + i * gap
    const c = t.tint[s.tint]
    b += `<rect x="${X}" y="${y}" width="${BW}" height="${BH}" rx="14" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/>`
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
  const y5 = top + 4 * gap
  const doneY = y5 + BH + 44
  const g = t.tint.green
  b += `<line x1="${CX}" y1="${y5 + BH}" x2="${CX}" y2="${doneY - 4}" stroke="${t.line}" stroke-width="2" marker-end="url(#a)"/>`
  b += text(CX + 12, y5 + BH + 28, "Approve", { size: 14, weight: 600, fill: g.accent })
  b += `<rect x="${CX - 90}" y="${doneY}" width="180" height="48" rx="24" fill="${g.fill}" stroke="${g.stroke}" stroke-width="1.5"/>`
  b += text(CX, doneY + 31, "Done", { size: 19, weight: 700, fill: g.accent, anchor: "middle" })

  // Send back: from step 5's left edge, around the left, into step 3
  const y3 = top + 2 * gap
  const o = t.tint.orange
  const lx = X - 70
  b += `<path d="M ${X} ${y5 + 56} H ${lx} V ${y3 + 56} H ${X - 4}" fill="none" stroke="${o.accent}" stroke-width="2" stroke-dasharray="7 6" marker-end="url(#o)"/>`
  b += `<g transform="translate(${lx - 14} ${(y3 + y5) / 2 + 56}) rotate(-90)">${text(0, 0, "Send back with a note", { size: 14, weight: 600, fill: o.accent, anchor: "middle" })}</g>`

  // Side note: asking for a decision
  const nx = X + BW + 50
  const ny = y3 - 34
  const nw = W - nx - 30
  const yl = t.tint.yellow
  b += `<rect x="${nx}" y="${ny}" width="${nw}" height="196" rx="14" fill="${yl.fill}" stroke="${yl.stroke}" stroke-width="1.5" stroke-dasharray="6 5"/>`
  b += text(nx + 18, ny + 32, "Stuck on a decision?", { size: 16, weight: 700, fill: t.text })
  ;["The agent asks on the card:", "options, its pick and why.", "The task waits in Needs input;", "you answer next to the", "screenshots, and it carries on."].forEach((l, i) => {
    b += text(nx + 18, ny + 60 + i * 21, l, { size: 14, fill: t.muted })
  })
  b += `<rect x="${nx + 18}" y="${ny + 158}" width="${nw - 36}" height="22" rx="5" fill="${t.chip}"/>`
  b += text(nx + 28, ny + 173, "cello task ask SHOP-8", { size: 12.5, fill: t.chipText, mono: true })
  b += `<line x1="${X + BW + 4}" y1="${y3 + 56}" x2="${nx - 4}" y2="${y3 + 56}" stroke="${yl.accent}" stroke-width="2" stroke-dasharray="6 5" marker-start="url(#y)" marker-end="url(#y)"/>`

  // Side note: comments reach the agent
  const cy = top + 4 * gap - 6
  b += `<rect x="${nx}" y="${cy}" width="${nw}" height="124" rx="14" fill="none" stroke="${t.line}" stroke-width="1.5" stroke-dasharray="6 5"/>`
  b += text(nx + 18, cy + 30, "Your words reach it", { size: 16, weight: 700, fill: t.text })
  ;["Comments, notes and emoji", "land in the agent's session", "by themselves, even when", "it's idle."].forEach((l, i) => {
    b += text(nx + 18, cy + 56 + i * 20, l, { size: 14, fill: t.muted })
  })

  const H = doneY + 48 + 70
  b += text(40, H - 30, "Every change is an event: which agent, which conversation, when. The board replays it live.", { size: 15, fill: t.muted })
  return svg(W, H, t, b, "How work flows through Cello: you ask, an agent claims, builds and tests, submits a review packet, and you approve or send it back.")
}

// ── How the pieces fit ───────────────────────────────────────────────────────

function architecture(t: Theme) {
  const W = 1040
  let b = ""
  b += text(40, 56, "One local server, many agents, one board", { size: 30, weight: 700, fill: t.text })
  b += text(40, 88, "Everything runs on your machine. No accounts, no cloud, no waiting on the network.", { size: 17, fill: t.muted })

  const o = t.tint.orange
  const p = t.tint.purple
  const bl = t.tint.blue

  // Agents row
  const agents = ["Claude Code", "Codex", "Cursor", "any shell"]
  const aw = 210
  const ag = 22
  const ax0 = (W - (agents.length * aw + (agents.length - 1) * ag)) / 2
  const ay = 130
  agents.forEach((a, i) => {
    const x = ax0 + i * (aw + ag)
    b += `<rect x="${x}" y="${ay}" width="${aw}" height="64" rx="12" fill="${o.fill}" stroke="${o.stroke}" stroke-width="1.5"/>`
    b += text(x + aw / 2, ay + 30, a, { size: 17, weight: 650, fill: t.text, anchor: "middle" })
    b += text(x + aw / 2, ay + 50, "runs  cello …", { size: 13, fill: t.muted, anchor: "middle", mono: true })
  })
  const CX = W / 2
  const sy = 300
  // arrows down to the server
  agents.forEach((_, i) => {
    const x = ax0 + i * (aw + ag) + aw / 2
    b += `<path d="M ${x} ${ay + 64} C ${x} ${ay + 110}, ${CX + (x - CX) * 0.35} ${sy - 50}, ${CX + (x - CX) * 0.35} ${sy - 4}" fill="none" stroke="${t.line}" stroke-width="2" marker-end="url(#a)"/>`
  })

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
    b += text(cx + cw / 2, sy + 110, c, { size: 14.5, weight: 600, fill: p.accent, anchor: "middle" })
    cx += cw + 12
  })

  // Board + desktop
  const by = sy + 150 + 90
  const bw = 300
  const items = [
    { x: CX - bw - 20, t: "Board in the browser", s: "kanban, list, review, pages" },
    { x: CX + 20, t: "Desktop app", s: "dock icon, side panel, cello:// links" },
  ]
  items.forEach((it) => {
    b += `<rect x="${it.x}" y="${by}" width="${bw}" height="76" rx="12" fill="${bl.fill}" stroke="${bl.stroke}" stroke-width="1.5"/>`
    b += text(it.x + bw / 2, by + 33, it.t, { size: 17, weight: 650, fill: t.text, anchor: "middle" })
    b += text(it.x + bw / 2, by + 56, it.s, { size: 14, fill: t.muted, anchor: "middle" })
    b += `<line x1="${it.x + bw / 2}" y1="${sy + 150}" x2="${it.x + bw / 2}" y2="${by - 4}" stroke="${t.line}" stroke-width="2" marker-end="url(#a)"/>`
  })
  b += text(CX, sy + 150 + 50, "live over a WebSocket, in well under 100 ms", { size: 13.5, fill: t.muted, italic: true, anchor: "middle" })

  // You
  const yy = by + 76 + 60
  b += `<rect x="${CX - 110}" y="${yy}" width="220" height="50" rx="25" fill="${t.chip}" stroke="${t.line}"/>`
  b += text(CX, yy + 32, "You", { size: 18, weight: 700, fill: t.text, anchor: "middle" })
  items.forEach((it) => {
    b += `<line x1="${it.x + bw / 2}" y1="${by + 76}" x2="${CX + (it.x + bw / 2 - CX) * 0.4}" y2="${yy - 4}" stroke="${t.line}" stroke-width="2" marker-end="url(#a)"/>`
  })

  // Back channel: your comments reach the agents (route around the right side)
  const rx = W - 46
  b += `<path d="M ${CX + 110} ${yy + 25} H ${rx} V ${ay + 32} H ${ax0 + 4 * aw + 3 * ag + 4}" fill="none" stroke="${o.accent}" stroke-width="2" stroke-dasharray="7 6" marker-end="url(#o)"/>`
  b += text(CX + 128, yy + 16, "your comments and answers reach the agent", { size: 13.5, weight: 600, fill: o.accent })

  const H = yy + 50 + 40
  return svg(W, H, t, b, "Agents run the cello CLI against one local server; the board and desktop app update live; your comments flow back to the agents.")
}

for (const [name, t] of [["light", light], ["dark", dark]] as const) {
  writeFileSync(join(dir, `loop-${name}.svg`), loop(t))
  writeFileSync(join(dir, `architecture-${name}.svg`), architecture(t))
}

// ── Banner: the logo, the name and the line ─────────────────────────────────

const banner = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 420" width="1280" height="420" role="img" aria-label="Cello: your agents, in harmony">
<rect width="1280" height="420" rx="24" fill="#FF7A2F"/>
<g transform="translate(200 70) scale(0.27)">
  <path d="M205 185 L312.4 633 A270 270 0 1 0 648.4 310.2 Z" fill="#141416"/>
  <g fill="#FF7A2F"><rect x="470" y="513" width="80" height="124" rx="40"/><rect x="600" y="513" width="80" height="124" rx="40"/></g>
</g>
<g fill="#141416" transform="translate(388 96) scale(0.9)">
  <ellipse cx="12" cy="44" rx="13" ry="9.5" transform="rotate(-22 12 44)"/>
  <rect x="21" y="0" width="5" height="44"/>
  <path d="M26 0 C 30 14, 46 14, 44 34 C 42 22, 32 20, 26 18 Z"/>
</g>
${text(550, 200, "Cello", { size: 120, weight: 800, fill: "#141416" })}
${text(556, 256, "Your agents, in harmony.", { size: 38, weight: 500, fill: "#141416" })}
${text(556, 312, "A local task board for you and your AI coding agents.", { size: 24, fill: "#3A1C0B" })}
<rect x="1060" y="34" width="186" height="38" rx="19" fill="#141416"/>
${text(1153, 59, "EXPERIMENTAL", { size: 15, weight: 700, fill: "#FF7A2F", anchor: "middle" })}
</svg>
`
writeFileSync(join(dir, "banner.svg"), banner)
console.log("wrote banner.svg, loop-{light,dark}.svg, architecture-{light,dark}.svg")
