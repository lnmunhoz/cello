# Comment receipts and card activity (CEL-76)

Decisions from CEL-76 (Nov 16), so Lucas can see whether a comment reached the agent, and whether an In Progress card is being worked on right now.

## Taking a comment is now a board event

- **The old rule:** read marks were the session's own bookkeeping, so `inbox.take` wrote no event (CEL-15).
- **The new rule:** taking a comment, or a Send back note, writes `comment.delivered { commentId, taskId, session, via }`. It's written in the same transaction as `read_at`: `take` runs as a command with no receipt (`receipt: false`), like a check-in. Taking answers, withdrawals and reactions still writes nothing.
- **Why:** "did my comment reach the agent?" is exactly the fact Lucas asked to see. One event per comment taken costs little: he writes a handful of comments a day.
- **`via`** (`inbox_items.read_via`, migration 0014) says who took it:
  - `hook`: the hooks pass `via: "hook"` to `inbox.take`
  - `inbox`: `cello inbox`, the default
  - `wait`: `inbox.wait`
- **Where a comment went is known from the start.** `InboxService.deliverWithin` now runs inside `CommentService.addWithin`, before the comment is read back. So `comment.added` already carries `delivery: { sessionId, readAt: null, via: null }`, or `null` when nobody held the claim. `comment.list` reads the delivery back from `inbox_items`.
- **The receipt names the session, not a subagent.** Subagents never take comments: the hooks skip them, and they don't run `cello inbox`. When a subagent is working on the task, the line under the comment box names it (CEL-55).
- **"Answered" is worked out on the client.** A comment is answered once its session, or a subagent of it, comments after it or reacts to it (CEL-77). Nothing is stored for it.

## Waiting is seen by the server, not read from a lock

- CEL-74's waiter lock lives in the agent's `$TMPDIR`, hashed by port and session, with a pid check. The server could read it, but `TMPDIR` belongs to each process's environment, so that would be brittle.
- The server doesn't need it: it already sees the waiter, because `cello inbox --wait` holds an `inbox.wait` call open.
- **How it's tracked:** `SessionService.waitingWhile` counts a session's open waits in memory. The count is released however the wait ends: something to hand over, an interrupt, a dropped connection.
- **What boards hear:** `session.waiting { session, waiting }`, when the first wait opens and the last closes, so at most twice per turn. It goes to the workspaces where the session holds claims; a session holding none waits quietly.
- **`AgentSession.waiting`** comes from `byIds`, so the snapshot and every `session.seen` carry it.
- **After a restart** the server starts with no waiters, and a waiter that reconnects (CEL-74's reconnect grace) says so again.

## Check-ins every minute instead of every 2

- **The change:** `PRESENCE_EVERY_MS` goes from 2 minutes to 60 seconds. It covers `session.seen`, and `agent.seen` for subagents.
- **Why:** each check-in plays the card's burst and turns the status icon's half fill once. At 2 minutes a busy card sat still about 97% of the time, which is why CEL-55 looked idle while it was being worked on.
- **The cost:** one row per working session (and per working subagent) per workspace per minute, instead of every 2. Three sessions working for 8 hours write about 1,440 rows a day instead of 720. That's small next to the rest of the log, and "active now" (5 minutes) is unaffected.

## The card while an agent works

- **The static edge:** a thin edge in the agent's colour shows while the task's agent is at work, meaning active and working or thinking. It doesn't show when the agent is quiet, has ended, or is waiting on Lucas (Needs input, In Review).
- **Per check-in or mood change seen on screen** (the same trigger as CEL-69's burst):
  - the edge flashes softly once
  - the status icon's half fill turns once (`StatusIcon`'s `turn`)
- A page load plays nothing. Both motions end where they started with no fill, so an idle board runs nothing.
- With reduced motion, only the edge is left.
