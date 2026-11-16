#!/usr/bin/env bash
# Storyboard stills for the v2 video: each time (seconds) → storyboard/<t>.webp, 1280x720.
#   art/setup-video/v2/storyboard.sh [t,t,...]   (no argument: the review set below, 2-4 per scene)
# Each still is written to frames/ first and only replaces storyboard/<t>.webp once it's a non-empty
# image, so a failed or interrupted run leaves the existing stills as they were.
set -euo pipefail
cd "$(dirname "$0")"
T=${1:-2.6,10.2,14,18.5,25.3,27.6,32.7,37.8,42.5,48.4,56.5,64.4,73,76.7,79.9,87,91,97.9,103.1,113.1,119.2,126.4,131.3,137.6,143.6,148.7}
bun make.mjs "$T" >/dev/null
mkdir -p storyboard
IFS=, read -ra TIMES <<< "$T"
for t in "${TIMES[@]}"; do
  resvg "frames/still-$t.svg" "frames/still-$t.png"
  cwebp -quiet -q 85 -resize 1280 720 "frames/still-$t.png" -o "frames/still-$t.webp"
  [ -s "frames/still-$t.webp" ] || { echo "empty still at $t s, storyboard left as it was" >&2; exit 1; }
  mv "frames/still-$t.webp" "storyboard/$t.webp"
done
ls storyboard
