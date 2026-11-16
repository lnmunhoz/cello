// Cello onboarding video v2 (CEL-94): a motion-graphics explainer in the promo's style, about 2:33,
// 1920x1080 @ 30 fps. The narration is final (../audio/<scene>-a.mp3, texts in ../tools/captions.py);
// the picture follows it word by word. Every frame is an SVG built here from the shared kit.
//   bun art/setup-video/v2/make.mjs                 every frame into frames/
//   bun art/setup-video/v2/make.mjs 12.5,40         only those stills (seconds) into frames/still-<s>.svg
//   bun art/setup-video/v2/make.mjs --timeline      the scene timing as JSON (for render.sh)
// Rules: made-up project (Acme Shop, ACME keys) and session ids; no real names.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { FPS, W, H, C, f, clamp, lerp, prog, io, out, pop, path, blink, win, typed, agent, txt, pill, pillW, panel, bar, you, click, term, CW, card, GRAB, lifted, svg } from "../../motion-kit.mjs";
const dir = new URL(".", import.meta.url).pathname;

// ── helpers on top of the kit ──
const G = (op, body, tr = "") => (op <= 0 || !body ? "" : `<g opacity="${f(Math.min(1, op))}"${tr ? ` transform="${tr}"` : ""}>${body}</g>`);
const fade = (u, u0, u1 = 1e9, d = 0.35) => out(prog(u, u0, u0 + d)) * (1 - prog(u, u1, u1 + 0.3));
const at = (x, y, k, body) => (k <= 0 ? "" : `<g transform="translate(${f(x)} ${f(y)}) scale(${f(k)})">${body}</g>`);
// the one bold phrase of a beat, at the bottom
const say = (u, s, u0, u1 = 1e9, size = 56) => G(fade(u, u0, u1), txt(W / 2, 985, s, size, C.ink));
const textW = (s, size) => s.length * size * 0.57;
// speech bubble centred on (x, y); tail "down" (under its left half), "left" or none
function bubble(x, y, s, k, { bg = C.cream, fg = C.ink, size = 34, tail = "down", w = 700 } = {}) {
  if (k <= 0) return "";
  const bw = textW(s, size) + 60, bh = size + 44;
  const tl = tail === "down" ? `<path d="M-30 ${f(bh / 2 - 4)} L-46 ${f(bh / 2 + 30)} L12 ${f(bh / 2 - 4)} Z" fill="${bg}"/>`
    : tail === "left" ? `<path d="M${f(-bw / 2 + 24)} -16 L${f(-bw / 2 - 26)} 18 L${f(-bw / 2 + 34)} 14 Z" fill="${bg}"/>` : "";
  return at(x, y, k, `<rect x="${f(-bw / 2)}" y="${f(-bh / 2)}" width="${f(bw)}" height="${bh}" rx="${bh / 2}" fill="${bg}"/>${tl}` + txt(0, size * 0.36, s, size, fg, { w }));
}
const tick = (x, y, r, k, bg = C.green) => at(x, y, k, `<circle r="${r}" fill="${bg}"/><path d="M${f(-r * 0.42)} ${f(r * 0.02)} L${f(-r * 0.1)} ${f(r * 0.34)} L${f(r * 0.46)} ${f(-r * 0.32)}" fill="none" stroke="${C.white}" stroke-width="${f(r * 0.26)}" stroke-linecap="round" stroke-linejoin="round"/>`);
// a dashed line drawn from (x1, y1) towards (x2, y2), k of the way
const dash = (x1, y1, x2, y2, k, col = C.ink, w = 6) => (k <= 0 ? "" : `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(lerp(x1, x2, k))}" y2="${f(lerp(y1, y2, k))}" stroke="${col}" stroke-width="${w}" stroke-dasharray="14 12" stroke-linecap="round"/>`);
const lock = (x, y, k) => at(x, y, k, `<path d="M-26 -8 V-30 A26 26 0 0 1 26 -30 V-8" fill="none" stroke="${C.ink}" stroke-width="12"/><rect x="-42" y="-12" width="84" height="66" rx="14" fill="${C.ink}"/><circle cy="18" r="9" fill="${C.cream}"/>`);
const magnifier = (x, y) => `<g transform="translate(${f(x)} ${f(y)})"><circle r="34" fill="${C.white}" fill-opacity="0.35" stroke="${C.ink}" stroke-width="9"/><line x1="25" y1="25" x2="58" y2="58" stroke="${C.ink}" stroke-width="13" stroke-linecap="round"/></g>`;
const folder = (x, y, col = C.ink) => `<path d="M${x} ${y} h22 l8 8 h26 v30 h-56 Z" fill="${col}"/>`;
const pulseDot = (x, y, u, col = C.green, r = 9) => `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r + 9 * ((u * 1.4) % 1))}" fill="${col}" opacity="${f(0.45 * (1 - ((u * 1.4) % 1)))}"/><circle cx="${f(x)}" cy="${f(y)}" r="${r}" fill="${col}"/>`;

// agents as cursors on the board, with their name
const WHO = { claude: ["Claude", C.ink, C.orange], codex: ["Codex", C.navy, C.orange], cursor: ["Cursor", C.teal, C.white] };
const mover = (p, id, u, bls = [], name = null) => {
  const [n, fg, eye] = WHO[id];
  return agent({ x: p.x, y: p.y, s: 0.15, tip: true, fg, eye, bl: blink(u, bls), lx: clamp(p.vx / 900, -1, 1) }) + pill(p.x + 56, p.y + 76, name || n, fg, C.white, 22);
};
// a standing agent (the drop), by role
const drop = (x, y, s, u, { fg = C.ink, eye = C.orange, bls = [], lx = 0, ly = 0, k = 1 } = {}) => (k <= 0 ? "" : agent({ x, y, s: s * k, fg, eye, bl: blink(u, bls), lx, ly }));
const label = (x, y, s, bg = C.ink, fg = C.white, size = 24) => pill(x - pillW(s, size) / 2, y, s, bg, fg, size);

// ── the board ──
const TASKS = {
  "ACME-12": ["Add a wishlist", C.orange], "ACME-15": ["Reviews section", C.teal], "ACME-18": ["Gift cards", C.navy],
  "ACME-9": ["Fix checkout", C.teal], "ACME-3": ["Product page", C.navy], "ACME-1": ["Add search", C.teal], "ACME-2": ["Dark theme", C.navy],
};
const SC = 0.8; // cards on the board are drawn at 80%
// a task card at (x, y): mark = who claimed it, live = "active now" dot, proof = video thumbnail, done = check
function tcard(key, x, y, u = 0, { sc = SC, mark = null, live = 0, proof = 0, done = 0, ...o } = {}) {
  const [title, tag] = TASKS[key];
  let ex = "";
  if (mark) { const [n, fg, eye] = WHO[mark]; ex += agent({ x: CW - 36, y: 32, s: 0.055, fg, eye }) + txt(CW - 64, 38, n, 20, C.grey, { a: "end", w: 600 }); }
  if (live > 0) ex += G(live, pulseDot(CW - 34, 78, u));
  if (proof > 0) ex += at(CW - 76, 76, proof, `<rect x="-52" y="-26" width="104" height="52" rx="10" fill="${C.term}"/><path d="M-9 -13 L15 0 L-9 13 Z" fill="${C.white}"/>`);
  if (done > 0) ex += tick(CW - 36, 74, 22, done);
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${sc})">${card(key, title, tag, 0, 0, o)}${ex}</g>`;
}
const BX = 160, BY = 150, BW = 1600, BH = 700, COLS = ["Todo", "In Progress", "Review", "Done"];
const colX = (i) => BX + 30 + i * 385, rowY = (r) => BY + 165 + r * 108;
const slot = (c, r) => [colX(c) + 14, rowY(r)];
const grab = (c, r, dx = 0, dy = 0) => [colX(c) + 14 + GRAB[0] * SC + dx, rowY(r) + GRAB[1] * SC + dy];
const board = (title = "Acme Shop") => panel(BX, BY, BW, BH, C.cream, 36) + txt(BX + 40, BY + 62, title, 36, C.ink, { a: "start" }) +
  COLS.map((n, i) => panel(colX(i), BY + 92, 365, BH - 116, C.paper, 22) + txt(colX(i) + 22, BY + 140, n, 28, C.ink, { a: "start" })).join("");
// a card that an agent-cursor p carries between pick-up t0 and drop t1
const carried = (key, p, u, t0, t1, o = {}) => tcard(key, p.x - GRAB[0] * SC, p.y - GRAB[1] * SC, u, { lift: lifted(u, t0, t1), ...o });

// ── scenes. u = seconds since the scene's narration line started (negative during the lead-in).
// Word times are measured from the take-A recordings: pauses with ffmpeg silencedetect, words inside a
// phrase split by their share of its characters. ──

// ① The problem: three agents, each in its own terminal; you can't tell what each is doing
function s1(u) {
  // "Working with several coding agents at once is powerful… | until you lose track. | Which agent is on what? |
  //  Is it still working, (6.89) is it stuck, (8.10) or did it finish an hour ago? (8.86) | And when it says it's done, (11.03) | how do you know it really works? (12.45)"
  let s = "";
  const AG = [[420, C.ink, "zsh · checkout", 1e9, null], [960, C.cream, "zsh · search", 7.7, "stuck"], [1500, C.navy, "zsh · wishlist", 8.6, "done"]];
  AG.forEach(([x, fg, title, freeze, end], i) => {
    const k = pop(u, -0.45 + i * 0.25), kw = pop(u, -0.3 + i * 0.25, 0.4);
    const v = Math.min(u, freeze), scroll = 46 * (v + 1) + 110 * Math.max(0, v - 3.6);
    const shake = Math.sin(u * 7 + i * 2) * 1.6 * prog(u, 3.6, 4.1) * (1 - prog(u, 5.0, 5.6));
    const tx = x - 220, ty = 290, th = 270;
    let w = term(0, 0, 440, th, title);
    const maxY = end && u > freeze ? th - 70 : th - 24;
    for (let j = 0; j < 7; j++) {
      const yy = 70 + j * 30 - (scroll % 30), idx = j + Math.floor(scroll / 30);
      if (yy < 62 || yy > maxY) continue;
      w += bar(30, yy, 380 * (0.3 + 0.55 * Math.abs(Math.sin(idx * 1.7 + i * 3))), 12, idx % 4 === 0 ? "#3A7D4F" : "#3A3A42", 6);
    }
    if (end === "stuck" && u > freeze) w += txt(30, th - 34, "? Allow this command? (y/n)", 19, "#FEBC2E", { a: "start", mono: true, w: 600 }) + (Math.floor(u * 2.5) % 2 ? bar(352, th - 50, 12, 22, "#FEBC2E", 2) : "");
    if (end === "done" && u > freeze) w += txt(30, th - 34, "✓ Done · 1 hour ago", 19, "#7FD99A", { a: "start", mono: true, w: 600 });
    s += kw > 0 ? `<g transform="translate(${tx + 220} ${ty + th / 2}) rotate(${f(shake)}) scale(${f(kw)}) translate(-220 ${-th / 2})">${w}</g>` : "";
    const look = u < 3.6 ? 0 : u < 5.3 ? Math.sin(u * 2.6 + i * 2.1) : u < 12.45 ? 0 : i < 2 ? 0.8 : -0.2;
    s += drop(x, 740, 0.28, u, { fg, k, lx: look, ly: u > 5.3 && u < 10.6 ? -0.5 : 0, bls: [1.6 + i * 0.7, 9.6 + i * 0.3, 13.2] });
  });
  const qb = (x, q, t0) => bubble(x, 205, q, pop(u, t0) * (1 - prog(u, 10.5, 10.8)), { size: 36 });
  s += qb(420, "Still working?", 6.89) + qb(960, "Stuck?", 8.1) + qb(1500, "Finished an hour ago?", 8.86);
  s += bubble(1730, 650, "Done!", pop(u, 11.03), { bg: C.navy, fg: C.white, tail: "left", size: 38 });
  s += say(u, "Which agent is on what?", 5.34, 10.5) + say(u, "…does it really work?", 12.45, 1e9, 72);
  return s;
}

// the banner: three agents and the name (scene ② and the outro)
function banner(u, u0, sub, subAt) {
  const k = pop(u, u0, 0.55), k1 = pop(u, u0 + 0.9), k2 = pop(u, u0 + 1.05);
  return agent({ x: W / 2 - 330, y: 450, s: 0.36 * k1, fg: C.cream, outline: C.orange, lx: 0.6, bl: blink(u, [u0 + 2.6]) }) +
    agent({ x: W / 2 + 330, y: 450, s: 0.36 * k2, fg: C.navy, outline: C.orange, lx: -0.6, bl: blink(u, [u0 + 2.9]) }) +
    agent({ x: W / 2, y: 400, s: 0.62 * k, outline: C.orange, bl: blink(u, [u0 + 1.2, u0 + 3.4]), ly: u > u0 + 2 ? -0.3 : 0 }) +
    txt(W / 2, 810, "Cello", 140, C.ink, { op: out(prog(u, u0 + 0.3, u0 + 0.7)) }) +
    txt(W / 2, 895, sub, 54, C.ink, { w: 500, op: out(prog(u, subAt, subAt + 0.4)) });
}

// ② What Cello is: a board on your machine; agents take cards, show their work, hand it back with proof
function s2(u) {
  // "Cello is a task board built for exactly that. | It runs on your own machine, (3.48) and your agents use it like teammates: (5.0) |
  //  they take cards, (7.10) show you their work as it happens, (7.9) | and hand it back with proof. (9.83)"
  let s = G(1 - prog(u, 3.0, 3.35), banner(u, -0.55, "A task board for you and your agents", 0.9));
  const bk = out(prog(u, 3.25, 3.85));
  if (bk <= 0) return s;
  let b = board() + G(pop(u, 4.3), pill(BX + BW - 300, BY + 30, "on your machine", C.ink, C.white, 24));
  const C1 = path(u, [[4.9, 2100, 900], [5.6, 1180, 820], [7.1, ...grab(0, 0)], [7.3, ...grab(0, 0)], [8.0, ...grab(1, 1)], [8.15, ...grab(1, 1)], [8.7, ...grab(1, 1, 150, 110)]]);
  const C2 = path(u, [[5.1, 2100, 260], [5.8, 1560, 360], [7.45, ...grab(0, 0)], [7.65, ...grab(0, 0)], [8.35, ...grab(1, 2)], [8.5, ...grab(1, 2)], [9.1, ...grab(1, 2, 160, 120)]]);
  const C3 = path(u, [[5.3, -300, 780], [6.0, 720, 780], [8.7, 720, 780], [9.3, ...grab(1, 0)], [9.5, ...grab(1, 0)], [10.15, ...grab(2, 0)], [10.3, ...grab(2, 0)], [10.9, ...grab(2, 0, 150, 120)]]);
  const up1 = io(prog(u, 7.35, 7.65)), up2 = io(prog(u, 7.7, 8.0)), upIP = io(prog(u, 10.2, 10.5));
  let cards = "", top = "";
  cards += tcard("ACME-18", slot(0, 0)[0], lerp(rowY(2), rowY(0), (up1 + up2) / 2));
  cards += tcard("ACME-3", ...slot(3, 0));
  // ACME-12: Claude takes it to In Progress, where it shows its work live
  if (u < 7.3) cards += tcard("ACME-12", ...slot(0, 0));
  else if (u < 8.0) top += carried("ACME-12", C1, u, 7.3, 8.0, { mark: "claude" });
  else cards += tcard("ACME-12", slot(1, 0)[0], lerp(rowY(1), rowY(0), upIP), u, { mark: "claude", ring: C.ink, live: prog(u, 8.1, 8.3) });
  // ACME-15: Codex takes the next one
  if (u < 7.65) cards += tcard("ACME-15", slot(0, 0)[0], lerp(rowY(1), rowY(0), up1));
  else if (u < 8.35) top += carried("ACME-15", C2, u, 7.65, 8.35, { mark: "codex" });
  else cards += tcard("ACME-15", slot(1, 0)[0], lerp(rowY(2), rowY(1), upIP), u, { mark: "codex", ring: C.navy });
  // ACME-9: Cursor hands it back for review, with proof
  if (u < 9.5) cards += tcard("ACME-9", ...slot(1, 0), u, { mark: "cursor" });
  else if (u < 10.15) top += carried("ACME-9", C3, u, 9.5, 10.15, { mark: "cursor" });
  else cards += tcard("ACME-9", ...slot(2, 0), u, { mark: "cursor", ring: C.green, proof: pop(u, 10.25) });
  b += cards + top;
  b += bubble(C1.x + 270, C1.y + 30, "Running the tests…", pop(u, 8.25) * (1 - prog(u, 9.6, 9.9)), { bg: C.navy, fg: C.white, size: 26, tail: "left" });
  b += G(pop(u, 10.35), label(colX(2) + 182, rowY(1) + 4, "with proof", C.green, C.white, 24));
  b += mover(C3, "cursor", u, [6.6]) + mover(C2, "codex", u, [6.3]) + mover(C1, "claude", u, [6.0, 9.2]);
  s += G(bk, b, `translate(0 ${f(80 * (1 - bk))})`);
  s += say(u, "Your agents, as teammates.", 5.1);
  return s;
}

// ③ Setting it up: ask your agent; it installs, starts and connects; every session then works through the board
function s3(u) {
  // "To get started, | point your coding agent at Cello, and ask it to set it up for your project. (1.14) | It installs Cello, (5.25) |
  //  starts it on your machine, (6.49) and connects your project (7.7) to a new board. (9.1) | From then on, (10.22) every agent session (10.9) in that project works through it."
  let s = "";
  const away = io(prog(u, 8.2, 8.9));
  if (away < 1) {
    let c = panel(360, 150, 1200, 680, C.cream, 36) + txt(400, 208, "Your coding agent", 26, C.grey, { a: "start", w: 600 }) + bar(400, 232, 1120, 3, C.line, 1);
    const kb = pop(u, 1.05, 0.4), L1 = "Set up Cello for this project:", L2 = "github.com/lnmunhoz/cello";
    if (kb > 0) c += at(1520, 260, kb, panel(-700, 0, 700, 140, C.ink, 30) + txt(-666, 58, typed(L1, u, 1.2, 24), 34, C.white, { a: "start", w: 600 }) + txt(-666, 108, typed(L2, u, 2.55, 22), 34, "#FFB98A", { a: "start", w: 600, mono: false }));
    c += drop(470, 560, 0.15, u, { k: pop(u, 3.9), lx: 0.6, bls: [5.9, 8.0] });
    const kr = pop(u, 4.2, 0.4);
    if (kr > 0) {
      let r = panel(0, 0, 820, 330, C.white, 26);
      [["Installs Cello", 5.25], ["Starts it on your machine", 6.49], ["Connects your project", 7.7]].forEach(([n, t0], i) => {
        r += tick(60, 72 + i * 96, 26, pop(u, t0)) + G(fade(u, t0), txt(110, 84 + i * 96, n, 36, C.ink, { a: "start", w: 600 }));
        if (u > t0 - 0.5 && u < t0) r += `<circle cx="60" cy="${72 + i * 96}" r="24" fill="none" stroke="${C.line}" stroke-width="6"/>`;
      });
      c += at(580, 430, kr, r);
    }
    s += G(1 - away, c, `translate(${f(-260 * away)} 0)`);
  }
  // the new board, then the sessions that work through it
  const kb = pop(u, 8.6, 0.55);
  if (kb > 0) {
    const bx = 760, by = 170, bw = 1000, bh = 640, cw = 223, cx = (i) => bx + 30 + i * (cw + 16);
    let b = panel(bx, by, bw, bh, C.cream, 34) + txt(bx + 40, by + 64, "Acme Shop", 38, C.ink, { a: "start" }) + G(pop(u, 9.1), pill(bx + 290, by + 30, "new board", C.green, C.white, 22));
    COLS.forEach((n, i) => { b += panel(cx(i), by + 100, cw, bh - 124, C.paper, 18) + txt(cx(i) + 18, by + 142, n, 24, C.ink, { a: "start" }); });
    [["claude", 220, "ACME-12"], ["codex", 420, "ACME-15"], ["cursor", 620, "ACME-9"]].forEach(([id, y, key], i) => {
      const t0 = 10.85 + i * 0.3, ln = io(prog(u, t0 + 0.3, t0 + 0.8)), [n, fg, eye] = WHO[id];
      const k = pop(u, t0, 0.4);
      if (k > 0) s += at(330, y + 70, k, term(-210, -70, 420, 140, `session · ${n.toLowerCase()}`) + agent({ x: -140, y: 22, s: 0.09, fg: id === "claude" ? C.cream : fg, eye }) + bar(-90, 4, 220, 12, "#3A3A42", 6) + bar(-90, 32, 160, 12, "#3A7D4F", 6));
      b += dash(540, y + 70, bx - 4, y + 70, ln);
      // each session's card shows up on the board once it's connected
      if (ln >= 1) b += tcard(key, cx(1) + 12, by + 170 + i * 82, u, { sc: 0.473, ring: fg, s: pop(u, t0 + 0.8) });
    });
    s = at(bx + bw / 2, by + bh / 2, kb, `<g transform="translate(${-(bx + bw / 2)} ${-(by + bh / 2)})">${b}</g>`) + s;
  }
  s += say(u, "Point your agent at Cello.", 1.14, 8.2) + say(u, "Every session works through it.", 10.9);
  return s;
}

// ③b The orchestrator: two new commands; a strong model runs /cello:orchestrate and coordinates builders and a reviewer
function s3b(u) {
  // "Setup also gives your agent two new commands. (1.6) | For real work, (3.19) | start a session with a strong model, (4.19) like Claude Opus on high or extra-high effort, (6.21)
  //  and run the orchestrate command (8.78) with the tasks you want done. | That session becomes the orchestrator. (12.71) | It plans, (15.04) and hands each task to a builder agent (15.61)
  //  working in its own copy of the code. (17.83) | A fresh reviewer agent checks every change (20.24) before it's merged. (23.0) | The orchestrator doesn't write the code itself… (24.18) | it coordinates. (26.76)"
  let s = "";
  // the two commands
  const a1 = 1 - prog(u, 3.1, 3.45);
  if (a1 > 0) {
    let c = drop(W / 2, 400, 0.3, u, { k: pop(u, -0.4), ly: u > 1.5 ? 0.6 : 0, bls: [0.8, 2.6] });
    [["/cello:orchestrate", 700, 1.65], ["/cello:work", 1230, 2.05]].forEach(([n, x, t0]) => { c += at(x, 690, pop(u, t0), panel(-textW(n, 42) / 2 - 36, -46, textW(n, 42) + 72, 92, C.ink, 46) + txt(0, 15, n, 42, C.white, { mono: true, w: 600 })); });
    s += G(a1, c);
  }
  // a session with a strong model runs the command
  const a2 = out(prog(u, 4.1, 4.5)) * (1 - prog(u, 12.3, 12.7));
  if (a2 > 0) {
    let w = term(0, 0, 1100, 500, "Claude Code · acme-shop");
    w += at(900, 26, pop(u, 6.25, 0.5), pill(-180, -24, "Claude Opus · high effort", C.orange, C.white, 24));
    const cmd = "/cello:orchestrate ACME-1 ACME-2", shown = typed(cmd, u, 8.9, 22);
    w += txt(50, 150, ">", 36, C.orange, { a: "start", mono: true }) + txt(90, 150, shown, 36, C.white, { a: "start", mono: true, w: 500 });
    if (u < 10.5 && Math.floor(u * 2.5) % 2) w += bar(92 + shown.length * 21.7, 122, 18, 36, C.white, 2);
    if (u > 10.8) w += txt(90, 230, "● Orchestrating ACME-1, ACME-2…", 28, "#7FD99A", { a: "start", mono: true, w: 500 });
    s += G(a2, `<g transform="translate(410 ${f(170 + 40 * (1 - out(prog(u, 4.1, 4.5))))})">${w}</g>`);
    s += say(u, "Start a session with a strong model.", 4.3, 8.7) + say(u, "Run it with the tasks you want done.", 8.9, 12.3);
  }
  // the orchestrator plans and hands out the work
  const b0 = 12.7;
  if (u > b0 - 0.2) {
    const O = [960, 250];
    s += drop(O[0], O[1], 0.27, u, { k: pop(u, b0), bls: [14.2, 19.5, 25.4], ly: u > 15.6 ? 0.5 : 0 }) + G(pop(u, b0 + 0.4), label(O[0], 336, "orchestrator", C.ink, C.white, 28));
    const kp = pop(u, 15.0, 0.45);
    if (kp > 0) s += at(1150, 150, kp, panel(0, 0, 420, 200, C.cream, 26) + txt(30, 48, "Plan", 28, C.ink, { a: "start" }) +
      [["ACME-1", "Add search"], ["ACME-2", "Dark theme"]].map(([key, n], i) => G(fade(u, 15.15 + i * 0.25), `<rect x="30" y="${80 + i * 56}" width="26" height="26" rx="7" fill="none" stroke="${C.ink}" stroke-width="4"/>` + tick(43, 93 + i * 56, 16, pop(u, 23.25 + i * 0.2)) + txt(72, 102 + i * 56, key, 22, C.grey, { a: "start", w: 600 }) + txt(170, 102 + i * 56, n, 26, C.ink, { a: "start", w: 600 }))).join(""));
    [[300, "ACME-1", 0], [1120, "ACME-2", 1]].forEach(([bx, key, i]) => {
      const kbox = out(prog(u, 17.9 + i * 0.3, 18.3 + i * 0.3));
      if (kbox > 0) s += G(kbox, `<rect x="${bx}" y="470" width="500" height="390" rx="30" fill="${C.cream}" fill-opacity="0.3" stroke="${C.ink}" stroke-width="5" stroke-dasharray="16 12"/>` + folder(bx + 28, 494) + txt(bx + 100, 522, "its own copy of the code", 26, C.ink, { a: "start", w: 600 }));
      s += dash(O[0] + (i ? 70 : -70), 300, bx + 250, 470, io(prog(u, 15.7 + i * 0.3, 16.2 + i * 0.3)));
      // the task card flies from the plan to the builder
      const fk = io(prog(u, 15.85 + i * 0.3, 16.6 + i * 0.3));
      if (fk > 0) s += tcard(key, lerp(1180, bx + 30, fk), lerp(220 + i * 56, 560, fk), u, { sc: lerp(0.3, 0.62, fk) });
      s += drop(bx + 120, 738, 0.16, u, { k: pop(u, 16.0 + i * 0.3), fg: i ? C.navy : C.ink, bls: [17.2 + i, 21.8 + i], lx: u > 20.3 ? (i ? -0.7 : 0.7) : 0 });
      s += G(pop(u, 16.3 + i * 0.3), label(bx + 128, 788, "builder", i ? C.navy : C.ink, C.white, 22));
      // it writes code
      for (let j = 0; j < 4; j++) { const g = prog(u, 16.8 + i * 0.3 + j * 0.45, 17.4 + i * 0.3 + j * 0.45); if (g > 0) s += bar(bx + 240, 660 + j * 34, 210 * g * [1, 0.7, 0.85, 0.55][j], 14, j === 1 ? C.white : C.ink, 7); }
    });
    // the reviewer checks the change, then it's merged
    const kr = pop(u, 20.3);
    if (kr > 0) {
      s += drop(960, 520, 0.14, u, { k: kr, fg: C.teal, eye: C.white, bls: [21.2, 24.6] }) + G(kr, label(960, 556, "reviewer", C.teal, C.white, 22));
      let d = panel(0, 0, 290, 150, C.term, 18);
      [["+ wishlist.add(item)", "#7FD99A"], ["- todo()", "#FF8A80"], ["+ test: adds item", "#7FD99A"]].forEach(([l, col], j) => { d += txt(22, 44 + j * 40, l, 19, col, { a: "start", mono: true, w: 500 }); });
      s += at(815, 625, out(prog(u, 20.6, 21.0)), d);
      const M = path(u, [[21.0, 860, 660], [21.8, 1040, 700], [22.4, 880, 745]]);
      if (u > 20.9 && u < 22.6) s += magnifier(M.x, M.y);
      s += tick(1100, 630, 30, pop(u, 22.6)) + G(pop(u, 23.1), label(960, 800, "merged", C.green, C.white, 26));
    }
    s += say(u, u < 26.76 ? "It doesn't write the code." : "It doesn't write the code. It coordinates.", 24.18);
  }
  return s;
}

// a bigger card that shows who has it, whether they're active, and the stage of the work
function detailCard(x, y, sc, u, { footer = 1, who = 0, live = 0, stage = null, stageK = 1 } = {}) {
  const w = 460, h = 112 + 74 * footer;
  let c = `<rect width="${w}" height="${f(h)}" rx="20" fill="${C.white}" stroke="${C.ink}" stroke-width="6"/>` + `<rect x="24" y="26" width="12" height="12" rx="6" fill="${C.orange}"/>` +
    txt(48, 38, "ACME-12", 20, C.grey, { a: "start", w: 600 }) + txt(24, 84, "Add a wishlist", 32, C.ink, { a: "start", w: 600 });
  if (footer > 0.6) {
    c += G(who, agent({ x: 44, y: 148, s: 0.055 }) + txt(70, 156, "Claude", 24, C.ink, { a: "start", w: 600 }));
    c += G(live, pulseDot(182, 148, u, C.green, 8) + txt(198, 156, "active now", 22, C.green, { a: "start", w: 600 }));
    if (stage) { const [n, bg] = stage; c += at(w - 24 - pillW(n, 22) / 2, 148, stageK, pill(-pillW(n, 22) / 2, -22, n, bg, C.white, 22)); }
  }
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${f(sc)})">${c}</g>`;
}
const STAGE = (u) => (u < 10.64 ? ["Building", C.orange] : u < 11.28 ? ["Agent review", C.navy] : ["Fixing", C.red]);

// ④ Watch the work: a request becomes a card; an agent claims it; who, active, stage; who changed it, in which conversation
function s4(u) {
  // "When you ask for something, | it becomes a card. (1.55) | An agent claims it, (2.92) | and you watch it move: (4.12) | who's working on it, (5.55) whether it's active right now, (6.56)
  //  and what stage the work is in, (8.04) | from building, (9.76) to review, (10.64) to fixing. (11.28) | Every change records which agent made it, (12.31) and in which conversation. (14.56)"
  let s = "";
  const zoom = io(prog(u, 5.15, 5.9)), A = 1 - prog(u, 12.1, 12.45);
  if (A > 0) {
    let b = board();
    b += tcard("ACME-15", ...slot(0, 0)) + tcard("ACME-9", ...slot(1, 0), u, { mark: "codex" }) + tcard("ACME-18", ...slot(2, 0), u, { mark: "cursor" }) + tcard("ACME-3", ...slot(3, 0));
    const P = path(u, [[2.2, 2100, 980], [2.9, ...grab(0, 1)], [4.15, ...grab(0, 1)], [4.95, ...grab(1, 1)], [5.05, ...grab(1, 1)], [5.6, ...grab(1, 1, 170, 150)]]);
    const kc = pop(u, 1.55, 0.5);
    let mine = "", top = "";
    if (u < 4.15) mine = kc > 0 ? at(slot(0, 1)[0] + 168, rowY(1) + 45, kc, tcard("ACME-12", -168, -45, u, u > 2.95 ? { mark: "claude", ring: C.ink } : {})) : "";
    else if (u < 4.95) top = carried("ACME-12", P, u, 4.15, 4.95, { mark: "claude", ring: C.ink });
    else {
      const ft = io(prog(u, 5.4, 5.75));
      mine = ft <= 0 ? tcard("ACME-12", ...slot(1, 1), u, { mark: "claude", ring: C.ink })
        : detailCard(slot(1, 1)[0], rowY(1), 0.8 * 0.913, u, { footer: ft, who: fade(u, 5.55), live: fade(u, 6.56), stage: u > 8.04 ? STAGE(u) : null, stageK: pop(u, u < 10.64 ? 8.04 : u < 11.28 ? 10.64 : 11.28) });
    }
    b += mine + top + (u < 5.6 ? mover(P, "claude", u, [3.6]) : "");
    // your request, in your words
    b += bubble(slot(0, 1)[0] + 168, rowY(1) + 45, "Add a wishlist", pop(u, -0.2) * (1 - prog(u, 1.4, 1.6)), { size: 32 });
    const Y = path(u, [[-0.6, 900, 1100], [0.0, slot(0, 1)[0] + 330, rowY(1) + 70], [1.8, slot(0, 1)[0] + 340, rowY(1) + 80], [2.4, 640, 1150]]);
    if (u < 2.4) b += you(Y.x, Y.y);
    // the camera moves in on the card
    const cx = slot(1, 1)[0] + 184, cy = rowY(1) + 74, z = lerp(1, 1.55, zoom);
    s += G(A, `<g transform="translate(${f(lerp(cx, 960, zoom))} ${f(lerp(cy, 520, zoom))}) scale(${f(z)}) translate(${f(-cx)} ${f(-cy)})">${b}</g>`);
    s += say(u, "Watch it move.", 4.2, 12.0);
  }
  // who changed it, in which conversation
  if (u > 12.1) {
    const a = out(prog(u, 12.2, 12.6)), cx = 200, cy = 330;
    s += G(a, detailCard(cx, cy, 1, u, { who: 1, live: 1, stage: ["Fixing", C.red] }));
    s += G(out(prog(u, 12.6, 13.0)), pill(cx, cy + 220, "changed by Claude · just now", C.ink, C.white, 28));
    const c = out(prog(u, 14.4, 14.9));
    if (c > 0) {
      s += `<path d="M${cx + 470} ${cy + 90} C ${cx + 560} ${cy + 90}, ${cx + 600} ${cy - 10}, ${f(cx + 470 + 300 * c)} ${cy - 10}" fill="none" stroke="${C.ink}" stroke-width="6" stroke-dasharray="14 12"/>`;
      s += G(c, panel(0, 0, 720, 300, C.cream, 30) + agent({ x: 80, y: 80, s: 0.13, bl: blink(u, [15.6]) }) + txt(140, 92, "Claude Code", 34, C.ink, { a: "start" }) + txt(140, 132, "session 4f2a9c1e", 26, C.grey, { a: "start", w: 500 }) +
        panel(40, 170, 640, 96, C.white, 20) + txt(70, 230, "“Add a wishlist to the product pages.”", 28, C.ink, { a: "start", w: 500 }), `translate(${f(1000 + 40 * (1 - c))} ${cy - 160})`);
    }
    s += say(u, "Which agent, which conversation.", 12.7);
  }
  return s;
}

// ⑤ Decisions and comments: the agent asks on the card (options, recommendation, why); your comment reaches the orchestrator, then the builders
function s5(u) {
  // "When an agent needs a decision from you, | it doesn't wait in a terminal (2.34) you might not be watching. (3.6) | It asks on the card, (5.36) | with the options, (6.76) | its recommendation, (7.88) | and why. (9.12) |
  //  And you can write to it anytime, (10.2) | right in Cello: (11.79) | a comment on the card, or on a review, (13.17) | reaches the orchestrator's session by itself… (15.65) | and it passes your words on to the agents doing the work. (18.24)"
  let s = "";
  const A = 1 - prog(u, 10.3, 10.6);
  if (A > 0) {
    // not in a terminal
    const tk = out(prog(u, 2.3, 2.7)), dim = 1 - 0.65 * prog(u, 4.3, 4.8);
    let t = term(0, 0, 720, 400, "zsh · acme-shop");
    [["● Building the wishlist…", C.grey], ["? Which layout for the wishlist?", C.white], ["  1) Grid of cards", C.grey], ["  2) Simple list", C.grey]].forEach(([l, col], i) => { if (u > 2.5 + i * 0.15) t += txt(40, 110 + i * 54, l, 26, col, { a: "start", mono: true, w: 500 }); });
    t += txt(40, 340, ">", 26, C.orange, { a: "start", mono: true }) + (Math.floor(u * 2.5) % 2 ? bar(70, 318, 14, 28, C.white, 2) : "");
    s += G(tk * dim, `<g transform="translate(160 200)">${t}</g>` + drop(520, 760, 0.2, u, { k: pop(u, -0.3), ly: u > 2.4 ? -0.6 : 0, bls: [1.2, 3.0, 4.2] }));
    if (u < 2.3) s += bubble(640, 610, "?", pop(u, 0.2) * (1 - prog(u, 2.1, 2.3)), { size: 44 });
    const x1 = prog(u, 3.6, 4.0), x2 = prog(u, 3.85, 4.25);
    if (x1 > 0) s += `<line x1="180" y1="220" x2="${f(lerp(180, 860, x1))}" y2="${f(lerp(220, 580, x1))}" stroke="${C.red}" stroke-width="16" stroke-linecap="round"/>`;
    if (x2 > 0) s += `<line x1="860" y1="220" x2="${f(lerp(860, 180, x2))}" y2="${f(lerp(220, 580, x2))}" stroke="${C.red}" stroke-width="16" stroke-linecap="round"/>`;
    // on the card
    const kc = out(prog(u, 5.3, 5.75));
    if (kc > 0) {
      let c = panel(0, 0, 780, 700, C.cream, 32) + txt(40, 62, "ACME-12", 22, C.grey, { a: "start", w: 600 }) + txt(40, 108, "Add a wishlist", 40, C.ink, { a: "start" });
      c += at(40 + pillW("Needs input", 24) / 2, 152, pop(u, 5.5), pill(-pillW("Needs input", 24) / 2, -23, "Needs input", "#F5A524", C.ink, 24));
      c += agent({ x: 66, y: 236, s: 0.08, bl: blink(u, [7.2]) }) + txt(110, 248, "Which layout for the wishlist?", 32, C.ink, { a: "start" });
      const picked = u > 9.85;
      const opt = (y, h, n, t0, rec) => {
        const k = out(prog(u, t0, t0 + 0.3));
        let o = panel(40, y, 700, h, C.white, 20) + (rec && picked ? `<rect x="40" y="${y}" width="700" height="${h}" rx="20" fill="none" stroke="${C.ink}" stroke-width="6"/>` : "") +
          `<circle cx="84" cy="${y + 46}" r="16" fill="${rec && picked ? C.ink : "none"}" stroke="${C.ink}" stroke-width="5"/>` + txt(120, y + 57, n, 32, C.ink, { a: "start", w: 600 });
        if (rec) o += at(640, y + 46, pop(u, 7.88), pill(-pillW("Recommended", 22) / 2, -22, "Recommended", C.green, C.white, 22)) + G(fade(u, 9.12), txt(120, y + 100, "because it matches the product pages", 26, C.grey, { a: "start", w: 500 }));
        return G(k, o, `translate(${f(30 * (1 - k))} 0)`);
      };
      c += opt(300, 130, "Grid of cards", 6.8, true) + opt(460, 92, "Simple list", 7.05, false);
      s += G(kc, `<g transform="translate(980 ${f(150 + 40 * (1 - kc))})">${c}</g>`);
      const Y = path(u, [[8.9, 1900, 1100], [9.75, 1640, 520], [10.6, 1650, 530]]);
      s += click(1640, 510, u, 9.82) + you(Y.x, Y.y, u > 9.75 && u < 9.95 ? 1 : 0);
    }
    s += say(u, "It asks on the card.", 5.4, 10.2);
    s = G(A, s);
  }
  // your comment reaches the orchestrator, then the builders
  if (u > 10.3) {
    const kb = out(prog(u, 10.4, 10.8));
    let c = panel(0, 0, 560, 600, C.cream, 32) + txt(40, 62, "ACME-12", 22, C.grey, { a: "start", w: 600 }) + txt(40, 108, "Add a wishlist", 38, C.ink, { a: "start" }) + pill(40, 132, "In Progress", C.ink, C.white, 22);
    const msg = "Make the heart icon bigger.", posted = u > 12.4;
    c += panel(30, 470, 500, 96, C.white, 20) + txt(56, 528, posted ? "Write a comment…" : (u > 10.9 ? typed(msg, u, 10.9, 20) : "Write a comment…"), 26, posted || u < 10.9 ? C.grey : C.ink, { a: "start", w: 500 });
    if (posted) c += at(280, 330, pop(u, 12.4, 0.4), panel(-250, -80, 500, 150, C.white, 22) + pill(-224, -60, "You", C.ink, C.white, 20) + txt(-224, 40, msg, 28, C.ink, { a: "start", w: 600 }));
    const dx = 560 * (1 - io(prog(u, 14.4, 15.0)));
    s += G(kb, `<g transform="translate(${f(120 + dx)} ${f(200 + 30 * (1 - kb))})">${c}</g>`);
    const Y = path(u, [[10.4, 1460, 1100], [10.85, 1120, 760], [12.3, 1130, 770], [12.9, 1260, 1150]]);
    if (u < 12.9) s += you(Y.x, Y.y);
    // to the orchestrator
    const O = [1130, 470];
    s += drop(O[0], O[1], 0.24, u, { k: pop(u, 14.9), lx: u > 15.6 && u < 17.8 ? -0.7 : u > 17.8 ? 0.7 : 0, bls: [16.7, 20.2] }) + G(pop(u, 15.2), label(O[0], 556, "orchestrator", C.ink, C.white, 26));
    s += dash(690, 530, 1030, 480, io(prog(u, 15.65, 16.2)));
    const chip = (x, y, k) => at(x, y, k, panel(-46, -32, 92, 64, C.white, 16) + bar(-28, -14, 56, 9, C.ink, 4) + bar(-28, 4, 38, 9, C.grey, 4));
    const m1 = io(prog(u, 15.75, 16.6));
    if (m1 > 0 && m1 < 1) s += chip(lerp(690, 1040, m1), lerp(530, 478, m1), 1 - 0.3 * m1);
    // and on to the agents doing the work
    [[300, C.ink], [700, C.navy]].forEach(([by, fg], i) => {
      s += drop(1660, by, 0.17, u, { k: pop(u, 17.6 + i * 0.2), fg, lx: -0.6, bls: [19.6 + i * 0.3] }) + G(pop(u, 17.8 + i * 0.2), label(1668, by + 36, "builder", fg, C.white, 22));
      s += dash(1220, i ? 500 : 440, 1600, i ? by - 20 : by - 20, io(prog(u, 18.3, 18.8)));
      const m = io(prog(u, 18.4, 19.3));
      if (m > 0 && m < 1) s += chip(lerp(1220, 1590, m), lerp(i ? 500 : 440, by - 20, m), 0.8);
      s += tick(1730, by - 110, 22, pop(u, 19.4 + i * 0.15));
    });
    s += say(u, "Your words reach the agents.", 15.7);
  }
  return s;
}

// ⑥ Nothing without proof: moving the card to Review is refused; the agent hands you a review packet; approve, or send back with a note
function s6(u) {
  // "And when the work is done, | the agent can't just move the card to review. (1.48) | It hands you a review packet: (4.11) | what changed, (6.0) how to check it, (6.75) |
  //  and the evidence, (7.96) like a video of the real app. (8.9) | You approve it, (10.85) | or send it back with a note… (11.68) | and the note reaches the agent's session. (13.34)"
  let s = "";
  const dimB = 1 - 0.75 * prog(u, 4.0, 4.4) + 0.75 * prog(u, 11.1, 11.4), boardOut = 1 - prog(u, 11.75, 12.05);
  if (boardOut > 0) {
    let b = board() + tcard("ACME-15", ...slot(0, 0)) + tcard("ACME-3", ...slot(3, 0));
    const P = path(u, [[-0.6, ...grab(1, 0, 130, 150)], [1.3, ...grab(1, 0)], [1.5, ...grab(1, 0)], [2.3, ...grab(2, 0, -150, 0)], [2.5, ...grab(2, 0, -150, 0)], [3.1, ...grab(1, 0)], [3.2, ...grab(1, 0)], [3.8, ...grab(1, 0, 130, 150)]]);
    const shake = u > 2.3 && u < 2.7 ? Math.sin(u * 70) * 8 : 0;
    if (u < 1.5 || (u > 3.1 && u < 11.1)) b += tcard("ACME-12", ...slot(1, 0), u, { mark: "claude", ring: C.ink });
    else if (u <= 3.1) b += carried("ACME-12", P, u, 1.5, 3.1, { mark: "claude", ring: C.ink, shake });
    else b += tcard("ACME-12", ...slot(3, 1), u, { mark: "claude", done: pop(u, 11.25) });
    const lk = pop(u, 2.3) * (1 - prog(u, 3.9, 4.1));
    b += lock(colX(2) + 300, rowY(0) + 50, lk) + G(lk, label(colX(2) + 182, rowY(1) + 100, "needs a review packet", C.red, C.white, 22));
    if (u < 4.0) b += mover(P, "claude", u, [0.6, 3.4]);
    s += G(dimB * boardOut, b);
  }
  // the packet
  const pin = out(prog(u, 4.1, 4.6)), pgo = io(prog(u, 11.0, 11.4));
  if (pin > 0 && pgo < 1) {
    let p = panel(0, 0, 1320, 790, C.cream, 34);
    p += txt(50, 64, "REVIEW PACKET", 20, C.grey, { a: "start", w: 700, ls: 2 }) + txt(50, 122, "ACME-12 · Add a wishlist", 44, C.ink, { a: "start" });
    p += agent({ x: 66, y: 166, s: 0.05 }) + txt(92, 174, "Claude Code · session 4f2a9c1e", 24, C.grey, { a: "start", w: 500 });
    p += G(fade(u, 6.0), txt(50, 260, "What changed", 32, C.ink, { a: "start" }) + bar(50, 286, 520, 16) + bar(50, 318, 430, 16));
    p += G(fade(u, 6.75), txt(50, 410, "How to check", 32, C.ink, { a: "start" }));
    ["Open a product page", "Tap the heart", "Reload: it stays filled"].forEach((n, i) => {
      p += G(fade(u, 6.8 + i * 0.2), `<circle cx="70" cy="${452 + i * 56}" r="18" fill="${C.ink}"/>` + txt(70, 461 + i * 56, String(i + 1), 22, C.white) + txt(104, 462 + i * 56, n, 28, C.ink, { a: "start", w: 500 }));
    });
    // the evidence: a video of the real app
    const ek = out(prog(u, 7.96, 8.3));
    if (ek > 0) {
      const playing = u > 8.9, fill = prog(u, 9.5, 9.8);
      let v = panel(0, 0, 560, 315, C.term, 20) + panel(28, 26, 504, 238, C.white, 12) + panel(48, 46, 190, 196, C.line, 10) + bar(262, 62, 210, 20, C.ink, 6) + bar(262, 100, 150, 14) + bar(262, 126, 180, 14);
      v += `<path d="M300 186 C 300 168, 322 160, 334 176 C 346 160, 368 168, 368 186 C 368 206, 334 226, 334 226 C 334 226, 300 206, 300 186 Z" fill="${fill > 0 ? C.red : "none"}" fill-opacity="${f(fill)}" stroke="${C.red}" stroke-width="6"/>`;
      if (playing) v += `<path d="M${f(270 + 140 * prog(u, 8.9, 9.5))} ${f(150 + 50 * prog(u, 8.9, 9.5))} l0 40 l11 -9 l8 18 l8 -4 l-8 -17 l14 0 Z" fill="${C.ink}" stroke="${C.white}" stroke-width="2"/>`;
      v += bar(28, 284, 504, 8, "#3A3A42", 4) + bar(28, 284, 504 * prog(u, 8.9, 11.0), 8, C.orange, 4);
      if (!playing) v += `<circle cx="280" cy="145" r="52" fill="${C.ink}" opacity="0.85"/><path d="M262 118 L306 145 L262 172 Z" fill="${C.white}"/>`;
      p += txt(700, 260, "Evidence", 32, C.ink, { a: "start", op: ek }) + G(ek, v, `translate(700 ${f(286 + 30 * (1 - ek))})`);
    }
    const ok = u > 10.95;
    p += `<rect x="790" y="680" width="210" height="70" rx="35" fill="${C.paper}"/>` + txt(895, 725, "Send back", 28, C.ink, { w: 600 });
    p += `<rect x="1020" y="680" width="250" height="70" rx="35" fill="${ok ? C.green : C.ink}"/>` + txt(1145, 725, ok ? "Approved" : "Approve", 28, C.white, { w: 600 });
    // after approving, it shrinks into the Done column
    const tx = lerp(300, slot(3, 1)[0], pgo), ty = lerp(lerp(1150, 110, pin), rowY(1), pgo), sc = lerp(1, 0.25, pgo);
    s += G(1 - pgo, p, `translate(${f(tx)} ${f(ty)}) scale(${f(sc)})`);
    const Y = path(u, [[9.9, 1900, 1100], [10.75, 1455, 820], [11.4, 1460, 830]]);
    if (u < 11.4) s += click(1445, 825, u, 10.88) + you(Y.x, Y.y, u > 10.82 && u < 11.0 ? 1 : 0);
    if (u < 11.0) s += say(u, "Nothing reaches you without proof.", 4.3, 10.8);
  }
  // a second one goes back, with a note
  if (u > 11.6) {
    const k = out(prog(u, 11.7, 12.1));
    let p = panel(0, 0, 900, 560, C.cream, 32) + txt(40, 60, "REVIEW PACKET", 20, C.grey, { a: "start", w: 700, ls: 2 }) + txt(40, 116, "ACME-15 · Reviews section", 40, C.ink, { a: "start" }) + bar(40, 160, 600, 16) + bar(40, 192, 480, 16);
    const sent = u > 12.05;
    p += `<rect x="420" y="240" width="210" height="66" rx="33" fill="${sent ? C.ink : C.paper}"/>` + txt(525, 283, "Send back", 26, sent ? C.white : C.ink, { w: 600 });
    p += `<rect x="650" y="240" width="210" height="66" rx="33" fill="${C.paper}"/>` + txt(755, 283, "Approve", 26, C.ink, { w: 600 });
    const nk = out(prog(u, 12.15, 12.45)), note = "Stars don't show on mobile.", flown = io(prog(u, 13.4, 14.2));
    if (nk > 0) p += G(nk * (flown > 0 ? 0.5 : 1), panel(40, 340, 820, 170, C.white, 22) + txt(70, 390, "Note", 24, C.grey, { a: "start", w: 600 }) + txt(70, 450, typed(note, u, 12.3, 24), 32, C.ink, { a: "start", w: 600 }));
    s += G(k, p, `translate(720 ${f(200 + 40 * (1 - k))})`);
    const Y = path(u, [[11.6, 1800, 1100], [11.98, 1260, 488], [12.6, 1270, 500], [13.1, 1500, 1150]]);
    if (u < 13.1) s += click(1245, 475, u, 12.0) + you(Y.x, Y.y, u > 11.98 && u < 12.15 ? 1 : 0);
    // the note flies to the agent's session
    s += drop(330, 560, 0.24, u, { k: pop(u, 12.7), fg: C.navy, lx: flown > 0 && flown < 1 ? 0.8 : 0.4, bls: [14.3] }) + G(pop(u, 12.9), label(338, 660, "Codex · session 9d1b7e30", C.navy, C.white, 22));
    if (flown > 0 && flown < 1) s += at(lerp(1180, 470, flown), lerp(650, 520, flown), 1 - 0.5 * flown, panel(-150, -40, 300, 80, C.white, 20) + txt(0, 10, "Stars don't show…", 24, C.ink, { w: 600 }));
    s += bubble(470, 400, "On it.", pop(u, 14.4), { size: 32, tail: "down" });
    s += say(u, "Send it back, and the note reaches the agent.", 12.4);
  }
  return s;
}

// ⑦ Local and instant: one small server and one database file on your machine; no accounts, no cloud; changes show up at once
function s7(u) {
  // "Everything stays local: | one small server, (1.79) and one database file on your machine. (2.82) | No accounts, (5.4) no cloud, (6.22) and every change shows up on your board instantly. (6.85, instantly 9.3)"
  let s = "";
  const kl = pop(u, -0.45, 0.6);
  let l = `<rect x="440" y="190" width="1040" height="580" rx="30" fill="${C.ink}"/><rect x="470" y="220" width="980" height="520" rx="14" fill="${C.cream}"/><path d="M360 770 L1560 770 L1510 818 L410 818 Z" fill="${C.ink}"/><rect x="890" y="770" width="140" height="12" rx="6" fill="#2A2A30"/>`;
  // the server
  l += at(640, 455, pop(u, 1.79), `<rect x="-100" y="-125" width="200" height="250" rx="22" fill="${C.ink}"/>` + [0, 1, 2].map((i) => bar(-74, -92 + i * 70, 110, 22, "#3A3A42", 8) + `<circle cx="64" cy="${-81 + i * 70}" r="9" fill="${C.green}"/>`).join("") + txt(0, 175, "server", 30, C.ink));
  // the database file
  l += at(880, 455, pop(u, 2.82), `<path d="M-85 -95 V95 A85 26 0 0 0 85 95 V-95" fill="${C.navy}"/><ellipse cy="-95" rx="85" ry="26" fill="#2A3A66"/><path d="M-85 -20 A85 26 0 0 0 85 -20 M-85 40 A85 26 0 0 0 85 40" fill="none" stroke="#2A3A66" stroke-width="6"/>` + txt(0, 175, "one file", 30, C.ink));
  l += dash(745, 455, 790, 455, prog(u, 3.0, 3.3), C.ink, 6);
  // the board
  const kb = pop(u, 6.9);
  if (kb > 0) {
    const flash = Math.max(1 - Math.abs(u - 8.0) / 0.3, 1 - Math.abs(u - 9.35) / 0.3, 0);
    let b = panel(-200, -190, 400, 380, C.white, 22) + txt(-170, -140, "Acme Shop", 28, C.ink, { a: "start" });
    [0, 1, 2].forEach((i) => { b += panel(-180 + i * 124, -110, 112, 280, C.paper, 12); });
    b += bar(-172, -96, 96, 40, C.white, 8) + bar(-48, -96, 96, 40, C.white, 8);
    const moved = u > 8.0;
    b += bar(moved ? 76 : -48, moved ? -96 : -46, 96, 40, moved ? C.green : C.orange, 8);
    if (u > 9.35) b += bar(76, -46, 96, 40, C.green, 8);
    b += `<rect x="-200" y="-190" width="400" height="380" rx="22" fill="none" stroke="${C.orange}" stroke-width="${f(10 * flash)}" opacity="${f(flash)}"/>`;
    b += at(170, -160, pop(u, 9.3), `<path d="M8 -34 L-20 6 L0 6 L-8 34 L22 -8 L2 -8 Z" fill="${C.orange}" stroke="${C.ink}" stroke-width="4" stroke-linejoin="round"/>`);
    l += at(1230, 470, kb, b);
  }
  // a change arrives: agent → server → board, then once more, faster
  const pulse = (t0, t1, t2) => {
    const a = prog(u, t0, t1), b2 = prog(u, t1, t2);
    if (a > 0 && a < 1) return `<circle cx="${f(lerp(300, 640, io(a)))}" cy="${f(lerp(470, 455, io(a)))}" r="16" fill="${C.orange}" stroke="${C.ink}" stroke-width="4"/>`;
    if (b2 > 0 && b2 < 1) return `<circle cx="${f(lerp(640, 1150, io(b2)))}" cy="455" r="16" fill="${C.orange}" stroke="${C.ink}" stroke-width="4"/>`;
    return "";
  };
  s += at(960, 500, kl, `<g transform="translate(-960 -500)">${l}</g>`);
  s += drop(230, 470, 0.17, u, { k: pop(u, 6.7), lx: 0.8, bls: [8.4] }) + pulse(7.2, 7.6, 7.95) + pulse(8.95, 9.1, 9.3);
  // no accounts, no cloud
  const ka = pop(u, 5.4);
  if (ka > 0) s += at(330, 110, ka, `<circle cx="0" cy="-12" r="16" fill="${C.ink}"/><path d="M-28 30 A28 26 0 0 1 28 30 Z" fill="${C.ink}"/><circle r="46" fill="none" stroke="${C.red}" stroke-width="8"/><line x1="-32" y1="32" x2="32" y2="-32" stroke="${C.red}" stroke-width="8"/>` + txt(70, 14, "No accounts", 40, C.ink, { a: "start" }));
  const kc = pop(u, 6.22);
  if (kc > 0) s += at(1300, 110, kc, `<path d="M-34 22 A20 20 0 0 1 -26 -12 A26 26 0 0 1 22 -18 A22 22 0 0 1 32 22 Z" fill="${C.cream}" stroke="${C.ink}" stroke-width="6"/><circle r="46" fill="none" stroke="${C.red}" stroke-width="8"/><line x1="-32" y1="32" x2="32" y2="-32" stroke="${C.red}" stroke-width="8"/>` + txt(70, 14, "No cloud", 40, C.ink, { a: "start" }));
  s += say(u, "Everything stays on your machine.", 0.2, 6.6) + say(u, "Every change shows up instantly.", 6.9);
  return s;
}

// ⑧ Outro
const s8 = (u) => banner(u, -0.5, "Your agents, in harmony.", 1.33);

// ── timing: each scene leads in, plays its narration line, then breathes while the music plays on ──
const LEAD = 0.6, TAIL = 1.2;
const SCENES = [
  ["s1-problem", 14.32, s1], ["s2-what", 11.36, s2], ["s3-setup", 13.68, s3, 1.6], ["s3b-orchestrator", 27.84, s3b],
  ["s4-watch", 16.32, s4], ["s5-decisions", 21.36, s5], ["s6-proof", 15.44, s6, 1.4], ["s7-local", 10.32, s7], ["s8-outro", 3.44, s8, 3.6],
];
let clock = 0;
export const TIMELINE = SCENES.map(([scene, seconds, fn, tail = TAIL]) => {
  const r = { scene, voice: `audio/${scene}-a.mp3`, start: f(clock), at: f(clock + LEAD), seconds, end: f(clock + LEAD + seconds + tail), fn };
  clock = r.end;
  return r;
});
export const DUR = clock;
export function frame(t) {
  let s = "";
  TIMELINE.forEach((r, i) => {
    const o = win(t, i === 0 ? -1 : r.start, i === TIMELINE.length - 1 ? 1e9 : r.end, 0.5);
    if (o > 0) s += G(o, r.fn(t - r.at));
  });
  return svg(s);
}

if (import.meta.main) {
  const arg = process.argv[2];
  if (arg === "--timeline") {
    console.log(JSON.stringify(TIMELINE.map(({ fn, ...r }) => r), null, 1));
  } else {
    const outDir = `${dir}frames/`;
    const only = arg ? arg.split(",").map(Number) : null;
    if (!only) rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    if (only) { only.forEach((sec) => writeFileSync(`${outDir}still-${sec}.svg`, frame(sec))); console.log(`stills ${only}`); }
    else { const N = Math.round(DUR * FPS); for (let i = 0; i < N; i++) writeFileSync(`${outDir}${String(i).padStart(4, "0")}.svg`, frame(i / FPS)); console.log(`${N} frames, ${DUR.toFixed(2)} s`); }
  }
}
