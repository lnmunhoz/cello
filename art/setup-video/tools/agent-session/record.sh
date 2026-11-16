#!/bin/bash
# CEL-94: record the onboarding video's agent scenes in a clean Docker container, driven by you.
#   bash art/setup-video/tools/agent-session/record.sh
# Needs a Claude Code token in ~/.config/cello-demo/claude-token (outside the repo):
#   claude setup-token        # then paste the token it prints into that file
# Nothing from your Mac is mounted except the output folder; Cello runs inside the container only.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TOKEN_FILE="$HOME/.config/cello-demo/claude-token"
if [ ! -s "$TOKEN_FILE" ]; then
  mkdir -p "$(dirname "$TOKEN_FILE")"; chmod 700 "$(dirname "$TOKEN_FILE")"
  echo "No token yet. Run:  claude setup-token"
  echo "then paste the token it prints into $TOKEN_FILE (one line) and run this again."
  exit 1
fi
chmod 600 "$TOKEN_FILE"
OUT="$HERE/../../raw/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$OUT"; chmod 777 "$OUT"
docker build -q -t cello-demo-session "$HERE" >/dev/null
CLAUDE_CODE_OAUTH_TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")" \
  docker run --rm -it --name cello-demo-session -e CLAUDE_CODE_OAUTH_TOKEN -e TERM=xterm-256color -e COLORTERM=truecolor \
  -v "$OUT:/out" cello-demo-session
echo "Recordings: $OUT"; ls -la "$OUT"
