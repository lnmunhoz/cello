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

The agent on its own, without the tile, is `packages/shared/src/agentMark.ts` (CEL-6): the same body path
and eyes, drawn at any size, with its tip as the hotspot. The board's agent cursors draw it in the
session's colour with white eyes, and the e2e videos' pointer draws it in ink with orange eyes. A test there
compares it with `icon.svg` and `favicon.svg`, so a change to the icon has to change the mark too.

The mark has states (CEL-69): `apps/web/src/components/ui/AgentMark.tsx` draws it with a mood, and cards
and list rows show it in place of the session's presence dot, in the session's colour with white eyes.
**Working** (stage Building or Fixing findings): narrowed eyes on the tip; a burst spins a shorter tip
round the body three times, the eyes following it. **Thinking** (no stage, or Agent review): it leans
back, eyes slanted up toward the tip; a burst leans further back and forward once. A burst plays when
the agent starts working or thinking, or checks in while at it, so a busy agent keeps moving and a quiet
one goes still. **Needs input**: big eyes looking up; arriving, it hops twice and a ring goes out, once.
**Done** (In Review or Done, after ElevenLabs' take): a pancake squash, a leap with happy arches for
eyes, a wobbly landing, a blink, once. Merged has happy eyes; a quiet or ended session keeps still
(amber, grey). Every motion ends (nothing loops, so an idle board runs no animation), it plays only for
a change seen on screen, and `prefers-reduced-motion` stills it all. Body and eyes are two CSS colours
(`--agent-body`, `--agent-eye`, or the `body` and `eye` props), so it draws in any colour. Only
transform and opacity animate, each on its own HTML layer (`AgentMark.css`). `e2e/perf.spec.ts` holds
40 agents spinning at once to at least 55 fps (60 measured), no long tasks, no more layout than the
board standing still and under 1.5 ms of extra style work a frame. The extra geometry (spinner tip, happy eyes, the square frame) is in `agentMark.ts`.

## Where it ships (CEL-27)

`art/icon/build-app-icons.mjs` builds every icon the apps use from `icon.svg` and `favicon.svg` (resvg 0.47.0).
Edit a source, then run `bun art/icon/build-app-icons.mjs`; `--check` fails if a committed icon is out of date
and prints the resvg version it used. The same sources and resvg version give the same bytes.

| Built file | From | Used by |
|---|---|---|
| `apps/web/public/icons/icon.svg` | `favicon.svg` (as is) | the browser tab, and the manifest's SVG icon |
| `apps/web/public/favicon.ico` | `favicon.svg` at 16, 32, 48 px | browsers that skip SVG favicons |
| `apps/web/public/icons/icon-192.png`, `icon-512.png` | `icon.svg` | the PWA manifest (`purpose: any`) |
| `apps/web/public/icons/icon-maskable-512.png` | `icon.svg`, the agent at 80% | the manifest (`maskable`): the tip stays inside the 80% safe circle |
| `apps/web/public/icons/apple-touch-icon.png` | `icon.svg` at 180 px, full bleed | iOS home screen (iOS rounds the corners) |
| `apps/desktop/resources/icon.png` | `icon.svg` in Apple's grid: an 824 px rounded square on 1024, with a shadow | the Dock icon in dev (`app.dock.setIcon`) |
| `apps/desktop/resources/Cello.icon/` (`icon.json`, `Assets/agent.svg`) | `icon.svg`: the agent as one layer with its eyes cut out, on an orange fill | the packaged `Cello.app` (electron-builder `mac.icon`) |

The `.icon` is an Icon Composer document. When packaging, electron-builder compiles it with Xcode 26's
`actool` into `Contents/Resources/Assets.car` (`CFBundleIconName`), plus an `icon.icns` for macOS before 26.
So the Mac that packages needs Xcode 26. Its settings:
- one layer with `glass: false`
- shadow `none`, `specular: false`, translucency off
- a solid orange fill, pinned for the dark appearance too

The manifest's colours come from the icon:
- `theme_color` ink `#141416`: the installed app's title bar on macOS, the status bar on Android
- `background_color` orange `#FF7A2F`:
  - macOS Chrome has no launch screen and shows it only for a moment before the page paints
  - Android shows it as the launch screen
  - iOS ignores it

The 2026-11-15 decisions below explain both choices. The side-by-side comparisons are in CEL-27's review packet.

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
- 2026-11-15 (CEL-27): The packaged app's icon is a flat Icon Composer `.icon`, not a plain `.icns`.
  - With only an `.icns`, macOS 26 redraws it as glass: the ink teardrop turns see-through brown with glowing eyes.
  - In macOS's dark icon style the `.icns` loses the orange altogether: a black tile with the agent as a faint outline.
  - The `.icon` with glass off keeps the agent flat ink on orange in both styles, so it stays recognisable in the Dock.
- 2026-11-15 (CEL-27): The installed web app gets an ink title bar (`theme_color` `#141416`) and an orange `background_color`.
  - The ink bar sits quietly above both the light and the dark board.
  - An orange bar would be loud on every window.
  - The orange shows where the brand belongs: Android's launch screen, where the full-bleed icon melts into it and leaves the agent.
- 2026-11-14: Promo music must sound like Cello (cello and orchestra, never electronic); chosen: Baroque strings take 1.
- 2026-11-14: Write "Chello" in voice text so it's pronounced right; the screen still says Cello. Leave a breath (about 0.8 s) between voice lines.
- 2026-11-14: Voice tags must be unambiguous: `[clear]` made the narrator clear his throat. Use one consistent tag such as `[confident, inspiring]`, or none.
- 2026-11-14: No real project names or session ids in demos and promos; use web-app, api, mobile, docs-site.
- 2026-11-14: Rule for this brand: judge every mark at 16 px before large; no interior lines.
