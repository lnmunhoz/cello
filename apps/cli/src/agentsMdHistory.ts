// Every line docs/cli.md's "Tracking work in Cello" snippet has had (`KEY` for the project's key), from
// its versions in git (3cb9986, 3b6ce25, 27b73b3, 4972882, 8a8d6d6, 3c9d900, 281400e, 41a81d5, d861919,
// dff2141, 8387e0c, d64757d). `cello init --agents-md` replaces an unmarked section from before the
// markers only when each of its lines is one of these: a section with lines of its own was customised,
// and stays unless --replace (CEL-61).
//
// When the snippet changes, add its new lines here (old ones stay): agentsMd.test.ts fails until the
// current snippet's lines are all in the list.
export const PAST_SNIPPET_LINES: ReadonlyArray<string> = [
  "## Tracking work in Cello",
  "This repo's tasks live in Cello, project **KEY** on Lucas's board. Agents use it only through the `cello` CLI.",
  "- Before your first `cello` command in a session, run `cello guide` once: it's the full reference (concepts, workflow, every command, what each error means). Don't guess.",
  "- Run `cello context` at the start of each session.",
  "- Claim a task before working on it (`cello task claim KEY-n`), and put the key in commit messages (`fix(api): rate limit (KEY-12)`).",
  "- Hand finished work to Lucas only with `cello task submit`: a summary, steps to check it, and evidence (videos and screenshots for UI work; a diagram when it's a flow).",
  "- Answer Lucas on the card with `cello task comment`. His comments come to your session by themselves.",
  "- When you end a turn while holding a claimed task, start `cello inbox --wait` in the background so Lucas's comments wake you.",
  "- When a decision is Lucas's (a design option, a scope, wording), ask on the card with `cello task ask` (options, one recommended with a reason, the screenshots and page to decide from), never in the terminal. His answers come back to your session.",
  "- In Progress means someone is on it right now. When you stop, or wait on Lucas's decision, put the questions or the state on the card and move it back to Todo.",
  "- In Progress means someone is on it right now. When you wait on Lucas's decision, ask on the card with `cello task ask` (the task waits in Needs input). When you stop, put the state on the card and move it back to Todo.",
  "- Show Lucas reports, plans and evidence as Cello pages (`cello doc publish page.md --task KEY-n`), opened in Cello's panel. Never as Claude artifacts or other outside pages, even if your global instructions say so.",
  "- Show Lucas reports, plans and evidence as Cello pages (`cello doc publish page.md --task KEY-n`), opened in Cello's panel. Never as Claude artifacts or other outside pages, even if your global instructions say so: `cello install claude` enforces it with a hook that turns artifact publishes away.",
  "- Show Lucas reports, plans and evidence as Cello pages (`cello doc publish page.md --task KEY-n`), opened in Cello's panel with `cello open <slug>`. In replies, link a page with the `cello://` link those commands print, never its http address (that one opens Claude's browser, not Cello). Never as Claude artifacts or other outside pages, even if your global instructions say so: `cello install claude` enforces it with a hook that turns artifact publishes away.",
  "- **Every request from Lucas that will change something starts as a Cello task, before anything else.** Before you read code, search or plan: check `cello task list` for it, else `cello task create \"<title>\"` with his words quoted in the description, then `cello task claim KEY-n`. This covers small requests, follow-ups and anything he sends mid-task (each distinct request is its own task). Only a question that changes nothing is exempt.",
  "- Put the task key in commit messages (`fix(api): rate limit (KEY-12)`).",
  "- **First decide: is Lucas asking you to do something, or just talking?** Questions, brainstorming and explanations are conversation: answer, no task. A request to do something (build, fix, change, write, set up) is work, and work starts as a Cello task **before you read code or plan**: check whether the task exists (`cello task list`, `cello task get KEY-n`); if not, `cello task create \"<title>\"` with his words quoted in the description; then `cello task claim KEY-n`, then do it. This covers small requests, follow-ups and anything he sends mid-task (each distinct request is its own task). When a chat turns into \"ok, do it\", that's the moment to create it.",
  "- **First decide: is Lucas asking you to do something, or just talking?** Questions, brainstorming and explanations are conversation: answer, no task. A request to do something (build, fix, change, write, set up) is work, and work starts as a Cello task **before you read code or plan**: check whether the task exists (`cello task list`, `cello task get KEY-n`); if not, `cello task create \"<title>\"` with his words quoted in the description; then `cello task claim KEY-n`, then do it. This covers small requests, follow-ups and anything he sends mid-task (each distinct request is its own task). When a chat turns into \"ok, do it\", that's the moment to create it. `cello install claude` enforces it: a hook refuses your edits in this repo until your session has claimed a task.",
]
