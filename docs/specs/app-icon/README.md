# Cello app icon and promo

## What was asked (verbatim, 2026-11-14)

- "create an icon for this project"
- "very minimal and then like should be easy to render on the web as well"
- "when it's small you can barely see it ... think about different approaches"
- "it looks kind of like a face and it reminds me of Grokbot ... different variations of this one"
- "explore more with the cursor design ... to look more sleek"
- "have a tie ... something within the team of cello, violoncello and orchestra"
- "create a video, a promo video about this project using 11 labs ... make this kind of character a little animated with the eyes blinking ... explaining the product, like a 30 second video"

There was no earlier icon.

## The icon

A teardrop agent: a circle with one sharp corner (the cursor tip) and two pill eyes, cut out in the
background colour. Ink `#141416` on orange `#FF7A2F`. It reads as a cursor, a face and a character at once,
and holds up at 16 px because it is one solid shape with two holes and nothing thinner than 64 px on the
1024 canvas.

Files in `art/icon/`:

| File | Use |
|---|---|
| `icon.svg`, `icon-1024.png` | App icon: the plain agent (no note) |
| `ensemble.svg`, `ensemble-1024.png` | The team: three agents (cream, ink, navy), for the landing page and empty states |
| `favicon.svg`, `favicon.ico`, `favicon-{16,32,48,180,192,512}.png` | Same agent, favicon sizes |
| `apple-touch-icon.png` | 180 px of the app icon |
| `make-source.mjs` | The generator these came from (round 14) |

The same face is meant for agent avatars in the UI, with state shown by the eyes (idle, working, thinking,
waiting, done): see `art/variations/round12-face/S-*.svg`.

## How we got here

All rounds live in `art/variations/` (each has its own `make.mjs`); the review page is the Artifact
"Cello Icon Options".

1. Dark liquid glass (skill default): rejected, "addicted to a certain style".
2. Flat f-hole and card ideas: no identity.
3. ElevenLabs sketches of six directions: the cello-playing cursor ("ensemble") was liked.
4-5. That cellist traced and simplified: still too much detail when small.
6-7. A cursor as a cello (strings, f-holes, bridge): lines vanish at 16 px.
8-10. Small-first rule (judge at 16 px first); chunky f-hole, tail-less arrow, orchestra ideas.
11. Mobbin research (Airbnb, Subway, AllTrails, Google Drive, Alma): one bold abstract silhouette wins.
    The "soft agent" (a rounded arrow with eyes) was picked.
12. Faces and states, after studying xAI's Grok Bot (one shape, two eyes, state in the eyes).
13. Sleeker shapes: the teardrop was picked.
14. Orchestra variations: the note version and the ensemble were picked; the note was dropped the same day.

## Promo video

**Current: `art/promo/v2/cello-promo-60.mp4`**, 70.6 s (a 0.55 s breath before each beat: `BREATH` in make.mjs), from the script artifact "Cello Promo Script" (draft 3, 12 beats: the mess, meet Cello, CLI and claims, live cursors, who did it, Pages, Docs and Specs, review, design rounds, catch up, search and local, end card). Built with `art/promo/v2/make.mjs` and `render.sh`; 12 ElevenLabs voice lines (Noah, eleven_v4), all tagged `[confident, inspiring]` for one serious, inspiring tone, each sped up only as much as its slot needs (`TEMPOS` in render.sh; check with `python3 check_vo.py`). Music: `v2/audio/music7-baroque-a.mp3`, a Baroque string ensemble led by a cello (other options in `v2/audio/`, previews in `v2/previews/`, earlier voice in `v2/audio/voice-v1/`). No real project names or session ids.

First cut (30 s, superseded):

`art/promo/cello-promo.mp4`, 30.5 s, 1920x1080, 30 fps. Built with `art/promo/make.mjs` (every frame is
an SVG) and `art/promo/render.sh` (resvg + ffmpeg). Voiceover: ElevenLabs, voice "Noah - Confident
Canadian Narrator", eleven_v4, one clip per line (`audio/vo1-6.mp3`). Music: ElevenLabs Music v2.5,
pizzicato cello theme (`audio/music1.mp3`, alternate take `music2.mp3`), ducked under the voice.

Scenes: Meet Cello, the ensemble, a live board where the agents are the cursors (pick up, carry and drop
cards, comment), "who did it, and which conversation", all repos on your Mac, end card.

## Decisions

- 2026-11-14: Icon and favicon = the plain teardrop agent (the note version was dropped: "just use the one with the character"); team mark = ensemble.
- 2026-11-14: Promo music must sound like Cello (cello and orchestra, never electronic); chosen: Baroque strings take 1.
- 2026-11-14: Write "Chello" in voice text so it's pronounced right; the screen still says Cello. Leave a breath (about 0.8 s) between voice lines.
- 2026-11-14: Voice tags must be unambiguous: `[clear]` made the narrator clear his throat. Use one consistent tag such as `[confident, inspiring]`, or none.
- 2026-11-14: No real project names or session ids in demos and promos; use web-app, api, mobile, docs-site.
- 2026-11-14: Rule for this brand: judge every mark at 16 px before large; no interior lines.
