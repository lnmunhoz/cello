# Cello for macOS

The board in its own window, with a browser panel docked on the right. The panel loads pages
top-level (an Electron `WebContentsView`), so it shows pages a browser iframe can't, like Claude
artifact pages (claude.ai sends `frame-ancestors 'self'`), plus any website and local dev servers.

## Commands

Run them in `apps/desktop`:

```bash
bun run dev        # build the app and run it with Electron
bun run package    # build apps/cli/dist/cello, then an unsigned Cello.app in dist/mac-arm64/
bun run package -- --install   # same, then copy it to /Applications (Launchpad, Spotlight, Raycast)
bun run test:e2e   # Playwright's Electron tests, in Docker (same as test:docker:desktop at the root)
```

- **`bun run dev`** joins the server already running on `CELLO_PORT` (4747 by default, e.g.
  `cello start` in a terminal, which is your real board). With none running it starts
  `apps/cli/dist/cello` (run `bun run build` in `apps/cli` first). Dev keeps its window state
  in `~/Library/Application Support/Cello Dev`, apart from the packaged app's `Cello`.
- **`bun run package`** makes `dist/mac-arm64/Cello.app` (Apple silicon, about 355 MB), with the
  compiled `cello` binary, web app included, at `Contents/Resources/cello`. `--skip-cli` reuses
  the binary as it is. The app isn't signed: the first time, open it with right-click → Open.
  - The Mac that packages needs **Xcode 26** (`xcrun --find actool`). electron-builder compiles the
    icon (`resources/Cello.icon`) with actool into `Assets.car`, so macOS 26 draws it flat instead of
    redrawing it as glass, and it adds an `icon.icns` for older macOS. Without Xcode 26 the package
    step fails.
- **`bun run package -- --install`** also makes `/Applications/Cello.app` the copy `cello://` links
  open; see "Which copy opens `cello://` links" below.
- **`bun run test:e2e`** runs the tests in a throwaway Linux container (`scripts/test-in-docker.ts`,
  OrbStack must be running), with the app under Xvfb, so no window opens on the Mac. Arguments
  after `--` go to `playwright test`. Videos and screenshots land in
  `test-results/docker/latest/desktop/` at the repo root, with `summary.txt` and the logs.
  - Inside, `test:e2e:local` builds the app, builds `apps/cli/dist/cello` (a Linux binary there) if
    it's missing, and runs Playwright. Every test runs its own `cello start` with a temp data
    folder on a free port, never 4747, 4748, 5199 or `~/.cello`.
  - `playwright.config.ts` refuses to run on macOS. `CELLO_ALLOW_LOCAL_DESKTOP=1 bun run
    test:e2e:local` is the rare exception, for a check only macOS can do (Dock, `cello://`
    through LaunchServices, the app menu), and only when Lucas asks for one.
  - On Linux the keys are Ctrl where macOS has ⌘ (Electron's CommandOrControl; the tests' helpers
    pick the right one). In the container Electron gets `--no-sandbox` (it runs as root),
    `--force-device-scale-factor=2` (Retina-sharp screenshots) and `--hide-scrollbars`
    (`e2e/support.ts` says why).
  - `CELLO_E2E_ONLINE=1` adds the claude.ai test, which needs the internet; it's passed into the
    container. The recorder holds each step's result 1.2 s, so these videos need no slow motion.

## The server

Electron's Node can't run the Bun server, so the app uses the `cello` binary as a sidecar
(`src/server/`):

1. If a live server holds the data folder's `server.lock`, or anything answers on `CELLO_PORT`,
   the app joins it and leaves it alone on quit. That includes the background service
   (`cello service install`, CEL-81).
2. If the background service is installed for the data folder but nothing answers, it asks
   launchd to start it (`launchctl kickstart`) and waits; it never starts a server beside it. If the
   service doesn't come up (a stale plist), it starts its own server and the app menu says why.
3. Otherwise it runs `cello start` (with `CELLO_PORT` and `CELLO_DATA_DIR`), waits for its
   "Cello is running at …" line, and loads the board from it.
4. On quit, only for a server it started (`src/server/quit.ts`), the first time it asks: **Keep
   Running** (it stops its child, whose output is piped to the app, and starts a detached
   `cello start` logging to `<data folder>/logs/server.log`; if that one doesn't answer, it says so,
   stays open and starts its own server again), **Stop Server** (SIGTERM, SIGKILL
   after 5 s), or **Install Background Service** (stops its child, then `cello service install`
   with the `cello` in `CELLO_BIN`, `~/.local/bin` or the app). Keep and Stop are remembered in
   `server-on-quit.json` in the app's user data folder; delete it to be asked again.
5. The app menu's status line says who runs the server: "Server: background service (pid …)",
   "Server: started by this app (pid …)" or "Server: started outside the app (pid …)".

| Variable | Default | |
| --- | --- | --- |
| `CELLO_PORT` | `4747` | the server's port |
| `CELLO_DATA_DIR` | `~/.cello` | the data folder, as for `cello start` |
| `CELLO_BIN` | bundled / `apps/cli/dist/cello` | the `cello` binary to start |
| `CELLO_DESKTOP_USER_DATA` | `~/Library/Application Support/Cello` | the app's own state (tests use a temp folder) |

## The panel

- **Open it from the web app:** `window.celloDesktop.openPanel(url, title?)` and `closePanel()`
  (the preload's bridge, `isDesktop: true`). Use `openInPanel(url, title?)` from
  `apps/web/src/lib/desktop.ts`: it's the one entry point for evidence, pages and links, and outside
  the app it opens them in the web app's own viewer panel (`apps/web/src/viewer`). Only http(s)
  URLs open; relative ones (`/attachments/<id>`) are made absolute first.
- Links that open a new window, from the board or from a panel page, open in the panel. Links off
  the board's origin open there too. A scripted popup (`window.open` with features, as sign-in
  flows use) opens as its own window.
- The board's own pages show in the panel without the app's sidebar (`?embed=1`), however they got
  there: from the board, a `cello://open` link, the address field, or a link followed inside the panel.
- A task key clicked in a Cello page in the panel opens the task in the main window; the page stays
  in the panel. Main sends the key to the board's preload, which hands it to the web app as the same
  `cello:task` message a page in the web viewer's iframe posts, so the board opens it with its router,
  without reloading.
- Only Cello pages can do that. A link to a board task on any other site loads in the panel instead,
  so a site can't switch the board's task, or take the focus, by setting `location` or calling
  `window.open` on its own.
- **Toolbar:** back, forward, reload, the title (click it to type a URL: `localhost:5173`,
  `claude.ai/…`), open in your browser, close. Drag the panel's left edge to resize it.
- **Keys:** ⌘\ toggles the panel (it comes back on the page it showed), ⌘L puts the cursor in the
  address field. Pages in the panel keep their sign-ins across launches (`persist:panel`).

## Back and forward

The main window goes back and forward like a browser (CEL-54), in the board, or in the panel's page
when the panel has focus:

- ⌘[ and ⌘] (Ctrl on Linux and Windows), also in the **History** menu as Back and Forward
- a mouse's back and forward buttons: Windows and Linux report them as app commands
  (`browser-backward`, `browser-forward`), which `MainWindow` takes; macOS reports them only to the
  page, so the board's preload takes them there
- a trackpad swipe on macOS, when System Settings › Trackpad › More Gestures › "Swipe between pages"
  is set to swipe with two or three fingers (Electron's `swipe` event)

Which input means which way is `src/window/history.ts`. The "Starting Cello…" message the board
replaces is dropped from the board's history, so Back never lands on it.

- **What's checked where:** the keys, the History menu and the app commands run in the desktop e2e
  (Linux, in Docker). The trackpad swipe and a real mouse's buttons on macOS are covered only by the
  unit tests of `history.ts`; nobody has checked them on a real Mac yet.
- **Not handled:** on macOS a mouse's back and forward buttons do nothing over the panel's page (it's
  any website, with no preload of ours). Its toolbar has Back and Forward, and ⌘[ / ⌘] work there.
- The window's size and position, and the panel's width, are saved; the panel's page lasts as
  long as the app runs.

## `cello://` links

- `cello://CEL-3` opens that task on the board.
- `cello://open?url=<encoded URL>` opens a page in the panel.

The packaged app registers the scheme (Info.plist and `setAsDefaultProtocolClient`). One copy
runs at a time: opening a link while it runs, or launching it again, hands the link to the
running app.

### Which copy opens `cello://` links

Every `Cello.app` on disk claims `cello://`, and macOS (LaunchServices) can hand a link to any copy it
has seen: `/Applications/Cello.app`, but also `dist/mac-arm64/Cello.app` in the repo and in each agent's
worktree. A copy started before a fix was merged keeps running the old code even after its files are
replaced (CEL-75: a Cello started from `dist/` at 17:54 kept sending Cello pages to the browser panel
after CEL-60 fixed that at 23:01).

So `bun run package -- --install` copies the app to `/Applications/.Cello.app.new` first and swaps it in
only once that copy succeeded (a failed copy leaves the old app in place), then:

1. **unregisters the build folders' copies** from LaunchServices (`lsregister -u`): every `Cello.app`
   under `apps/desktop/dist*/` in the repo, its git worktrees and any folder in `.claude/worktrees/`,
   whether it's still on disk or only still registered. The folders stay; nothing is deleted. Copies
   anywhere else (Downloads, another clone) are left alone.
2. **registers `/Applications/Cello.app` again** (`lsregister -f`), so links open it.
3. **warns about a Cello that won't run the new build**, without quitting it: one running from another
   copy, or `/Applications`' copy started before the install began.

```text
Installed /Applications/Cello.app
Unregistered /Users/me/projects/cello/apps/desktop/dist/mac-arm64/Cello.app from LaunchServices (the folder stays)
cello:// links now open /Applications/Cello.app
! Cello (pid 95951) is running from /Users/me/projects/cello/apps/desktop/dist/mac-arm64/Cello.app, not /Applications/Cello.app. Quit it (⌘Q) and open /Applications/Cello.app, so cello:// links reach the new build.
```

When you see the `!` line, quit Cello and open it from /Applications (Launchpad, Spotlight, Raycast).
`bun scripts/install.ts` prints what an install would do right now (which copies it would unregister,
which running Cello it would warn about) and changes nothing. A later `bun run package` (without
`--install`) makes a fresh `dist/` copy that macOS may register again; the next `--install` unregisters it.

The decisions are in `src/install/plan.ts` (pure, unit-tested); `scripts/install.ts` gathers the facts
(`git worktree list`, `lsregister -dump`, `ps`) and runs them.

### The app says when it should restart

The board reloads into a new web build by itself (CEL-37), but the app around it keeps the code it
started with. So the app checks its own build too, each time its window takes focus and each time a
`cello://` link arrives, and shows a notice at the top of the board:

- **"The Cello app was updated · Restart"** when the build on disk isn't the one it loaded.
  `scripts/build.ts` writes `dist-electron/build.json` (build time and commit) on every build;
  electron-builder copies it beside `app.asar` (`Contents/Resources/build.json`), where the app reads it
  at launch and again on each check. (Not from inside app.asar: Electron keeps the archive it loaded open.)
- **"Cello is running from a build folder · Restart from Applications"** when the packaged app runs
  from a copy other than `/Applications/Cello.app` while that one exists.

**Restart** quits the app (stopping a server it started, without the quit question) and starts it again: the same
executable with its launch arguments, or `/Applications/Cello.app` when it ran from another copy. It
checks again first, and while that executable isn't on disk (an install halfway through) it does
nothing and the notice stays. **×** hides the notice until the next build, or until the board reloads. Dev (`bun run dev`) gets the "updated" notice after a rebuild,
never the build-folder one. The rules are `src/update/appUpdate.ts`; the notice is
`apps/web/src/app/AppRestartBar.tsx`, through `window.celloDesktop.onAppNotice` and `restartApp`
(missing in older app builds, where the web app shows nothing).

## Code

- `src/main.ts`: startup, single instance, links, menu, quit
- `src/window/`: the main window, its layout (board view, panel views) and its back and forward
- `src/panel/`: the panel (`Panel.ts`), its toolbar page (`chrome.*`) and the URL rules (`urls.ts`)
- `src/server/`: finding or starting the server (`plan.ts` decides, `sidecar.ts` does it)
- `src/install/plan.ts`: what `package -- --install` does after copying the app (LaunchServices, warnings)
- `src/update/appUpdate.ts`: when the running app offers a restart, and into which copy
- `src/preload.ts`: `window.celloDesktop`
- `scripts/`: bundling with Bun (`dist-electron/`), dev, packaging (electron-builder)
- `resources/Cello.icon/` (the packaged app, an Icon Composer document) and `resources/icon.png` (the
  Dock in dev): built by `bun art/icon/build-app-icons.mjs` from `art/icon/icon.svg`; don't edit them by hand
- `e2e/`: Playwright Electron tests (run in Docker); `recorder.ts` composes the whole window into videos and screenshots
