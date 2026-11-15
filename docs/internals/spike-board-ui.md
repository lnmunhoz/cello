# Spikes (b) and (c): UI SDK drag and the agent cursor

Run on 2026-11-14. Code: `spikes/board-ui/` (`src/kanban.tsx` adapted from UI SDK's kanban example, `src/store.ts`, `src/agents.ts` for the event source and animation layer). Measurements: production build, headless Chromium, 1440×1000, 50 cards. Versions: `@ui-sdk/core` and `@ui-sdk/react` 0.1.0-beta.2, `motion` 14.14.0, React 19.3.1, Vite 8.3.8, Tailwind 4.3.5.

## (b) Drag and drop: pass, keep UI SDK

- **60 fps while dragging:** 59.5–60 fps over a 2 s drag across three columns; p95 frame 16.8 ms. The one slow frame (33 ms) is always the pickup, when UI SDK copies the card and the board re-renders. With 4× CPU throttle: 57.7–59.1 fps. Dragging while 3 agents animate: 59–60.5 fps.
- **Keyboard:** Space picks up, arrows carry, Space drops, Escape cancels. The store changes only on drop; focus follows the card.
- No reorder flip-flop. Agent events during a user drag keep all cards, with no duplicates. If an agent moves the card you're holding, your drop wins.

UI SDK notes (none blocking):
- `createTransfer` worked as documented, including rejecting a move mid-drag and re-basing when the store changes underneath.
- No layout animation of its own; Motion goes in through each part's `render` prop.
- The drag copy is a snapshot, so a card must be visible when a drag starts. The hidden-spacer state is removed on pointerdown.
- No "pickup started" hook; watch the root's `moving` draft instead.
- Pickup re-renders the whole board: fine at 50 cards, untested at 500.

## (c) Agent cursor: all seven behaviors work

1. **Record, then apply.** The store applies the move first. While a move waits in its queue, the card shows as a static copy in its old slot and is hidden at its new one. Copies parked at a recorded rectangle drifted as columns reflowed, so this changes the spec's design. When the move plays: cursor glides → ghost replaces the copy and lifts → old slot closes → ghost flies to the spacer → lands.
2. Per-agent queues animate in parallel.
3. Newest wins across agents: queued moves collapse; mid-flight, the newer agent takes the ghost from where it is.
4. Grabbing a card (mouse or keyboard) cancels its ghost at once.
5. Bursts speed up live and skip to the end with a "Claude made 20 changes" toast.
6. Idle board: `document.getAnimations().length === 0` and no rAF calls.
7. Reduced motion: fade out, fade in, no flight.

Known rough edges: column counts update before the animation finishes; a hidden waiting card wasn't tested against a user drag in the same column.

## Pacing numbers (now the spec's defaults)

| Setting | Value |
| --- | --- |
| One move at full speed | ~1.1 s: cursor glide 120 ms + 0.35 ms/px (max 300 ms), lift 110 ms, travel 480 ms, land 150 ms, 60 ms gap |
| Speed-up | above 2 waiting: scale = 2 / waiting, floor 0.35 (~0.4 s a move); applies to the move in flight too |
| Skip | above 8 waiting, jump to the end (animation stays ≤ ~3 s behind the store) |
| Cursor | stays 600 ms after the last move, fades over 220 ms |
| Lane reset | 700 ms of quiet |
| Toast | 2.6 s |

Not covered: touch, a real display's refresh rate, scrolling columns.

Videos: `spikes/board-ui/videos/` (7 MP4s).

## In the app (CEL-6, M3)

Code: `apps/web/src/board/cursors/` (`queue.ts` the timing, `animator.ts` the drawing, `steps.ts` which events animate). Where it differs from the spike:

- **Only agent sessions get a cursor.** An event with no `sessionId` is Lucas's, from any tab, and just applies.
- **Lucas wins, more strictly.** Picking up a card (pointer or keyboard) stops every step that holds a card, in every session, and steps that start during the drag only highlight. What those steps held stays put until he lets go: a hole keeps its space (empty if its copy was flying), a waiting card stays hidden at its new slot. So no hole opens or closes under his hand.
- **Waiting cards are CSS rules,** written into one style element, not React state: the board re-renders only when a hole opens (in the same render as the event) or closes. 200 cards with three cursors stay at about 60 fps (`e2e/perf.spec.ts`).
- **Colour** comes from the session id, but a session never takes a colour another cursor on screen has.
- **Label** "Claude Code · 2fd0505c" (the host session id's first 8 characters) comes from `task.get`, which lists the sessions a task's history names; no new RPC.
- **"made N changes"** is the cursor layer's own notice: an app toast shown while the desktop app entered full screen left its board view at the old size under Xvfb.
