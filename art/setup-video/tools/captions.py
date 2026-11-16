#!/usr/bin/env python3
"""Writes captions (SRT) for a cut from its timeline: each narration line split into short phrases, timed by length.
Usage: python3 tools/captions.py review/cello-setup.timeline.json > review/cello-setup.srt"""
import json, re, sys
TEXT = {
  "s1-problem": "Working with several coding agents at once is powerful… until you lose track. Which agent is on what? Is it still working, is it stuck, or did it finish an hour ago? And when it says it's done, how do you know it really works?",
  "s2-what": "Cello is a task board built for exactly that. It runs on your own machine, and your agents use it like teammates: they take cards, show you their work as it happens, and hand it back with proof.",
  "s3-setup": "To get started, point your coding agent at Cello, and ask it to set it up for your project. It installs Cello, starts it on your machine, and connects your project to a new board. From then on, every agent session in that project works through it.",
  "s3b-orchestrator": "Setup also gives your agent two new commands. For real work, start a session with a strong model, like Claude Opus on high or extra-high effort, and run the orchestrate command with the tasks you want done. That session becomes the orchestrator. It plans, and hands each task to a builder agent working in its own copy of the code. A fresh reviewer agent checks every change before it's merged. The orchestrator doesn't write the code itself… it coordinates.",
  "s4-watch": "When you ask for something, it becomes a card. An agent claims it, and you watch it move: who's working on it, whether it's active right now, and what stage the work is in, from building, to review, to fixing. Every change records which agent made it, and in which conversation.",
  "s5-decisions": "When an agent needs a decision from you, it doesn't wait in a terminal you might not be watching. It asks on the card, with the options, its recommendation, and why. And you can write to it anytime, right in Cello: a comment on the card, or on a review, reaches the orchestrator's session by itself… and it passes your words on to the agents doing the work.",
  "s6-proof": "And when the work is done, the agent can't just move the card to review. It hands you a review packet: what changed, how to check it, and the evidence, like a video of the real app. You approve it, or send it back with a note… and the note reaches the agent's session.",
  "s7-local": "Everything stays local: one small server, and one database file on your machine. No accounts, no cloud, and every change shows up on your board instantly.",
  "s8-outro": "Cello. Your agents, in harmony.",
}
def phrases(text, limit=64):
    out = []
    for sentence in re.split(r"(?<=[.?!…])\s+", text):
        parts, cur = re.split(r"(?<=[,:])\s+", sentence), ""
        for p in parts:
            if cur and len(cur) + 1 + len(p) > limit: out.append(cur); cur = p
            else: cur = f"{cur} {p}".strip()
        if cur: out.append(cur)
    return out
ts = lambda s: f"{int(s // 3600):02d}:{int(s % 3600 // 60):02d}:{int(s % 60):02d},{int(round(s % 1 * 1000)) % 1000:03d}"
n = 0
for row in json.load(open(sys.argv[1])):
    ps = phrases(TEXT[row["scene"]]); total = sum(len(p) for p in ps); t = row["at"]
    for p in ps:
        d = row["seconds"] * len(p) / total; n += 1
        print(f"{n}\n{ts(t)} --> {ts(t + d - 0.05)}\n{p}\n"); t += d
