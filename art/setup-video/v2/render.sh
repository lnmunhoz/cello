#!/usr/bin/env bash
# Renders the v2 onboarding video (CEL-94): SVG frames (make.mjs) → PNG (resvg, parallel) → picture,
# then the narration at the timeline's voice times with the music ducked under it (../tools/mix.py, shared
# with the footage cut), then captions (../tools/captions.py) burnt into a second copy.
#   art/setup-video/v2/render.sh          everything
#   SKIP_FRAMES=1 art/setup-video/v2/render.sh   reuse frames/*.png (after a sound or caption change)
# Writes cello-setup-v2.mp4, cello-setup-v2-captions.mp4, cello-setup-v2.srt and cello-setup-v2.timeline.json.
set -euo pipefail
cd "$(dirname "$0")"
bun make.mjs --timeline > cello-setup-v2.timeline.json
if [ -z "${SKIP_FRAMES:-}" ]; then
  bun make.mjs
  ls frames/*.svg | xargs -P 8 -I{} sh -c 'resvg -w 1920 -h 1080 "$1" "${1%.svg}.png"' _ {}
fi
ffmpeg -y -hide_banner -loglevel error -framerate 30 -i frames/%04d.png -c:v libx264 -crf 16 -preset medium -pix_fmt yuv420p frames/picture.mp4
python3 ../tools/mix.py --picture frames/picture.mp4 --timeline cello-setup-v2.timeline.json --out cello-setup-v2.mp4
python3 ../tools/captions.py cello-setup-v2.timeline.json > cello-setup-v2.srt
# libass lays subtitles out on a 288-line canvas, so FontSize 12 is about 45 px of the 1080; they sit under the bold phrase
ffmpeg -y -hide_banner -loglevel error -i cello-setup-v2.mp4 \
  -vf "subtitles=cello-setup-v2.srt:force_style='FontName=Avenir Next Demi Bold,FontSize=12,Bold=0,PrimaryColour=&H00FFFFFF,OutlineColour=&H00161414,BorderStyle=1,Outline=1,Shadow=0,Spacing=0.4,MarginV=6'" \
  -c:v libx264 -crf 20 -preset medium -pix_fmt yuv420p -c:a copy -movflags +faststart cello-setup-v2-captions.mp4
ls -la cello-setup-v2.mp4 cello-setup-v2-captions.mp4
