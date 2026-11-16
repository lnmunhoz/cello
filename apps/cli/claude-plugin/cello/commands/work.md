---
description: Do one Cello task in this thread yourself, from claim to review packet.
argument-hint: "<task key, or what to do>"
---

Do this task yourself, in this thread: $ARGUMENTS

1. **Read up.** Run `cello context`. If you haven't read `cello guide` in this session, read it once. Don't guess flags. Its testing profile says how to test this repo and record evidence; use those commands, and fix a field with `cello profile set` when it's wrong (say so in your packet).
2. **Find the task, or make it.** A key: `cello task get <KEY>`. A request: check it isn't on the board (`cello task list`), else `cello task create` with the person's words in the description.
3. **Claim it** (`cello task claim <KEY>`), then mark where you are so the card says it, picking by the task:
   - **It needs a decision before code** (a spec, a scope with options for the person, a question only they can answer): `cello task stage <KEY> planning`, and it stays there until that's settled.
   - **It's clear** (you know what to build): straight to `cello task stage <KEY> building`.
   - Building runs into a design question the task doesn't answer? Back to `planning` while you ask, then `building` again.
   - If you merge it yourself, `cello task stage <KEY> merged` before you hand it in.
4. **Test first.** Each behaviour starts as a failing test, then the code that passes it. Put the key in every commit message.
5. **Comment progress** and decisions on the card with `cello task comment`.
6. **Hand it in** with `cello task submit <KEY>`: a summary, how to check it, and evidence (videos and screenshots for UI; a terminal transcript or test output for CLI and server work; a small ```mermaid flowchart TD when it's a flow).

While you work:

- **The person's decisions go on the card,** never in the terminal: `cello task ask <KEY> --file ask.yaml --wait`, run in the background.
- **Their comments come to you** by themselves with the hooks (else `cello inbox`). Act on them, then answer on the card.
- **Ending a turn while you hold the claim?** Start `cello inbox --wait` in the background first, so their comments wake you while you're idle.
- **Stopping before you submit?** Put where it stands on the card, move it back to Todo and `cello task release` it.
- More than one task, or work big enough for builder and reviewer agents? Use `/cello:orchestrate` instead.
