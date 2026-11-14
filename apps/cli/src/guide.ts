// The agent conventions, printed by `cello guide`. The Claude Code skill (later in M2) points here,
// so the guide lives in one place.
export const GUIDE = `Working with Cello

Cello is the task board you share with Lucas. Track your work through the \`cello\` CLI.

1. Run \`cello context\` first: the project, its statuses, what you've claimed, recent activity.
2. Claim a task before working on it: \`cello task claim CEL-3\`. If another live session holds it,
   pick another task.
3. Comment on progress: \`cello task comment CEL-3 "what changed"\`, or \`--body-file -\` with a heredoc
   for markdown.
4. Put the task key in commit messages: \`feat(cli): task claim (CEL-3)\`.
5. When you're done, hand it to Lucas with a review packet. It moves the task to In Review; Lucas
   approves it (Done) or sends it back with a note. \`cello task move CEL-3 "In Review"\` is refused.

     cello task submit CEL-3 \\
       --summary "What changed and why, in markdown" \\
       --step "Open the board" --step "Drag a card to Done; it stays there after a reload" \\
       --attach e2e/videos/drag.mp4 --caption "Dragging a card" \\
       --attach shots/board-dark.png \\
       --link https://github.com/you/repo/pull/12

   Lucas reviews visually, so bring evidence he can look at:
   - UI work: MP4 video(s) of the flow (Playwright videos from the e2e run) and screenshots.
   - CLI or server work: a terminal recording or a test-output file (\`... > vitest.log\`), plus steps
     he can run.
   Files are images, videos (MP4, WebM, MOV) or text (txt, log, md, json, cast), up to 50 MB each.
   \`--caption\` describes the \`--attach\` or \`--link\` before it. Use \`--summary-file -\` for a long
   summary from stdin. Submitting again replaces the open packet.

Other commands: \`cello task list\` (--status, --label, --mine), \`cello task get CEL-3\` (shows the
packets and Lucas's notes), \`cello task create "Title"\` (--description or --body-file -, --status,
--priority, --label (repeatable), --parent), \`cello task release CEL-3\`, \`cello whoami\`. Add --json
for scripts.

Changes are recorded as your agent session. To act as Lucas, run \`CELLO_SESSION=me cello ...\`.`
