# The cello CLI, for agents

Everything an agent needs to work with Cello through the `cello` command: the ideas behind it, the workflow, copy-paste examples, what each error means, and every command with its flags. `cello guide` prints this same page, so it reads the same in any repository.

A Cello board belongs to one person: the one you work with, who reviews what you hand in. This page calls them **the human**. Cello itself shows their name (the git user name the board was first started with), and the examples here call them Ana Souza.

This page is kept current: any change to a command, a flag, an output or a rule updates it in the same commit. The command reference at the end is generated from the CLI's own `--help`.

## Set up a repo for Cello

When the human says "use Cello in this repo", or `cello context` fails here, go through these steps in order. Each one checks first, so running them again is safe.

```mermaid
flowchart TD
    A["① Is the cello CLI installed?<br/>cello --version"] --> B["② Is Cello running?<br/>cello whoami: server answers"]
    B --> C{"③ cello init<br/>Is this repo a Cello project yet?"}
    C -->|"no: creates it<br/>(folder's name, a free key, this repo's path)"| D
    C -->|"yes: says which one, changes nothing"| D
    D["Then it inspects the repo: how to test it, how to collect evidence<br/>prints a readiness report, drafts the testing profile"] --> E
    E["④ Hooks and plugin: cello install claude<br/>(or cello init --hooks)"] --> F["⑤ Tell this repo's agents: a Cello section<br/>in AGENTS.md / CLAUDE.md (or cello init --agents-md)"]
    F --> G(["⑥ Check: cello context shows the project"])
```

Steps 3 to 5 in one go: `cello init --hooks --agents-md`.

1. **The CLI.** `cello --version` prints a version. If the command isn't found, stop and tell the human: `cello` is installed from their Cello checkout (`apps/cli`, linked at `~/.local/bin/cello`). Never install it yourself, unless you were asked to set Cello up from scratch on a machine that doesn't have it: then follow [docs/agent-setup.md](agent-setup.md), the first-time install.
2. **The server.** `cello whoami` prints JSON with a `server` entry. If it says Cello isn't running, `cello service status` says whether the background service is installed and shows its log; tell the human what it says, and ask them to open the Cello desktop app or run `cello start`. Don't start it yourself, since it serves their real data (the first-time install in docs/agent-setup.md is the one exception).
3. **The project.** Run `cello init` inside this repo. It creates the project with this repo's path (the main checkout's when you're in a worktree), named after the repo's folder, with a key made from the name that no other project has, and prints the key and the board's URL. If the repo is already a project, it says which one and leaves the project as it is, however its path was typed in New project (`~/…`, a trailing `/`, a symlinked folder, a subfolder of the repo). It refuses a repo an archived project holds, naming it: ask the human then.

   Then it inspects the repo, because the human relies on visual evidence and every packet needs some: it looks for a unit test runner, a typecheck, an e2e tool and its output folders, how to start the app and on which port, and checks this machine for ffmpeg, Docker and Playwright's browsers. It prints a readiness report, one line per kind of evidence (unit tests, e2e video, screenshots, terminal transcript): **ready**, **partial**, **missing**, or **not needed** (no UI found), each one that isn't ready with what to do. What it found goes into the project's testing profile (see The testing profile):

   ```
   $ cello init
   Created project SHOP · shop for /Users/lnmunhoz/projects/shop (tasks SHOP-1, SHOP-2, …)
   http://127.0.0.1:4747/SHOP
   Testing: detected web (Vite) · bun · Vitest · Playwright
     ready        unit tests           Vitest: bun run test
     partial      e2e video            Playwright: bun run test:e2e
                  → turn videos on in playwright.config.ts (use: { video: "on" }).
     ready        screenshots          saved in test-results
     ready        terminal transcript  commands to run and save with their output
   Wrote install, unit, typecheck, ui.runsIn, app.start, app.url, evidence.ui, evidence.cli, e2e.web.run, e2e.web.videos, e2e.web.screenshots to the testing profile. See `cello profile`.
   ```

   In a repo with nothing to test yet, every kind says what's missing and how to set it up:

   ```
   Testing: nothing detected (no test runner, e2e tool or app found)
     missing      unit tests           no unit test command found
                  → Add a unit test runner (Vitest: `npm add -D vitest`) and a "test" script.
     missing      e2e video            no e2e tool found
                  → Set up Playwright (`npm init playwright@latest`) with use: { video: "on" }, so builders can record the flow headless.
     …
   Nothing to write to the testing profile yet. Set fields as the repo gets them: `cello profile set <field> "<value>"`.
   ```

   It never writes a value it can't settle from the files alone. A value built from an environment variable resolves to the default the file gives (`http://localhost:${WEB_PORT}` with `const WEB_PORT = Number(process.env.WEB_PORT ?? 5199)` is `http://localhost:5199`); with no default in the file (or an expression it can't work out), the field is left out and an **unknown** line says why. Each Playwright config (the root's and each workspace package's) is its own e2e surface, each with its own run command: `desktop` when the config uses `_electron`, when it sits in a workspace package that depends on Electron, or, for the root's config, when a root script named for the desktop (`test:e2e:electron`) runs Playwright; else `web`. Electron in the root package.json alone doesn't count: monorepos often keep electron-builder there. When an e2e run goes through Docker or a wrapper script instead of the tool itself, the finished videos land where the wrapper puts them, not in Playwright's folder, so the videos and screenshots folders are left out and the report says to set them. In a repo like that:

   ```
   Testing: detected web (Vite) · desktop (Electron) · CLI · bun · Vitest · Playwright
     ready        unit tests           Vitest: bun run test
     partial      e2e video            Playwright: bun run test:e2e (web), bun run test:docker:desktop (desktop)
                  → set e2e.web.videos to the folder its finished videos land in: the run goes through `bun scripts/test-in-docker.ts e2e`, not straight to Playwright; set e2e.desktop.videos to …
     partial      screenshots          Playwright can take them
                  → Set e2e.web.screenshots to the folder its screenshots land in: …
     ready        terminal transcript  commands to run and save with their output
     unknown      app.url              baseURL in playwright.config.ts is `process.env.BASE_URL`, which names a variable with no default there
                  → Set it with `cello profile set app.url "<value>"` once you know it.
   ```

   Find those folders (run the e2e once and see where its videos land) and set them with `cello profile set e2e.web.videos "<folder>"`, so builders after you pick the videos up from the right place.

   - **Tell the human what's missing.** A missing or partial line means builders here can't bring the evidence a packet needs (a video of the flow, above all). Say so when you report the setup, with the suggestion, so they can decide whether to set it up.
   - The defaults are fine unless the human named the project or its key: then pass `--name "Thai Lookup"` and `--key THAI`.
   - If the key is taken, it says which project has it: pick another, or leave `--key` out and Cello picks a free one (CEL, then CELL, CELLO, CEL2…).
   - `--workspace Work` puts it in another workspace, by name; the default is the first one.
   - Running it again in a linked repo inspects again: new detected values fill fields that are empty or were detected before, a value found again unchanged is left as it is, and fields an agent or the human set are kept (the report says which). A field that was detected before and isn't found this time (the repo changed, or an earlier version of Cello wrote a value it now leaves out) is cleared, and the report ends with `Cleared app.url and e2e.web.videos: detected before, not found this time.` A field an agent or the human set is never cleared. When it finds nothing at all (a worktree on a branch without the repo's files, a sparse or fresh checkout), it clears nothing and says `Found nothing to detect here; kept the testing profile as it is.` `--skip-detect` leaves the inspection out.
4. **Hooks, so the human's comments reach your session.** Run `cello install claude` (or `cello init --hooks`, which does the same). It writes this machine's `.claude/settings.local.json` and makes sure git ignores it. It keeps a `.bak` of the old file; ignore that too if the repo's `.gitignore` doesn't cover it. Run it again any time; it changes nothing the second time. The same command adds two guards: in this project, Claude artifact publishes are turned away with a pointer to `cello doc publish` (see "Showing things to the human"), and an agent's edits in the repo are turned away until its session has claimed a task (see "Edits need a claimed task"). It also installs Cello's Claude Code plugin, which gives new sessions `/cello:orchestrate`, `/cello:work` and the `cello` skill (see "The Claude Code plugin"), and allows `cello` commands in Claude Code, so a permission check that fails can't cut agents off the board (see "`cello` commands skip Claude Code's permission check" below).
5. **Tell the repo's agents.** `cello init --agents-md` adds this section, with the project's key in place of `KEY`, to the end of the AGENTS.md in the checkout you're in, or to CLAUDE.md if there's no AGENTS.md (creating it), between two markers: `<!-- cello:agents-md:start sha256:… -->` (a fingerprint of the text it wrote) and `<!-- cello:agents-md:end -->`. Run it again whenever Cello's text changes: it puts the current text between the markers and prints the lines that changed, or says it's already current. It changes nothing else in the file.
   - **Everything between the markers is Cello's and gets rewritten.** Put the repo's own notes outside them (above the start marker or below the end one). If the text between them isn't exactly what Cello wrote (someone added a note, or it names another project's key), the command still rewrites it, but keeps the old file as `AGENTS.md.bak` first and says so.
   - **A section from before the markers** (a "Tracking work in Cello" heading that mentions `cello guide` or `cello context`) runs up to the next heading of any level, a setext heading or a `---` rule, so what follows it is never touched. What happens to it depends on whether anyone changed it:
     - **An earlier snippet, untouched** (every line is one Cello's snippet has had, with this project's key): it's replaced with the marked one. The command says so, prints what changed, and keeps the old file as `AGENTS.md.bak` (or `CLAUDE.md.bak`): delete it once you've looked.
     - **Customised** (it has lines Cello didn't write: the repo's own rules, another project's key): it's left exactly as it is and nothing is appended. The command says so and prints what swapping it would change (`--json`: `"change": "customised"`). To swap it anyway, run `cello init --agents-md --replace` (the old file is kept as `.bak`). To keep your lines and still get updates, add the markers by hand around a copy of the snippet and move your own lines outside them.
   - **A `.bak` already there is never overwritten:** the new copy goes to `AGENTS.md.bak.1`, then `.bak.2`, and so on.
   - **A "Tracking work in Cello" section that isn't Cello's** (it mentions neither) is left alone, and the command says so.
   - To add it by hand, copy it and replace `KEY` yourself:

   <!-- agents-md:start -->
   ```markdown
   ## Tracking work in Cello

   This repo's tasks live in Cello, project **KEY**, on the board of the person you work with (the human, below). Agents use it only through the `cello` CLI.

   - Before your first `cello` command in a session, run `cello guide` once: it's the full reference (concepts, workflow, every command, what each error means). Don't guess.
   - **First decide: is the human asking you to do something, or just talking?** Questions, brainstorming and explanations are conversation: answer, no task. A request to do something (build, fix, change, write, set up) is work, and work starts as a Cello task **before you read code or plan**: check whether the task exists (`cello task list`, `cello task get KEY-n`); if not, `cello task create "<title>"` with their words quoted in the description; then `cello task claim KEY-n`, then do it. This covers small requests, follow-ups and anything they send mid-task (each distinct request is its own task). When a chat turns into "ok, do it", that's the moment to create it. `cello install claude` enforces it: a hook refuses your edits in this repo until your session has claimed a task.
   - Run `cello context` at the start of each session.
   - Put the task key in commit messages (`fix(api): rate limit (KEY-12)`).
   - In Progress means someone is on it right now. When you wait on the human's decision, ask on the card with `cello task ask` (the task waits in Needs input). When you stop, put the state on the card and move it back to Todo.
   - Hand finished work to the human only with `cello task submit`: a summary, steps to check it, and evidence (videos and screenshots for UI work; a diagram when it's a flow).
   - This project has a testing profile: how to install, test, start the app and record evidence here. Read it in `cello context` and use its commands for your tests and evidence. When a field is wrong, fix it with `cello profile set` and say so in your packet; a field the human set is theirs, so ask on the card with `cello task ask`.
   - Answer the human on the card with `cello task comment`. Their comments come to your session by themselves.
   - When you end a turn while holding a claimed task, start `cello inbox --wait` in the background so the human's comments wake you.
   - When a decision is the human's (a design option, a scope, wording), ask on the card with `cello task ask` (options, one recommended with a reason, the screenshots and page to decide from), never in the terminal. Their answers come back to your session.
   - Show the human reports, plans and evidence as Cello pages (`cello doc publish page.md --task KEY-n`), opened in Cello's panel with `cello open <slug>`. In replies, link a page with the `cello://` link those commands print, never its http address (that one opens Claude's browser, not Cello). Never as Claude artifacts or other outside pages, even if your global instructions say so: `cello install claude` enforces it with a hook that turns artifact publishes away.
   ```
   <!-- agents-md:end -->

   `cello init --agents-md` copies this block, so changing it here changes what the command writes.
6. **Check.** `cello context` shows the project, its statuses and labels, and its testing profile. Tell the human the repo is set up: the project key, that the hooks and the plugin are installed (new sessions get `/cello:orchestrate`), that `cello` commands are on Claude Code's allow list (`Bash(cello:*)`), and that the AGENTS.md section was added or brought up to date (uncommitted, unless they ask you to commit it).

### `cello` commands skip Claude Code's permission check

Agents reach the board only through `cello`. Before Claude Code runs a shell command it checks whether it's allowed, and in auto mode that check is a call to a server. On Nov 16 that server returned errors for several minutes: no `cello` command could run, so agents couldn't read, comment on or submit any task. Commands on Claude Code's allow list skip the check, so `cello install claude` (and `cello init --hooks`) puts `cello` on it, in the same settings file as the hooks:

```json
{
  "permissions": {
    "allow": ["Bash(cello:*)"]
  }
}
```

`Bash(cello:*)` means "any shell command that starts with `cello`", and only those: Claude Code doesn't look past a `VAR=value` in front of a command (unless the variable is on its own short list of safe ones), so `CELLO_AGENT=… cello task comment …` still goes through the check. That's why subagents name themselves with `cello --agent <type>/<id> …` rather than a `CELLO_AGENT=` prefix (see Subagents): keep every `cello` command starting with `cello`. Install says what it did:

```
$ cello install claude
…
Allowed `cello` commands in /Users/lnmunhoz/projects/app/.claude/settings.local.json ("Bash(cello:*)" in permissions.allow), so Claude Code runs them without a permission check: agents reach the board only through `cello`, and a check that fails can't cut them off it.
```

- **It merges.** The rule goes after the rules already in `permissions.allow`; `deny`, `ask` and every other permission setting stay as they are. A `deny` rule still wins: `"deny": ["Bash(cello restore:*)"]` keeps blocking that one command.
- **Once.** Running install again changes nothing (it says `` `cello` commands are already allowed in … ``). If the file already allows `Bash(cello *)` (the same rule in Claude Code's newer spelling), install leaves it and adds nothing.
- **Where:** this project's `.claude/settings.local.json` by default, `~/.claude/settings.json` with `--user` (every project, which is where the human's own fix went), the committed `.claude/settings.json` with `--shared` (everyone who clones the repo gets it, along with the hooks).
- **A project set up before this** gets the rule the next time you run `cello install claude` there; nothing else in the file changes.
- **Uninstalling:** `cello uninstall claude` takes out exactly the `Bash(cello:*)` entry, and the empty `allow` list and `permissions` object it leaves, if any. Cello can't tell that entry from one you added by hand with the same text, so uninstall takes out a hand-added `Bash(cello:*)` too, and says "If you added the Bash(cello:*) rule yourself, put it back." Your `Bash(cello *)` stays.
- **A `permissions` block Cello can't merge into** (`permissions` isn't an object, or `allow` isn't a list) is never overwritten. Install refuses with a sentence and changes nothing; uninstall leaves that block as it is (Cello's rule can't be in it) and still takes out the hooks and the plugin.
- **The file comes back reformatted, with nothing lost.** Cello writes settings back with the file's own indentation and key order, but one item per line: a list or object you wrote on one line (`"allow": ["Read", "Bash(git status)"]`) comes back spread over several. Every key and value stays; the old bytes are in the `.bak`. This goes for the hooks and the plugin too.

## Concepts

**Cello** is the task board the human shares with their coding agents. Its server runs on their Mac (`cello start`, http://127.0.0.1:4747, data in `~/.cello`), as a background service from login once `cello service install` set it up (see The background service). The board in the browser, the desktop app and the CLI all talk to that server, and every change shows up live everywhere.

- **Workspace:** a group of projects that share statuses and views.
- **Label:** a name and a colour on a task. Each project has its own labels: CEL's `bug` and THAI's `bug` are two labels. A task can carry several of its project's labels. `cello label list` shows them; see Labels.
- **Milestone:** a goal for a project ("M3 · Watching agents"), with an optional target date, in the order the human sets. Each task is in at most one. How far along it is (done of total) is counted from its tasks' statuses, never typed in. Each project has its own milestones. Agents create, edit and assign them; only the human closes one, like approving a review. See Milestones.
- **Project:** one product, usually one git repository, with its own key (`CEL`). The CLI works out the project from the repository you're in; `--project KEY` picks another.
- **Task:** a card, keyed `<PROJECT>-<number>` (`CEL-12`). It has a title, a markdown description, a status, a priority, labels, an optional milestone, an optional parent task, comments and a history.
- **Status:** a column on the board, shared by the workspace. Names match in any case. `cello context` lists a workspace's own; the defaults are:

  | Status | What it means | How a task gets there |
  | --- | --- | --- |
  | Backlog (hidden) | An idea or request that still needs discussing. Nobody builds from here. | `cello task create … --status Backlog` |
  | Todo | Agreed and ready to build. | The default for new tasks |
  | In Progress | Someone is working on it. | `cello task claim` |
  | Needs input | Waiting for the human to decide something an agent asked on the card. On the board it shows in In Progress with a "Needs input" badge, unless Display turns its column on. | Only `cello task ask` |
  | In Review | Waiting for the human, with a review packet. | Only `cello task submit` |
  | Done | The human approved it. | The human, on the Review page |
  | Canceled (hidden) | It won't be done. | The human |

  Hidden statuses are folded on the board and left out of `cello task list` unless you ask for them.
- **Agent session:** one agent conversation. Cello credits every change to the session that made it ("Claude Code session 2fd0505c"), from `CLAUDE_CODE_SESSION_ID`, which Claude Code sets.
- **Subagent:** an agent the session started with Claude Code's Agent tool (a builder, a reviewer, an `Explore`). It works under its parent's session, with the same `CLAUDE_CODE_SESSION_ID`, so Cello names it on its own: its type and a short id, "cello-builder · a13bfb89", with the session as its parent. The board shows which subagent is on each card and counts each one in "Agents working". Claims and the human's comments stay with the session. See Subagents.
- **Claim:** "this session is working on this task". `cello task claim` assigns the task to your session and moves it to In Progress.
  - While your session is alive, other agents can't claim it.
  - If your session has exited, another session can claim the task and takes the claim over.
  - The human always wins: when they change a task you've claimed (moves it to another status, edits it, changes its labels, archives it, claim it themselves or releases your claim), your claim ends. Your session hears it once, like a comment ("Ana Souza moved CEL-40 to Todo: your claim ended. Stop working on it."; see Comments from the human reach your session), and `cello context` lists it under "Claims you lost" (until you hold the task again: claimed back, or reopened for you by their comment). Stop working on the task when you hear it.
  - Not every touch ends it: the human dragging your card to another place in the same column keeps your claim, and so does their comment. Their approval ends it without a notice, since your work is done. Your own changes (a move, `cello task release`, `cello task submit`) and your subagents' never tell you anything.
  - **A task remembers the last session that held it.** When the human comments on a task nobody holds (Done after their approval, Canceled, moved back to Todo, released, or any other whose claim a change of theirs ended), the comment goes to that session, and the task is yours again: it moves back to In Progress (a task still In Progress, In Review or Needs input stays where it is) and your session holds the claim. Your session hears it like any comment, saying the comment reopened the task (see Comments from the human reach your session). A task no agent ever claimed, an archived one, and a task someone holds aren't touched; neither are agents' comments or Send back notes.
- **Stage:** where a claimed task is inside In Progress: **planning**, **building**, **review** (Agent review), **fixing** (Fixing findings) or **merged**. In Progress holds a task from the claim to the packet, so without a stage a task being planned, one being built and one waiting for review look the same. **Every session holding a claim sets it** with `cello task stage`, not only orchestrators; the board shows it on the card. Pick it by the task: **planning** only when the task needs a decision before code (a spec, a scope with options, a question to the human); a clear task goes straight to **building**. A task with no stage whose agent is active shows as **Working**, so the board stays truthful if you forget, but it can't say which step you're on. Asking the human keeps it through Needs input; any other move out of In Progress, or submitting it, clears it. See Stages.
- **Presence:** the board shows whether the session holding a claim is working right now: **active now** (it called Cello in the last 5 minutes), **seen 2h ago** (quiet, its process still running) or **ended** (its process exited). Every `cello` command and every hook run counts as a check-in; with the hooks installed that's every tool call, a subagent's included. A subagent checks in as itself too, so the card names the subagent working on it ("cello-builder · a13bfb89 active now") rather than its session. The board hears about each at most once a minute, which keeps "active now" steady without filling the history; each one plays a short motion on the card, and while you're working the card has a thin edge in your colour. You don't do anything for it.
- **Review packet:** how finished work reaches the human. It holds a summary, how-to-check steps and evidence (videos, screenshots, test output, links). `cello task submit` creates it and moves the task to In Review. Then the human decides:
  - **Approve:** the task moves to Done and your claim ends. Nothing reaches your session for it: the work is done. A note they typed with it shows under Reviews in `cello task get` (`Note: …`). If they comment on the task later, it comes back to your session, reopened (see Claim above).
  - **Send back:** the task returns to In Progress with their note, and your claim stays. The note comes to your session (see Comments from the human reach your session), and `cello task get` shows it under Reviews.
  - **Comment, without deciding yet:** the Review page shows the task's comments under the packet, with a comment box. A comment there leaves the task In Review and your claim in place, and comes to your session like any comment. Answer it on the card; if it asks for a change, move the task back to In Progress before you make it (that withdraws the packet), then submit again.
  - **Moved out without a decision** (`cello task move`, or the human dragging the card): the packet is **withdrawn** and leaves the Review page. `cello task get` shows it as withdrawn, with who moved the task and where. To hand the work over again, submit a new packet.
- **Ask (Needs input):** how you get a decision from the human: questions on the card, each with options (one recommended, with your reason), plus evidence. `cello task ask` moves the task to Needs input; they answer in Cello, next to the evidence; the task comes back to In Progress, still yours, and their answers reach your session. Never ask them in the terminal when the decision is theirs (see Questions for the human).
- **Documents:** markdown published into the project's Docs tab with `cello doc publish`. There are three kinds:
  - a **page** reports on finished work (a snapshot to read now)
  - a **doc** explains how something works (kept up to date)
  - a **spec** plans work before it starts

  Publishing again updates a document in place, and its old versions are kept.
- **Reaction:** an emoji on a comment (👍 ✅ 👀 ❤️ 🎉 …), the human's quick answer that needs no words. Their reactions to your comments reach your session like their comments; `cello task react` adds yours. See Reactions.
- **Testing profile:** how to test this project's repo and collect evidence: the install, unit test and typecheck commands, how to start the app and where it's ready, each e2e surface with its videos and screenshots folders, and what a packet needs. It lives in Cello, one per project, shown by `cello context` and in Settings. It's current best knowledge, not a fixed config: it changes as the repo does, and agents keep it right. See The testing profile.
- **History:** every change is recorded with who made it. `cello task get` shows a task's history; `cello context` shows recent activity.

## Start of every session

```bash
cello context
```

It shows the project, its statuses (hidden ones in brackets), its labels, its open milestones with how many of their tasks are done, its testing profile (how to test and collect evidence here, each field with who set it, and what's missing), new comments from the human on tasks you've claimed (shown, not taken; see Comments from the human reach your session), the tasks your session has claimed, claims you lost and why, and recent activity:

```
Project   CEL · Cello · /Users/lnmunhoz/projects/cello
You       Claude Code session 2fd0505c (cli)
Statuses  Todo · In Progress · Needs input · In Review · Done (hidden: Backlog, Canceled)
Labels    feature · server · ui
Milestones  M3 6/11 done (due 2026-12-01) · M4 0/2 done
Testing   how to test this repo and collect evidence; current best knowledge, so fix it with `cello profile set` when it's wrong
  install          bun install  (detected)
  unit             bun run test  (detected)
  typecheck        bun run typecheck  (detected)
  ui.runsIn        docker  (human)
  app.start        bun run dev  (detected)
  app.url          http://127.0.0.1:5199  (agent)
  evidence.ui      MP4 video of the e2e run of the flow, plus screenshots (light and dark when it matters)  (detected)
  evidence.cli     terminal transcript of the commands and their output, plus the test output  (detected)
  review.env       CELLO_E2E_REVIEW=1  (human)
  never.touch      ~/.cello and port 4747  (human)
  e2e.web.run      bun run test:e2e  (detected)
  e2e.web.videos   test-results/docker/latest/web/videos  (agent)
  e2e.desktop.run  bun run test:docker:desktop  (human)

New comments for you (1)
  CEL-22  Review page: collapsed rows, one packet open at a time
    Ana Souza commented, 5m ago
      Use the same row height as the list layout.
  Answer on the card: `cello task comment CEL-22 "…"`. They stay new until the hook or `cello inbox` hands them over.

Claimed by you
  CEL-22  In Progress  Review page: collapsed rows, one packet open at a time

Recent activity
  2m ago   CEL-22  Ana Souza commented
```

Run it first in every session, and again when you come back to a task.

## The testing profile

Each project has a testing profile in Cello: how to test its repo and how to collect the evidence a review packet needs. The human relies on visual evidence (a video of the flow, screenshots), so before you build, read the profile in `cello context` (or `cello profile`) and use its commands for your tests and your evidence: install with `install`, run `unit` and `typecheck`, start the app with `app.start` and open `app.url`, record the flow with the e2e surface's `run` and pick the videos and screenshots up from its folders, and bring what `evidence.ui` or `evidence.cli` asks for. Stay away from what `never.touch` names.

**It's current best knowledge, not set in stone.** `cello init` drafts it from what it detects, and the repo keeps changing after that. Treat a field as what worked last time, and fix it when it's wrong:

- **When a command in it fails** because the command is wrong (the script was renamed, the port moved), find the right one and set it.
- **When the repo changes** (you add an e2e tool, a new surface, a script, a port), update the fields your change affects in the same task.
- **Say so in your review packet**, in the summary: which fields you changed and why ("`e2e.web.run` was `bun run e2e`, which no longer exists; now `bun run test:e2e`").
- **Fields the human set are theirs.** An agent can't change or unset them; Cello refuses with "Ana Souza set unit (…)". If one is wrong, ask them on the card with `cello task ask` (see Questions for the human) and mention it in your packet. Their edits, in Settings or from their own `cello`, overwrite anything.
- **Nothing to record with?** When the profile has no e2e surface and the work is UI, say so in your packet and bring what you can (screenshots, a transcript); don't set up a new e2e tool unless the task asks for it.

Each field records who set it last (`detected`, `agent` or `human`) and when; setting the value it already has confirms it. Every change is an event, so Recent activity in `cello context` and Settings show who changed what.

```bash
cello profile                                                    # every field, with who set it and when
cello profile set e2e.web.run "bun run test:e2e"                 # Set e2e.web.run to `bun run test:e2e`.
cello profile set app.url http://127.0.0.1:5199                  # after the dev server moved to another port
cello profile set ui.runsIn docker                               # local (the default) or docker
cello profile unset e2e.mobile.run                               # Unset e2e.mobile.run. (the surface is gone)
cello profile --json                                             # { projectId, fields: [{ field, value, source, updatedAt, actorId, sessionId }] }
```

The fields:

| Field | What it holds | Example |
| --- | --- | --- |
| `install` | How to install dependencies | `bun install` |
| `unit` | How to run the unit tests | `bun run test` |
| `typecheck` | How to typecheck | `bun run typecheck` |
| `ui.runsIn` | Where UI tests run: `local` (headless, the default when unset) or `docker` | `docker` |
| `app.start` | How to start the app | `bun run dev` |
| `app.url` | The URL it's ready at | `http://127.0.0.1:5199` |
| `e2e.<surface>.run` | How to run one surface's e2e tests (`web`, `desktop`, `mobile`, any lower-case name) | `bun run test:e2e` |
| `e2e.<surface>.videos` | Where that run's videos land | `test-results/docker/latest/web/videos` |
| `e2e.<surface>.screenshots` | Where its screenshots land | `test-results/docker/latest/desktop/screenshots` |
| `evidence.ui` | What a packet for UI work needs | MP4 video of the flow, plus screenshots light and dark |
| `evidence.cli` | What a packet for CLI or server work needs | terminal transcript plus the test output |
| `review.env` | Variables that record review videos (slow motion, held steps) | `CELLO_E2E_REVIEW=1` |
| `never.touch` | Paths and ports agents must never touch | `~/.cello and port 4747` |

`cello context` lists what's missing (`missing: typecheck, e2e.<surface>.run`); `review.env` and `never.touch` are optional, and `ui.runsIn` means local when it's unset.

## The workflow

1. **Find the work, or make it.** When the human asks for something that will change code, docs or anything else, it becomes a task **before you read code or plan**: `cello task list` to check it isn't there already, else `cello task create` with their words. `cello task list` shows Todo and In Progress; `cello task get CEL-12` reads one task in full, including the human's notes on earlier packets and every comment.
2. **Claim it.** `cello task claim CEL-12`. If it says another session holds the task, pick another one. Don't work on a task someone else holds. With the hooks installed, an edit in the repo is refused until you hold one (see "Edits need a claimed task" below).
3. **Work, test first, and put the key in every commit:** `feat(web): collapsed review rows (CEL-22)`.
4. **Comment** progress and decisions on the card (`cello task comment`). The human reads them there.
   - **When a decision is theirs** (which design, which scope, what wording), ask on the card with `cello task ask` and wait for their answers (see Questions for the human). Never ask them in the terminal.
5. **Hand it over** with `cello task submit` and evidence they can look at (see Review packets). The task moves to In Review.
6. **If it's sent back,** their note comes to your session (by the hook, or `cello inbox`), and `cello task get CEL-12` shows it under Reviews. Fix it, then submit again.
   **The human's feedback in chat counts as a Send back.** When they review a task in your conversation instead of on the card (a screenshot, "this should be…", "I don't like…"), do both of these before you start fixing:
   - put their words on the card as a comment, quoted as they said them and marked as theirs (`**<their name>, in chat (review):** "…"`), so the review lives with the task;
   - if the task is In Review, move it back with `cello task move CEL-12 "In Progress"`, so the board shows it's being worked on again. The move withdraws the open packet, so it leaves the human's Review page.

   Then fix, and submit a new packet. The same goes for feedback on a task in Done: comment it, and move it back to In Progress, or open a new task if it's a new request.
7. **Mark each step with `cello task stage`** (see Stages), so the card says where the work is. Every session holding a claim does this, not only orchestrators:
   - **Working by yourself:** `planning` only when the task needs a decision before code: a spec to write, a scope with options for the human to pick, or a question to ask them. It stays in `planning` until that's settled. A clear task (you know what to build) goes straight to `building`. Then `building` while you write the code, and `merged` once it's merged, just before you submit. If building runs into a design question, go back to `planning` until it's answered. `/cello:work APP-12` sets a Claude Code session up for this.
   - **Running a feature through builder and reviewer agents** (the orchestrator): `building`, `review`, `fixing`, `merged` at each step. `/cello:orchestrate APP-12 APP-14` sets a Claude Code session up for this (see "The Claude Code plugin").
8. **In Progress means someone is working on it right now.** When work stops before you submit, don't leave the card there: the board would show it as being built when nobody is on it.
   - **Waiting on the human** (a scope's options, a design choice, any decision that's theirs): ask on the card with `cello task ask` (see Questions for the human). The task moves to Needs input, your claim stays, and it comes back to In Progress when they answer.
   - **Stopping or pausing:** comment where it stands, move it back to Todo, and `cello task release CEL-12`.
   - A **scope** is part of its task. Claim the task to make the scope; once the scope is published, ask its questions with `cello task ask` (attach its screenshots, link the page): the task waits in Needs input until they pick.
   - `cello task release` alone keeps the status, so only use it on its own when another session takes over the work straight away.

Never move a task to Done or Canceled yourself: the human decides.

### Edits need a claimed task

`cello install claude` (and `cello init --hooks`) puts a PreToolUse hook on Claude Code's `Edit`, `Write` and `NotebookEdit` into the project's settings. Before one of them changes a file **inside this repo**, the hook asks the server whether your session holds an open task (Todo, In Progress, Needs input or In Review) in this repo's project. When it holds none, Claude Code blocks the edit and shows you this reason (with the project's key):

```
Cello: this session hasn't claimed a task in KEY. Before editing for a request, check it exists (`cello task list`), else `cello task create "<title>"` with the human's words, then `cello task claim KEY-n`.
```

- Do what it says, then make the edit again. Once you've claimed, the next edit goes through.
- **Only edits inside the repo** (the checkout you're in, or the main checkout) are checked. Files in your scratchpad, a temp folder or anywhere else outside the repo go through. Reading, searching and running commands are never checked.
- **Subagents share your session,** so a builder subagent working in a worktree of the repo edits under the task you claimed.
- **It never stops work it can't be sure about:** when the server is down or doesn't answer within 2 seconds, the repo isn't a Cello project, or the hook's input is broken, the edit goes through silently.
- A claim it saw is remembered for a minute (a small file under the system's temp folder), so a run of edits doesn't ask the server each time. A refusal isn't remembered: right after you claim, the edit goes through.
- **`CELLO_ALLOW_UNTRACKED=1`** in Claude Code's environment turns the check off. It's the human's switch, for when they want to work without tasks (`CELLO_ALLOW_UNTRACKED=1 claude`). Agents never set it on their own, nor work around the hook another way (writing files through Bash to dodge it, say).

## Creating tasks

```bash
# Ready to build: lands in Todo
cello task create "Sidebar: collapse and resize" --label ui --priority high \
  --description "Drag the sidebar's edge to resize it; ⌘B collapses it to an icon rail."

# Still needs discussing: Backlog
cello task create "Idea: media library per project" --status Backlog --body-file - <<'EOF'
The human makes promo videos, icons and designs for each project. A place in Cello to keep them,
link them to tasks, and sync them later.
EOF

# A subtask, with two labels, in milestone M3
cello task create "Restore refuses while a server runs" --parent CEL-23 --label server,feature --milestone M3
```

- **Todo or Backlog:** Todo means agreed and ready to build. When the human says "add to the backlog", use `--status Backlog`.
- **Labels must already exist.** `cello label list` lists them, and an unknown label fails with the real names. `cello label create` makes a new one (see Labels).
- **So must the milestone,** and it must be open: `cello milestone list` shows them, `cello milestone create` makes one (see Milestones). `--milestone none` is the same as leaving it out: no milestone.
- **Priority:** `urgent`, `high`, `medium`, `low` or `none`.
- **Long descriptions:** use `--body-file -` with a heredoc, or `--body-file notes.md`.

## Editing tasks

```bash
cello task edit CEL-12 --title "Sidebar: collapse, resize and remember the width"
# Edited CEL-12  Sidebar: collapse, resize and remember the width

# Replace the description with markdown from stdin
cello task edit CEL-12 --body-file - <<'EOF'
Drag the sidebar's edge to resize it; ⌘B collapses it to an icon rail.
The width is kept per project.
EOF

cello task edit CEL-12 --priority urgent --description "Short and new."

cello task edit CEL-12 --milestone M3     # put it in a milestone (moves it from another)
# CEL-12 is in M3  Sidebar: collapse, resize and remember the width
cello task edit CEL-12 --milestone none   # take it out
# CEL-12 has no milestone now  Sidebar: collapse, resize and remember the width
```

- **Only the flags you give change.** `--title`, `--description` (or `--body-file`, a file or `-` for stdin) and `--priority` (`urgent`, `high`, `medium`, `low`, `none`), in any mix; together they're one change, one line in the history. `--milestone` is a change of its own, with its own line ("put it in M3"); with `--json` the command then prints both writes as `{ "update": …, "moved": … }` (`update` is null when only `--milestone` was given). With none of them it refuses and changes nothing. The same values again change nothing and say so ("Nothing to change on CEL-12  …").
- **The description is replaced, not added to.** To add a note, comment instead. To keep part of the old text, read it first: `cello task get CEL-12 --json | jq -r '.task.description'`.
- **Who edits:** you, on any task, claimed or not; editing isn't guarded by a claim, and another session's claim stays. When the human edits a task you hold, your claim ends, as with any change they make to it, and your session is told (see Claim in Concepts).
- **If someone changes the task at the same moment,** it fails with "It was changed by … in the meantime"; run it again.

## Reading tasks

```bash
cello task list                          # Todo and In Progress
cello task list --status Backlog         # any status by name, hidden ones too
cello task list --status Done --label ui
cello task list --milestone M3           # open tasks in a milestone; --milestone none for tasks without one
cello task list --mine                   # what your session has claimed
cello task get CEL-12                    # everything about one task
cello task get CEL-12 --json | jq -r '.task.description'
```

Every command takes `--json` and prints the whole response, for scripts.

## Searching

`cello search` finds things in the project by what they say: task keys, titles and descriptions, comments, review packets, pages and docs, and project and label names. Use it before creating a task (is there one already?), to find the comment where the human decided something, or the page that explains a part of the system. The human's ⌘K bar in the app runs the same search, so you both see the same results.

```bash
cello search evidence video              # every word must match the start of a word
cello search CEL-15                      # the task, then everything that mentions it or is on it
cello search backup --kind comment,packet
cello search restore --kind page --limit 20
cello search stage --json | jq -r '.groups[] | select(.kind == "task") | .hits[].taskKey'
```

```
$ cello search evidence
Tasks (2)
  CEL-12  In Review  [Evidence] in review packets
  CEL-9   Todo       Record the flow
          The [evidence] goes in the packet.
Comments (1 of 3)
  CEL-9  Ana Souza, 2h ago, on Record the flow
         The [evidence] video stops before the inbox shows the comment.
Pages and docs (1)
  evidence-videos  doc  How [evidence] videos are made  · Claude Code, 1d ago

More: `--limit 20` shows more per kind; `--kind comment` shows only one kind.
```

- **Words** match the start of words, so `evid` finds "evidence", and they're stemmed, so `videos` finds "video". Every word must match. Case and accents don't matter.
- **A task key** (`CEL-15`) prints that task first, then the tasks, comments, packets and docs that mention it, and the comments and packets on it. `CEL-1` never matches CEL-15.
- **Results** come grouped by kind (tasks, comments, review packets, pages and docs, projects, labels), best match first: a match in a title counts more than one in a description, and an open task ranks above a Done one. The matched words are in `[brackets]`. Each group shows 5 hits unless `--limit` says more (up to 50); the heading says how many matched in all ("1 of 3").
- **`--kind`** narrows it: `task`, `comment`, `packet`, `page` (pages, docs and specs alike), `project`, `label`, comma-separated.
- **What's left out:** archived tasks and documents, deleted comments, packets replaced by a newer one, and archived projects. It searches the working folder's project; `--project KEY` searches another.
- It sees a change the moment it's made: the index is updated in the same transaction as the change.

## Moving tasks

```bash
cello task move CEL-12 Todo
cello task move CEL-31 backlog           # any case
```

- **Moving into In Review is refused:** use `cello task submit`.
- **Moving out of In Review withdraws the open packet:** it leaves the Review page, and coming back takes a new `cello task submit`.
- **Moving into Needs input is refused,** to everyone, the human included: only `cello task ask` puts a task there, with your questions.
- **Don't move tasks to Done or Canceled.**
- **"It was changed by … in the meantime":** someone changed the task while you were acting. Run the command again.

## Stages

A stage says where a claimed task is inside In Progress, so the human can tell from the board why it's still there. **Every session holding a claim sets it**, at each step of its work:

- **Working by yourself** (one session plans and builds the task): `building` → `merged` for a clear task; `planning` → `building` → `merged` when it needs a decision first.
- **Orchestrating** builder and reviewer agents: `building` → `review` → `fixing` → `merged` (docs/feature-lifecycle.md), with `planning` first when the task needs a scope or a decision before the builder starts.

**When to plan, by the task:** a clear task (a bug with a known fix, a change the task spells out) needs no plan: go straight to `building`. Use `planning` only when you can't start the code yet: the task asks for a spec, a scope with design options for the human to pick, or leaves a question only they can answer. It stays in `planning` until that's settled (their pick, their answer, the spec agreed). If building runs into a design question the task doesn't answer, set `planning` again while you ask, then back to `building`.

| Stage | The board says | Set it when |
| --- | --- | --- |
| `planning` | Planning | the task needs a decision before code: you're writing a spec, making a scope with options, or waiting on a question to the human. Not for a clear task |
| `building` | Building | the code starts being written, by you or a builder agent |
| `review` | Agent review | a reviewer agent starts reading the branch |
| `fixing` | Fixing findings | the findings go back to the builder |
| `merged` | Merged | the branch is merged into main, before the packet |

```bash
cello task stage CEL-12 planning
# CEL-12 is now Planning  (In Progress  Sidebar: collapse and resize)
cello task stage CEL-12 building
# CEL-12 is now Building  (In Progress  Sidebar: collapse and resize)
cello task stage CEL-12 review
cello task stage CEL-12 --clear      # no stage
cello task list
# CEL-12  In Progress · Agent review  Sidebar: collapse and resize  · Claude Code session 2fd0505c
```

- **Only the session holding the claim** sets it (or the human, with `CELLO_SESSION=me`, which keeps your claim). Claim the task first.
- **Only in In Progress.** In any other status it's refused.
- **It clears itself:** `cello task submit`, or a move to any other status, removes it. Reordering inside In Progress keeps it, and so does `cello task ask`: the stage waits in Needs input and is still there when the human's answers bring the task back.
- **Forgot it?** A task with no stage whose agent is active shows as **Working** on the board: on its card, its list row and its task panel, and in a Working lane when In Progress is grouped by stage. So it doesn't look stuck while you work, and it goes back to no stage once your session is quiet for 5 minutes or ends. Set the stage anyway: Working can't tell the human whether you're planning or building.
- **Subagents don't run it.** Builders and reviewers work for the claim of the session that started them; that session marks the steps.
- `cello task get` shows it on the Status line ("Status: In Progress · Stage: Agent review") and in the history, with who changed the task last.

## Labels

Labels say what a task is about: what kind of work, which part of the product. **Each project has its own labels**: the `cello label` commands, `cello context`, `cello task label` and `cello search` see only the current project's (the repository you're in, or `--project KEY`), and a task can only carry labels of its own project. Each label has a name (unique in its project, ignoring case), a colour and a group. Two projects can each have a label of the same name, such as `bug`; they're separate labels, and changing or archiving one leaves the other alone. Each project has its own convention for them; Cello's own board, for one, gives each task one kind (feature, bug, polish, chore, docs) and one or more areas (board, cli, agents…).

**Groups** say what a label means, so the board's filter can sort them: **kind** (the kind of work: feature, bug…), **area** (the part of the product: board, cli…), **milestone** or **none** (the default; every screen calls it **Other**). Milestones are their own thing now (see Milestones): Cello turned the Milestone labels it had (M2, M3) into milestones and removed the labels, so don't make new Milestone labels. The Issues tab's filter panel lists labels under Kind, Area and Other (a label still in the Milestone group shows under Other, since milestones have a Milestone section of their own), and matches any label within a group and every group picked: ticking `bug` and `agents` shows the bugs in agents.

```bash
cello label list                                           # the project's labels: colour, and how many of its tasks carry each, under its group
cello label list --project THAI                            # another project's labels
cello label create board --color "#5B9A74" --group area    # a new label; without --color, one is picked from the name; without --group, none
cello label update server --color "#8D7B68"                # recolour; --name renames; --group regroups
cello label update docs --group kind
cello label archive ui                                     # retire one

cello task label CEL-12 +board +cli -ui                    # add and remove a task's labels, in one change
```

```
$ cello label list
Kind
  feature  #3B82F6  34 tasks in CEL

Area
  board    #5B9A74  9 tasks in CEL
  server   #8D7B68  4 tasks in CEL

Archived (hidden from cards and pickers; tasks keep the link): ui (31 tasks in CEL)

$ cello label update server --group area
Updated label server  #8D7B68  Area

$ cello task label CEL-12 +board +cli -ui
CEL-12 labels: feature, board, cli (added board and cli; removed ui)
```

Until some label has a group, `cello label list` is one list without headings. `--group` takes `kind`, `area`, `milestone` or `none` (`other` works too), in any case; any other name is refused and nothing changes.

- **`+name` adds, `-name` removes,** as many as you like, in any case. It's one change to the task: one line in its history. Labels it already has (or doesn't have) are skipped, and when nothing changes it says so ("CEL-12 already has these labels: …").
- **An unknown name is refused,** every unknown one at once, with close matches, and nothing on the task changes:

  ```
  $ cello task label CEL-12 +bord -ui
  No label named "bord" (did you mean board?). Nothing was changed. Labels: board, cli, feature, server, ui. Make a new one with `cello label create <name>`.
  ```

  Labels are never made on the fly. When a label really is missing, create it first. Another project's label doesn't count: if THAI has `decks` and CEL doesn't, `cello task label CEL-12 +decks` is refused the same way.
- **A taken name is refused:** `cello label create Board` when the project has `board` fails and creates nothing, whatever the case, and archived labels keep their names too. Run `cello label list` first when you're not sure. A name another project uses is free here.
- **Who labels:** you and the human, on any task. A label change is an ordinary change to the task, not one a claim guards: you may relabel a task another session holds, and its claim stays. When the human changes the labels of a task you hold, your claim ends, as with any change they make to it, and your session is told (see Claim in Concepts).
- **Archiving** retires a label: it disappears from the cards, the list, the pickers and `cello context`, and it can't be put on a task any more. Nothing is deleted: tasks keep the link underneath, out of sight. Its name stays taken, and there's no unarchive yet.
  - It applies to this project's label only: another project's label of the same name stays as it is.
  - When you replace a label (say `ui` by areas), relabel its tasks first (`cello task label CEL-12 +board -ui`), so no card is left without one, then archive it.
- **Colours:** `--color` takes `#RRGGBB`. Quote it in the shell (`"#5B9A74"`), since an unquoted `#` can start a comment.


## Milestones

A milestone is a goal for a project, such as "M3 · Watching agents", with an optional target date. **Each task is in at most one milestone**, and the milestone's progress is counted from its tasks: done of total, where Done counts as done, Canceled is left out of the total, and Backlog is counted but shown apart (it isn't committed yet). Nobody types progress in; it moves as cards move. **Each project has its own milestones**, in the order the human sets (M2 before M3), each open or closed. The card shows its milestone next to the labels, and the task panel has a Milestone picker. The board and list's filter panel has a **Milestone** section: the project's open milestones in order, then No milestone, each with how many tasks it would show; ticking M3 and No milestone shows the tasks in M3 and those in none. For you, `cello task list --milestone M3` is the same filter.

```bash
cello milestone list                                              # every milestone in order: open or closed, progress, date, goal
cello milestone show M3                                           # one milestone: goal, date, progress, then its tasks by status
cello milestone create M4 --goal "Releases" --due 2026-12-01      # a new one, last in the order
cello milestone edit M4 --due none --goal "Releases and updates"  # --name renames; --due none clears the date
cello milestone edit M4 --before M3                               # move it in the order (--after works too)

cello task create "Release notes" --milestone M4                  # a new task in it
cello task edit CEL-12 --milestone M4                             # put a task in it (moves it out of another)
cello task edit CEL-12 --milestone none                           # take it out
cello task list --milestone M4                                    # its open tasks; --status picks another status
```

```
$ cello milestone list
M2  closed  7 of 7 done · 100%  closed 2d ago
M3  open    6 of 11 done · 55%  due 2026-12-01 · Watching agents
M4  open    0 of 2 done         due 2026-12-15 · Releases

$ cello milestone show M3
M3 · open · due 2026-12-01
Watching agents
6 of 11 done · 55%: 1 in review, 2 in progress, 1 to do, 1 in Backlog (1 canceled, not counted)

CEL-30  Backlog      Filters on the Milestones page
CEL-31  Todo         Burn-up chart
…
```

- **`cello context` lists the open milestones** with done of total ("M3 6/11 done (due 2026-12-01)"), so you know what's current. `cello task get` shows a task's milestone on its status line, and its history says each change ("put it in M3", "moved it from M2 to M3", "took it out of M3").
- **Names match in any case,** and an unknown one is refused with the project's milestones and close matches; nothing is created on the fly. A name is unique in its project, in any case, closed milestones included; another project may use the same name.
- **Only open milestones take tasks.** Putting a task in a closed one is refused ("M2 is closed: put tasks in an open milestone, or reopen M2 first"). A task already in it when it closed stays there.
- **Who does what:** you and the human create, edit and reorder milestones, and put tasks in and out of them, on any task: a milestone change isn't guarded by a claim, and it doesn't end anyone's claim, the human's included (it's planning, not taking the work over). **Closing and reopening are the human's only**, like approving a review: `cello milestone close` and `cello milestone reopen` refuse an agent ("Only Ana Souza can close a milestone…"). When a milestone's work looks done, say so on your task's card.
- **The old Milestone labels:** Cello turned each label in the Milestone group into a milestone of the same name, in name order, with its tasks, then removed the labels. A task that had two (M2 and M3) went to the later one, and its history says so ("Cello turned its M3 label into the milestone M3 (it also had M2…)").
- **What the human sees:** each project has a **Milestones** tab next to Issues. It lists the open milestones in order, each with its goal, a bar split into Done, In Review, In Progress (Needs input with it), Todo and a lighter Backlog tail, "6 of 11 done · 55%", "3 days left" (or "due today", or "4 days late" in red) and the marks of the agents working on its tasks right now; he drags rows to reorder them. Below: **No milestone** with its count of open tasks, and the closed milestones, folded, with when each closed. Each milestone has its own page (its goal, date and bar, its tasks by status, **Add a task**), and the board's Display can group cards by milestone, one swimlane each. When a milestone's last task reaches Done, its row and page ask "All done: close M3?"; only he answers it. The same numbers are what `cello milestone list` and `cello milestone show` print, so what you see matches what he sees.
- **A closed milestone stays closed.** If one of its tasks moves out of Done afterwards, the milestone doesn't reopen; the task's row on its page says "reopened after M3 closed" until the human reopens the milestone or the task is Done again. To reopen work on a closed milestone, ask on your task's card.

## Comments

```bash
cello task comment CEL-12 "Found the cause: the column's min-height was missing."

cello task comment CEL-12 --body-file - <<'EOF'
## Progress
- Collapsed rows work, with j/k and Enter
- Next: open the next row after Approve
EOF

# A table: shown as one, scrolling sideways inside the comment when it's wide
cello task comment CEL-12 --body-file - <<'EOF'
| Run | Time | Tests |
| --- | ---: | --- |
| e2e | 4m 12s | 31 passed |
EOF

# With screenshots: shown under the text as thumbnails that open full size
cello task comment CEL-12 "The empty state, built" --attach empty-state.png --attach empty-state-dark.png
# Commented on CEL-12 with 2 images
```

Comments are GitHub-flavored markdown, rendered on the card: tables, task lists (`- [x] done`), ~~strikethrough~~ and bare addresses work, as they do in task descriptions, review packet summaries, asks' intros and pages. Links in them can be clicked. Task keys (e.g. CEL-12) link to the task, with its live status; keys of unknown tasks, and keys in backticks or code blocks, stay plain. Answer the human's comments and Send back notes on the card, so the conversation stays with the task. Their comments come to your session by themselves (next section).

**Screenshots in comments.** `--attach` takes an image (PNG, JPEG, GIF, WebP or AVIF, up to 50 MB), relative to the folder you run it in; repeat it for more. A comment with screenshots needs no text. Anything else is refused ("notes.txt isn't an image (PNG, JPEG, GIF, WebP or AVIF)"): test output and videos go in a review packet. The human pastes (⌘V) or drops screenshots into the comment box in the task panel and on the Review page; they reach you as files (next section). `cello task get CEL-12` saves every comment's screenshots to temp files and prints their paths under the comment's text (`Screenshot: /var/folders/…/T/cello-comments/<comment id>/1.png`); `--json` has them as each comment's `attachments`.

A comment counts as activity on its task: adding, editing or deleting one moves the task's last change (`updatedAt`, "Last changed by" in `cello task get`) to you, and the card says "2fd0505c commented just now". It's not a status change, so it never ends anyone's claim. `cello task get CEL-12 --json` has them as `.task.commentCount` and `.task.lastCommentAt`.

## Reactions

A reaction is an emoji on a comment: a quick answer that needs no words. The human clicks 👍 under your "Shall I merge it?" instead of typing "yes". You can react too:

```bash
cello task react CEL-12 last 👍              # on the human's newest comment on CEL-12
cello task react CEL-12 01JD2X7Q8M4K5N6P7R8S9T0V1W ✅   # on one comment, by its id
cello task react CEL-12 last 👍 --remove     # take it back
```

- **Which comment:** `last` is the human's newest comment on the task. For any other comment, pass its id: `cello task get CEL-12` prints it after each comment's author (`Ana Souza · 5m ago · id 01JD2X…`), and `--json` has it as `.comments[].id`.
- **One emoji per reaction**, any emoji (skin tones and flags count as one). The board offers 👍 ✅ 👀 ❤️ 🎉 and a short picker.
- **Once per emoji:** reacting with the same emoji again changes nothing ("You had already reacted 👍 …"), and `--remove` takes yours back. Each party reacts on its own: the human's 👍 and your 👍 are two.
- **Not activity on the task:** a reaction doesn't move the task's last change, doesn't show in its history, and never ends a claim.
- **`cello task get` shows them** under each comment: `Reactions: 👍 Ana Souza · ✅ Claude Code session 2fd0505c`. In `--json` they're `.comments[].reactions`.
- **The human's reactions to your comments reach your session**, like their comments do (next section). Your reactions reach no one: they show on the board, that's all.

## Comments from the human reach your session

The human's comments on a task you've claimed, their Send back notes, their answers to your asks (see Questions for the human) and their reactions to your comments are addressed to your session: the one holding the claim (for a reaction, the one that wrote the comment). Your own comments and other agents' never come back to you, and nothing does once another session or the human holds the claim. Two exceptions: a Send back note still reaches the session that handed in the packet, and a comment on a task nobody holds reaches the session that held it last, which holds it again (below).

**A comment on a task you worked on, after your claim ended, reopens it for you.** Once the human approves your packet the task is Done and nobody holds it; the same goes after you release it, or after a change of theirs ended your claim (a move to Canceled or Todo, say). The comment reopens it from any of these: Done, Canceled, Todo, or released. If they then comment on it ("Let's add the video to the readme"), the comment's own change gives the task back to you: it moves to In Progress (unless it's still In Progress, In Review or Needs input, where it stays), your session holds its claim again, and the history says "Ana Souza's comment reopened it for Claude Code session 2fd0505c". Before they send it, the comment box tells them so ("Commenting reopens CEL-94 and sends it to Claude Code session 2fd0505c"), and the receipt then shows it delivered as usual. The comment reaches you the same ways as any other (the hooks, `cello inbox`, `cello inbox --wait`, a woken run when your process is gone and waking is on), and says the task was reopened:

```
New Cello comment on a task you worked on before, now yours again:

CEL-94  The setup video
  Ana Souza commented while it was Done, reopening it, 1m ago
    Let's add the instructional video to the repo readme

Act on it now, then answer on the card: `cello task comment CEL-94 "…"` (or `--body-file -` for markdown), so Ana Souza sees your reply there.
CEL-94 was Done: Ana Souza's comment reopened it and gave it back to you. It's in In Progress and claimed by this session again; when the work is done, hand it in with `cello task submit CEL-94`.
```

Treat it as your task again: set its stage, do the work, answer on the card, and submit a new packet. On a task that stayed where it was (you released it while it was In Progress), the line says the comment gave it back to you instead. The task goes to the last agent session that held its claim, never to a subagent (they share your session) and never to the human. A task no agent ever claimed, an archived task and a task someone holds aren't reopened, agents' comments never reopen anything, and a Send back works as before.

**So does word that the human ended your claim.** When a change the human makes to a task you hold ends your claim (they move the card to another status, edit it, change its labels, archive it, claim it themselves or release your claim), your session gets one notice, the same way as a comment: the hooks, `cello inbox`, `cello inbox --wait`, and listed (not taken) by `cello context`. It says what they did and where the card is now. Stop working on the task when it arrives; if you think the work should go on, say so on the card and let them decide. Your own changes and your subagents' never send one, and neither does their approval (the work is done) or their reordering your card within its column (your claim stays). When they move a card out of Needs input, the withdrawn ask is the notice (see Questions for the human), not a second one:

```
Ana Souza ended your claim on a task in Cello:

CEL-40  Board filters
  Ana Souza ended your claim, 1m ago
    Ana Souza moved CEL-40 to Todo: your claim ended. Stop working on it.

Stop working on CEL-40: your claim on it ended. See where it stands with `cello task get CEL-40`. If you think the work should go on, say so on the card (`cello task comment CEL-40 "…"`) and leave the decision to Ana Souza.
```

**With the hooks (the usual way),** they arrive by themselves:

```bash
cello install claude            # this project, this machine: .claude/settings.local.json (git-ignored)
cello install claude --user     # every project on this machine: ~/.claude/settings.json
cello install claude --shared   # .claude/settings.json, committed: everyone who clones the repo gets them
cello uninstall claude          # takes them out of all three
```

- **Once per project** (or once with `--user`). From inside a worktree it writes the main checkout's settings.
- **It merges** with the hooks already there, and running it again changes nothing. The old file is kept as `<file>.bak`.
- **The same command installs the Claude Code plugin** in the same settings file (see "The Claude Code plugin" below), and allows `cello` commands there (`Bash(cello:*)`, see "`cello` commands skip Claude Code's permission check"); `cello uninstall claude` takes both out with the hooks.
- **What runs:** Claude Code runs `cello hook claude stop` when you finish a turn, and `cello hook claude post-tool-use` after each tool call. New comments come in as context. If you were about to stop, they keep you going: the transcript shows them as "Stop hook feedback". With nothing new, a stop while you hold a claim and nothing waits for you asks you once to start `cello inbox --wait` (below).
- **A third hook, the guards:** `cello hook claude pre-tool-use` runs before each call to Claude Code's `Artifact`, `AskUserQuestion`, `Edit`, `Write` and `NotebookEdit` tools. It turns artifact publishes away (see "Showing things to the human"), `AskUserQuestion` where nobody watches the window: an orchestrating session, a subagent, a woken run (see "Never in Claude's own question window" under Questions for the human), and edits in the repo from a session that hasn't claimed a task (see "Edits need a claimed task"). It goes into the project's settings (`.claude/settings.local.json`, or `.claude/settings.json` with `--shared`), never into `~/.claude/settings.json` with `--user`, since not every project is a Cello project. Running `cello install claude` again in a project set up before a guard existed adds it (it replaces the older install's matcher).
- **Two more, for subagents:** `cello hook claude subagent-start` and `cello hook claude subagent-stop` run when a subagent starts and finishes (see Subagents). The start hook only goes into the project's settings, like the guards; the stop hook goes everywhere. Running `cello install claude` again in a project set up before them adds them.
- **Test runs follow Bash:** the same `pre-tool-use` hook also runs before each `Bash` call, and `cello hook claude post-tool-use-failure` after one that failed, so the board can show a test run (see "The board shows your test runs"). For any other command it does nothing and doesn't ask the server. Both go into the project's settings only.
- **`cello` must be on the PATH** Claude Code starts with (`~/.local/bin`). When the server is down, the hook stays silent and your session carries on.

**Without the hooks:**

```bash
cello context            # lists new comments and leaves them new
cello inbox              # hands them over and marks them read, then lists what came earlier
cello inbox --new        # only new ones; prints nothing when there are none
cello inbox --wait       # blocks until a new one arrives, then hands it over (below)
cello inbox --json
```

**Each comment arrives once.** Whichever gets it first (the Stop hook, the PostToolUse hook, `cello inbox` or `cello inbox --wait`) marks it read, so it never comes a second time, even when parallel tool calls run the hook at the same moment. `cello context` only shows them.

**The human sees each comment's receipt**, like a messenger's ticks, under their comment on the card:

- **Sent** while it waits in your inbox.
- **✓ Delivered to 2fd0505c · 12s** once your session takes it (the hook, `cello inbox` or `--wait`). Showing it with `cello context` doesn't count.
- **✓✓ Answered** once your session, or one of its subagents, comments on the task after it or reacts to it. So answer on the card, even with just a 👍.
- **Not delivered** when no session held the claim as they wrote it, and no agent had ever held it either (otherwise the comment reopened the task for the last one, above).

Under their latest comment, until you answer it, a status row in the thread (with your agent mark, like a chat's typing indicator) tells them where it stands:

- you're working and haven't taken it yet: "2fd0505c gets this at its next step"
- a `cello inbox --wait` of yours is running: "2fd0505c is waiting for you: it gets this in about a second"
- you're idle with no waiter: "2fd0505c is idle: it gets this when it next works"
- your session has ended: "2fd0505c ended: it gets this if the session is resumed"
- you took it and are working: "2fd0505c got your comment and is working on it…", with your mark thinking (it sways). Taking it through `cello inbox --wait` counts as waking up: the row says this from that moment, not from your next check-in
- nobody holds the claim and no agent ever did: "No agent holds this task: nobody will get this"

The row goes away once you answer (a comment or a reaction after taking it), so a comment you took and then left unanswered keeps saying "got your comment but hasn't answered yet" once you go idle or start waiting again.

That's another reason to keep `cello inbox --wait` running when you end a turn holding a claim. What arrives looks like this:

```
New Cello comment on a task you claimed:

CEL-22  Review page: collapsed rows, one packet open at a time
  Ana Souza sent it back, 2m ago
    The next row doesn't open by itself after Approve.

Act on it now, then answer on the card: `cello task comment CEL-22 "…"` (or `--body-file -` for markdown), so Ana Souza sees your reply there.
For a task Ana Souza sent back, fix what the note asks, then hand it in again with `cello task submit CEL-22`.
```

**Screenshots come as files.** When the human pastes screenshots into a comment or a Send back note, the hook, `cello inbox` and `cello context` save each one to a temp file and print its path under the text, so you can open it (Claude Code's Read tool shows images):

```
CEL-22  Review page: collapsed rows, one packet open at a time
  Ana Souza commented, just now
    The rows overlap here:
    Screenshot: /var/folders/…/T/cello-comments/01JD…/1.png

Act on it now (its screenshots are files you can open), then answer on the card: `cello task comment CEL-22 "…"` (or `--body-file -` for markdown), so Ana Souza sees your reply there.
```

One that can't be fetched (the server stopped in between) shows the path the server serves it at instead (`Screenshot: /attachments/<id>`).

**The human's reactions come the same way.** When they react to a comment your session wrote (a 👍 under "Shall I merge it?"), it reaches your session once, through the hooks, `cello inbox` or `cello inbox --wait`, even if you no longer hold the task's claim. Once your session has ended it goes to whoever holds the claim instead, and to no one when nobody does. If they take the reaction back before it reaches you, it never arrives. It quotes the start of your comment:

```
Ana Souza reacted to your comment in Cello:

CEL-22  Review page: collapsed rows, one packet open at a time
  Ana Souza reacted 👍 to your comment, 1m ago
    "Built the collapsed rows. Shall I merge it now, or wait for the Review page tests?"

A reaction is Ana Souza's quick answer to your comment: take it as their reply; there's no need to answer it on the card.
```

**When you end a turn while holding a claimed task, start `cello inbox --wait` in the background so the human's comments wake you.** The hooks only fire while you work: after a tool call, or when you stop. Once your turn has ended and the session sits waiting for its human, nothing fires, and a comment the human leaves then stays unread until someone types to you. `cello inbox --wait` closes that gap:

```bash
cello inbox --wait          # in Claude Code: the Bash tool with run_in_background: true
cello inbox --wait --json   # the same as JSON: items, claimed
```

- **It blocks until something new arrives for your session** (a comment, a Send back note, answers to your ask, an ask withdrawn, a reaction, word that the human ended your claim), then takes it the way `cello inbox --new` does (marked read, each item once) and prints it. Run in the background, its end wakes you with the text, as if the hook had delivered it. It returns at once when something is already waiting.
- **It doesn't poll the board:** it listens on the server's event stream. When the server restarts (every deploy does), it says so on stderr, "The Cello server on port 4747 went away; reconnecting for up to 2 minutes…", reconnects and carries on; nothing is taken twice. If the server stays away for 2 minutes, it exits 1 with "The Cello server on port 4747 went away and didn't come back within 2 minutes, so this stopped waiting." Start it (`cello start`) and run `--wait` again. `cello wait` and `cello task ask --wait` ride out a restart the same way (Questions for the human).
- **One per session.** While it waits it holds a lock file (`$TMPDIR/cello-inbox-wait/<hash of port and session>`, holding its pid and when it started) and says so on stderr: `Waiting for new comments, Send back notes, answers and ended claims for this session (pid 4242)…`. A second `cello inbox --wait` for the same session leaves at once, saying on stderr ``Already waiting: a `cello inbox --wait` (pid 4242) is running for this session, and it wakes you when something new arrives.`` (with `--json`: `{"waiting": true, "pid": 4242}`). The lock goes when it ends, however it ends.
- **It never outlives your session.** It stops, taking nothing, once the Claude Code that started it is gone (it checks `CLAUDE_PID` every second), and after a day with nothing new it stops and says so: "Nothing new for this session in 24 hours, so `cello inbox --wait` stopped. If you still hold a claim, start it again in the background." A lock whose pid is dead, or that's older than a day (its pid may belong to another process by then), is ignored.
- **It shares nicely:** the hooks and `cello inbox` take from the same inbox, so whichever gets an item first hands it over and the others never see it. Answers a `cello task ask --wait` (or `cello wait`) is waiting for stay with that command; if a server restart lets the hook take them first, that command says they already arrived instead of printing them again.
- **Start it again after it wakes you,** when you end that turn too: it hands over one batch and exits.

**The Stop hook asks for it.** When you stop with nothing new, while you hold a claimed task and no waiter is running for your session, the Stop hook keeps you going once with:

```
Cello: you hold a claim on CEL-22, and nothing is waiting for Ana Souza's comments, so once this turn ends Ana Souza can't reach you. Start `cello inbox --wait` in the background now (the Bash tool with run_in_background: true), then end your turn. It wakes you when Ana Souza comments, sends a task back or answers your questions.
```

- **"A waiter is running"** means one of Claude Code's background shells runs `cello inbox --wait` (the hook reads the list Claude Code sends it), or, when Claude Code sends no list, the session's lock is held by a live process. When the list is there and has no waiter, a lock doesn't count: it belongs to a waiter that outlived its session.
- **When the stop hands comments over,** the same advice comes as a last line under them, since the stop you make after acting on them won't be nudged: "When you end this turn, start `cello inbox --wait` in the background first (the Bash tool with run_in_background: true), so Ana Souza's next comment wakes you."
- **It never loops:** the stop you make right after a nudge goes through whatever you did, and so does any stop it can't judge (no server, a lock it can't read, past its 2-second deadline).

**Answer on the card.** Act on the comment, then reply with `cello task comment CEL-22 "…"` (`--body-file -` for markdown), so the conversation stays with the task and the human sees it there.

**When a task is sent back,** it's in In Progress again and still yours. The note arrives the same way, marked "sent it back" (`cello task get` also shows it under Reviews). Fix what it asks, test, then hand the task in again with `cello task submit CEL-22` and new evidence.

**Subagents share your session.** A subagent's `CLAUDE_CODE_SESSION_ID` is its parent's. Inside a subagent the hook hands nothing over, so comments reach the main conversation; it only checks the subagent in, under your session, so the board shows who is working on your task while it runs. Don't run `cello inbox` (or `cello inbox --wait`) from a subagent: it would take the parent's comments. `cello context` is safe anywhere, since it takes nothing.


### When the session is closed

Closing the terminal (or the Claude Code thread) ends the session. Nothing is lost; delivery pauses:

1. **The waiter stops with it.** `cello inbox --wait` exits within a second once its Claude Code is gone, taking nothing.
2. **The human's comments wait in that session's inbox.** On the card, the status row under their latest comment says the session ended and gets it if resumed, and the presence turns grey "ended" within about 30 seconds.
3. **Resuming the session** (`claude --resume`, or reopening the thread) hands everything over at its first hook: its first tool call, or its first stop.
4. **A new session that claims the task instead** doesn't receive what was sent to the old one; it reads it in the task's history (`cello task get CEL-12` shows every comment). New comments from then on go to the new session, and once it lets go, a comment reopens the task for it, not for the old one: the task goes to the last session that held it.

### When your process is gone, Cello can wake you

A session doesn't die with its process: Claude Code keeps the conversation on disk. When the human comments on a task you claimed (or on one you worked on before, which their comment reopens for you), answers your ask, sends it back or reacts to your comment, and nothing of your session is running, Cello can continue your conversation itself, headless, in the folder you started Claude Code in (where it keeps the conversation). That's a **woken run**. It's off until the human turns it on for the project (Settings → the project → "Wake agent sessions when you comment").

What happens:

1. The human comments on CEL-12, which you claimed. Your `cello inbox --wait` isn't running, your Claude process has exited, and you haven't checked in for 2 minutes.
2. Cello waits 30 seconds (each new comment restarts the wait, so three quick comments make one wake), then runs, in your repo folder:

   ```bash
   claude -p --resume <your session id> --permission-mode <your mode> \
     --output-format stream-json --verbose --max-turns 40 -- \
     "Ana Souza acted on CEL-12, which you claimed: run `cello inbox` and act on it, then answer on the card. Cello woke this session because its process had ended."
   ```

3. You're the same session, with your claim and your memory of the task. Run `cello inbox` as the prompt says, act on what it hands you, and answer on the card with `cello task comment`. Then end your turn: the run exits and the claim stays. The next comment wakes you again.

How a woken run differs from a normal turn:

- **You run with a clean environment:** Cello leaves out `CELLO_SESSION`, `CELLO_AGENT` and every other Claude Code session's variables, so your `cello` commands are yours.
- **`CELLO_WOKEN=1` is in your environment.** The Stop hook then never asks you to start `cello inbox --wait`: a waiter would keep the run alive for nothing, and Cello wakes you again when the human next acts. Don't start one yourself.
- **Nobody is watching.** You run in the permission mode your session last had (Cello's hooks record it on every event), never `bypassPermissions`. A tool the mode doesn't allow is refused; say on the card what you couldn't do ("couldn't run `bun install`: not allowed in this mode") so the human can answer or open the chat.
- **One turn, at most 40 agentic steps.** Do what the comment asks, answer, and stop. Big follow-up work waits for the human.
- **Your output is logged** to `<data folder>/runs/<session>/<time>.jsonl` (the newest 20 per session; backups leave them out). The card links it, with a Stop button while the run goes.

Cello doesn't wake a session when its `cello inbox --wait` is running (it hears the comment by itself), when its process is still open (two processes on one conversation would corrupt it; the comment arrives with its next hook), when it checked in less than 2 minutes ago, when waking is off for the project, past the cap (3 wakes per task per hour unless the human changes it), when it ran with `bypassPermissions` (or a mode Claude Code doesn't have), when its folder isn't a folder on this machine, or when its conversation isn't there. A batched wake for several of your tasks counts toward each one's cap. The card then says why, and the comment waits in the inbox as before.

An orchestrator (or the human) can wake a session now, with the same checks, and list its runs:

```bash
cello sessions wake CEL-12      # the session holding CEL-12's claim
cello sessions wake c14ca1fa    # a session, by the start of its id
# Woke session c14ca1fa (mode auto). It runs `cello inbox`, acts, answers on the card, then exits.
# Log: /Users/ana/.cello/runs/c14ca1fa-…/2026-11-16T15-58-12-123Z.jsonl
cello sessions runs c14ca1fa
# Woken runs of session c14ca1fa, newest first:
#   2026-11-16 15:58  a comment  auto  completed in 1 min
#     /Users/ana/.cello/runs/c14ca1fa-…/2026-11-16T15-58-12-123Z.jsonl
```

Never wake your own session: you're already running.

## Subagents

When you run builders and reviewers with Claude Code's Agent tool, they all carry your `CLAUDE_CODE_SESSION_ID`. Cello still tells them apart: each is a **subagent** of your session, named by its type and the first 8 characters of its id ("cello-builder · a13bfb89", "general-purpose · add98dec"). The card it works on says "cello-builder · a13bfb89 active now", with your session in the hover and in the task panel; its comments and changes name it; and "Agents working" in the sidebar counts each working subagent and opens the Agents page, which lists them under your session, each with its task.

**How Cello learns about them (with the hooks installed):**

- **The launch names the task.** When the Agent tool returns, the PostToolUse hook in your conversation tells Cello the subagent's id and type, and the task the launch's **description** (else its prompt) names: of the keys there that are real tasks, the one your session has claimed, else the first. A foreground subagent's launch arrives after it finished; it links the task and leaves the subagent finished. So put the task key first in the description: `"CEL-55 which agent is on each card"`. A launch that names no task leaves the subagent under your session with no task.
- **Its tool calls check it in.** Every tool call inside the subagent runs the PostToolUse hook, which checks it in as itself, under your session.
- **SubagentStart hands it its name.** A subagent's shell can't see its own id, so `cello hook claude subagent-start` tells it, as context: "give every `cello` command you run `--agent cello-builder/a13bfb89`".
- **SubagentStop marks it finished,** so it leaves "Agents working" for "Finished today" at the bottom of the Agents page (and `cello agents --all`), where its log still opens while Claude Code keeps the transcript. A resumed subagent comes back: its next hook (a SubagentStart, or any tool call) has it working again, and the board hears it at once.
- **Unless work it waits for is still running.** A subagent that ends its turn while a test command it started with `run_in_background` (a Docker e2e run, say) or a Monitor is still going isn't done: Claude Code resumes it when that work ends. Only those two count: other background work, like a dev server it left running (`bun run dev`), may never end, so it would never finish. The PostToolUse hook remembers each piece of background work a subagent starts, and SubagentStop compares it with Claude Code's `background_tasks`. While some of it runs, the subagent is **waiting on background work**, not finished: the Agents page keeps it under Working with what it waits on ("Waiting on background work · Bash · bun run test:e2e -- e2e/agents-page.spec.ts"), and `cello task get` says "waiting on its background work (…)". The stop after that work ended finishes it. Nothing to do for this beyond `cello install claude`; background work your conversation or another subagent started doesn't count.

**Inside a subagent,** give each `cello` command the `--agent` you were given, right after `cello`, so the board credits it to you rather than to the main conversation:

```bash
cello --agent cello-code-reviewer/b77d0e11aa22bb33 task comment CEL-55 "Review: two findings, see below"
cello --agent cello-code-reviewer/b77d0e11aa22bb33 whoami     # "x-cello-agent" and the server's "agent" say who you are
```

**Why a flag and not `CELLO_AGENT=… cello …`:** the `CELLO_AGENT` variable does the same thing and still works, but a command with a variable in front doesn't start with `cello`, so Claude Code's allow rule `Bash(cello:*)` doesn't match it and the command goes through the permission check (see "`cello` commands skip Claude Code's permission check"). Given both, `--agent` wins.

A command without it is credited to the session, as before. So a subagent's comments and changes are credited to it **only where `subagent-start` is installed** (a project's settings: `cello install claude` or `--shared`, not `--user`) **and only when the subagent follows that instruction**: it's context the model reads, not something Cello enforces. Its presence and the task it was launched on don't depend on either: the PostToolUse hook reports them. Nothing else changes: **claims and the human's comments stay with the session.** A subagent's claim is the session's claim, the main conversation keeps holding it, and comments are delivered there (never `cello inbox` from a subagent).

### The board shows your test runs

Long test runs used to look like nothing was happening. With the hooks installed, the board says when you run tests and how far they are:

- **A test command marks you Running tests.** When a Bash call of yours runs tests (`bun run test`, `bun run test:e2e`, `bun run test:docker*`, `scripts/test-in-docker.ts`, which are also Cello's testing profile commands, and elsewhere `vitest`, `playwright test`, `jest`, `pytest`, `npm test`, `cargo test`, `go test`), the PreToolUse hook says a run started. It ends with the call (passed, or failed when the command failed), or, run with `run_in_background`, when the runner's last report arrives or a stop no longer lists it among Claude Code's `background_tasks`. A command that only mentions one (`grep 'bun run test'`, `echo`) doesn't count.
- **The Docker runner reports where it is.** `scripts/test-in-docker.ts` writes `progress.json` in its run folder as the output streams (the stage, tests passed and failed of the total, the spec it's on, each failure by spec and title), and runs `cello test progress --file <run folder>/progress.json` as it goes when an agent session runs it: at once for a failure, else at most every 3 seconds, and once at the end. It never waits on it: without `cello` or a server, the tests run as before.
- **Where it shows:** the Agents page row ("Running tests · web e2e 7 of 13 · 1 failed · 3m12s", with a bar; the open row lists each failure and, once done, the run's `summary.txt`), the card's stage line ("🔨 Building · 7/13 · 1 failed", the whole run in its hover) and the task panel's ("🔨 Building · running web e2e 7/13"), `cello agents` and `cello task get` ("running tests (web e2e 7 of 13 · 3m12s)").
- **Which run a report is for:** the runner's shell carries your session but not which subagent you are, so a report goes to the session's (or one of its subagents') running run started from the runner's folder exactly, else from the deepest folder holding it or inside it (the orchestrator at the repo root and a builder in a worktree inside it each get their own), else the newest such run, else the session's only running run. A report nobody's run takes changes nothing. An agent can have more than one run going: a unit run started while its background Docker run goes on never replaces it; the board shows the newest running one.

Nothing to do for this beyond `cello install claude` (run it again in a project set up before CEL-134: it adds Bash to the PreToolUse hook and a PostToolUseFailure hook). You don't run `cello test progress` yourself; another test runner can call it the same way:

```bash
cello test progress --file test-results/docker/latest/progress.json   # "Reported.", or "No test run of this session is running here, so nothing took it."
```

### The human can follow your log

The Agents page opens each agent's **live log**: what it says, each tool it calls with the result (✓ or ✗ and how long it took), the subagents it launches, and, behind a "Thinking" switch, its thinking. Cello reads it from Claude Code's own transcript on this machine; agents don't report anything new for it, and nothing of it is stored in Cello.

- **The hooks say where the transcript is.** Every hook run passes on Claude Code's `transcript_path`: in your conversation, your session's file (`~/.claude/projects/<repo>/<session>.jsonl`); inside a subagent, the subagent's own file next to it (`<session>/subagents/agent-<id>.jsonl`). SubagentStart, SubagentStop and the Agent tool's launch report the subagent's file too, so its log opens before its first tool call.
- **After each tool call, the step in one line** ("Bash · bun run test", "Edit · FacetPanel.tsx") is the agent's current step on the Agents page.
- **Only those files, only there.** The server reads a transcript only when a hook reported that exact path and it's a `.jsonl` inside Claude Code's `projects/` folder (`$CLAUDE_CONFIG_DIR/projects`, else `~/.claude/projects`), symlinks resolved. A log Claude Code has cleaned up shows "no longer on disk".
- **Keys and tokens are masked** (`sk-…`, `ghp_…`, `AKIA…`, `API_TOKEN=…`, `password=…`, `--token …`, `Bearer …`, the password in `https://user:password@host`, long random strings) before the log or the current step leaves the server; the human can ask to see them. Still: don't print secrets you don't need.
- **A run Cello woke** (see "When your process is gone, Cello can wake you") also shows its run log there.

Nothing to do for this beyond `cello install claude`; without the hooks, the Agents page lists you but has no log. For example, the human sees a builder's log as:

```
Prompt  Build the pancake timer, CLO-7. Read AGENTS.md first.
Said    Starting with a failing test for the timer.
✓ Read · timer.ts                       0.3 s
✗ Bash · bun run test                   2.5 s
✓ Agent · cello-code-reviewer: CLO-7    (opens that subagent's row)
```

**What `cello task get` shows:** the subagents launched on the task, and who did what, with the model and effort that did it (see "Which model wrote it" below).

```
Subagents on it (1)
  cello-builder · a13bfb89 (Sonnet 5.5, medium; under Claude Code session 2fd0505c): working, seen 1m ago

Comments (2)
  Claude Code session 2fd0505c (Opus 5.5, high) · 5m ago
    Plan: a timer that flips at 90 s
  cello-builder · a13bfb89 (Sonnet 5.5, medium; under Claude Code session 2fd0505c) · just now
    Built; tests pass
```

### Which model wrote it

Every comment, history line and Agents page row an agent writes says whether it came from the **main session** (your conversation, which may run subagents) or a **subagent** of it, and the **model and effort** that wrote it: on the board "Claude Code · Main session · Opus 5.5 · high · 2fd0505c", "cello-builder · Subagent of 2fd0505c · Sonnet 5.5 · medium"; in the CLI "Claude Code session 2fd0505c (Opus 5.5, high)", "cello-builder · a13bfb89 (Sonnet 5.5, medium; under Claude Code session 2fd0505c)".

- **Nothing to report.** Claude Code writes the model and effort of each reply to its transcript. As each `cello` command reaches the server, it reads the end of *your* transcript, the one the hooks reported (the session's, or with `--agent` the subagent's own), and takes the newest reply's. So a subagent is credited with its own model, not its parent's, as long as it gives `--agent`.
- **Kept with what you wrote.** A comment and a history line keep the model they were written with. After `/model`, your next comments show the new one; older ones keep theirs.
- **Unknown stays unknown.** Without the hooks (no transcript), before your first reply, for agents that aren't Claude Code, and for anything written before this existed, only the role shows: no model is guessed.
- **`cello agents`** shows the model each agent is on now, after its id.

### Checking on your builders from the terminal

An orchestrator doesn't need the Agents page to see what its builders are doing: `cello agents` lists the agents working in the project's workspace, and `cello agents log <id>` prints one's log, the same steps the page shows, as plain text.

```bash
cello agents
# Agents working (3):
#   Claude Code session 2fd0505c (Opus 5.5, high)  orchestrator  active now    holds CEL-7  Agent · cello-builder: CEL-7 pancake timer
#     cello-builder/a13bfb89 (Sonnet 5.5, medium)                active now    on CEL-7     Bash · bun run test
#     cello-code-reviewer/b77d0e11 (Sonnet 5.5, medium)          seen 12m ago  on CEL-6
#
# 1 agent finished today: `cello agents --all` lists them.
# `cello agents log <id>` prints one's log: a session's short id (2fd0505c) or a subagent's (cello-builder/a13bfb89).

cello agents log cello-builder/a13bfb89
# 09:00:00  Prompt  Build CEL-7, test first.
# 09:00:01  Said    Reading AGENTS.md first.
# 09:00:02  ✗ Bash · bun run test  2.0 s
#             FAIL src/timer.test.ts
#               flips after 90 seconds
#                 at step 1
#             … 2 more lines (--full shows them)
```

- **Which agent:** a session by the start of its id (`2fd0505c`), a subagent by the start of its id with its type in front or not (`cello-builder/a13bfb89`, or `a13bfb89`), as `cello agents` prints them. An id that starts more than one says which, so you can give more of it. `--all` adds the agents that finished today; their logs still print while Claude Code keeps the transcript.
- **What each line is:** the time, then `Prompt` (what the agent was told), `Said` (what it wrote), or a tool call with ✓ (it worked), ✗ (it failed) or ▸ (still running) and how long it took. A result shows its first 3 lines; `--full` prints it whole. A subagent the agent launched shows its id after `→`. Thinking is left out unless you pass `--thinking`.
- **`--follow` (or `-f`)** keeps printing steps as they're written, until Ctrl-C: a running call prints when it starts and again with its result when it ends. It rides out a server restart the way `cello inbox --wait` does: it says on stderr that the server went away, reconnects for up to 2 minutes, and carries on without printing a step twice. A log that isn't on disk yet (a subagent that just started) says so on stderr and prints once Claude Code writes it.
- **Keys and tokens stay masked** for agents. `--show-secrets` shows them only when the human runs it.
- **`--json`** prints the steps as JSON (`{ steps, skipped, older }`); with `--follow`, each update the server sends, one JSON line at a time (a step sent again replaces the one with its `id`).
- **When there's no log,** it says why and exits 1: the agent's hooks never said where its transcript is (`cello install claude` adds them), Claude Code cleaned the file up, or it's outside Claude Code's projects folder.

## The Claude Code plugin

`cello install claude` (and `cello init --hooks`) also installs a Claude Code plugin called `cello`. It teaches Claude Code how to work with the board, so a session doesn't have to work it out from this page each time. New sessions get:

| What | How you use it | What it does |
| --- | --- | --- |
| `/cello:orchestrate [task keys, or a goal]` | You type it at the start of a thread; `/cello:orchestrate off` to stop | Makes this thread the **orchestrator**: it puts the session in orchestrate mode (`cello sessions orchestrate on`, so Claude's question dialog is turned away and questions go on the card; `off` gives it back), claims the tasks (or creates them from a goal), then runs each one through a builder agent in its own worktree, a fresh reviewer, fixes, merge and `cello task submit`, marking each step with `cello task stage`. It doesn't write the feature code itself. |
| `/cello:work <task key, or what to do>` | You type it | Does one task in this thread: find or create it, claim, mark it `planning` when it needs a decision first, `building` once the code starts, test first, comment progress, submit with evidence. |
| The `cello` skill | Claude loads it by itself in a repo tracked in Cello | The core rules in a few lines (a task before work, claim, ask on the card, submit), and a pointer to `cello guide`. |
| `cello:builder` and `cello:reviewer` agents | The orchestrator starts them | A builder that works test first in its own worktree and never pushes or touches the live board; a read-only reviewer that judges the diff against the task text and gives a verdict. When the repo has its own agents in `.claude/agents/` (named like `*-builder`, `*-reviewer`), the orchestrator uses those instead. |

```
$ cello install claude
Installed Cello's Claude Code hooks in /Users/lnmunhoz/projects/app/.claude/settings.local.json (this machine only):
  …
Enabled Cello's Claude Code plugin in /Users/lnmunhoz/projects/app/.claude/settings.local.json; its files are in /Users/lnmunhoz/.local/share/cello/claude-plugin.
Allowed `cello` commands in /Users/lnmunhoz/projects/app/.claude/settings.local.json ("Bash(cello:*)" in permissions.allow), so …
…
The plugin gives new sessions /cello:orchestrate (run tasks through builder and reviewer agents), /cello:work (do one task in this thread) and the cello skill.
New Claude Code sessions pick them up.
```

What `/cello:orchestrate` does, per task:

```mermaid
flowchart TD
    A["Claim<br/>cello task claim"] --> B["Build: cello task stage KEY building<br/>a builder agent in its own worktree"]
    B --> C["Review: stage review<br/>a fresh reviewer gets the diff and the task text"]
    C -->|findings| D["Fix: stage fixing<br/>back to the same builder"]
    D --> C
    C -->|clean| E["Merge: stage merged<br/>whole test suite"]
    E --> F(["Submit right away<br/>cello task submit: In Review"])
```

- **Where the files go.** The plugin's files are written to `$XDG_DATA_HOME/cello/claude-plugin` (by default `~/.local/share/cello/claude-plugin`), a folder of Cello's own, never inside the repo or `~/.cello`. Every install rewrites what changed there, so updating `cello` and running `cello install claude` again updates the plugin. Cello only ever removes files it wrote there itself, and refuses to write through a symlinked folder inside it.
- **Don't edit the plugin's files there:** the next install puts Cello's text back. Put your own commands in the project's `.claude/commands/` (or skills in `.claude/skills/`) instead.
- **How it's enabled.** Two entries in the same settings file as the hooks: `extraKnownMarketplaces.cello` (that folder, as a local marketplace) and `enabledPlugins["cello@cello"]: true`. Claude Code loads the plugin straight from the folder when a session starts, with no prompt, as long as you've trusted the project folder (as you have for the hooks).
- **Per project by default,** like the hooks, since not every project uses Cello. `--user` enables it for every project on this machine.
- **`--shared`** enables it in the committed `.claude/settings.json`, but the marketplace is a folder on your machine, so it's declared in your `.claude/settings.local.json` instead. Others who clone the repo get the plugin once they run `cello install claude` themselves.
- **Running it again changes nothing.** In a project set up before the plugin existed, it adds the plugin and leaves the hooks as they are.
- **A plugin you turned off stays off.** If the settings file says `"cello@cello": false`, install leaves it and says so; set it to `true`, or delete the line, to turn it on.
- **Another marketplace called `cello`** in the settings file (one that isn't Cello's folder) is never replaced: install refuses with a sentence and changes nothing, and uninstall leaves it and the `cello@cello` it enables alone. With `--shared`, both files are checked before either is written.
- **Removing it:** `cello uninstall claude` takes the plugin out of all three settings files with the hooks. The folder stays, since other projects may still enable it; delete it yourself when none do.
- **Check it:** in a new session, typing `/cello:` lists the two commands. From a shell in the project, `claude plugin details cello@cello` shows its commands, skill and agents once a session has started there. `claude plugin list` doesn't list it: that shows only plugins added with `claude plugin install`, which Cello doesn't run because it rewrites the whole settings file.

## Review packets

```bash
cello task submit CEL-22 \
  --summary "The Review page shows one packet at a time: collapsed rows, j/k to move, Enter to open." \
  --step "Open the Review page" \
  --step "Press j twice, then Enter: the third packet opens and the first closes" \
  --step "Approve it: the next packet opens by itself" \
  --attach test-results/docker/latest/web/videos/review-rows.mp4 --caption "Going through the queue with the keyboard" \
  --attach shots/review-dark.png --caption "Dark mode" \
  --link http://127.0.0.1:4747/CEL/pages/review-rows --caption "The report"
```

- **`--summary`** says what changed and why, in markdown. Use `--summary-file -` for a long one from stdin.
- **`--step`** says how the human checks it, one step per flag, in order.
- **`--attach`** takes images, videos (MP4, WebM, MOV) and text files (txt, log, md, json, cast), up to 50 MB each.
  - Paths are relative to your working folder.
  - The server copies each file into `~/.cello/assets`, so you can delete the original afterwards (in a worktree, say).
- **`--link`** adds a URL: a PR, or a page you published.
- **`--caption`** describes the `--attach` or `--link` right before it.
- **Submitting again** while a packet is still open replaces it.
- **A packet waits on the human only while its task is in In Review** (or in Needs input, when you asked from In Review). Approve and Send back close it with their decision. Any other move closes it as **withdrawn**: you or the human moving the task back to In Progress, to Todo or anywhere else, and their answers to an ask you made from In Review, which bring the task back to In Progress. A withdrawn packet leaves the Review page; it stays in the task's list, where `cello task get` shows it:

  ```
  Reviews (1)
    Review (withdrawn 3m ago: Claude Code session 2fd0505c moved it to In Progress), submitted by Claude Code session 2fd0505c, 20m ago
  ```

What to bring, by kind of work (the project's testing profile says how to make it here: `evidence.ui`, `evidence.cli` and the e2e surfaces in `cello context`; if you changed the profile, say which fields in the summary):

- **A flow being validated** (steps, states, systems talking to each other): add a diagram to the summary. A ```mermaid block in `--summary-file` renders as a diagram on the Review page; draw it top to bottom (`flowchart TD`). The human reads the diagram first.

- **UI:** MP4 videos of the flow (the Playwright e2e videos) plus screenshots, in light and dark when it matters. How they're made: `docs/evidence-videos.md` in the Cello repository, also in Cello's Docs tab.
- **CLI or server:** a terminal transcript or a test-output file (`… > vitest.log`), plus steps the human can run themselves.
- **A report you published:** `--link <page url> --caption "The report"`.

## Questions for the human (Needs input)

When you need the human to decide something (which design option, which stages, what wording), ask **on the card**, never in the terminal, and, when nobody watches your window (orchestrating, a subagent, a woken run), never with Claude Code's `AskUserQuestion` (see "Never in Claude's own question window" below; with no open task of yours to ask on, create one). They see your questions next to the evidence, pick options, write what they like and don't, and can paste screenshots to show what they mean. Their answers come back to your session.

```bash
# Anything real: a file with the questions and the evidence, waiting for the answers
cello task ask CEL-35 --file ask.yaml --wait

# One quick question, inline
cello task ask CEL-43 --title "Search layout" \
  --question "Which layout?" \
  --option "Peek: list + preview|Shows the highlighted result's text" --recommend "Peek: list + preview" --because "Most results are long text" \
  --option "Palette: one line per result" \
  --attach shots/peek-dark.png --attach shots/palette-dark.png \
  --link http://127.0.0.1:4747/CEL/pages/cel-43-scope \
  --wait
```

What happens:

1. The task moves to **Needs input** (your claim stays). It shows in the sidebar's Needs input count, first on the human's Review page, and in In Progress with a "Needs input" badge (or its own column, when they turn that on in Display).
2. The human answers each question (a pick, several, or None of these with a comment; words for a text-only one, which they may leave blank) and sends. The task goes back to **In Progress**, still yours. If you asked from In Review, the open packet is withdrawn then: submit a new one when the work is ready again.
3. The answers reach you, once:
   - **with `--wait`:** the command blocks until they send, then prints the answers and exits. Run it in the background (Claude Code: `run_in_background`), so your session wakes when they arrive.
   - **without it:** the hook delivers them like a comment (see Comments from the human reach your session), or `cello wait CEL-43` waits for them later (after a restart, say).
   - **a server restart doesn't stop the wait.** Every deploy restarts the server; `--wait` and `cello wait` say so on stderr ("The Cello server on port 4747 went away; reconnecting for up to 2 minutes…"), reconnect, and keep waiting on the same ask: nothing is asked again, and the answers are still printed once (or that the ask was withdrawn, if it was meanwhile). If the server stays away for 2 minutes they exit 1 with "…didn't come back within 2 minutes, so this stopped waiting. Start it (`cello start`), then run `cello wait CEL-43` again."; the ask is still open, so `cello wait CEL-43` picks it up once the server is back.
   - **answers that already reached you aren't printed again.** If the hook or `cello inbox` took them first (the human answered while the wait was reconnecting), or an earlier `cello wait` printed them, the wait prints one line instead and exits 0:

     ```
     The answers to "Search layout" on CEL-43 already reached this session (through the hook, 2m ago). `cello task answers CEL-43` shows them again.
     ```

     With `--json` it prints the ask as usual, plus `alreadyDelivered: { via, at }` (`via` is `hook`, `inbox` or `wait`; null when the wait handed them over itself). A withdrawn ask is reported as withdrawn either way.
   - `cello task answers CEL-43` prints the latest answers again any time (`--all`: every round); `--json` for scripts.

**The file** (JSON or YAML; paths are relative to it):

```yaml
title: Search layout                 # what the decision is about
intro: |                             # optional markdown, shown above the questions
  Both layouts are built; the screenshots are from the real app.
questions:
  - prompt: Which layout?
    kind: one                        # what you expect: one (the default with options), any, text (no options). They may still pick several
    options:
      - label: "Peek: list + preview"
        description: Shows the highlighted result's text   # one line, optional
        image: shots/peek-dark.png                         # optional: shown on the option, opens large
        recommended: true
        because: Most results are long text                # required with recommended
      - label: "Palette: one line per result"
        image: shots/palette-dark.png
  - prompt: Which extras?
    kind: any
    options: [Filters, Recent searches]
  - prompt: Which empty state should the new page keep?  # text only: no options, and optional
attach:                                                   # screenshots, videos, text files
  - shots/peek-dark.png
  - { path: shots/flow.mp4, caption: Both layouts, side by side }
links:
  - { url: "http://127.0.0.1:4747/CEL/pages/cel-43-scope", caption: The scope }
```

- **Inline flags** in order: `--question` starts a question; the `--kind`, `--option "Label|description"`, `--recommend "Label"` and `--because "why"` after it belong to it. `--attach`, `--caption` and `--link` work as for `submit`; they add to a file's evidence too.
- **Every question with options needs an answer; a text-only one is optional:** the human can send with it blank.
- **Don't add an "Anything else?" question.** The form always ends with its own optional note ("Anything else?"), which reaches you as `Note:`; a question of your own with the same words shows it twice.
- **Recommend at most one option** of a pick-one question, and always say why (`because`). Recommended options come **picked** for the human; they can change them, pick several on any question, or pick **None of these** and say what instead.
- **Up to 20 questions, 9 options each** (they pick with the 1-9 keys).
- **Only the session holding the claim asks or withdraws.** Claim the task first; another session's ask on it is refused, naming the holder, so the answers never reach a session that didn't ask.
- **A closed task (Done or Canceled) takes no asks.** When the human approves your task, your claim ends, and a Done task can't be claimed back. A decision left after that (whether to merge, what to do next) goes on a follow-up task: `cello task create "<the decision>" --status Todo`, claim it, and ask there. Asking on the closed task is refused with that pointer ("CEL-43 is Done: create a follow-up task for this decision …").
- **One ask per task at a time.** Asking again while one is open replaces it (the old one is kept, marked replaced).
- **Withdraw** an ask you no longer need: `cello task ask CEL-43 --withdraw`. The task goes back to In Progress.
- **If the human moves the card themselves** out of Needs input, the ask is withdrawn and your claim ends, as with any move they make. You hear it once, like a comment: "Ana Souza moved CEL-43 to Todo; your ask 'Search layout' was withdrawn." That one notice covers the ended claim too (no second "your claim ended"). `--wait` then says it was withdrawn.
- **Rounds:** after their answers, ask again on the same card for a follow-up; the answered ask stays. The card shows the asks as a thread ("Round 1 · answered", "Round 2 · open"), and `cello task answers CEL-43 --all` prints every round.
- **Scopes** always attach their screenshots and link the scope page.

**What arrives** (by `--wait`, the hook, or `cello inbox`) is each question with what they picked and their comment; screenshots they pasted are saved as files you can open, and their paths printed:

```
Ana Souza answered "Search layout" on CEL-43, just now:

1. Which layout?
   Picked: Peek: list + preview (your recommendation)
   Comment: Yes, but make the preview narrower.
   Screenshot: /var/folders/…/T/cello-answers/01JD…/q1-1.png

2. Which extras?
   Picked: Filters

3. Which empty state should the new page keep?
   Comment: The one from the old page.

Note: Ship it after the e2e passes.

CEL-43 is back in progress: carry on with these answers. Reply on the card with `cello task comment CEL-43 "…"` if something is unclear.
```

A question can come back as "Picked: None of these": no option fitted, and their comment says what they want instead. They may also pick several options on any question, even one you asked as `kind: one`.

### Never in Claude's own question window

**Where nobody watches your window, never ask with Claude Code's `AskUserQuestion` tool.** Its dialog blocks your session until someone answers it: the card only says "idle", and the human's comments queue up behind it. (Nov 16: an orchestrating session asked in its window after an ask on a Done task was refused, and sat blocked for 40 minutes.) Nobody watches when:

- **your session is orchestrating:** `/cello:orchestrate` runs `cello sessions orchestrate on` as its first step (see "Orchestrate mode" below)
- **you're a subagent** (a builder, a reviewer)
- **you're a run Cello woke** by itself (`CELLO_WOKEN=1`, see "When your process is gone, Cello can wake you")

There, every question goes on a card with `cello task ask`:

- **You hold an open task the question belongs to:** ask on it.
- **No open task of yours fits** (yours was approved and is Done, or it's a new decision): create one, claim it, and ask there.

```bash
cello task create "Merge CEL-43's branch now, or wait for CEL-44?" --status Todo
# Created CEL-45  Todo  Merge CEL-43's branch now, or wait for CEL-44?
cello task claim CEL-45
cello task ask CEL-45 --file ask.yaml --wait     # in the background (Claude Code: run_in_background)
```

A session chatting with the human in the terminal isn't any of those: it keeps the dialog for a quick question. Their decisions still belong on the card, as above.

**A hook enforces it.** `cello install claude` puts `AskUserQuestion` in the project's PreToolUse hook. In a subagent or a woken run it's denied at once; otherwise the hook asks the server whether your session is orchestrating, every time (nothing is cached, so `off` counts on the next call). When it's denied you see this reason:

```
This project uses Cello, and nobody is watching this window: this session is orchestrating, is a subagent, or is a run Cello woke. Claude's question dialog would block it until someone answered, so questions for the human go on the card. Ask with `cello task ask KEY-n --file ask.yaml --wait`, run in the background (the Bash tool with run_in_background: true): the task moves to Needs input and the answers come back to you. If no open task you hold fits the question (yours was approved, or it's a new decision), create one: `cello task create "<the decision>" --status Todo`, claim it with `cello task claim KEY-n`, and ask there. If the human is chatting with you in this session and wants the dialog back, they can say "/cello:orchestrate off" (or start Claude Code with CELLO_ALLOW_ASK_USER=1).
```

- Do what it says. Don't retry the tool, and don't put the question in your reply text instead: a question in the reply waits just as invisibly.
- It never stops a question on doubt: when the server is down or slow, or the repo isn't a Cello project, the dialog goes through.
- **`CELLO_ALLOW_ASK_USER=1`** in Claude Code's environment lets `AskUserQuestion` through everywhere. It's the human's switch (`CELLO_ALLOW_ASK_USER=1 claude`). Agents never set it on their own, nor work around the hook any other way.
- `cello uninstall claude` takes it out with the other hooks.

### Orchestrate mode

A session running work through builder and reviewer agents is in **orchestrate mode**. It's a flag on the session, kept on the server:

```bash
cello sessions orchestrate on    # /cello:orchestrate runs this first
# This session is orchestrating (Claude Code session 2fd0505c). Claude's question dialog is turned away here: questions go on the card (`cello task ask`). `cello sessions orchestrate off`, or /cello:orchestrate off, ends it.
cello sessions orchestrate off   # what /cello:orchestrate off runs
# This session stopped orchestrating (Claude Code session 2fd0505c). Claude's question dialog works here again.
```

- **`cello context`** shows it on the You line: `You       Claude Code session 2fd0505c · orchestrating`.
- **Running it again changes nothing.** Each change is one event on the board of the project you ran it in ("started orchestrating", "stopped orchestrating").
- **It stays on** across a resumed conversation, until `off`.
- **When the human asks for the dialog back** in a chat ("/cello:orchestrate off", or in their own words), run `cello sessions orchestrate off`.
- **The human has no session** to put in it: run as them it's refused.
- **Only the main conversation changes it.** A subagent's commands carry its parent's session, so `cello sessions orchestrate` from a builder or reviewer is refused ("orchestrate mode is for the main conversation, not a subagent"): a builder turning it off would leave the orchestrator open to a dialog nobody watches.

## Pages, docs and specs

```bash
cello doc publish report.md --task CEL-13
# Published page "Billing audit" (version 1), linked to CEL-13, with 1 file
# http://127.0.0.1:4747/CEL/pages/billing-audit
# Link in replies (opens in Cello): cello://open?url=http%3A%2F%2F127.0.0.1%3A4747%2FCEL%2Fpages%2Fbilling-audit

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
- **What renders:** `##` and `###` headings become the page's section list. Tables, code blocks, ```` ```mermaid ```` diagrams and images all render. A linked video plays inline, whether it's linked as an image (`![The demo](demo.mp4)`) or a plain link (`[demo.mp4](demo.mp4)`); its link text is its caption.
- **Task keys** (e.g. CEL-12) link to the task, with its live status, so a progress table never goes stale. Keys of unknown tasks, and keys in backticks or code blocks, stay plain.
- **Files go up with the page:** every file the markdown links by a path (relative to the markdown file, or absolute) goes up with it, as an image or a plain link: images, videos (MP4, WebM, MOV) and text files (txt, log, md, csv, json, cast). `--asset` uploads a file the markdown doesn't link.
- **A linked file that can't go up** (it isn't there, or it's a type Cello doesn't store, like a PDF) gets a warning, and the page still publishes. The page shows that link as a missing file instead of following it, so fix the path and publish again:

  ```
  $ cello doc publish scope.md
  Warning: demo.mp4 isn't there (/Users/lnmunhoz/projects/cello/reports/demo.mp4), so the page shows that link as a missing file.
  Published page "Palette scope" (version 1), with 1 file
  http://127.0.0.1:4747/CEL/pages/palette-scope
  Link in replies (opens in Cello): cello://open?url=http%3A%2F%2F127.0.0.1%3A4747%2FCEL%2Fpages%2Fpalette-scope
  ```
- **Two links come back:** the page's address, and its `cello://` link, the one to put in your replies (see Showing things to the human). `--json` has both, as `url` and `link`.
- **Publishing the same file again** updates the page and keeps the old version, and the link never changes.
- **Publish reports, plans and summaries here,** not as Claude artifacts: the human reads them next to the tasks.

## Showing things to the human

**Everything you show the human goes into Cello, never into another tool's page** (a claude.ai artifact, a gist, a pastebin): reports, plans, comparisons, evidence before a packet, video and screenshot galleries. They read them next to the task, and they're backed up with the board.

```bash
cello doc publish evidence.md --task CEL-12 --kind page   # images inline; linked videos and files go up too
cello open evidence                      # opens the page in the board's side panel, and prints its cello:// link
cello open CEL-12                        # focuses the app on a task
cello open --print evidence              # just the link, for your reply; opens nothing
```

`cello open` takes a page's slug (looked up in the working folder's project, or `--project`), a page's address, or a task key in capitals, and prints the link it opened:

```
$ cello open evidence
Opened http://127.0.0.1:4747/CEL/pages/evidence in Cello.
Link in replies (opens in Cello): cello://open?url=http%3A%2F%2F127.0.0.1%3A4747%2FCEL%2Fpages%2Fevidence
```

- **In replies, link pages with the `cello://` link, never the http one.** The human reads your replies in Claude's desktop app, where clicking an http link opens Claude's own built-in browser, outside Cello. A `cello://` link opens the page in Cello's side panel, next to the board. `cello doc publish` and `cello open` both print it, so never build or URL-encode one by hand. Write it as a markdown link with a readable name: `[Billing audit](cello://open?url=http%3A%2F%2F127.0.0.1%3A4747%2FCEL%2Fpages%2Fbilling-audit)`. A task is `cello://CEL-12`.
- **Slugs are lower case,** so `cello open cel-12` looks for a page called cel-12; write a task's key in capitals (`CEL-12`).
- **A slug that isn't a page** fails before anything opens (`No document CEL/evidnce`); `cello doc list` lists them.
- **When nothing can open it** (the desktop app isn't installed), the command fails and still prints the link.
- **`--json`** prints `{ "link", "url", "opened" }` (`url` is null for a task).
- **Where it opens.** A Cello page or doc (`/KEY/pages/<slug>`) opens in the board's own side panel, docked on the right like the task panel, in the page reader, with buttons to expand it to a full page and to close it. So does a text file on the board (a transcript, a test log, `.md`, `.json`, `.csv`: shown as text, with Copy and Download). The app's built-in browser panel is only for outside sites (claude.ai, GitHub, a dev server). In a plain browser tab, Cello pages open in the same side panel. When a task is open in the side panel, the task moves to the main area and the page opens beside it, so neither covers the other; closing the page docks the task again. In a narrow window (under 768 px) there's no room for both, so the page covers the task until it's closed. Whatever the side panel shows is in the board's address (`?viewer=/CEL/pages/notes`), so a reload keeps it (going to another tab or project closes it), and a page or task opened from the side panel gets a Back button (and ⌘[) that returns to what was there before.
- This holds even when your own global instructions say to use artifacts: in a Cello project, the project's rule wins.
- Use their browser only when the desktop app isn't running.

**A hook enforces it.** `cello install claude` (and `cello init --hooks`) adds a PreToolUse hook on Claude Code's `Artifact` tool to the project's settings. When you try to publish an artifact (no `action`, or `action: "publish"`, which covers uploading files and assets and creating one from a type), Claude Code blocks the call and shows you this reason:

```
This project uses Cello. Show it as a Cello page: `cello doc publish page.md --task KEY-n` (images inline, videos with --asset), then open it in Cello's panel with `cello open <slug>`. In your reply, link the page with the cello:// link those commands print, never its http address: an http link opens Claude's own browser, not Cello. Claude artifacts are only for when the human asks for one by name; if they did, tell them this project's Cello hook stopped it (they can allow them by starting Claude Code with CELLO_ALLOW_ARTIFACTS=1).
```

- Do what it says: publish a Cello page, open it in the panel, and link it in your reply with its `cello://` link. Don't retry the artifact.
- Every other action (`read`, `list`, `open`, `delete`, `pin`, `unpin`, `quickstart`) goes through, so you can still read an artifact link someone gives you.
- The hook needs no server, and anything it can't read (broken input, another tool) goes through, so it never gets in the way of other work.
- **`CELLO_ALLOW_ARTIFACTS=1`** in Claude Code's environment lets every artifact call through. It's for when the human explicitly asks for a claude.ai artifact; they set it by starting Claude Code with it (`CELLO_ALLOW_ARTIFACTS=1 claude`). Agents never set it on their own, nor work around the hook any other way.
- `cello uninstall claude` takes it out with the other hooks.

## The background service

On macOS, Cello's server can run as a **background service**: a launchd user agent, `dev.cello.server`, that starts `cello start` when the human logs in and starts it again within 5 seconds whenever it stops. Then the server doesn't depend on the desktop app or a terminal: the human can quit the app and agents' `cello` commands keep working.

```bash
cello service status               # installed? running? pid, program, data folder, port, version, log
cello service install              # write ~/Library/LaunchAgents/dev.cello.server.plist and start it
cello service install --replace    # the same, replacing what's in the way (it says what first)
cello service restart              # a clean stop, and launchd runs the binary again (bun run release does it for Cello)
cello service uninstall            # stop it and remove the plist; data and log stay
```

- **What it runs:** the `cello` binary that ran `install`, by its absolute path with symlinks resolved. Installed from a Cello checkout, that's its build, `apps/cli/dist/cello` (what `~/.local/bin/cello` links to), so rebuilding updates what the service runs on its next restart. It gets `CELLO_DATA_DIR` and `CELLO_PORT` as they were at install (default `~/.cello` and 4747), plus PATH and HOME, since launchd doesn't read a shell profile.
- **Not from a worktree or a temp folder:** `install` refuses a `cello` in a git worktree (`.claude/worktrees/`) or a temp folder, since it can disappear and leave the service with nothing to run. Install with the one you keep (`~/.local/bin/cello`). `--temporary` installs it anyway, for trying a build.
- **Its log:** `<data folder>/logs/server.log`, with the one before it as `server.log.1` once it passes 5 MB (checked at each install and restart). `cello service status` prints its last 10 lines, which is where to look when the service keeps stopping.
- **One server per data folder** still holds. `install` refuses while a server started another way (a terminal's `cello start`, the desktop app) holds the data folder, and names it:

  ```
  Cello is already running for /Users/me/.cello (pid 51234, http://127.0.0.1:4747), outside the service. Stop it first
  (Ctrl-C in its terminal, or quit the desktop app and pick Stop), or run `cello service install --replace` to stop pid
  51234 and install the service in its place.
  ```

  `--replace` stops that pid, and only that one, and only after checking it's a Cello server: its command is a `cello … start`, it is the process listening on the lock's port (when `lsof` is there to tell), and that port answers as Cello. A lock whose pid runs something else (a server that died, its pid since reused) is reported and never touched, and so is one naming pid 0, 1 or a negative pid: delete `server.lock` if no Cello server runs for that folder.
- **One service per user.** Installing again with the same binary, data folder and port is fine: it unloads the running one first. Installing one that runs another binary, data folder or port refuses and names both; `--replace` replaces it.
- **If launchd won't load it,** install puts the old plist back (kept as `dev.cello.server.plist.bak` meanwhile) and loads it again, or removes the new one when there was none. It says whether a server was stopped on the way, and that `cello start` runs Cello meanwhile.
- **A plist pointing at a binary that's gone** (the repo moved, the build was deleted): `status` says so, and `restart` refuses. Build it again, or run `install` again with the cello you want it to run. The desktop app then starts its own server and says in its menu why the service didn't start.
- **Restart is a clean stop:** launchd sends the server SIGTERM (`launchctl kill SIGTERM`; never `kickstart -k`, which can kill it mid-write), KeepAlive starts the program again, and `restart` waits up to 30 s for the new server to answer and prints its pid. A service that isn't running is started instead.

  ```
  $ cello service restart
  Restarted the background service: launchd started `/Users/me/cello/apps/cli/dist/cello start` again (pid 51302), and it answers on http://127.0.0.1:4747.
  ```
- **Deploying with the service installed:** in the Cello repository, `bun run release` does it (it backs up, puts the new `cello` in place, then restarts the service; see `docs/releases.md` there). By hand: `cello backup`, replace the binary, then `cello service restart`. Without the service, restart `cello start` by hand as before.
- **The desktop app** joins the service whenever it's installed and never stops it when it quits. Without the service, the app starts its own server, and the first time the human quits it asks once: **Keep Running** (the server restarts on its own and stays up until the Mac restarts; if it doesn't come up, the app says so and stays open), **Stop Server**, or **Install Background Service**. It remembers Keep or Stop (in `server-on-quit.json` in the app's user data folder; deleting it brings the question back). The app menu says which it is: "Server: background service (pid 44568)" when launchd's job is the server it uses, "Server: started by this app (pid …)" or "Server: started outside the app (pid …)".
- **Agents:** `cello service status` is safe to run any time, to see why Cello isn't answering. `install`, `restart` and `uninstall` change the human's machine: run them only when they ask, or as the orchestrator's deploy step. Tests never run them against the real `~/Library/LaunchAgents` or launchctl: they use a temp HOME and a fake `launchctl` on PATH.

## Backups

The server backs up its data folder every day: the database and every evidence file (videos, screenshots, page images), into `~/.cello/backups/<YYYYMMDD-HHMMSS>/`.

```bash
cello backup                     # take one now: prints the folder, its size, files linked vs copied
cello backup --json              # the same as JSON
cello backup list                # id, when, kind, size and file count, newest first
cello restore 20261115-120000    # only when the human asks, with Cello stopped
```

- **When:** when the server starts, if the newest daily backup is 24 hours old (or there's none), then every 24 hours. Take one by hand before something risky.
- **Small:** files unchanged since the previous backup are hard links to it, so a backup only adds what changed.
- **With or without a server:** `cello backup` and `cello backup list` ask the server on `CELLO_PORT`. When none answers, they work on `CELLO_DATA_DIR` (`~/.cello` by default) directly; `cello backup` then holds the data folder's lock while it copies, as a server would.
- **What's kept:** the newest 14 of each kind, counted apart: **auto** (the daily ones), **manual** (`cello backup`) and **safety** (the copy of the current state that restore takes first). Taking many manual backups never pushes out the daily history or the undo for a restore. Only Cello's own folders (a `YYYYMMDD-HHMMSS` name and a manifest.json) are ever pruned; anything else in `backups/` is left alone.
- **Restore** replaces the database and evidence files with a backup's. Stop Cello first (Ctrl-C where `cello start` runs, or quit the desktop app): it refuses while a server runs. It takes a safety backup of the current state first ("before restoring <id>" in the list), so restoring that one undoes it. **Agents run `cello restore` only when the human asks.**

## Which build is running

Each build of Cello knows the commit it was built from. When the human asks whether their Cello has a change yet, compare that commit with the merge:

```bash
cello --version        # the CLI: 0.2.0 (build c602f25)
cello whoami | jq '.server.build'
# {
#   "version": "0.2.0",
#   "commit": "c602f25",              the commit the server was built from
#   "startedAt": 1763230740000,        when it started
#   "web": { "commit": "c602f25", "builtAt": …, "changes": ["merge: … (CEL-38, CEL-39)", …] }
# }
git merge-base --is-ancestor <merge commit> c602f25 && echo "it's in"
```

- `web` is the web app the server serves; `changes` lists the commit subjects merged since the build before it. The sidebar's footer shows the same line, "Cello 0.2.0 · build c602f25 · live since 18:19", and a click lists those changes.
- After a new build is started, open tabs and the desktop app notice it the next time they reconnect: they show "Cello was updated · Reload" and reload by themselves after a few seconds, unless the human is typing.
- `build dev` means the commit is unknown: a build made outside a git checkout without `CELLO_BUILD_COMMIT`.

### Every build so far

The server records each build the first time it starts on it, so the board keeps a history of every deploy. `cello builds` lists it, newest first; the human sees the same on the **Builds** page (Settings → Builds, or "See all builds →" in the footer's popover).

```bash
cello builds
# #14  build 9afd602  Cello 0.2.0  live since 2026-11-15 18:19, for 2 h 41 min  running
#     merge: needs input on a task (CEL-47)
#     merge: build history, one click from the footer (CEL-50)
# #13  build c602f25  Cello 0.2.0  live since 2026-11-15 12:02, for 6 h 17 min
#     merge: the task panel's layout (CEL-49)
```

- Each build has a number (#1 is the first one this data folder recorded), its commit, when it went live and how long it was live (until the next build went live). `running` marks the one the server runs now.
- Under each build are the commits merged since the build before it: the first-parent subjects, so merges, which name their tasks. Use it to answer "is CEL-47 deployed yet?" or "what did the last deploy bring in?".
- Restarting the same build adds nothing; a rebuild at the same commit is a new build with no changes.
- The changes come from git when the server can read the checkout it was built from; otherwise from the list the web build carries (what changed since the build before it in the same folder).
- A dev server (Vite serving the app) records no builds. `--limit` and `--before` page through a long history; `--json` gives `builds`, `running` and `next`.

## Identity and environment

| Variable | What it does |
| --- | --- |
| `CLAUDE_CODE_SESSION_ID` | Set by Claude Code. Your agent session: your changes are credited to it, your claims belong to it, and the human's comments on them come to it. Subagents get their parent's. |
| `CELLO_AGENT` | Which subagent of the session is calling, as `<type>/<id>` (`cello-builder/a13bfb89`) or just the id. The SubagentStart hook tells each subagent its value. Subagents pass it as `cello --agent <value> …` instead, which does the same and wins over the variable, so the command still starts with `cello` (see Subagents). Your changes and comments are then credited to that subagent, under the session; claims stay with the session. See Subagents. |
| `CLAUDE_PID` | Set by Claude Code. Lets Cello tell whether your session is still alive, so a dead session's claim can be taken over. |
| `CELLO_SESSION` | Overrides the session. An agent that isn't Claude Code sets a stable id for its conversation here. `CELLO_SESSION=me` acts as the human: only when they ask you to. |
| `CELLO_PORT` | The server's port, 4747 by default. Dev servers and tests use other ports. A woken run gets the port of the server that woke it. |
| `CELLO_WOKEN` | Set to `1` by Cello in a run it woke (see "When your process is gone, Cello can wake you"): the Stop hook then never asks for `cello inbox --wait`. |
| `CELLO_PERMISSION_MODE` | Set by Cello's hooks only: the session's permission mode from Claude Code, sent with the hook's calls so a woken run uses the same one. |
| `CELLO_DATA_DIR` | `cello start`'s data folder, `~/.cello` by default. |
| `CELLO_WEB_DIR` | A built web app (`vite build`'s folder) for `cello start` to serve instead of its own. It serves **every file in that folder** to anything that can reach the port, so point it only at a build. Without an `index.html` there, `cello start` says so on stderr and serves its own app. Tests use it to serve two builds. |
| `CELLO_BUILD_COMMIT` | The commit a build records, when it's made outside a git checkout (Docker): a commit hash (7 to 40 lowercase hex characters); anything else is ignored. `vite build`, `bun run build` and `cello` from source otherwise read the checkout's HEAD. |

With no session at all, changes are recorded as the human. When something gets credited to the wrong person, `cello whoami` prints what Cello sees.

Agents never open, copy or change anything in `~/.cello` directly. Everything goes through `cello`.

## When something fails

Every error is one sentence that says what to do next. The usual ones:

| The message says | What it means | What to do |
| --- | --- | --- |
| Cello isn't running on 127.0.0.1:4747 | The human's server is down. | Run `cello service status`: it says whether the background service is installed and shows its log's last lines. Tell the human what it says. Don't start one against `~/.cello` yourself unless they ask. |
| Cello is already running for … (pid …), outside the service | `cello service install` found a server started another way holding the data folder. | Stop that server first, or `cello service install --replace` to stop that pid and install. Only when the human asked for the install. |
| The background service isn't installed | `cello service restart` with no service set up. | `cello service install` sets it up (when the human asks); without it, restart `cello start` by hand. |
| The service's program … doesn't exist any more | The plist points at a `cello` binary that was moved or deleted. | Build it again (`bun run build` in `apps/cli`), or run `cello service install` with the cello it should run. |
| `cello service` runs Cello as a macOS launchd service, and launchctl isn't on the PATH | Not macOS (or a PATH without `/bin`). | Run `cello start` yourself instead. |
| …/server.lock names pid …, which is running but isn't a Cello server | `cello service install` found a lock whose process isn't a Cello server (a server died and its pid was reused). Nothing was stopped. | If no Cello server runs for that folder, delete the `server.lock` it names, then install again. |
| The background service already runs … Installing would replace it with … | An installed service runs another binary, data folder or port. | Only when the human wants it replaced: `cello service install --replace`. |
| … is in a temp folder or a git worktree | `cello service install` from a worktree's or a temp folder's build. | Install with `~/.local/bin/cello`; `--temporary` only to try a build. |
| launchctl couldn't load the service: … | launchd refused the plist. The old one is back in place if there was one. | Do what it says: `cello start` runs Cello meanwhile; `cello service status` and the log say why. |
| The service's server was stopped, but no new one answered on … | `cello service restart` stopped the server and none came back within 30 s. | `cello service status` and the log say why; `cello start` runs Cello meanwhile. Tell the human. |
| The Cello server on port 4747 went away and didn't come back within 2 minutes, so this stopped waiting | A command waiting on the human (`cello inbox --wait`, `cello wait`, `cello task ask --wait`) lost the server, kept reconnecting for 2 minutes, and gave up. A plain restart doesn't cause this: they ride those out. | Tell the human the server is down if it still is; once it's back, run the command the message names again. Nothing was taken or asked twice. |
| Cello on 127.0.0.1:4747 closed the connection before answering | The server stopped or restarted (a deploy) while your command ran. A change it had started still went through. | Look before you redo it: `cello task get CEL-12` shows whether the claim, move, comment or submit landed. A rerun is a new command, so running it blindly can do it twice. |
| CEL-12 is claimed by Claude Code session 1a2b3c4d (active now) | Another live session is working on it. | Pick another task. |
| No task CEL-99 · No status named … · No label named … | A typo, or something that doesn't exist. | The message lists the real names. |
| No label named "bord" (did you mean board?). Nothing was changed. | `cello task label` named a label that doesn't exist; the task wasn't touched. | Use the right name, or make the label with `cello label create` first. |
| There's already a label named "board" · …an archived label named "ui" | Label names are unique in a project, ignoring case, and archived labels keep theirs. | Use the label that's there; `cello label list` shows them all. |
| It was changed by … in the meantime | Someone changed the task while you were acting. | Run the command again. |
| CEL-12 isn't claimed: claim it first | `cello task stage` on a task nobody holds. | `cello task claim CEL-12`, then set the stage. |
| CEL-12 is claimed by another session: only the session holding the claim sets its stage | Someone else holds it. | Leave its stage alone. |
| CEL-12 is in Todo; a stage is only for tasks in In Progress | Stages live inside In Progress. | Claim it (which moves it to In Progress), or leave it. |
| No stage "deploying" | Not one of the stages (`designing` was renamed `planning`). | Use planning, building, review, fixing or merged. |
| A reaction must be one emoji, like 👍 | `cello task react` got text, or several emoji. | Pass one emoji. |
| No comment 01JD… on CEL-12 · Ana Souza hasn't commented on CEL-12 yet | The comment id isn't on that task, or `last` found no comment from the human. | `cello task get CEL-12` shows each comment with its id. |
| CEL-12 needs a review packet before it goes to In Review | You used `move` to hand work over. | Use `cello task submit`. |
| Only Ana Souza can approve a review | Approving and sending back are theirs. | Leave the task in In Review. |
| CEL-12 goes to Needs input only with questions for the human | You used `move` to wait on them. | Ask with `cello task ask` (see Questions for the human). |
| Say why you recommend "…" (because) · question 2 needs options… | The ask's questions can't be answered well as written. | Fix what it says; nothing was asked. |
| CEL-12 has no open ask to withdraw | It was answered, withdrawn or replaced already. | `cello task answers CEL-12` shows what happened. |
| claim CEL-12 first (cello task claim CEL-12): only the session working on a task asks on it | You asked on an open task nobody holds. | Claim it, then ask. Asking on a task another session holds is refused like a claim (it names the holder). |
| CEL-12 is Done: create a follow-up task for this decision (`cello task create "<the decision>" --status Todo`), claim it, and ask there | You asked on a closed task (Done or Canceled). Its claim ended, and it can't be claimed back. | Create a follow-up task with the decision as its title, claim it, and ask there (see "Never in Claude's own question window"). Never fall back to `AskUserQuestion`. |
| Cello didn't wake session c14ca1fa: waking is off for this project | `cello sessions wake` found a reason not to wake it (its process is still open, the cap, waking off…). The card says the same. | Nothing to do from your side; the comment waits in the session's inbox. Waking is the human's setting. |
| This folder isn't in a git repository | The CLI can't work out the project. | Pass `--project KEY`. |
| No project is linked to /path | This repository isn't a Cello project yet. | Set it up: `cello init` (see Set up a repo for Cello), or pass `--project KEY`. |
| The key THAI is taken by ThaiLookup | `cello init --key` named a key another project has. | Pick another key, or leave `--key` out and Cello picks a free one. |
| --key builds won't do: a key can't be BUILDS, the address of Cello's Builds page | The key is a word the board uses for its own pages (BUILDS, SETTINGS, REVIEW, AGENTS, ASSETS, ICONS, ATTACHMENTS, RPC), so the project's board would be hidden. | Pick another key, or leave `--key` out. |
| … is already used by Old Cello (archived), so it can't be linked again | An archived project holds this repo's folder. | Ask the human. |
| Several projects use this folder (A, B) | More than one project was linked to this repo. | Pass `--project KEY`, and tell the human. |
| Ana Souza set unit (`bun run test`), so an agent can't change it | You tried to set or unset a testing-profile field the human set. Nothing in that command was changed. | If it's wrong, ask them on the card with `cello task ask`, and say so in your packet. |
| Unknown field "deploy". Fields: install, unit, … | Not a testing-profile field. | Use one of the names it lists (see The testing profile). |
| Project CEL is set up, but the next step failed: … | `cello init` made or found the project; inspecting the repo, `--hooks` or `--agents-md` then failed. | Fix what the message says, then run the same `cello init` again: it skips what's done. |
| Cello is running for …, and restore only runs while it's stopped | `cello restore` runs only while no server does. Nothing was changed. | The human stops Cello, then runs it again. |
| No backup 20261115-120000 in … | That backup id doesn't exist. | `cello backup list` shows the real ones. |
| The backup failed (…) | The disk is full, or a file in `assets/` can't be read. Nothing was saved. | Tell the human, with the message. |
| The restore of … failed while … | The disk or a file got in the way. The sentence says whether anything changed, the safety backup's id and, if needed, where the data was kept. | Tell the human, with the message. Don't start Cello if it says not to. |

## Command reference

<!-- cli-reference:start -->
Generated from the CLI's own `--help` by `bun run docs:cli`. Don't edit it by hand: change the command's descriptions in `apps/cli/src/cli.ts` and run that.

### cello context

Start here: the project, its statuses, labels and open milestones, new comments for you, your claims and recent activity.

```
cello context [flags]
```

| | |
| --- | --- |
| `--project string` | Project key, instead of the working folder's. |
| `--json` | Print JSON for scripts. |

### cello init

Make the git repository you're in a Cello project: creates it with this repo's path (the main checkout's, from a worktree), named after the folder, with a free key made from the name, and prints its key and board URL. In a repo that's already a project it says which one and changes nothing. Then it inspects the repo (test runner, typecheck, e2e tool, how to start the app, and ffmpeg, Docker and Playwright's browsers on this machine), prints a readiness report per kind of evidence with what to do about what's missing, and writes what it found into the project's testing profile where a field is empty or was detected before, clearing detected values it no longer finds. --hooks and --agents-md do the rest of the setup; each is safe to run again.

```
cello init [flags]
```

| | |
| --- | --- |
| `--name string` | The project's name. Default: the repository's folder name. |
| `--key string` | Its task key: 2 to 10 letters or digits, starting with a letter (THAI gives THAI-1, THAI-2…). Default: one made from the name that no project has. |
| `--workspace string` | The workspace to put it in, by name. Default: the first one. |
| `--hooks` | Also install the Claude Code hooks and plugin for this machine, and allow `cello` commands (Bash(cello:*)), as `cello install claude` does. |
| `--agents-md` | Also add the "Tracking work in Cello" section to this checkout's AGENTS.md (CLAUDE.md when there's no AGENTS.md), or bring the one there up to date. |
| `--replace` | With --agents-md: swap an old "Tracking work in Cello" section that has lines Cello didn't write for Cello's current one (the old file is kept as .bak). Without it, such a section is left as it is. |
| `--skip-detect` | Don't inspect the repo: no testing report, and the testing profile is left as it is. |
| `--json` | Print JSON: created, project, url, testing ({ detection: { stack, packageManager, tools, fields, unresolved ([{ field, why }]: found but not settled, so not written), readiness }, written, kept, cleared (detected fields this run didn't find, so removed) }), profile (the testing profile after it), hooks ({ file, changed, pluginFolder }) and agentsMd ({ file, changed, change: added, updated, replaced, unchanged, customised or foreign, backup, diff }), each null when not asked for or not reached, and error when detection, --hooks or --agents-md failed. |

### cello profile

Show the project's testing profile: how to install, run the unit tests and typecheck, start the app, run each e2e surface and where its videos and screenshots land, and what evidence a review packet needs. Each field says who set it (detected by `cello init`, an agent, or the human) and when. It's current best knowledge, not a fixed config: `cello profile set` fixes a field.

```
cello profile <subcommand> [flags]
```

| | |
| --- | --- |
| `--project string` | Project key, instead of the working folder's. |
| `--json` | Print JSON for scripts. |

### cello profile set

Set one field of the testing profile. Do it when a command in the profile fails or the repo changed (a new script, port or e2e tool), and say so in your review packet. Setting the value it already has confirms it. An agent can't change a field the human set: ask them on the card with `cello task ask`.

```
cello profile set [flags] <field> <value>
```

| | |
| --- | --- |
| `field string` | The field: install, unit, typecheck, ui.runsIn (local or docker), app.start, app.url, e2e.<surface>.run, e2e.<surface>.videos, e2e.<surface>.screenshots (surface: web, desktop, …), evidence.ui, evidence.cli, review.env or never.touch. |
| `value string` | Its new value, e.g. "bun run test"; quote it when it has spaces. |
| `--project string` | Project key, instead of the working folder's. |
| `--json` | Print JSON for scripts. |

### cello profile unset

Remove a field from the testing profile, when it no longer applies (the e2e surface is gone, the app has no dev server). An agent can't unset a field the human set.

```
cello profile unset [flags] <field>
```

| | |
| --- | --- |
| `field string` | The field: install, unit, typecheck, ui.runsIn (local or docker), app.start, app.url, e2e.<surface>.run, e2e.<surface>.videos, e2e.<surface>.screenshots (surface: web, desktop, …), evidence.ui, evidence.cli, review.env or never.touch. |
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
| `--milestone string` | Only tasks in this milestone, by name; none for tasks without one. |
| `--mine` | Only tasks you've claimed. |

### cello task get

One task in full: description, labels, milestone, claim, pages, review packets with the human's notes, comments, history.

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
| `--milestone string` | An open milestone of the project, by name (`cello milestone list`); none for no milestone. |
| `--parent string` | Parent task key. |

### cello task edit

Change a task's title, description, priority or milestone; only the flags you give change. Any task, claimed or not; the human's edits end a claim as their other changes do (a milestone doesn't: it's planning).

```
cello task edit [flags] <key>
```

| | |
| --- | --- |
| `key string` | A task key, e.g. CEL-3. |
| `--title string` | A new title. |
| `--description string` | A new description, in markdown; replaces the old one. |
| `--body-file string` | Read the new description from a file; - is stdin. |
| `--priority string` | urgent, high, medium, low or none. |
| `--milestone string` | Put it in this open milestone, by name; none takes it out. |
| `--json` | Print JSON for scripts. |

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

### cello task stage

Say where your claimed task is inside In Progress, so the board shows it: planning, building, agent review, fixing findings, merged. Every session holding a claim sets it: on your own, planning (only when the task needs a decision before code), then building, then merged; an orchestrator, building, review, fixing, merged. Only the session holding the claim (or the human), only in In Progress. Asking the human (Needs input) keeps it; any other move out of In Progress, or submitting it, clears it.

```
cello task stage [flags] <key> [<stage>]
```

| | |
| --- | --- |
| `key string` | A task key, e.g. CEL-3. |
| `stage string` | Where the work is: planning (the task needs a decision before code: a spec, a scope with options, or a question to the human), building (the code is being written, by you or a builder agent), review (a reviewer agent is reading the branch), fixing (the builder is fixing what the review found), merged (merged into main; the packet comes next). (optional) |
| `--clear` | Remove the stage instead. |
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

### cello task label

Add and remove a task's labels by name in one change: `cello task label CEL-12 +board -ui`. Unknown names are refused with close matches; nothing is created.

```
cello task label [flags] <key> [<changes...>]
```

| | |
| --- | --- |
| `key string` | A task key, e.g. CEL-3. |
| `changes... string` | +name adds a label, -name removes one; as many as you like, e.g. +board +cli -ui. Names match in any case. (optional) |
| `--json` | Print JSON for scripts. |

### cello task comment

Add a markdown comment to a task: progress, a question, an answer to the human. --attach adds screenshots.

```
cello task comment [flags] <key> [<text>]
```

| | |
| --- | --- |
| `key string` | A task key, e.g. CEL-3. |
| `text string` | The comment, in quotes; markdown renders on the card. (optional) |
| `--body-file string` | Read the comment from a file; - is stdin. |
| `--attach string` | An image (PNG, JPEG, GIF, WebP or AVIF) shown under the comment as a thumbnail; repeatable. |
| `--json` | Print JSON for scripts. |

### cello task react

React to a comment with an emoji: a quick answer that needs no words (👍 to the human's "go ahead"). Once per emoji; --remove takes it back. The human's reactions to your comments reach your session like their comments do.

```
cello task react [flags] <key> <comment> <emoji>
```

| | |
| --- | --- |
| `key string` | A task key, e.g. CEL-3. |
| `comment string` | The comment's id (`cello task get` shows it after each comment's author), or `last` for the human's newest comment on the task. |
| `emoji string` | One emoji, e.g. 👍 ✅ 👀 ❤️ 🎉. |
| `--remove` | Take your reaction with that emoji back instead. |
| `--json` | Print JSON for scripts. |

### cello task submit

Hand finished work to the human: a review packet (summary, steps, evidence) that moves the task to In Review.

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

### cello task ask

Ask the human to decide something, on the card: questions with options (one recommended, with a reason) and evidence. The task moves to Needs input until they answer; then it's back in In Progress and the answers reach you (hook, --wait or `cello wait`).

```
cello task ask [flags] <key>
```

| | |
| --- | --- |
| `key string` | A task key, e.g. CEL-3. |
| `--json` | Print JSON for scripts. |
| `--file string` | Read the title, intro, questions and evidence from a JSON or YAML file (the format is in `cello guide`); paths in it are relative to the file. |
| `--title string` | What the decision is about, e.g. "Search layout". Overrides the file's. |
| `--intro string` | Context in markdown, shown above the questions. |
| `--question string` | A question; the --kind, --option, --recommend and --because after it belong to it. |
| `--kind string` | one (the human picks one option; the default with options), any (any number) or text (no options, optional to answer; the default without). |
| `--option string` | An option: "Label" or "Label\|one-line description"; repeat in order. |
| `--recommend string` | The label of the option you recommend; --because must follow. |
| `--because string` | Why you recommend it, right after --recommend. |
| `--attach string` | A screenshot, video or text file to decide from; repeatable. |
| `--caption string` | Describes the --attach or --link right before it. |
| `--link string` | A link to decide from, e.g. the scope page; repeatable. |
| `--wait` | Block until the human answers (or the ask is withdrawn), then print the answers. Run it in the background. Rides out a server restart; exits 1 if the server stays away for 2 minutes (the ask stays open: run `cello wait` then). |
| `--withdraw` | Take back the open ask instead: the task returns to In Progress. |

### cello task answers

Print the human's latest answers on a task again (--all: every round of questions); screenshots they pasted are saved to files and their paths printed.

```
cello task answers [flags] <key>
```

| | |
| --- | --- |
| `key string` | A task key, e.g. CEL-3. |
| `--json` | Print JSON for scripts. |
| `--all` | Every round of questions on the task, oldest first, not only the latest answers. |

### cello label list

The project's labels: each one's colour and how many of its tasks carry it, under its group, then the archived ones. Other projects' labels aren't listed.

```
cello label list [flags]
```

| | |
| --- | --- |
| `--project string` | Project key, instead of the working folder's. |
| `--json` | Print JSON for scripts. |

### cello label create

Make a label in the project (each project has its own labels). A name already taken in the project, in any case and by archived labels too, is refused; another project may use the same name.

```
cello label create [flags] <name>
```

| | |
| --- | --- |
| `name string` | The label's name; any case. |
| `--color string` | A colour like "#3B82F6" (quoted, so the shell keeps the #). Default: one picked from the name. |
| `--group string` | What the label says about a task: kind, area, milestone, none (none is shown as Other; "other" works too). The Issues tab's filter groups labels by it. |
| `--project string` | Project key, instead of the working folder's. |
| `--json` | Print JSON for scripts. |

### cello label update

Recolour, rename or regroup a label. Every task carrying it shows the change.

```
cello label update [flags] <name>
```

| | |
| --- | --- |
| `name string` | The label's name; any case. |
| `--color string` | A colour like "#3B82F6" (quoted, so the shell keeps the #). |
| `--name string` | A new name for the label. |
| `--group string` | What the label says about a task: kind, area, milestone, none (none is shown as Other; "other" works too). The Issues tab's filter groups labels by it. |
| `--project string` | Project key, instead of the working folder's. |
| `--json` | Print JSON for scripts. |

### cello label archive

Archive a label: it disappears from cards, pickers and `cello context`, and can't be added to tasks any more. Tasks keep the link underneath, out of sight, and its name stays taken. Only this project's label: another project's label of the same name stays.

```
cello label archive [flags] <name>
```

| | |
| --- | --- |
| `name string` | The label's name; any case. |
| `--project string` | Project key, instead of the working folder's. |
| `--json` | Print JSON for scripts. |

### cello milestone list

The project's milestones in order: each one open or closed, how far along (done of total, Canceled not counted), its target date and goal.

```
cello milestone list [flags]
```

| | |
| --- | --- |
| `--project string` | Project key, instead of the working folder's. |
| `--json` | Print JSON for scripts. |

### cello milestone show

One milestone: its goal, date and progress, then its tasks by status (archived ones left out).

```
cello milestone show [flags] <name>
```

| | |
| --- | --- |
| `name string` | The milestone's name; any case. |
| `--project string` | Project key, instead of the working folder's. |
| `--json` | Print JSON for scripts. |

### cello milestone create

Make a milestone in the project, last in its order. A name already taken in the project, in any case, is refused; another project may use the same name.

```
cello milestone create [flags] <name>
```

| | |
| --- | --- |
| `name string` | The milestone's name; any case. |
| `--goal string` | What it's for, in one line (markdown). |
| `--due string` | Its target date, like 2026-12-01; none clears it. |
| `--project string` | Project key, instead of the working folder's. |
| `--json` | Print JSON for scripts. |

### cello milestone edit

Rename a milestone, change its goal or target date, or move it in the project's order.

```
cello milestone edit [flags] <name>
```

| | |
| --- | --- |
| `name string` | The milestone's name; any case. |
| `--name string` | A new name for the milestone. |
| `--goal string` | What it's for, in one line (markdown). |
| `--due string` | Its target date, like 2026-12-01; none clears it. |
| `--before string` | Move it right before this milestone in the order. |
| `--after string` | Move it right after this milestone in the order. |
| `--project string` | Project key, instead of the working folder's. |
| `--json` | Print JSON for scripts. |

### cello milestone close

Close a milestone when its work is done: the human's only, like approving a review (agents are refused). Its tasks stay in it.

```
cello milestone close [flags] <name>
```

| | |
| --- | --- |
| `name string` | The milestone's name; any case. |
| `--project string` | Project key, instead of the working folder's. |
| `--json` | Print JSON for scripts. |

### cello milestone reopen

Reopen a closed milestone, so tasks can go in it again: the human's only.

```
cello milestone reopen [flags] <name>
```

| | |
| --- | --- |
| `name string` | The milestone's name; any case. |
| `--project string` | Project key, instead of the working folder's. |
| `--json` | Print JSON for scripts. |

### cello wait

Wait for the human to answer the task's open ask (after a restart, say), then print the answers. Returns at once when it's already answered. When the answers already reached this session (the hook, `cello inbox` or an earlier wait took them), it says so in one line instead. Rides out a server restart; exits 1 if the server stays away for 2 minutes.

```
cello wait [flags] <key>
```

| | |
| --- | --- |
| `key string` | A task key, e.g. CEL-3. |
| `--json` | Print JSON for scripts. |

### cello inbox

Show the comments the human left on tasks this session claimed (Send back notes, answers to your asks, and word that a change of theirs ended your claim too) and mark them read; each one arrives once. Use it when `cello context` lists new ones, or to reread what they said. With `cello install claude` they arrive by themselves while you work; `--wait` in the background wakes you with them when you've ended your turn. Not from a subagent: it shares its parent's session and would take the parent's comments.

```
cello inbox [flags]
```

| | |
| --- | --- |
| `--new` | Only new comments, and print nothing (exit 0) when there are none. For scripts and hooks. |
| `--wait` | Block until something new arrives for this session (a comment, a Send back note, answers, a withdrawn ask), then take it and print it, as --new does. Run it in the background when you end a turn holding a claim, so comments wake you. A second one for the same session leaves at once. Rides out a server restart; exits 1 if the server stays away for 2 minutes, or when the Claude Code that started it (CLAUDE_PID) is gone; stops after a day with nothing new. |
| `--json` | Print JSON: `items` (new, handed over now and marked read), `earlier` (read before; empty with --new and --wait) and `claimed` (the keys of the tasks this session holds). With --wait: `{ waiting, pid }` when another waiter runs, `{ stopped, afterMs }` after a day with nothing new. |

### cello sessions orchestrate

Put your agent session in orchestrate mode, or take it out (CEL-124). /cello:orchestrate runs `on` first, and `/cello:orchestrate off` runs `off`. While it's on, the Claude Code hook turns your AskUserQuestion away, since nobody watches an orchestrator's window: questions go on the card with `cello task ask`. A session chatting with the human stays off and keeps the dialog. Running it again changes nothing; `cello context` shows the mode. The human has no session to put in it, and a subagent can't change its session's mode.

```
cello sessions orchestrate [flags] <mode>
```

| | |
| --- | --- |
| `mode choice` | on: this session runs work through agents, with nobody watching its window; off: it's back to a normal session. |
| `--project string` | Project key, instead of the working folder's. |
| `--json` | Print JSON for scripts. |

### cello sessions wake

Wake an agent session now: Cello continues its conversation headless in its repo folder (`claude -p --resume`), as it does by itself 30 s after the human comments on a task the session claimed and its process is gone. The same checks apply: waking on for the project, under the cap, its process gone, nothing listening; when one fails it says why and exits 1. For the human or an orchestrator, never for yourself.

```
cello sessions wake [flags] <session-or-key>
```

| | |
| --- | --- |
| `session-or-key string` | The session to wake: a task key (CEL-92) wakes the session holding its claim; otherwise a session id, or its first 8 characters (c14ca1fa). |
| `--json` | Print JSON for scripts. |

### cello sessions runs

List the times Cello woke a session (newest first): why, the permission mode, how each run ended, and its log file.

```
cello sessions runs [flags] <session>
```

| | |
| --- | --- |
| `session string` | A session id, or its first 8 characters (c14ca1fa). |
| `--json` | Print JSON for scripts. |

### cello agents

List the agents working in this project's workspace, as the Agents page does: each agent session, its subagents under it, with the tasks it's on, whether it's active, and what it's doing right now (its last tool call). `cello agents log <id>` prints one's log.

```
cello agents <subcommand> [flags]
```

| | |
| --- | --- |
| `--all` | Also list the agents that finished today, newest first. |
| `--project string` | Project key, instead of the working folder's. |
| `--json` | Print JSON for scripts. |

### cello agents log

Print an agent's log: the same steps as its log on the Agents page, read from its Claude Code transcript. Its prompt, what it said, each tool call with ✓ or ✗ and how long it took, its result folded to the first lines. Keys and tokens are masked. With --follow it keeps printing new steps: how an orchestrator watches a builder from the terminal.

```
cello agents log [flags] <id>
```

| | |
| --- | --- |
| `id string` | Whose log: a session's id or its start (2fd0505c), or a subagent's id or its start, with its type in front or not (cello-builder/a13bfb89, or a13bfb89), as `cello agents` lists them. |
| `--follow, -f` | Keep printing new steps as the agent works, until Ctrl-C. Rides out a server restart (reconnects for up to 2 minutes). |
| `--full` | Print each result whole, instead of its first 3 lines. |
| `--thinking` | Also print the agent's thinking (hidden by default, as on the Agents page). |
| `--show-secrets` | Print keys and tokens as they are instead of masked. For the human only: when an agent asks, they stay masked. |
| `--project string` | Project key, instead of the working folder's. |
| `--json` | Print the steps as JSON; with --follow, each update the server sends as one JSON line. |

### cello doc publish

Publish a markdown report, plan or summary as a page in Cello and print its URL, and the cello:// link to put in replies.

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
| `--asset string` | Another file to upload with it (files the markdown links go up by themselves); repeatable. |

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

### cello open

Open a page or a task in Cello's desktop app, and print its cello:// link: the link to put in replies, never the http one.

```
cello open [flags] <target>
```

| | |
| --- | --- |
| `target string` | A page's slug (billing-audit), its address (http://127.0.0.1:4747/CEL/pages/billing-audit), or a task key (CEL-12). |
| `--project string` | Project key, instead of the working folder's. |
| `--json` | Print JSON for scripts. |
| `--print` | Print the link without opening it. |

### cello search

Search the project: task keys, titles and descriptions, comments, review packets, pages and docs, and project and label names. Each word matches the start of a word, stemmed (videos finds video), and all of them must match; a task key (CEL-15) prints that task, then everything that mentions it or is on it. Results come grouped by kind, best match first, with the matched words in [brackets]. The ⌘K bar in the app runs the same search.

```
cello search [flags] <query...>
```

| | |
| --- | --- |
| `query... string` | Words to find (each matches the start of a word, all of them required), or a task key like CEL-15. |
| `--kind string` | Only these kinds, comma-separated: task, comment, packet, page (docs and specs too), project, label. |
| `--limit integer` | How many hits to print per kind, best first (1 to 50). |
| `--project string` | Project key, instead of the working folder's. |
| `--json` | Print the results as JSON for scripts: query, terms, key, jump (the task a key names) and groups of hits with their matched ranges. |

### cello whoami

Print, as JSON, who Cello thinks is calling, and which build the CLI and the server are.

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

Connect Claude Code to Cello. Adds hooks that deliver new comments into the agent session holding the task (Stop and PostToolUse), and one that turns Claude artifact publishes away in favour of Cello pages, AskUserQuestion away in favour of `cello task ask` on the card where nobody watches the window (orchestrating sessions, subagents, woken runs), and edits away until the session has claimed a task (PreToolUse on Artifact, AskUserQuestion, Edit, Write and NotebookEdit; not with --user), all running `cello hook claude`. Installs Cello's Claude Code plugin too (/cello:orchestrate, /cello:work, the cello skill, and builder and reviewer agents): writes its files to $XDG_DATA_HOME/cello/claude-plugin (default ~/.local/share/cello/claude-plugin), rewritten on every run so a new Cello updates it, and enables it. Adds Bash(cello:*) to permissions.allow, so `cello` commands run without Claude Code's permission check and a check that fails can't cut agents off the board. Writes this project's .claude/settings.local.json (this machine, git-ignored; from a worktree, the main checkout's), merged with what's already there; running it again changes nothing. The old file is kept as .bak.

```
cello install claude [flags]
```

| | |
| --- | --- |
| `--user` | Write ~/.claude/settings.json instead: every project on this machine gets the comment hooks (not the guards) and the plugin. |
| `--shared` | Write this project's .claude/settings.json instead, committed with the repo: everyone who clones it gets the hooks and needs cello. The plugin is enabled there too; its marketplace, a folder on this machine, goes into .claude/settings.local.json. |

### cello uninstall claude

Take Cello's hooks, plugin and Bash(cello:*) rule out of Claude Code's settings: this project's .claude/settings.local.json and .claude/settings.json, and ~/.claude/settings.json. Every other hook, plugin, permission rule and setting stays as it was. The plugin's files stay in their folder, since other projects may still enable it.

```
cello uninstall claude [flags]
```

### cello hook claude

Run by the hooks `cello install claude` adds, not by hand: reads Claude Code's hook JSON on stdin. stop and post-tool-use hand new comments for its session back to the agent as context (on Stop it keeps the agent going); every run checks the session in, so the board shows it working; they print nothing when there are none, inside a subagent (which only checks in), or when the server doesn't answer within 2 seconds. With nothing new, stop keeps a session that holds a claim going once to start `cello inbox --wait` in the background, unless one is running for it (its lock file, or Claude Code's background_tasks) or Claude is already continuing because of a Stop hook (stop_hook_active), and never in a run Cello woke (CELLO_WOKEN=1). Every run passes the session's permission_mode on to the server, so a run Cello wakes uses the same mode, and its Claude Code transcript_path (inside a subagent, the subagent's own file) with, after a tool call, that call in one line ("Bash · bun run test"), so the Agents page shows its live log and current step. pre-tool-use turns a Claude artifact publish away with a pointer to `cello doc publish`, and lets every other Artifact call through (all of them with CELLO_ALLOW_ARTIFACTS=1); this artifact guard needs no server. It denies AskUserQuestion (Claude's own question dialog, which blocks the session) where nobody watches the window, with a pointer to `cello task ask`, and to `cello task create` when no open task the session holds fits: inside a subagent or a run Cello woke (CELLO_WOKEN=1) at once, and in a session in orchestrate mode (`cello sessions orchestrate on`) after asking the server, uncached; a session chatting with the human keeps the dialog, and so does every session when the server doesn't answer, the repo isn't a Cello project, or CELLO_ALLOW_ASK_USER=1. For Edit, Write and NotebookEdit on a file inside this repo, pre-tool-use asks the server and denies the edit while the session holds no open task in the repo's project, saying to create or claim one; this claim guard lets the edit through when the server doesn't answer, the repo isn't a Cello project, or CELLO_ALLOW_UNTRACKED=1, and remembers a claim for a minute. Subagents (they share the session): inside one, every run checks that agent in under the session, so the board names it; post-tool-use on the Agent tool tells the board which subagent was launched and the task its description names; subagent-start prints context telling the new subagent to give its cello commands --agent <type>/<id>, and subagent-stop marks it finished, or waiting on background work while a test command it ran with run_in_background or a Monitor it started is still among Claude Code's background_tasks (post-tool-use remembers the background work each call starts). Test runs: pre-tool-use on a Bash command that runs tests (bun run test, test:e2e, test:docker*, scripts/test-in-docker.ts, vitest, playwright test, …) marks its agent Running tests; its post-tool-use ends a foreground run passed, post-tool-use-failure failed, and stop ends a run the main conversation's turn leaves behind unless it runs in the background. Always exits 0.

```
cello hook claude [flags] <event>
```

| | |
| --- | --- |
| `event string` | The hook event Claude Code runs it for: stop (Stop), post-tool-use (PostToolUse), pre-tool-use (PreToolUse: the artifact, AskUserQuestion and claim guards, and a Bash test run starting), post-tool-use-failure (PostToolUseFailure: a Bash test run failed), subagent-start (SubagentStart) or subagent-stop (SubagentStop). Any other event does nothing and exits 0. |

### cello test progress

Report a test run's progress to the board, for the agent whose tool call started it: the test runner runs it, not you. The run is this session's, or one of its subagents', started from this folder (one inside the other), else the session's only running one; the Agents page, the card and the task panel show where it is ("web e2e 7 of 13 · 1 failed") and each failure as it happens. A run nobody started, or a call without a session, changes nothing. scripts/test-in-docker.ts calls it as it goes, and never waits on it: without a server the tests run as before.

```
cello test progress [flags]
```

| | |
| --- | --- |
| `--file string` | The progress file to report: JSON with stage, passed, failed, skipped, total (or null), current, failures, done, outcome (passed, failed, stopped or null) and folder; scripts/test-in-docker.ts writes it as progress.json in its run folder. |
| `--json` | Print { matched }: whether a running test run took the report. |

### cello start

Run the Cello server on 127.0.0.1:4747 with data in ~/.cello (CELLO_PORT, CELLO_DATA_DIR), serving its built-in web app, or every file in CELLO_WEB_DIR when that folder has an index.html.

```
cello start [flags]
```

### cello service install

Run Cello's server as a macOS background service: writes the launchd user agent dev.cello.server to ~/Library/LaunchAgents/dev.cello.server.plist and loads it, so `cello start` runs now, at every login, and again within 5 seconds whenever it stops. It runs this cello binary (the absolute path, symlinks resolved), with CELLO_DATA_DIR (default ~/.cello) and CELLO_PORT (default 4747) as they are now, and logs to <data folder>/logs/server.log. Installing again replaces it (after a rebuild that moved, or to change the port). Refuses while another server holds the data folder.

```
cello service install [flags]
```

| | |
| --- | --- |
| `--replace` | Replace what's in the way, after naming it: a Cello server started another way (`cello start` in a terminal, the desktop app) that holds the data folder, which it stops by the pid in its lock, and only after checking that pid is a Cello server answering on the lock's port; and an installed service that runs another binary, data folder or port. Without it, install refuses and says what's there. |
| `--temporary` | Install even though this cello is in a temp folder or a git worktree (.claude/worktrees/), which can disappear and leave the service with nothing to run. For trying a build; tests use it. |

### cello service status

Show the background service: whether it's installed and running, its pid, the program and data folder it runs with, whether its server answers and which build it is, the plist and log paths, and the log's last 10 lines. Flags a plist whose program no longer exists (the repo moved or the build was deleted). Without the service, says whether a server runs anyway.

```
cello service status [flags]
```

| | |
| --- | --- |
| `--json` | Print JSON: installed, plist, program, programExists, dataDir, port, logPath, loaded, running, pid, lastExit, server ({ version, commit } or null), logTail and holder ({ pid, port } of the server holding the data folder, or null). |

### cello service restart

Restart the background service: launchd sends its server SIGTERM (the clean shutdown; never a kill), starts the program again, and this waits up to 30 s for the new server to answer, then prints its pid. A stopped service is started instead. Cello's own deploys run it from `bun run release` in the Cello repository, after a backup; deploying by hand: cello backup, replace the binary, then restart.

```
cello service restart [flags]
```

### cello service uninstall

Remove the background service: unloads it from launchd (stopping its server) and deletes its plist. The data folder and the log are left as they are.

```
cello service uninstall [flags]
```

### cello backup

Back up the database and every evidence file (videos, screenshots, page images) now, into <data folder>/backups/<YYYYMMDD-HHMMSS>/, and print the folder, its size and how many files were linked or copied. The server already takes one a day and keeps 14 of those; take one by hand before something risky, like a bulk change or trying a new build on your real board. Files unchanged since the previous backup become hard links to it, so a backup only adds what changed. Talks to the running server on CELLO_PORT; with none running, it backs up CELLO_DATA_DIR (default ~/.cello) itself.

```
cello backup <subcommand> [flags]
```

| | |
| --- | --- |
| `--json` | Print the backup as JSON (id, path, sizes, file counts) for scripts. |

### cello backup list

List the backups, newest first: the id (the folder name, which `cello restore` takes), when it was taken, its kind (auto: the daily one; manual: `cello backup`; safety: the copy of the current state `cello restore` takes first, which undoes that restore), its size (the database plus its files, counting files shared with other backups in each) and how many evidence files it holds. The newest 14 of each kind are kept. Use it to pick a backup to restore. Only Cello's own backups are listed; other folders in backups/ are left alone. Works whether or not Cello is running.

```
cello backup list [flags]
```

| | |
| --- | --- |
| `--json` | Print the backups as a JSON array, newest first, for scripts. |

### cello restore

Put a backup's database and evidence files back in place of the current ones, in CELLO_DATA_DIR (default ~/.cello). Use it when the board's data is lost or damaged. Stop Cello first (Ctrl-C where `cello start` runs, or quit the desktop app): restore refuses while a server holds the data folder. It first takes a safety backup of the current state (kind safety, "before restoring <id>"), so restoring that one undoes it. Agents run it only when the human asks.

```
cello restore [flags] <id>
```

| | |
| --- | --- |
| `id string` | The backup to restore: its id from `cello backup list`, e.g. 20261115-120000. |
| `--json` | Print what was restored, and the safety backup, as JSON. |

### cello builds

List the builds of Cello the server has run, newest first: each build's number, commit and version, when it went live and for how long (until the next build went live), which one is running now, and the commits merged since the build before it (merge subjects name their tasks). The server records a build the first time it starts on it; restarting the same build adds nothing. Use it to tell whether a merged task is deployed yet, or what a deploy brought in.

```
cello builds [flags]
```

| | |
| --- | --- |
| `--limit integer` | How many builds to list, newest first (1 to 200). |
| `--before integer` | List the builds older than this build number: the number the previous list's "Older builds" line gives. |
| `--json` | Print the page as JSON (builds, running, next) for scripts. |

### Flags every command takes

| | |
| --- | --- |
| `--help, -h` | Show help information |
| `--version, -v` | Show version information |
| `--wizard` | Start wizard mode for a command |
| `--completions <bash\|zsh\|fish\|powershell\|sh\|pwsh>` | Print shell completion script (choices: bash, zsh, fish, powershell, sh, pwsh) |
| `--log-level <all\|trace\|debug\|info\|warn\|warning\|error\|fatal\|none>` | Sets the minimum log level (choices: all, trace, debug, info, warn, warning, error, fatal, none) |
| `--agent string` | Which subagent of this session is calling, as <type>/<id> (cello-builder/a13bfb89) or just the id: the name the SubagentStart hook gives a subagent. Does what CELLO_AGENT does, and wins over it; a flag keeps the command starting with `cello`, which Claude Code's allow rule Bash(cello:*) needs. |
<!-- cli-reference:end -->
