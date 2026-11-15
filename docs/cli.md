# The cello CLI, for agents

Everything an agent needs to work with Cello through the `cello` command: the ideas behind it, the workflow, copy-paste examples, what each error means, and every command with its flags. `cello guide` prints this same page, so it reads the same in any repository.

This page is kept current: any change to a command, a flag, an output or a rule updates it in the same commit. The command reference at the end is generated from the CLI's own `--help`.

## Concepts

**Cello** is the task board Lucas shares with his agents. Its server runs on his Mac (`cello start`, http://127.0.0.1:4747, data in `~/.cello`). The board in the browser, the desktop app and the CLI all talk to that server, and every change shows up live everywhere.

- **Workspace:** a group of projects that share statuses, labels and views.
- **Project:** one product, usually one git repository, with its own key (`CEL`). The CLI works out the project from the repository you're in; `--project KEY` picks another.
- **Task:** a card, keyed `<PROJECT>-<number>` (`CEL-12`). It has a title, a markdown description, a status, a priority, labels, an optional parent task, comments and a history.
- **Status:** a column on the board, shared by the workspace. Names match in any case. `cello context` lists a workspace's own; the defaults are:

  | Status | What it means | How a task gets there |
  | --- | --- | --- |
  | Backlog (hidden) | An idea or request that still needs discussing. Nobody builds from here. | `cello task create … --status Backlog` |
  | Todo | Agreed and ready to build. | The default for new tasks |
  | In Progress | Someone is working on it. | `cello task claim` |
  | In Review | Waiting for Lucas, with a review packet. | Only `cello task submit` |
  | Done | Lucas approved it. | Lucas, on the Review page |
  | Canceled (hidden) | It won't be done. | Lucas |

  Hidden statuses are folded on the board and left out of `cello task list` unless you ask for them.
- **Agent session:** one agent conversation. Cello credits every change to the session that made it ("Claude Code session 2fd0505c"), from `CLAUDE_CODE_SESSION_ID`, which Claude Code sets.
- **Claim:** "this session is working on this task". `cello task claim` assigns the task to your session and moves it to In Progress.
  - While your session is alive, other agents can't claim it.
  - If your session has exited, another session can claim the task and takes the claim over.
  - Lucas always wins: when he changes a task you've claimed (moves it, approves it), your claim ends, and `cello context` lists it under "Claims you lost".
- **Review packet:** how finished work reaches Lucas. It holds a summary, how-to-check steps and evidence (videos, screenshots, test output, links). `cello task submit` creates it and moves the task to In Review. Then Lucas decides:
  - **Approve:** the task moves to Done and your claim ends.
  - **Send back:** the task returns to In Progress with his note, and your claim stays. The note comes to your session (see Comments from Lucas reach your session), and `cello task get` shows it under Reviews.
- **Documents:** markdown published into the project's Docs tab with `cello doc publish`. There are three kinds:
  - a **page** reports on finished work (a snapshot to read now)
  - a **doc** explains how something works (kept up to date)
  - a **spec** plans work before it starts

  Publishing again updates a document in place, and its old versions are kept.
- **History:** every change is recorded with who made it. `cello task get` shows a task's history; `cello context` shows recent activity.

## Start of every session

```bash
cello context
```

It shows the project, its statuses (hidden ones in brackets), its labels, new comments from Lucas on tasks you've claimed (shown, not taken; see Comments from Lucas reach your session), the tasks your session has claimed, claims you lost and why, and recent activity:

```
Project   CEL · Cello · /Users/lnmunhoz/projects/cello
You       Claude Code session 2fd0505c (cli)
Statuses  Todo · In Progress · In Review · Done (hidden: Backlog, Canceled)
Labels    M2 · M3 · server · ui

New comments for you (1)
  CEL-22  Review page: collapsed rows, one packet open at a time
    Lucas N. Munhoz commented, 5m ago
      Use the same row height as the list layout.
  Answer on the card: `cello task comment CEL-22 "…"`. They stay new until the hook or `cello inbox` hands them over.

Claimed by you
  CEL-22  In Progress  Review page: collapsed rows, one packet open at a time

Recent activity
  2m ago   CEL-22  Lucas N. Munhoz commented
```

Run it first in every session, and again when you come back to a task.

## The workflow

1. **Find the work.** `cello task list` shows Todo and In Progress. `cello task get CEL-12` reads one task in full, including Lucas's notes on earlier packets and every comment.
2. **Claim it.** `cello task claim CEL-12`. If it says another session holds the task, pick another one. Don't work on a task someone else holds.
3. **Work, test first, and put the key in every commit:** `feat(web): collapsed review rows (CEL-22)`.
4. **Comment** progress, decisions and questions on the card (`cello task comment`). Lucas reads them there.
5. **Hand it over** with `cello task submit` and evidence he can look at (see Review packets). The task moves to In Review.
6. **If it's sent back,** his note comes to your session (by the hook, or `cello inbox`), and `cello task get CEL-12` shows it under Reviews. Fix it, then submit again.
7. **If you stop without finishing,** `cello task release CEL-12`. The task keeps its status, and someone else can claim it.

Never move a task to Done or Canceled yourself: Lucas decides.

## Creating tasks

```bash
# Ready to build: lands in Todo
cello task create "Sidebar: collapse and resize" --label ui --priority high \
  --description "Drag the sidebar's edge to resize it; ⌘B collapses it to an icon rail."

# Still needs discussing: Backlog
cello task create "Idea: media library per project" --status Backlog --body-file - <<'EOF'
Lucas makes promo videos, icons and designs for each project. A place in Cello to keep them,
link them to tasks, and sync them later.
EOF

# A subtask, with two labels
cello task create "Restore refuses while a server runs" --parent CEL-23 --label server,M2
```

- **Todo or Backlog:** Todo means agreed and ready to build. When Lucas says "add to the backlog", use `--status Backlog`.
- **Labels must already exist.** `cello context` lists them, and an unknown label fails with the real names.
- **Priority:** `urgent`, `high`, `medium`, `low` or `none`.
- **Long descriptions:** use `--body-file -` with a heredoc, or `--body-file notes.md`.

## Reading tasks

```bash
cello task list                          # Todo and In Progress
cello task list --status Backlog         # any status by name, hidden ones too
cello task list --status Done --label ui
cello task list --mine                   # what your session has claimed
cello task get CEL-12                    # everything about one task
cello task get CEL-12 --json | jq -r '.task.description'
```

Every command takes `--json` and prints the whole response, for scripts.

## Moving tasks

```bash
cello task move CEL-12 Todo
cello task move CEL-31 backlog           # any case
```

- **Moving into In Review is refused:** use `cello task submit`.
- **Don't move tasks to Done or Canceled.**
- **"It was changed by … in the meantime":** someone changed the task while you were acting. Run the command again.

## Comments

```bash
cello task comment CEL-12 "Found the cause: the column's min-height was missing."

cello task comment CEL-12 --body-file - <<'EOF'
## Progress
- Collapsed rows work, with j/k and Enter
- Next: open the next row after Approve
EOF
```

Comments are markdown, rendered on the card, and links in them can be clicked. Answer Lucas's comments and Send back notes on the card, so the conversation stays with the task. His comments come to your session by themselves (next section).

## Comments from Lucas reach your session

Lucas's comments on a task you've claimed, and his Send back notes, are addressed to your session: the one holding the claim. Your own comments and other agents' never come back to you, and nothing does once your claim has ended. One exception: a Send back note still reaches the session that handed in the packet.

**With the hooks (the usual way),** they arrive by themselves:

```bash
cello install claude            # this project, this machine: .claude/settings.local.json (git-ignored)
cello install claude --user     # every project on this machine: ~/.claude/settings.json
cello install claude --shared   # .claude/settings.json, committed: everyone who clones the repo gets them
cello uninstall claude          # takes them out of all three
```

- **Once per project** (or once with `--user`). From inside a worktree it writes the main checkout's settings.
- **It merges** with the hooks already there, and running it again changes nothing. The old file is kept as `<file>.bak`.
- **What runs:** Claude Code runs `cello hook claude stop` when you finish a turn, and `cello hook claude post-tool-use` after each tool call. New comments come in as context. If you were about to stop, they keep you going: the transcript shows them as "Stop hook feedback".
- **`cello` must be on the PATH** Claude Code starts with (`~/.local/bin`). When the server is down, the hook stays silent and your session carries on.

**Without the hooks:**

```bash
cello context            # lists new comments and leaves them new
cello inbox              # hands them over and marks them read, then lists what came earlier
cello inbox --new        # only new ones; prints nothing when there are none
cello inbox --json
```

**Each comment arrives once.** Whichever gets it first (the Stop hook, the PostToolUse hook or `cello inbox`) marks it read, so it never comes a second time, even when parallel tool calls run the hook at the same moment. `cello context` only shows them. What arrives looks like this:

```
New Cello comment on a task you claimed:

CEL-22  Review page: collapsed rows, one packet open at a time
  Lucas N. Munhoz sent it back, 2m ago
    The next row doesn't open by itself after Approve.

Act on it now, then answer on the card: `cello task comment CEL-22 "…"` (or `--body-file -` for markdown), so Lucas N. Munhoz sees your reply there.
For a task Lucas N. Munhoz sent back, fix what the note asks, then hand it in again with `cello task submit CEL-22`.
```

**Answer on the card.** Act on the comment, then reply with `cello task comment CEL-22 "…"` (`--body-file -` for markdown), so the conversation stays with the task and Lucas sees it there.

**When a task is sent back,** it's in In Progress again and still yours. The note arrives the same way, marked "sent it back" (`cello task get` also shows it under Reviews). Fix what it asks, test, then hand the task in again with `cello task submit CEL-22` and new evidence.

**Subagents share your session.** A subagent's `CLAUDE_CODE_SESSION_ID` is its parent's, so Cello can't tell them apart. The hook skips tool calls made inside a subagent, so comments reach the main conversation. Don't run `cello inbox` from a subagent: it would take the parent's comments. `cello context` is safe anywhere, since it takes nothing.

## Review packets

```bash
cello task submit CEL-22 \
  --summary "The Review page shows one packet at a time: collapsed rows, j/k to move, Enter to open." \
  --step "Open the Review page" \
  --step "Press j twice, then Enter: the third packet opens and the first closes" \
  --step "Approve it: the next packet opens by itself" \
  --attach e2e/videos/review-rows.mp4 --caption "Going through the queue with the keyboard" \
  --attach shots/review-dark.png --caption "Dark mode" \
  --link http://127.0.0.1:4747/CEL/pages/review-rows --caption "The report"
```

- **`--summary`** says what changed and why, in markdown. Use `--summary-file -` for a long one from stdin.
- **`--step`** says how Lucas checks it, one step per flag, in order.
- **`--attach`** takes images, videos (MP4, WebM, MOV) and text files (txt, log, md, json, cast), up to 50 MB each.
  - Paths are relative to your working folder.
  - The server copies each file into `~/.cello/assets`, so you can delete the original afterwards (in a worktree, say).
- **`--link`** adds a URL: a PR, or a page you published.
- **`--caption`** describes the `--attach` or `--link` right before it.
- **Submitting again** while a packet is still open replaces it.

What to bring, by kind of work:

- **UI:** MP4 videos of the flow (the Playwright e2e videos) plus screenshots, in light and dark when it matters. How they're made: `docs/evidence-videos.md` in the Cello repository, also in Cello's Docs tab.
- **CLI or server:** a terminal transcript or a test-output file (`… > vitest.log`), plus steps Lucas can run himself.
- **A report you published:** `--link <page url> --caption "The report"`.

## Pages, docs and specs

```bash
cello doc publish report.md --task CEL-13
# Published page "Billing audit" (version 1), linked to CEL-13, with 1 file
# http://127.0.0.1:4747/CEL/pages/billing-audit

cello doc publish docs/how-sync-works.md --kind doc      # explains the system, kept up to date
cello doc publish plan.md --kind spec --task CEL-15      # a plan before the work
cello doc publish - --slug m2-progress < report.md       # from stdin: pass --slug to update it later

cello doc list                       # the project's documents, newest first
cello doc list --kind spec
cello doc get billing-audit          # the markdown back, to continue from it
cello doc get billing-audit --version 1
cello doc archive billing-audit      # hidden from the Docs tab; the link keeps working
```

- **Which kind?** A page is about a moment, a doc is about the system, and a spec is a plan.
- **The title** is the frontmatter `title:`, the first `#` heading, or `--title`.
- **The summary** is the frontmatter `summary:`, the first paragraph, or `--summary`.
- **What renders:** `##` and `###` headings become the page's section list. Tables, code blocks, ```` ```mermaid ```` diagrams and images all render.
- **Images:** images the markdown links by a relative path go up with the page. `--asset` uploads other files.
- **Publishing the same file again** updates the page and keeps the old version, and the link never changes.
- **Publish reports, plans and summaries here,** not as Claude artifacts: Lucas reads them next to the tasks.

## Showing things to Lucas

Open pages, videos and links **inside Cello**, in the desktop app's browser panel. Claude artifact pages work there too.

```bash
open "cello://open?url=$(jq -rn --arg u 'https://claude.ai/artifact/abc' '$u|@uri')"
open "cello://CEL-12"                    # focuses the app on a task
```

Use his browser only when the desktop app isn't running.

## Identity and environment

| Variable | What it does |
| --- | --- |
| `CLAUDE_CODE_SESSION_ID` | Set by Claude Code. Your agent session: your changes are credited to it, your claims belong to it, and Lucas's comments on them come to it. Subagents get their parent's. |
| `CLAUDE_PID` | Set by Claude Code. Lets Cello tell whether your session is still alive, so a dead session's claim can be taken over. |
| `CELLO_SESSION` | Overrides the session. An agent that isn't Claude Code sets a stable id for its conversation here. `CELLO_SESSION=me` acts as Lucas: only when he asks you to. |
| `CELLO_PORT` | The server's port, 4747 by default. Dev servers and tests use other ports. |
| `CELLO_DATA_DIR` | `cello start`'s data folder, `~/.cello` by default. |

With no session at all, changes are recorded as Lucas. When something gets credited to the wrong person, `cello whoami` prints what Cello sees.

Agents never open, copy or change anything in `~/.cello` directly. Everything goes through `cello`.

## When something fails

Every error is one sentence that says what to do next. The usual ones:

| The message says | What it means | What to do |
| --- | --- | --- |
| Cello isn't running on 127.0.0.1:4747 | Lucas's server is down. | Tell him. Don't start one against `~/.cello` yourself unless he asks. |
| CEL-12 is claimed by Claude Code session 1a2b3c4d (active now) | Another live session is working on it. | Pick another task. |
| No task CEL-99 · No status named … · No label named … | A typo, or something that doesn't exist. | The message lists the real names. |
| It was changed by … in the meantime | Someone changed the task while you were acting. | Run the command again. |
| CEL-12 needs a review packet before it goes to In Review | You used `move` to hand work over. | Use `cello task submit`. |
| Only Lucas can approve a review | Approving and sending back are his. | Leave the task in In Review. |
| This folder isn't in a git repository | The CLI can't work out the project. | Pass `--project KEY`. |
| No project is linked to /path | This repository isn't a Cello project yet. | Pass `--project KEY`, or ask Lucas. |

## Command reference

<!-- cli-reference:start -->
Generated from the CLI's own `--help` by `bun run docs:cli`. Don't edit it by hand: change the command's descriptions in `apps/cli/src/cli.ts` and run that.

### cello context

Start here: the project, its statuses and labels, new comments for you, your claims and recent activity.

```
cello context [flags]
```

| | |
| --- | --- |
| `--project string` | Project key, instead of the working folder's. |
| `--json` | Print JSON for scripts. |

### cello task list

Tasks in the current project: Todo and In Progress unless --status picks another.

```
cello task list [flags]
```

| | |
| --- | --- |
| `--project string` | Project key, instead of the working folder's. |
| `--json` | Print JSON for scripts. |
| `--status string` | Only this status, by name (e.g. Backlog, Done). Without it: Todo and In Progress. |
| `--label string` | Only tasks with this label. |
| `--mine` | Only tasks you've claimed. |

### cello task get

One task in full: description, labels, claim, pages, review packets with Lucas's notes, comments, history.

```
cello task get [flags] <key>
```

| | |
| --- | --- |
| `key string` | A task key, e.g. CEL-3. |
| `--json` | Print JSON for scripts. |

### cello task create

Create a task in the current project (Todo unless --status says otherwise).

```
cello task create [flags] <title>
```

| | |
| --- | --- |
| `title string` | The task's title, in quotes. |
| `--project string` | Project key, instead of the working folder's. |
| `--json` | Print JSON for scripts. |
| `--description string` | The description, in markdown. |
| `--body-file string` | Read the description from a file; - is stdin. |
| `--status string` | Status by name. Default: the first visible one (Todo). Backlog for ideas that still need discussing. |
| `--priority string` | urgent, high, medium, low or none. |
| `--label string` | A label name; repeat it, or separate names with commas. |
| `--parent string` | Parent task key. |

### cello task claim

Start working on a task: it's assigned to your session and moves to In Progress. Refused while another live session holds it.

```
cello task claim [flags] <key>
```

| | |
| --- | --- |
| `key string` | A task key, e.g. CEL-3. |
| `--json` | Print JSON for scripts. |

### cello task release

Give up your claim without finishing the task; its status stays.

```
cello task release [flags] <key>
```

| | |
| --- | --- |
| `key string` | A task key, e.g. CEL-3. |
| `--json` | Print JSON for scripts. |

### cello task move

Move a task to a status by name. Into In Review is refused: hand work over with `cello task submit`.

```
cello task move [flags] <key> <status>
```

| | |
| --- | --- |
| `key string` | A task key, e.g. CEL-3. |
| `status string` | The status's name, e.g. Todo or Backlog; any case. |
| `--json` | Print JSON for scripts. |

### cello task comment

Add a markdown comment to a task: progress, a question, an answer to Lucas.

```
cello task comment [flags] <key> [<text>]
```

| | |
| --- | --- |
| `key string` | A task key, e.g. CEL-3. |
| `text string` | The comment, in quotes; markdown renders on the card. (optional) |
| `--body-file string` | Read the comment from a file; - is stdin. |
| `--json` | Print JSON for scripts. |

### cello task submit

Hand finished work to Lucas: a review packet (summary, steps, evidence) that moves the task to In Review.

```
cello task submit [flags] <key>
```

| | |
| --- | --- |
| `key string` | A task key, e.g. CEL-3. |
| `--json` | Print JSON for scripts. |
| `--summary string` | What changed, in markdown. |
| `--summary-file string` | Read the summary from a file; - is stdin. |
| `--step string` | How to check the work, one step each; repeat in order. |
| `--attach string` | A video (MP4), a screenshot, or a text file such as test output or a terminal recording; repeatable. |
| `--caption string` | Describes the --attach or --link right before it. |
| `--link string` | A link, e.g. the PR; repeatable. |

### cello inbox

Show the comments Lucas left on tasks this session claimed (Send back notes too) and mark them read; each one arrives once. Use it when `cello context` lists new ones, or to reread what he said. With `cello install claude` they arrive by themselves. Not from a subagent: it shares its parent's session and would take the parent's comments.

```
cello inbox [flags]
```

| | |
| --- | --- |
| `--new` | Only new comments, and print nothing (exit 0) when there are none. For scripts and hooks. |
| `--json` | Print JSON: `items` (new, handed over now and marked read) and `earlier` (read before). |

### cello doc publish

Publish a markdown report, plan or summary as a page in Cello and print its URL.

```
cello doc publish [flags] <file>
```

| | |
| --- | --- |
| `file string` | The markdown file, or - to read it from stdin. |
| `--project string` | Project key, instead of the working folder's. |
| `--json` | Print JSON for scripts. |
| `--title string` | Default: the frontmatter title:, the first # heading, or the file name. |
| `--slug string` | The page's slug (its URL); publishing to it again updates it. Default: the page this file went to before, else one from the title. |
| `--kind string` | page (the default), doc or spec. |
| `--summary string` | Default: the frontmatter summary:, else the first paragraph. |
| `--task string` | Link the page to a task, e.g. CEL-12; repeat it, or separate keys with commas. |
| `--asset string` | Another file to upload with it (images the markdown links go up by themselves); repeatable. |

### cello doc list

The project's docs, specs and pages, newest first.

```
cello doc list [flags]
```

| | |
| --- | --- |
| `--project string` | Project key, instead of the working folder's. |
| `--json` | Print JSON for scripts. |
| `--kind string` | page (the default), doc or spec. |

### cello doc get

Print a page's markdown, to read it back or continue from it.

```
cello doc get [flags] <slug>
```

| | |
| --- | --- |
| `slug string` | The page's slug, e.g. billing-audit. |
| `--project string` | Project key, instead of the working folder's. |
| `--json` | Print JSON for scripts. |
| `--version integer` | An older version, by number. |

### cello doc archive

Hide a page from the Docs tab; its link keeps working, and publishing it again brings it back.

```
cello doc archive [flags] <slug>
```

| | |
| --- | --- |
| `slug string` | The page's slug, e.g. billing-audit. |
| `--project string` | Project key, instead of the working folder's. |
| `--json` | Print JSON for scripts. |

### cello whoami

Print, as JSON, who Cello thinks is calling.

```
cello whoami [flags]
```

| | |
| --- | --- |
| `--project string` | Project key, instead of the working folder's. |

### cello guide

Print the full guide for agents: concepts, workflow, examples, errors and every command (docs/cli.md).

```
cello guide [flags]
```

### cello install claude

Add Claude Code hooks that deliver new comments into the agent session holding the task (Stop and PostToolUse, running `cello hook claude`). Writes this project's .claude/settings.local.json (this machine, git-ignored; from a worktree, the main checkout's), merged with the hooks already there; running it again changes nothing. The old file is kept as .bak.

```
cello install claude [flags]
```

| | |
| --- | --- |
| `--user` | Write ~/.claude/settings.json instead: every project on this machine. |
| `--shared` | Write this project's .claude/settings.json instead, committed with the repo: everyone who clones it gets the hooks and needs cello. |

### cello uninstall claude

Take Cello's hooks out of Claude Code's settings: this project's .claude/settings.local.json and .claude/settings.json, and ~/.claude/settings.json. Every other hook and setting stays as it was.

```
cello uninstall claude [flags]
```

### cello hook claude

Run by the hooks `cello install claude` adds, not by hand: reads Claude Code's hook JSON on stdin and hands new comments for its session back to the agent as context (on Stop it keeps the agent going). Prints nothing when there are none, inside a subagent, or when the server doesn't answer within 2 seconds; always exits 0.

```
cello hook claude [flags] <event>
```

| | |
| --- | --- |
| `event choice` | The hook event Claude Code runs it for: stop (Stop) or post-tool-use (PostToolUse). |

### cello start

Run the Cello server on 127.0.0.1:4747 with data in ~/.cello (CELLO_PORT, CELLO_DATA_DIR).

```
cello start [flags]
```

### Flags every command takes

| | |
| --- | --- |
| `--help, -h` | Show help information |
| `--version, -v` | Show version information |
| `--wizard` | Start wizard mode for a command |
| `--completions <bash\|zsh\|fish\|powershell\|sh\|pwsh>` | Print shell completion script (choices: bash, zsh, fish, powershell, sh, pwsh) |
| `--log-level <all\|trace\|debug\|info\|warn\|warning\|error\|fatal\|none>` | Sets the minimum log level (choices: all, trace, debug, info, warn, warning, error, fatal, none) |
<!-- cli-reference:end -->
