// Cello icon, round 14: the teardrop agent (round 13 #4, chosen) with orchestra variations.
// Lucas, 2026-11-14: "this is the good one ... a variation ... have a tie ... something within the
// team of cello, violoncello and orchestra".
//   bun art/variations/round14-teardrop/make.mjs
import { writeFileSync } from "node:fs";
const out = new URL(".", import.meta.url).pathname;
const f = (n) => +n.toFixed(1);
const C = { navy: "#0F1B3D", cream: "#FBF3E3", orange: "#FF7A2F", ink: "#141416", teal: "#2BB3A3" };
const svg = (bg, inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><rect width="1024" height="1024" fill="${bg}"/>${inner}</svg>\n`;

// Teardrop: a circle (c, r) with one sharp corner at P
function drop(P, c, r) {
  const dx = c[0] - P[0], dy = c[1] - P[1], D = Math.hypot(dx, dy), base = Math.atan2(dy, dx), t = Math.acos(r / D);
  const p1 = [c[0] + r * Math.cos(base + Math.PI - t), c[1] + r * Math.sin(base + Math.PI - t)];
  const p2 = [c[0] + r * Math.cos(base + Math.PI + t), c[1] + r * Math.sin(base + Math.PI + t)];
  return `M${P[0]} ${P[1]} L${f(p1[0])} ${f(p1[1])} A${r} ${r} 0 1 0 ${f(p2[0])} ${f(p2[1])} Z`;
}
const pill = (cx, cy, w, h) => `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="${w / 2}"/>`;
const DROP = drop([205, 185], [575, 570], 270);
const agent = (fg, eyeC, { ex = 575, ey = 575 } = {}) => `<path d="${DROP}" fill="${fg}"/><g fill="${eyeC}">${pill(ex - 65, ey, 80, 124)}${pill(ex + 65, ey, 80, 124)}</g>`;
// fit: scale about the canvas centre so accessories outside the body still fit
const fit = (inner, k = 1, dx = 0, dy = 0) => `<g transform="translate(${512 + dx} ${512 + dy}) scale(${k}) translate(-525 -512)">${inner}</g>`;
const v = {};

// 1. Base, refined (centred)
v["1-base"] = svg(C.orange, fit(agent(C.ink, C.orange)));

// 2. Bow tie: dressed for the concert
{
  const tie = (c) => `<g fill="${c}" stroke="${c}" stroke-width="20" stroke-linejoin="round"><path d="M480 724 L575 760 L480 796 Z"/><path d="M670 724 L575 760 L670 796 Z"/></g><circle cx="575" cy="760" r="30" fill="${c}"/>`;
  v["2-bowtie"] = svg(C.orange, fit(agent(C.ink, C.orange, { ey: 545 }) + tie(C.orange)));
  v["2b-bowtie-cream"] = svg(C.orange, fit(agent(C.ink, C.orange, { ey: 545 }) + tie(C.cream)));
}

// 3. Scroll curl: a cello's scroll as a curl of hair on top of its head
{
  const curl = `<path d="M640 320 C 620 230, 690 175, 760 200 C 830 225, 820 320, 760 322 C 715 324, 705 270, 745 262" fill="none" stroke="${C.ink}" stroke-width="54" stroke-linecap="round"/>`;
  v["3-scroll-curl"] = svg(C.orange, fit(curl + agent(C.ink, C.orange), 0.9, 0, 30));
}

// 4. Conductor: holding a baton, leading the agents
{
  const baton = `<path d="M790 640 L955 455" stroke="${C.ink}" stroke-width="40" stroke-linecap="round"/><circle cx="955" cy="455" r="30" fill="${C.cream}"/>` +
    `<circle cx="800" cy="650" r="44" fill="${C.ink}"/>`;
  v["4-conductor"] = svg(C.orange, fit(agent(C.ink, C.orange) + baton, 0.86, -40, 10));
}

// 5. Music note: it sings
{
  const note = `<g fill="${C.ink}"><ellipse cx="850" cy="330" rx="56" ry="42" transform="rotate(-22 850 330)"/><rect x="876" y="140" width="34" height="196" rx="8"/><path d="M876 140 L910 140 C 930 190, 990 200, 975 280 C 965 235, 935 225, 910 222 Z"/></g>`;
  v["5-note"] = svg(C.orange, fit(agent(C.ink, C.orange) + note, 0.86, -30, 20));
}

// 6. Ensemble: three agents, a little orchestra (the team)
{
  const small = (fg, eye, x, y, k) => `<g transform="translate(${x} ${y}) scale(${k}) translate(-525 -512)"><path d="${DROP}" fill="${C.orange}" stroke="${C.orange}" stroke-width="70" stroke-linejoin="round"/>${agent(fg, eye)}</g>`;
  v["6-ensemble"] = svg(C.orange, small(C.cream, C.orange, 300, 560, 0.5) + small(C.navy, C.orange, 760, 560, 0.5) + small(C.ink, C.orange, 530, 470, 0.66));
}

// palettes of the base
v["P1-ink"] = svg(C.ink, fit(agent(C.orange, C.ink)));
v["P2-cream"] = svg(C.cream, fit(agent(C.navy, C.cream)));
v["P3-navy"] = svg(C.navy, fit(agent(C.cream, C.navy)));

for (const [n, s] of Object.entries(v)) writeFileSync(`${out}${n}.svg`, s);
console.log(Object.keys(v).join(" "));
