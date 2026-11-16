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
