#!/bin/bash
# Runs inside the container. Two recorded Claude Code sessions, then the board recording is saved.
set -u
[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] || { echo "No Claude Code token: run record.sh on the Mac, not this directly."; exit 1; }
node /opt/recorder/record-board.mjs & REC=$!
cd ~/acme-shop
bold=$'\e[1m'; dim=$'\e[2m'; off=$'\e[0m'
clear; cat <<MSG

  ${bold}Part 1 of 2: set Cello up${off}
  Claude Code starts next. Type:

    ${bold}Set up Cello for this project: https://github.com/lnmunhoz/cello${off}

  Approve its steps as a new user would. When it offers to fill the board,
  say: ${bold}add the to-do list from the README as tasks${off}
  Then /exit.

  ${dim}Press Enter to start.${off}
MSG
read -r
echo "$(date -u +%FT%TZ) part1 start" >> /out/times.txt
asciinema rec -q --overwrite /out/part1-setup.cast -c "claude"
clear; cat <<MSG

  ${bold}Part 2 of 2: the orchestrator${off}
  A new Claude Code session starts next.

  1. Type ${bold}/model${off}, pick ${bold}Opus${off}, set the effort to ${bold}high${off} (or extra high), Enter.
  2. Type ${bold}/cello:orchestrate${off} and two task keys from the board, e.g.:
       ${bold}/cello:orchestrate ACME-1 ACME-2${off}
     (the keys are in part 1's output; \`cello task list\` shows them too)
  3. Approve as it goes, and let it run until both are submitted, or as long as you like.
     Try a comment from the board? Not here: that scene is recorded separately.
  Then /exit.

  ${dim}Press Enter to start.${off}
MSG
read -r
echo "$(date -u +%FT%TZ) part2 start" >> /out/times.txt
asciinema rec -q --overwrite /out/part2-orchestrator.cast -c "claude"
echo "$(date -u +%FT%TZ) done" >> /out/times.txt
kill -TERM $REC; wait $REC 2>/dev/null
echo; echo "  Done. The recordings are in the output folder on your Mac. Tell Claude in the CEL-94 session."
