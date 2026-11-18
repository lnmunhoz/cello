---
title: How a test run's outcome is kept on its task
summary: Decisions behind CEL-181. A finished agent test run is an event on its task (`tests.finished`), not a table; the task is picked when the run starts; a run has one key shared by its live row and its finished line; repeated runs collapse and folds keep results; the sweep ends a gone session's runs. No migration.
---

# How a test run's outcome is kept on its task (CEL-181)

Lucas, Nov 18: an agent comments "running the spec now", the task moves to In Review, and nothing says how the run went. The hooks already see every test run start and end (CEL-134). This ties each run to its task, shows it live, and keeps the result.

## An event, not a table

A run that ends writes **`tests.finished { taskId, run }`** on its task, in the same command that ends the run on its agent's row (`ActivityService.change` and `progress`, `AgentService.report` "stopped", `SessionService.sweep`). "Every change is an event": History and the thread read it like any other. No new table, **no migration**.

- It is named `tests.*`, never `task.*`: it is **not a change to the task**. The task's version, last change and claim stay (clients treat `task.*` as task changes with a `version`).
- Its entity is `tests` with the task's id (`EventStore.entityOf`), so `store.history(taskId)` has it and Recent activity (task, comment, review, ask, profile) leaves it out.
- It is written as the agent whose run it was. A runner reports as its session, so `Commands.emit` takes an `agentId` that credits the event to the subagent instead of the caller.
- **Written once.** Only runs that were open before the change and ended in it count (`endedNow`, matched by run id), so a late report, a second stop or a run dropped from the list writes nothing. The sweep that loses its race (`endIfUnchanged` false) ends and writes nothing.
- **Old data still parses.** `TestRun.taskId` and `AgentSession.runs` / `SessionAgent.runs` are optional keys. The stored `tests_json` is read as a whole (`parseRuns` drops runs that don't match), so a required key would have dropped every run in flight at upgrade. A run stored without a task is given one when it ends.
- An older server can't read a database that has these events (an unknown event type is unreadable to it), as with every new event type. Releases only go forward.

## Which task

Decided **when the run starts** (`testOutcomes.runTask`), and kept on the run:

1. a subagent launched on a task runs for it;
2. else the session's claims that aren't archived: the only one, or of several the one the session itself last touched (its own task events and its own comments; a subagent's or Lucas's don't count, and neither does a `tests.finished`);
3. else none: no live row and no event.

## One key, live then finished

`testRunKey(session, agent or "-", startedAt)` is the id of both the live row and the finished line. The live row comes from presence (`agent.seen` / `session.seen` carry every kept run, each with its task); the finished line from the event, or, for the moment between the board hearing the run end and the history fetching again, from the ended run in presence, built by the same function with the same words. History wins when it has the key. So the row turns into its outcome in place, with no flash and no duplicate. Both sit where the run **started**, so a run stays under the comment that announced it; the time shown on a finished line is when it ended.

## Collapse and fold

- Finished runs of one label collapse into the last when only test lines came between them. Live rows never collapse.
- A fold of 3 or more lines keeps its test lines (finished and live) and its newest line visible, and its button counts only what is hidden. A fold that would hide nothing doesn't fold. The stretch after the newest comment never folds.

## The sweep

A session whose process is gone left its runs open (only the 3-hour stale rule hid them). Now `SessionService.sweep` ends them, and those of its subagents that haven't stopped, as `ended`, with their events, in the command that ends the session.

The `session.seen` the sweep sends carries those runs as ended, so a board's live row and the Agents page stop showing "running" at once.

**Trade-off:** a run the sweep ended as `ended` is final. A detached runner that outlives its session and reports later is dropped (`testsProgressed` ignores an ended run). It is rare: the session's process dies, the runner survives. The alternative, reopening a run on a late report, would write a second `tests.finished` for it.

## Out of scope

Typecheck and build outcomes (tests only for now), and counts for a quick local `bun run test` (CEL-183).
