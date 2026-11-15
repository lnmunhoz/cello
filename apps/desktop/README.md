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
   the app joins it and leaves it alone on quit.
2. Otherwise it runs `cello start` (with `CELLO_PORT` and `CELLO_DATA_DIR`), waits for its
   "Cello is running at …" line, and loads the board from it.
3. On quit it closes the window, then stops that server (SIGTERM, SIGKILL after 5 s), but only
   one it started. It never starts a second server for a data folder a live one holds.

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
- The window's size and position, and the panel's width, are saved; the panel's page lasts as
  long as the app runs.

## `cello://` links

- `cello://CEL-3` opens that task on the board.
- `cello://open?url=<encoded URL>` opens a page in the panel.

The packaged app registers the scheme (Info.plist and `setAsDefaultProtocolClient`). One copy
runs at a time: opening a link while it runs, or launching it again, hands the link to the
running app.

## Code

- `src/main.ts`: startup, single instance, links, menu, quit
- `src/window/`: the main window, its layout (board view, panel views) and its back and forward
- `src/panel/`: the panel (`Panel.ts`), its toolbar page (`chrome.*`) and the URL rules (`urls.ts`)
- `src/server/`: finding or starting the server (`plan.ts` decides, `sidecar.ts` does it)
- `src/preload.ts`: `window.celloDesktop`
- `scripts/`: bundling with Bun (`dist-electron/`), dev, packaging (electron-builder)
- `resources/Cello.icon/` (the packaged app, an Icon Composer document) and `resources/icon.png` (the
  Dock in dev): built by `bun art/icon/build-app-icons.mjs` from `art/icon/icon.svg`; don't edit them by hand
- `e2e/`: Playwright Electron tests (run in Docker); `recorder.ts` composes the whole window into videos and screenshots
