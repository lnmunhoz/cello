// Shared drawing kit for Cello's motion graphics (the promo, art/promo/v2/make.mjs, and the onboarding
// video, art/setup-video/v2/make.mjs). Every frame is an SVG string built from these pieces, rendered with resvg.
// Taken from the promo's make.mjs with two changes: card() takes the key, title and tag colour itself
// (the promo looked them up by number in its CARDS), and pillW() and svg() are new. When the promo switches to this kit
// it keeps its CARDS list and wraps card(), e.g. card = (id, x, y, o) => kitCard(`CEL-${id}`, ...CARDS[id], x, y, o);
// with that, its frames come out byte-identical.

export const FPS = 30, W = 1920, H = 1080;
export const C = { orange: "#FF7A2F", ink: "#141416", cream: "#FBF3E3", paper: "#F3EBDD", navy: "#0F1B3D", teal: "#2BB3A3", white: "#FFFFFF", grey: "#8A8A93", line: "#E7DFD0", red: "#E5484D", green: "#2E9E5B", term: "#1B1B20" };
export const FONT = `font-family="Avenir Next" `, MONO = `font-family="Menlo" `;
export const f = (n) => +(+n).toFixed(2);

// ── timing ──
export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, k) => a + (b - a) * k;
// 0 → 1 as t goes from t0 to t1
export const prog = (t, t0, t1) => clamp((t - t0) / (t1 - t0));
// easings: in-out cubic, out cubic, out with overshoot
export const io = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
export const out = (k) => 1 - Math.pow(1 - k, 3);
export const back = (k) => { const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
// a scale that pops from 0 past 1 and settles at 1, starting at t0
export const pop = (t, t0, d = 0.45) => Math.max(0, back(prog(t, t0, t0 + d)));
// position along keyframes [[t, x, y], ...] with in-out easing; vx is the speed (for the agent's gaze)
export function path(t, keys) {
  if (t <= keys[0][0]) return { x: keys[0][1], y: keys[0][2], vx: 0 };
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, x0, y0] = keys[i], [t1, x1, y1] = keys[i + 1];
    if (t <= t1) { const k = io(prog(t, t0, t1)); const moving = k > 0 && k < 1; return { x: lerp(x0, x1, k), y: lerp(y0, y1, k), vx: moving ? (x1 - x0) / Math.max(0.01, t1 - t0) : 0 }; }
  }
  const l = keys[keys.length - 1]; return { x: l[1], y: l[2], vx: 0 };
}
// eyelids: 1 at each blink time, 0 away from them
export const blink = (t, times) => times.reduce((m, b) => Math.max(m, 1 - Math.abs(t - b) / 0.09), 0);
// visible from a to b, fading in and out over `fade` seconds
export const win = (t, a, b, fade = 0.3) => Math.min(prog(t, a - fade / 2, a + fade / 2), 1 - prog(t, b - fade / 2, b + fade / 2));
export const typed = (str, t, t0, cps = 26) => str.slice(0, Math.max(0, Math.floor((t - t0) * cps)));

// ── drawing kit ──
// the agent: a drop with two eyes. s 1 is about 650 px tall; tip: anchor at the point (a cursor) instead of the body
export const DROP = (() => {
  const P = [205, 185], c = [575, 570], r = 270, dx = c[0] - P[0], dy = c[1] - P[1], D = Math.hypot(dx, dy), base = Math.atan2(dy, dx), a = Math.acos(r / D);
  const p1 = [c[0] + r * Math.cos(base + Math.PI - a), c[1] + r * Math.sin(base + Math.PI - a)], p2 = [c[0] + r * Math.cos(base + Math.PI + a), c[1] + r * Math.sin(base + Math.PI + a)];
  return `M205 185 L${f(p1[0])} ${f(p1[1])} A270 270 0 1 0 ${f(p2[0])} ${f(p2[1])} Z`;
})();
export function agent({ x, y, s = 1, fg = C.ink, eye = C.orange, bl = 0, lx = 0, ly = 0, tip = false, outline = null, rot = 0 }) {
  const [ax, ay] = tip ? [205, 185] : [575, 570], eh = Math.max(14, 124 * (1 - bl)), ox = lx * 28, oy = ly * 22;
  const e = (cx) => `<rect x="${f(cx - 40 + ox)}" y="${f(575 - eh / 2 + oy)}" width="80" height="${f(eh)}" rx="40"/>`;
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)}) scale(${f(s)}) translate(${-ax} ${-ay})">` +
    (outline ? `<path d="${DROP}" fill="${outline}" stroke="${outline}" stroke-width="60" stroke-linejoin="round"/>` : "") +
    `<path d="${DROP}" fill="${fg}"/><g fill="${eye}">${e(510)}${e(640)}</g></g>`;
}
export const txt = (x, y, s, size, fill, { w = 700, a = "middle", op = 1, mono = false, ls = 0 } = {}) =>
  `<text x="${f(x)}" y="${f(y)}" ${mono ? MONO : FONT}font-size="${size}" font-weight="${w}" fill="${fill}" text-anchor="${a}" opacity="${f(op)}"${ls ? ` letter-spacing="${ls}"` : ""}>${s.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`;
// width a pill of this text takes (its left edge is x)
export const pillW = (s, size = 26) => s.length * size * 0.56 + 36;
export const pill = (x, y, s, bg, fg = C.white, size = 26, w = 600) => {
  const wd = s.length * size * 0.56 + 36;
  return `<rect x="${f(x)}" y="${f(y)}" width="${f(wd)}" height="${size + 22}" rx="${(size + 22) / 2}" fill="${bg}"/>` + txt(x + wd / 2, y + size + 4, s, size, fg, { w });
};
export const panel = (x, y, w, h, fill = C.cream, r = 32) => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${r}" fill="${fill}"/>`;
export const bar = (x, y, w, h = 16, fill = C.line, r = 8) => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${h}" rx="${r}" fill="${fill}"/>`;
// the human's pointer (classic arrow) with a "You" label
export const CUR = "M0 0 L0 300 L74 234 L124 344 L178 320 L128 212 L224 212 Z";
export const you = (x, y, press = 0) => `<g transform="translate(${f(x)} ${f(y)}) scale(${f(0.2 * (1 - 0.15 * press))})"><path d="${CUR}" fill="${C.white}" stroke="${C.ink}" stroke-width="22" stroke-linejoin="round"/></g>` + pill(x + 46, y + 62, "You", C.white, C.ink, 22);
export const click = (x, y, t, t0) => { const k = prog(t, t0, t0 + 0.4); return k > 0 && k < 1 ? `<circle cx="${f(x)}" cy="${f(y)}" r="${f(16 + 50 * k)}" fill="none" stroke="${C.ink}" stroke-width="5" opacity="${f(1 - k)}"/>` : ""; };
export const term = (x, y, w, h, title = "zsh") => panel(x, y, w, h, C.term, 24) + [0, 1, 2].map((i) => `<circle cx="${x + 30 + i * 26}" cy="${y + 30}" r="8" fill="${["#FF5F57", "#FEBC2E", "#28C840"][i]}"/>`).join("") + txt(x + w / 2, y + 38, title, 20, C.grey, { w: 500 });

// task cards: key ("CEL-12"), title, tag colour; lift tilts it while dragged, ring outlines it, note sits top-right
export const CW = 420, CH = 112;
export function card(key, title, tag, x, y, { lift = 0, ring = null, note = null, shake = 0, s = 1 } = {}) {
  const sh = lift ? `<rect x="10" y="22" width="${CW}" height="${CH}" rx="18" fill="#000" opacity="${f(0.18 * lift)}"/>` : "";
  return `<g transform="translate(${f(x + CW / 2 + shake)} ${f(y + CH / 2)}) rotate(${f(3 * lift)}) scale(${f(s * (1 + 0.04 * lift))}) translate(${-CW / 2} ${-CH / 2})">${sh}` +
    `<rect width="${CW}" height="${CH}" rx="18" fill="${C.white}" stroke="${ring || C.line}" stroke-width="${ring ? 6 : 2}"/>` +
    `<rect x="22" y="24" width="12" height="12" rx="6" fill="${tag}"/>` + txt(46, 36, key, 20, C.grey, { a: "start", w: 600 }) +
    txt(22, 82, title, 30, C.ink, { a: "start", w: 600 }) + (note ? txt(CW - 20, 36, note, 18, ring || C.grey, { a: "end", w: 600 }) : "") + `</g>`;
}
// where an agent-cursor holds a card it drags, and how lifted the card is between pick-up t0 and drop t1
export const GRAB = [300, 64];
export const lifted = (t, t0, t1) => Math.min(prog(t, t0, t0 + 0.15), 1 - prog(t, t1 - 0.15, t1));

// wraps a frame's content in the SVG document on a solid background
export const svg = (body, bg = C.orange) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${bg}"/>${body}</svg>`;
