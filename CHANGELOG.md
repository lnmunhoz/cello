# Changelog

Every release of Cello, newest first. `bun run release` writes each section from main's commits since the
previous tag; how releases work is in [docs/releases.md](docs/releases.md).

## [0.4.3](https://github.com/lnmunhoz/cello/compare/v0.4.2...v0.4.3) (2026-11-17)

### Features

- the Cello you download and Cello Dev (built on your Mac) now live side by side, the downloaded one can use its own test board, and an older Cello refuses a board a newer one changed (CEL-149) ([3ac698d](https://github.com/lnmunhoz/cello/commit/3ac698d9f4cb6a8c53afd2eda551807cffca7ae9))

## [0.4.2](https://github.com/lnmunhoz/cello/compare/v0.4.1...v0.4.2) (2026-11-17)

### Features

- Cello.app tells you when a new version is out, shows what's new, and offers Stable or Preview releases (CEL-140) ([2235876](https://github.com/lnmunhoz/cello/commit/2235876d0c4bad9196175f94a8738bab30a96af5))

## [0.4.1](https://github.com/lnmunhoz/cello/compare/v0.4.0...v0.4.1) (2026-11-17)

### Features

- approving tells the agent to merge it, in projects set to merge after you approve; the card shows Approved · merging until it's done (CEL-143) ([8fef805](https://github.com/lnmunhoz/cello/commit/8fef805231be2ca30734976e0fc26f45e3ecf656))
- GitHub Actions builds the downloads for Apple silicon and Intel; the Mac builds only its own cello (CEL-139) ([5600cb4](https://github.com/lnmunhoz/cello/commit/5600cb4c89577930a81e0311d4cff96c13b21fd9))

### Fixes

- a task link off its board opens the task in the page's side panel (CEL-141) ([79f3002](https://github.com/lnmunhoz/cello/commit/79f30026b1df8325542fda69e6b9c1ad8b9dfa12))
- release builds pick Xcode 26 for the .icon icon; a build-only run can build main (CEL-139) ([d5b9cf0](https://github.com/lnmunhoz/cello/commit/d5b9cf074df215e7d9e7e6d783a6971e1ae939ba))

### Other changes

- slim AGENTS.md so every session starts with less context (CEL-146) ([8f68f5b](https://github.com/lnmunhoz/cello/commit/8f68f5b7d22898706bddec30cde811193a75d416))
- **claude:** a /cello-release skill for this repo: preview, ask the version, release, make sure the board runs it (CEL-138) ([4576dee](https://github.com/lnmunhoz/cello/commit/4576deeeb0046e1ce441ebdb218bc191b1f90755))

## [0.4.0](https://github.com/lnmunhoz/cello/compare/v0.3.1...v0.4.0) (2026-11-17)

### Features

- waking a session says so at once with a countdown and Wake now; each session shows where it runs (CEL-136, CEL-137) ([7a165a7](https://github.com/lnmunhoz/cello/commit/7a165a7225972fd5bf19d3a01ab8c9382d311301))
- waiting on background work isn't finished; live test progress on the Agents page, card and panel (CEL-133, CEL-134) ([749ef3a](https://github.com/lnmunhoz/cello/commit/749ef3a15027534aa557afdb6da2615d38071304))
- the Milestones tab, a page per milestone, the board grouped by milestone (CEL-132, CEL-113) ([eaa0f00](https://github.com/lnmunhoz/cello/commit/eaa0f00f76dc8062591d8aff983d4b417d54027c))
- a Milestone section in the filter panel; task create --milestone none (CEL-113) ([8b59727](https://github.com/lnmunhoz/cello/commit/8b59727e3c07a92482bdc0f3f2c8321880267d16))
- milestones per project, a task's milestone, the chip and the picker; M2/M3 labels become milestones (CEL-113) ([855289c](https://github.com/lnmunhoz/cello/commit/855289c85bd3de62747dab222228345cc6746264))
- AskUserQuestion is denied only where nobody watches: orchestrate mode, subagents, woken runs (CEL-124) ([391ed1d](https://github.com/lnmunhoz/cello/commit/391ed1db8c68feac996345ade5493e66ef3cd430))

### Fixes

- skip events this build can't read instead of freezing the board (CEL-131) ([2047f20](https://github.com/lnmunhoz/cello/commit/2047f2062c8022c0ebefffcb26305a74dcd3dd5a))
- comments, descriptions, packets and asks render GitHub-flavored markdown, tables included (CEL-127) ([585a4da](https://github.com/lnmunhoz/cello/commit/585a4dad998df0bb9b9f8897848a840151b8fdb9))

### Other changes

- **e2e:** open a project by its key, not its name, so tests that share a server don't click another run's project (CEL-16) ([81532e5](https://github.com/lnmunhoz/cello/commit/81532e5f2bb17a0432ff64b78efefc04e53e19d2))
- **e2e:** a stopped subagent moves to Finished today instead of leaving the Agents page (CEL-123, CEL-120) ([f0a63c6](https://github.com/lnmunhoz/cello/commit/f0a63c60d6c4fbeb9864fa326bf02c52069db502))

## [0.3.1](https://github.com/lnmunhoz/cello/compare/v0.3.0...v0.3.1) (2026-11-16)

### Fixes

- **release:** the version bump also writes the Claude Code plugin's version and regenerates its embedded copy (CEL-36) ([5223b50](https://github.com/lnmunhoz/cello/commit/5223b50119cf1a469474a0987881b00dd1a0345a))

## 0.3.0 (2026-11-16)

First tagged release: everything on main since the first commit (2026-11-14). Earlier builds called themselves 0.1.0 or 0.2.0 and weren't tagged.

### Features

- bun run release cuts a versioned release with a changelog, GitHub release and the built apps, then deploys it after a backup (CEL-36) ([fa1d303](https://github.com/lnmunhoz/cello/commit/fa1d3037c77777c7bae2d09a37b55f6107685115))
- a page opened from a task opens beside it, with Back in the side panel (CEL-117) ([c89b76d](https://github.com/lnmunhoz/cello/commit/c89b76db59754e05accd0605697d8aa36c595372))
- each comment, history line and Agents row says main session or subagent, and the model and effort that wrote it (CEL-119) ([bb613ec](https://github.com/lnmunhoz/cello/commit/bb613ec0dd812c919b777678cf75eb533e22f47b))
- a comment on a Done or released task reopens it for the agent that last held it (CEL-110) ([b90d3a7](https://github.com/lnmunhoz/cello/commit/b90d3a7a442e1d8068230f1b297ffcdba509faa2))
- new log steps fade in; messages render as markdown, without loading images (CEL-107) ([8e927e3](https://github.com/lnmunhoz/cello/commit/8e927e3f14df468e095a807a97f24b444b9fa379))
- the stage designing is now planning, picked by the task's scope; migration 0020 (CEL-105) ([e3cc474](https://github.com/lnmunhoz/cello/commit/e3cc4742c1af6a51b4588fb6a8c59abee01ac6f7))
- cello agents and agents log --follow; Finished today; a Log link from the task panel (CEL-107) ([7329811](https://github.com/lnmunhoz/cello/commit/73298116e1d148f0010058de816d5bea60597406))
- the Agents page shows an agent's live log (CEL-106) ([27590a2](https://github.com/lnmunhoz/cello/commit/27590a2933f0a82aa9f220e8ef1a41805ed88d66))
- a task an agent works on with no stage shows Working; designing stage; every claiming session sets a stage (CEL-105) ([b21529a](https://github.com/lnmunhoz/cello/commit/b21529aac9fb9c0dd9e6fddc469c83f7833f305e))
- Cello wakes a claimed agent session when the human acts on its task and its process is gone, phase 1 (CEL-92) ([92ca1de](https://github.com/lnmunhoz/cello/commit/92ca1dee7b6865c165d11fc787b5899c0d341cfc))
- Cello's server as a launchd background service; the app joins it and asks once on quit (CEL-81) ([29f6ea8](https://github.com/lnmunhoz/cello/commit/29f6ea80e1ee10fa3b58edc301e966764fa1983c))
- tell an agent session when Lucas ends its claim (CEL-46) ([a688bff](https://github.com/lnmunhoz/cello/commit/a688bff9da9e188a71332a87941f126eaad60210))
- cello init inspects the repo and keeps a living testing profile per project (CEL-89) ([d318cde](https://github.com/lnmunhoz/cello/commit/d318cde9f64c6aaecfb2f5ce1881c2f340ea25bc))
- cello install claude allows cello commands; subagents call cello --agent so the rule covers them (CEL-90) ([ec394a3](https://github.com/lnmunhoz/cello/commit/ec394a3da4888e2ba2a5bcb3db020de3949d6118))
- agents link Cello pages as cello:// links; cello open, and doc publish prints the reply link (CEL-88) ([226e706](https://github.com/lnmunhoz/cello/commit/226e706f4bdf1a33cc2b207fa5cd58f55a34738e))
- the sidebar keeps only the Agents working link; Agents page card fixes (CEL-65) ([96d49d0](https://github.com/lnmunhoz/cello/commit/96d49d047a1137e65e6d3925099f3c85cb691d0d))
- cello:// links open /Applications' Cello; build-folder copies unregistered, and the app offers a restart when outdated (CEL-75) ([d40c4b0](https://github.com/lnmunhoz/cello/commit/d40c4b05d1fd535b1676ca8a80d9549d9199e3c1))
- labels belong to a project, not the workspace (CEL-80) ([1f665ca](https://github.com/lnmunhoz/cello/commit/1f665ca489a87a7c3e28d094f2392635cb75f592))
- the comment's status row in the thread, under Lucas's latest comment (CEL-76) ([3fda9ba](https://github.com/lnmunhoz/cello/commit/3fda9ba2661644d93b46058ff627b5ae0272b414))
- comment receipts (sent, delivered, answered) and the agent's edge on cards (CEL-76) ([37c06c2](https://github.com/lnmunhoz/cello/commit/37c06c2cf1698efdee649011b2b1f93c299591d9))
- the Agents page: Agents working opens every working agent in Review-style rows, live (CEL-65) ([bd1b47b](https://github.com/lnmunhoz/cello/commit/bd1b47bc0f1f607a025c5cbe94eeaee9514ed2b9))
- emoji reactions on comments, sent to the agent (CEL-77) ([0099c8c](https://github.com/lnmunhoz/cello/commit/0099c8cb34898a00982c402b7e836c5555ec36f5))
- paste or drop screenshots into comments; agents get them as files (CEL-73) ([30e6266](https://github.com/lnmunhoz/cello/commit/30e6266b49330100dd1a9d371eba3dd5069f906a))
- a working or thinking agent's mark loops while it's active, on cards, the panel and the sidebar (CEL-69) ([4f61462](https://github.com/lnmunhoz/cello/commit/4f614620573480cad11d8b0c086a85371950f90e))
- the sidebar's Agents working and the task panel show the card's agent mark, in its mood (CEL-55) ([126ab06](https://github.com/lnmunhoz/cello/commit/126ab0602d191d9e7d81f3b1fb2e43943ec98a2e))
- cello inbox --wait wakes an idle session; the Stop hook asks for it (CEL-74) ([0cdee0e](https://github.com/lnmunhoz/cello/commit/0cdee0ebb4a6fe55276d3ca98b91d12b38218eb5))
- the agent mark on cards shows what its agent is doing: working, thinking, needs input, done (CEL-69) ([79195e3](https://github.com/lnmunhoz/cello/commit/79195e33507f53d7b1eb266f9b80947704c6202d))
- cards, comments and history name the subagent doing the work; Agents working lists them (CEL-55) ([18b2f9c](https://github.com/lnmunhoz/cello/commit/18b2f9caa644e2a718f88d160b9114fca7ee5b29))
- comment on a packet from the Review page; Send back and Approve send the typed text as their note (CEL-70) ([65f95b9](https://github.com/lnmunhoz/cello/commit/65f95b9dcbadab9ac7055664947ef302e23bfc16))
- the filter panel folds to a rail, and its sections fold (CEL-52) ([f2136f5](https://github.com/lnmunhoz/cello/commit/f2136f54b3483f591a97aa31c38a9229e4b797ba))
- a Claude Code plugin (/cello:orchestrate, /cello:work, the cello skill, builder and reviewer agents), installed by cello install claude (CEL-64) ([94f8bab](https://github.com/lnmunhoz/cello/commit/94f8bab976d027061cb3c88a5e17a475e43a6043))
- copy a task's key, or the task for an agent, from its panel (CEL-67) ([3135d2b](https://github.com/lnmunhoz/cello/commit/3135d2b5e3c6ad3c13455db5f4110ced18423536))
- filter the board and list with a facet panel; labels get a group (CEL-52) ([9347183](https://github.com/lnmunhoz/cello/commit/9347183a76866fc0e9696f6149b9f7fc37c6d66c))
- a comment is activity on its task: cards say who commented, with a count (CEL-5) ([c59266c](https://github.com/lnmunhoz/cello/commit/c59266c98b2d54c0a334bba8975de9a7e70902a0))
- cello task edit for title, description and priority (CEL-63) ([cbcd434](https://github.com/lnmunhoz/cello/commit/cbcd434017e99b8120788da9bc4a509f52f8c665))
- edits wait for a claimed task (a PreToolUse guard); cello init keeps AGENTS.md's Cello section current (CEL-61) ([945ef7c](https://github.com/lnmunhoz/cello/commit/945ef7c6d6a7d30cdfb57ed0835fe60134e473bf))
- ⌘K searches everything in Cello, Peek by default with a toggle to Palette; cello search for agents (CEL-43, CEL-11) ([659f737](https://github.com/lnmunhoz/cello/commit/659f73742f2b976149a6d1ed37268077bdf6b53a))
- Cello pages and text files open in Cello's side panel; the built-in browser only for outside sites (CEL-60) ([671f1a8](https://github.com/lnmunhoz/cello/commit/671f1a82128ec5c4c8c88e963962f9c226531ecd))
- compare a Needs input question's options full screen, in columns or rows (CEL-47) ([1039ab0](https://github.com/lnmunhoz/cello/commit/1039ab08fda6778955a2037205b2520f0956a3c5))
- who made a task, who's on it, live presence and stages; stage lanes as a Display option (CEL-5, CEL-35) ([b8de7a7](https://github.com/lnmunhoz/cello/commit/b8de7a776d35d1ea883fcded74888777c880f9bc))
- cello label list/create/update/archive and cello task label; the CEL label script (CEL-56) ([98eb5e8](https://github.com/lnmunhoz/cello/commit/98eb5e886479dda7e83f2485db766667a3280475))
- in a Cello project, a Claude Code hook turns artifact publishes away to cello doc publish (CEL-57) ([d861919](https://github.com/lnmunhoz/cello/commit/d8619198697d1046af2211e0cac1001743480b8b))
- Needs input, agents ask Lucas on the card and wait for his answers (CEL-47) ([acb47ba](https://github.com/lnmunhoz/cello/commit/acb47bad541e17f97fbf16be009db6282624d97a))
- page videos play inline, Not found has a way back, the desktop window goes back and forward (CEL-54) ([68ddf26](https://github.com/lnmunhoz/cello/commit/68ddf26e2553e6dd5c20ef42e801ef2ea7f4b9ef))
- build history, every deploy with what changed, one click from the footer (CEL-50) ([8ef7019](https://github.com/lnmunhoz/cello/commit/8ef70199808027e25b09b4e0e92d05c0e1d55484))
- agent cursors are Cello's teardrop agent, tip on the card; the video overlay too (CEL-6) ([b0984e0](https://github.com/lnmunhoz/cello/commit/b0984e06aa977ac14e7c5e628b876f4ba2ec51ad))
- the task panel docks full height on the right, resizable by its edge (CEL-49) ([ae7b4e4](https://github.com/lnmunhoz/cello/commit/ae7b4e490989ab34e5860740df54f1ca6a2a6228))
- diagrams open in the zoomable image modal, like screenshots (CEL-48) ([ffb7d98](https://github.com/lnmunhoz/cello/commit/ffb7d9838353f2729146f09b6937d493e2084379))
- live agent cursors on the board, with the animation queue (CEL-6) ([31519a8](https://github.com/lnmunhoz/cello/commit/31519a8264386c7c4a07ac295b115652ba0cabcb))
- tabs notice a new Cello build and reload; the running build in the sidebar (CEL-37) ([d508276](https://github.com/lnmunhoz/cello/commit/d5082766e27024b5c90614b46f52338ce9168512))
- screenshots open in a zoomable image modal and show full width in packets (CEL-44) ([579f19f](https://github.com/lnmunhoz/cello/commit/579f19f3da8ab868dbecaef17c89dcd999941a1a))
- cello init sets up a repo as a Cello project by itself; one repo, one project, however its path is spelled (CEL-41) ([4ea8560](https://github.com/lnmunhoz/cello/commit/4ea8560a7face0b5ea243219555c8c422a767ef7))
- ordering in Display for board columns and list groups; unfolded hidden columns remembered (CEL-21) ([ac15fc7](https://github.com/lnmunhoz/cello/commit/ac15fc7f495db07bf75aadecbb1476d5174e74e8))
- the Review page uses the width, and a task can open as a full page (CEL-38, CEL-39) ([c602f25](https://github.com/lnmunhoz/cello/commit/c602f258cb24a00beef6e1b05dbf9c937df69a08))
- **web:** diagrams in review packets and comments; the Cello icon replaces the last placeholder C (CEL-27) ([ab64c02](https://github.com/lnmunhoz/cello/commit/ab64c02de081643719a9ea59769525c10c33fb07))
- the app fills the window, sidebar collapses to a rail, hides and resizes (CEL-24, CEL-25) ([d9a705c](https://github.com/lnmunhoz/cello/commit/d9a705cd1d5b9f8e70995c55ab928b6a6cffbfad))
- daily local backups, cello backup and restore (CEL-23) ([b6ce28b](https://github.com/lnmunhoz/cello/commit/b6ce28bbe76dd03bec8ba2088762fa65fd74a2db))
- task keys link to their task with live status; the Review page shows one packet at a time (CEL-20, CEL-22) ([e2d37ab](https://github.com/lnmunhoz/cello/commit/e2d37ab95a0746dc0fda993c533ce9bdcbd61336))
- the new app icon everywhere, a flat Icon Composer icon for the Dock, ink title bar (CEL-27) ([2cf868c](https://github.com/lnmunhoz/cello/commit/2cf868c40bcb2e8c690b8be7c9ca5a4da534ebd6))
- comments reach agents through the inbox and Claude Code hooks (CEL-15) ([a977a9a](https://github.com/lnmunhoz/cello/commit/a977a9ad49fb4f6a566edf71b6670972e6147bec))
- tests run in a throwaway Linux container, desktop e2e never on Lucas's screen, review-recording mode (CEL-29) ([9e5f995](https://github.com/lnmunhoz/cello/commit/9e5f995b33410143bbe3cdd03e467f46e2a7f9f2))
- Cello app icon and its spec ([b969db9](https://github.com/lnmunhoz/cello/commit/b969db9394f8ba80cc3a78551d9c71e58a62b286))
- Pages, agents publish reports into Cello (CEL-13) ([e3062fb](https://github.com/lnmunhoz/cello/commit/e3062fb2478f5fbfd377022a1fd60d2420f88fd9))
- viewer side panel for evidence, pages and links (CEL-12) ([3a0e4be](https://github.com/lnmunhoz/cello/commit/3a0e4bec8940e8c3f50eee6636cafe35110dbbd0))
- desktop app with a built-in browser panel (CEL-14) ([9e26ba1](https://github.com/lnmunhoz/cello/commit/9e26ba1f77f5bd7a277192fdd6b0f8036fa4a133))
- review packets, Review page, cello task submit (CEL-10) ([0f859ff](https://github.com/lnmunhoz/cello/commit/0f859ff2e10dd593cef94d1e90db7de47d743663))
- M1 polish, missing tests, 200-task fps (CEL-9) ([ff78c8c](https://github.com/lnmunhoz/cello/commit/ff78c8c381abd79f2705d5f6a2aced111b8bb7c5))
- list layout with Board/List switch (CEL-7) ([f96cf6b](https://github.com/lnmunhoz/cello/commit/f96cf6b4903947f8d80a2a993cbc4e23eb15dad9))
- Cello builds Cello: stable instance, cello CLI, agent identity (CEL-8, CEL-3, CEL-4) ([f274826](https://github.com/lnmunhoz/cello/commit/f274826444a1af79c0d2582a6f7d9cc33971b39d))
- **web:** M1 web app, client sync and optimistic commands ([df0450c](https://github.com/lnmunhoz/cello/commit/df0450c7e9d196b50961ea589fb5edcd209d0100))
- **server:** M1 server with event log, receipts, services and RPC ([c5fae75](https://github.com/lnmunhoz/cello/commit/c5fae75ff77728892197d305503f77d69ebbe00e))
- M1 foundation (workspace, contract, shared helpers, client reducer) ([f3d425e](https://github.com/lnmunhoz/cello/commit/f3d425e7923d5b97fc746c624d5e80825317b04d))

### Fixes

- an agent's live log re-checks its file every second, so a write the file watcher misses still shows up (CEL-126) ([6439e5b](https://github.com/lnmunhoz/cello/commit/6439e5bb0fcca572162e84d5c0ecdf51823c3758))
- questions never go to Claude's window; asks on a closed task point to a follow-up (CEL-124) ([b1c1712](https://github.com/lnmunhoz/cello/commit/b1c1712a3e87c3dcff61c098e426c8646f3c82c5))
- testing-profile detection resolves variables, leaves out folders it can't know, one e2e entry per config, clears stale detected values; agents-md mentions the profile (CEL-96) ([b1843d3](https://github.com/lnmunhoz/cello/commit/b1843d3098e3a2a793fa07cec1d931fc23c8fc99))
- **ask:** a text-only question is optional; the docs stop adding an "Anything else?" question (CEL-116) ([a9fc14d](https://github.com/lnmunhoz/cello/commit/a9fc14da63d67cca864ce7ee2480b31e249c3f5b))
- the setup video remade as a promo-style explainer; the drawing kit shared with the promo (CEL-94) ([5a353b1](https://github.com/lnmunhoz/cello/commit/5a353b19b6985eb250ed65addc3e5bf54ce9a113))
- onboarding footage for agents working and the orchestrator; Agents page says '1 subagent' (CEL-94) ([9c322a6](https://github.com/lnmunhoz/cello/commit/9c322a6042272ceb22bccf95046d1c918e56a6b9))
- service install --replace checks the listener; a failed install names the right folder (CEL-81) ([875c32b](https://github.com/lnmunhoz/cello/commit/875c32bc1ec66a22b26d400b61f1de119d89c1ef))
- orchestrator rows show their task's state; subagents stay under their session (CEL-104) ([f92dba0](https://github.com/lnmunhoz/cello/commit/f92dba01e7554a6e8c8afb2ed882f224178437ac))
- cello wait delivers answers once by the database, even across a restart (CEL-78) ([a085744](https://github.com/lnmunhoz/cello/commit/a08574423d0d614b230ff2faab5ef0c12c45c547))
- no hard-coded 'Lucas' in what Cello ships to other repos; neutral 'the human' (CEL-98) ([9d62f3b](https://github.com/lnmunhoz/cello/commit/9d62f3b1f70d1a5a234acb1ffd9573a6e1cf543b))
- cello wait and task ask --wait ride out a server restart (CEL-78) ([8875d84](https://github.com/lnmunhoz/cello/commit/8875d84032f2a95f76ff9f7708ee2d7cf8cdb74a))
- a comment taken by the waiter shows the agent working on it, its mark thinking (CEL-76) ([9563b91](https://github.com/lnmunhoz/cello/commit/9563b91574326fd7ef1911b0e0cafa1844039c4b))
- the agent mark plays a burst per check-in instead of looping; the ripple holds nothing after it (CEL-69) ([5a5e23f](https://github.com/lnmunhoz/cello/commit/5a5e23f0c73c51161f434da7c93fb068c36e8520))
- moving a task out of In Review withdraws its packet; stale packets count as none (CEL-71) ([cfac29e](https://github.com/lnmunhoz/cello/commit/cfac29e41812a250737d52eebd068b53c873c198))
- cello init --agents-md leaves a customised Cello section alone; --replace swaps it (CEL-61) ([185d071](https://github.com/lnmunhoz/cello/commit/185d071f4ab478b63f3049d4319f9347b422db21))
- **web:** Display stays whole when the task panel is wide; only the tabs scroll (CEL-49) ([3d49551](https://github.com/lnmunhoz/cello/commit/3d49551f981456cb489c9f25632c43e46a9fb5b5))
- **web:** a diagram's button says Open, like the image buttons (CEL-48) ([72de81f](https://github.com/lnmunhoz/cello/commit/72de81f5711ae6fbcd80b5f425d7e10908ea518d))
- the server stops within a second with tabs connected; started writes commit; posters made before the write (CEL-17) ([089bb88](https://github.com/lnmunhoz/cello/commit/089bb887bbea7ee28cccc6ec30faaf7cd71222e5))
- diagrams wrap wide, keep their start on top, edge labels without grey boxes, renders time out (CEL-19) ([517f79e](https://github.com/lnmunhoz/cello/commit/517f79ec3452ad206988158ab641502e5c1a12a2))
- **web:** list layout passes InlineCreate's new tasks prop (CEL-9, CEL-7) ([55cec22](https://github.com/lnmunhoz/cello/commit/55cec22749069d09d4823022050e4b64e5dbd1e5))

### Other changes

- CLI integration tests hold up under load: the claim guard's hook in process, one server per file, smaller tests; a time limit only for tests that launch a real process (CEL-121) ([372aa55](https://github.com/lnmunhoz/cello/commit/372aa550ae2a0cac412f070254e9601908811966))
- **e2e:** needs-input counts the optional text question as answered, and gets a 60 s budget (CEL-116) ([e19f48a](https://github.com/lnmunhoz/cello/commit/e19f48a963989dd6ce1b4cd7214c79a291554ab2))
- **agents:** builders and reviewers run only the related e2e specs, never the full suite (CEL-125) ([3386f36](https://github.com/lnmunhoz/cello/commit/3386f36909b6840af014043901d734dfa8a26f8a))
- run only the e2e specs related to a change; full e2e suite only in set situations (CEL-125) ([e4af08d](https://github.com/lnmunhoz/cello/commit/e4af08db31b3502d82f29a667bac7ced987a5c61))
- **readme:** the setup video at the top, with a poster frame (CEL-109) ([21c7587](https://github.com/lnmunhoz/cello/commit/21c75879bcc1453a83f86cc1743b170baebe6eb7))
- **setup-video:** the onboarding video, narration, music, setup footage and the tools that make it (CEL-94) ([9798e35](https://github.com/lnmunhoz/cello/commit/9798e35428047ffc7bc153fb4d6244c18ce4c09b))
- board footage for the onboarding video, one Playwright scene per test (CEL-94) ([f867e47](https://github.com/lnmunhoz/cello/commit/f867e47d548cef75f92a5cdab6cc38f8f39bea12))
- **e2e:** the profile spec expects the neutral 'set unit' wording (CEL-98) ([eda7cdc](https://github.com/lnmunhoz/cello/commit/eda7cdcf7ce0e1968f882703c5c46f9beba82f25))
- free security checks: dependency review, OSV-Scanner, CodeQL, gitleaks, Dependabot (CEL-99) ([407cb7f](https://github.com/lnmunhoz/cello/commit/407cb7ff5429d3e7a7f2c761c59398707ba51289))
- **agent-setup:** respect CELLO_BIN_DIR and XDG folders, so a test run leaves a machine's real Cello untouched (CEL-95) ([c8f1ba3](https://github.com/lnmunhoz/cello/commit/c8f1ba3db6554495dfef80178097129f6456571e))
- first-time setup guide for agents; README's "let your agent do it" (CEL-95) ([bb2c79d](https://github.com/lnmunhoz/cello/commit/bb2c79da8b75a724d0c9229d50888da9715bb071))
- animated agent marks in the README graphics, ensemble banner, MIT license (CEL-93) ([a56de0e](https://github.com/lnmunhoz/cello/commit/a56de0eaa029a7ea3f00055f4d5c36c6c207a7ec))
- open-source README with philosophy, graphics and roadmap (CEL-93) ([cb03f78](https://github.com/lnmunhoz/cello/commit/cb03f786e307127c9c25f6be409a9fdcaa948c27))
- **cli:** what happens to comments when the session is closed, and on resume (CEL-74) ([fd4f761](https://github.com/lnmunhoz/cello/commit/fd4f761d286433feaf0ab0bd981edfbf839636eb))
- **e2e:** the 40-agents perf test counts the board's own marks, not other specs' agents in the sidebar (CEL-69) ([ed732f4](https://github.com/lnmunhoz/cello/commit/ed732f40410730fd86ec1c64bb91e04af3f115a5))
- **e2e:** an idle page's check counts the page's own animations, not the sidebar's working agents (CEL-69) ([3afb466](https://github.com/lnmunhoz/cello/commit/3afb46638a3c870feaef8ab03e826fc77ed8bf45))
- e2e waits count a cancelled animation as ended, in one helper (CEL-69) ([bfc05ef](https://github.com/lnmunhoz/cello/commit/bfc05ef7b16497fb0cc3c770e41482bbc856c779))
- **e2e:** the search spec highlights its own comment on the shared server (CEL-43) ([3427a07](https://github.com/lnmunhoz/cello/commit/3427a0709054dbd360745b0cbd7e51bab50affbb))
- **agents:** /cello:orchestrate puts a thread in the orchestrator role (CEL-64) ([2271b14](https://github.com/lnmunhoz/cello/commit/2271b1430368374a52e5d7e45771c417a9b8ebab))
- the Claude Code plugin and the orchestrator thread (CEL-64) ([4cdf74f](https://github.com/lnmunhoz/cello/commit/4cdf74f7776557161e440637b21aaf32103d8c06))
- **specs:** Agents working and following an agent's log (CEL-65) ([3100536](https://github.com/lnmunhoz/cello/commit/3100536f6e0f9cf4184eba4e7c9f18c96415d32a))
- **e2e:** the shell spec opens a linked page in the side panel (CEL-60); the search spec looks for its own task on the shared server (CEL-43) ([79996f9](https://github.com/lnmunhoz/cello/commit/79996f9af496612edcee267bb65377060e72bd6c))
- **specs:** test progress on the card (CEL-62) ([18cf5fd](https://github.com/lnmunhoz/cello/commit/18cf5fd8a071c1ecf4c97dc7feec8ae3e31f5095))
- **cli:** decide first whether Lucas is asking for work or just talking; only work becomes a task, checked before it's created ([8387e0c](https://github.com/lnmunhoz/cello/commit/8387e0cb816c00a845727ff8721a665ffa322f73))
- **cli:** the AGENTS.md snippet leads with creating the task (CEL-41) ([96d24d3](https://github.com/lnmunhoz/cello/commit/96d24d3a707179615ca4835c4132697d3735f5e4))
- **cli:** every request from Lucas becomes a Cello task before any code is read; the AGENTS.md snippet leads with it ([dff2141](https://github.com/lnmunhoz/cello/commit/dff2141ed443214237042492fd76bc71ec6fdbf8))
- **agents:** the data reviewer is Sonnet at high effort and checks only the data paths; Opus only for a blocker it can't settle ([bbf2129](https://github.com/lnmunhoz/cello/commit/bbf2129c13355ea36a0c51f7d9b8a529ac802614))
- the full-screen desktop test follows the window, not its first event (CEL-16, CEL-25) ([3fd723a](https://github.com/lnmunhoz/cello/commit/3fd723a44112156ae74b24919ec886315e1b6db0))
- **e2e:** the sidebar spec expects CEL-54's Not found title for an unknown project ([2258498](https://github.com/lnmunhoz/cello/commit/225849884c429e361ee34e43ec5e2dae9a541206))
- **cli:** everything shown to Lucas goes into Cello as pages; the AGENTS.md snippet says so for every Cello project ([3c9d900](https://github.com/lnmunhoz/cello/commit/3c9d90073a073caecf5c073b13f8fd446fe1ac59))
- **agents:** show Lucas evidence as Cello pages, never Claude artifacts ([b28dd3b](https://github.com/lnmunhoz/cello/commit/b28dd3be4678cb11a13eb35da108068262db5730))
- the board-fills-the-window test waits for the window to settle (CEL-50, CEL-16) ([1470c37](https://github.com/lnmunhoz/cello/commit/1470c3721a67fe3d2b003d820d9871da066e176d))
- In Progress means someone is on it now; a scope waiting on Lucas goes back to Todo ([27b73b3](https://github.com/lnmunhoz/cello/commit/27b73b3f7c18b6b9313b03d37542f93a2069f3fc))
- **agents:** Lucas's feedback in chat is a review: comment it on the card, move the task back to In Progress ([3c3b976](https://github.com/lnmunhoz/cello/commit/3c3b9763a965738ea4a2ef0a9267dfa20a691c24))
- design-hook exception for the markdown blockquote's neutral side border ([7cb73e1](https://github.com/lnmunhoz/cello/commit/7cb73e1ccdda1a92a4ee84befbfb548d27cc3df2))
- **spec:** Lucas can paste screenshots into his answers (CEL-47) ([9a3759c](https://github.com/lnmunhoz/cello/commit/9a3759c40ab4cf5fcf61d9f59b15ca3a63ed7e87))
- **spec:** Needs input, agents ask Lucas on the card and wait for his answer (CEL-47) ([7468609](https://github.com/lnmunhoz/cello/commit/74686092574a6aba54604c80a051906339e53856))
- what each column means for the version you're running ([9afd602](https://github.com/lnmunhoz/cello/commit/9afd602c6df24fc20d09acd5f1b0082d6439fa74))
- **desktop:** bun run package -- --install copies Cello.app to /Applications ([b18a657](https://github.com/lnmunhoz/cello/commit/b18a6574d75fadfec4e58b544aacdad74e80675a))
- **cli:** set up a repo for Cello, step by step, so any agent can do it from cello guide ([f036947](https://github.com/lnmunhoz/cello/commit/f0369475c40c9f4706246910ca09ada4ecd2ea19))
- ignore the settings backup cello install claude keeps (CEL-15) ([e0f7171](https://github.com/lnmunhoz/cello/commit/e0f7171d0521581dd5258b1044dbdb8f3a247722))
- **agents:** submit right after each merge, never batch packets for a later deploy ([782e702](https://github.com/lnmunhoz/cello/commit/782e702c39582c49792f3c6f0e00ab8350295953))
- how a feature is built, end to end, with diagrams ([98eb4f2](https://github.com/lnmunhoz/cello/commit/98eb4f21db7e5f2048720765891bd000fa5ba85f))
- when to use which model and effort for agent work ([902b5bb](https://github.com/lnmunhoz/cello/commit/902b5bb71cdda44d93b8428e57008cb3bc36b2ba))
- **agents:** models and effort per agent; one reviewer per branch, blocker-only re-checks ([34da653](https://github.com/lnmunhoz/cello/commit/34da653d24078533d76d9fe53994c8d974702090))
- **cli:** one reference for agents in docs/cli.md, printed by cello guide and checked against the CLI (CEL-30) ([11a71e0](https://github.com/lnmunhoz/cello/commit/11a71e002297562d487632b1c7956abe1c26b5c9))
- **agents:** Backlog holds what still needs discussing, Todo is ready to build ([5ab6da1](https://github.com/lnmunhoz/cello/commit/5ab6da1d99a69f67e05d21030e88335ac2441bc9))
- **agents:** build, review, merge, submit flow, with builder and reviewer agents (CEL-28) ([583cf28](https://github.com/lnmunhoz/cello/commit/583cf287ae0fb4d115c19754c889f6257c39000e))
- how evidence videos and screenshots are made ([3cbc980](https://github.com/lnmunhoz/cello/commit/3cbc98099bd46f3cabf69eaa6e310f132b12b5b8))
- **agents:** when to publish a doc, a spec or a page ([fd0d729](https://github.com/lnmunhoz/cello/commit/fd0d729349d436251658221ed0cfac04ecb1650b))
- **agents:** open pages and artifacts for Lucas inside Cello's panel ([4ff0fe3](https://github.com/lnmunhoz/cello/commit/4ff0fe3697906cfff07eaaa8a25314511cd09967))
- review inside Cello: review packets, viewer panel, Pages and desktop app move into M2 ([7b2ce5f](https://github.com/lnmunhoz/cello/commit/7b2ce5f67c59d032fd12678eb6f3d55b568ab9ce))
- configurable web and e2e server ports ([76d5786](https://github.com/lnmunhoz/cello/commit/76d5786bf445995475d09f52174bb3d4da360d8b))
- M2 plan and the Cello-builds-Cello bootstrap ([3b623a2](https://github.com/lnmunhoz/cello/commit/3b623a2f4d8211835497be3a837171c024ff2cde))
- installable PWA in M1, Electron desktop app after v1 ([b0cf835](https://github.com/lnmunhoz/cello/commit/b0cf835e02eda405a1a8df3233b711f20cca6c28))
- M0 prototypes (identity, board UI, agent cursor, Effect slice) ([2d68051](https://github.com/lnmunhoz/cello/commit/2d68051f54a7e3143a90621f55e4f92b05c91e8b))
- M0 spike findings, M1 plan, spec updates ([1ec94a1](https://github.com/lnmunhoz/cello/commit/1ec94a1a680b0e0e2b840bd75528b79cab7dfc80))
- Cello spec and reference screenshots ([4832581](https://github.com/lnmunhoz/cello/commit/4832581ce9f07171d704dc70e6f6171ca637dd6b))
