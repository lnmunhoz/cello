# Setup video (CEL-94)

A 2:33 onboarding video: what Cello is, setting it up by pointing an agent at it, the orchestrator, and the board at work. Every shot is real footage of the app or of real commands.

- **Final:** `review/cello-setup.mp4`, with a captioned copy `review/cello-setup-captions.mp4` (`review/cello-setup.srt`).
- **Narration:** `audio/`, ElevenLabs, voice "Noah - Confident Canadian Narrator", eleven_v4, `[calm] [warmly]`, two takes per scene (`-a`, `-b`). "Cello" is written `/ˈtʃɛloʊ/` in the prompt so it's said "chello". The cut uses take A.
- **Music:** `music/baroque-long.mp3`, the promo's `../promo/v2/audio/music7-baroque-a.mp3` looped to 2:42 before its fade-out.
- **Footage:** `footage/`
  - `s1-agents`, `s2-board`, `s3b-orchestrate`, `s4-watch`, `s5-decisions`, `s6-proof`: `e2e/onboarding-video.spec.ts`, run with `CELLO_E2E_REVIEW=1 bun run test:e2e -- e2e/onboarding-video.spec.ts`, then the first Loading frames trimmed.
  - `s3-terminal`, `s3-board`: `tools/agent-session/record-setup.sh`, the setup guide's real commands in a clean container (asciinema, rendered with xterm.js; the board recorded alongside). Raw output goes to `raw/` (not committed).
  - `banner`, `architecture`, `loop`: the README's animated SVGs, `bun tools/record-svg.mjs`.
- **Cut:** `python3 tools/cut.py --out review/cello-setup.mp4` (each scene's picture fitted to its narration, the music ducked under the voice), then `python3 tools/captions.py review/cello-setup.timeline.json > review/cello-setup.srt` and the ffmpeg `subtitles` burn in the CEL-94 packet.
- `tools/agent-session/record.sh` is a hand-driven variant (a person types to Claude Code in the container); it wasn't used.

## v2: motion graphics

The real-footage cut above was too flat to explain Cello, so v2 draws the picture instead, in the promo's style: the same narration and music, with simple drawn screens, the agent drops, and one bold phrase per beat, each thing appearing on the word that names it.

- **Frames:** `v2/make.mjs`, every frame an SVG from code, drawn with the kit shared with the promo (`art/motion-kit.mjs`). `bun art/setup-video/v2/make.mjs 12.5,40` writes stills, `--timeline` prints each scene's start and voice time.
- **Storyboard:** `v2/storyboard.sh` renders the review stills into `v2/storyboard/<seconds>.webp`.
- **Render:** `v2/render.sh` (about 2.5 min): frames → PNG (resvg) → picture, the narration at the timeline's voice times with the music ducked under it (`tools/mix.py`, which `tools/cut.py` uses too), then captions (`tools/captions.py`) burnt into a copy. `SKIP_FRAMES=1` reuses the PNGs. Writes `v2/cello-setup-v2.mp4` (2:33), `v2/cello-setup-v2-captions.mp4`, `v2/cello-setup-v2.srt` and `v2/cello-setup-v2.timeline.json`.
- **Word timing:** each scene's comment lists the narration with the second each phrase starts, measured from take A (pauses with ffmpeg `silencedetect`, words inside a phrase split by their share of its characters).
