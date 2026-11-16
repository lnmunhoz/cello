#!/bin/bash
# Scene ③ for the CEL-94 video: the steps docs/agent-setup.md has an agent run, run for real in a clean
# container and recorded with asciinema. Each command is typed out so it can be read, then really run.
set -eu
c=$'\e[38;5;208m'; b=$'\e[1m'; d=$'\e[2m'; o=$'\e[0m'
say() { printf '\n%s# %s%s\n' "$d" "$1" "$o"; sleep 0.8; }
run() { printf '%s$%s ' "$c" "$o"; local s="$1" i; for ((i = 0; i < ${#s}; i++)); do printf '%s' "${s:i:1}"; sleep 0.025; done; printf '\n'; sleep 0.3; eval "$1"; sleep 0.6; }
clear
printf '%sSet up Cello for this project: https://github.com/lnmunhoz/cello%s\n' "$b" "$o"
printf '%sThe agent follows docs/agent-setup.md:%s\n' "$d" "$o"; sleep 1.2
say "Prerequisites"
run "git --version"
run "bun --version"
say "Get and build Cello, in its own folder"
CELLO_SRC="$HOME/.local/share/cello/src"
run "git clone -q https://github.com/lnmunhoz/cello.git ~/.local/share/cello/src"
run "cd ~/.local/share/cello/src && bun install --filter '!@cello/desktop' 2>&1 | tail -3"
run "bun run --filter @cello/cli build 2>&1 | tail -3"
run "mkdir -p ~/.local/bin && ln -sf ~/.local/share/cello/src/apps/cli/dist/cello ~/.local/bin/cello"
run "cello --version"
say "Start Cello in the background"
run "mkdir -p ~/.local/state/cello && (nohup cello start >> ~/.local/state/cello/server.log 2>&1 &)"
until cello whoami >/dev/null 2>&1; do sleep 1; done
run "cello whoami | grep -A3 '\"server\"'"
say "Connect the project"
run "cd ~/acme-shop && cello init --hooks --agents-md --name 'Acme Shop' --key ACME --skip-detect"
say "Fill the board from the README's to-do list"
run "cello task create 'Cart totals are off by a cent for some prices'"
run "cello task create 'Search products by SKU, not just by name'"
run "cello task create 'Send an order confirmation email after checkout'"
run "cello task create 'The product list is slow with many products'"
run "cello task create 'Add Apple Pay to checkout' --status Backlog"
run "cello task list"
sleep 3
