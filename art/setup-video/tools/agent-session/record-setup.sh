#!/bin/bash
# CEL-94 scene ③: runs the setup guide's commands for real in a clean container, unattended, and records
# the terminal (asciinema, rendered with xterm.js) and the board (headless Chromium). No Claude Code involved.
#   bash art/setup-video/tools/agent-session/record-setup.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../../raw/setup-$(date +%Y%m%d-%H%M%S)"; mkdir -p "$OUT"; chmod 777 "$OUT"
docker build -q -t cello-demo-session "$HERE" >/dev/null
docker run --rm -t -e TERM=xterm-256color -v "$OUT:/out" --entrypoint bash cello-demo-session -c '
  node /opt/recorder/record-board.mjs & REC=$!
  asciinema rec -q -i 1.2 --cols 100 --rows 28 /out/s3-setup.cast -c "bash /home/dev/setup-demo.sh"
  kill -TERM $REC; wait $REC
  node /opt/recorder/render-cast.mjs /out/s3-setup.cast /out/s3-terminal.webm 26'
echo "$OUT"; ls -la "$OUT"
