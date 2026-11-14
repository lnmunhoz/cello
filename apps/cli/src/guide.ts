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
5. When you're done, move it to In Review, not Done: \`cello task move CEL-3 "In Review"\`.
   Lucas moves it to Done.

Other commands: \`cello task list\` (--status, --label, --mine), \`cello task get CEL-3\`,
\`cello task create "Title"\` (--description or --body-file -, --status, --priority, --label, --parent),
\`cello task release CEL-3\`, \`cello whoami\`. Add --json for scripts.

Changes are recorded as your agent session. To act as Lucas, run \`CELLO_SESSION=me cello ...\`.`
