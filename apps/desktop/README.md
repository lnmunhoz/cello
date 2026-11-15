# Cello for macOS

The board in its own window, with a browser panel docked on the right. The panel loads pages
top-level (an Electron `WebContentsView`), so it shows pages a browser iframe can't, like Claude
artifact pages (claude.ai sends `frame-ancestors 'self'`), plus any website and local dev servers.

## Commands

Run them in `apps/desktop`:

```bash
bun run dev        # build the app and run it with Electron
bun run package    # build apps/cli/dist/cello, then an unsigned Cello.app in dist/mac-arm64/
bun run test:e2e   # build, then Playwright's Electron tests (videos in test-results/videos)
```

- **`bun run dev`** joins the server already running on `CELLO_PORT` (4747 by default, e.g.
  `cello start` in a terminal, which is your real board). With none running it starts
  `apps/cli/dist/cello` (run `bun run build` in `apps/cli` first). Dev keeps its window state
  in `~/Library/Application Support/Cello Dev`, apart from the packaged app's `Cello`.
- **`bun run package`** makes `dist/mac-arm64/Cello.app` (Apple silicon, about 355 MB), with the
  compiled `cello` binary, web app included, at `Contents/Resources/cello`. `--skip-cli` reuses
  the binary as it is. The app isn't signed: the first time, open it with right-click → Open.
- **`bun run test:e2e`** builds `apps/cli/dist/cello` if it's missing. Every test runs its own
  `cello start` with a temp data folder on a free port, never 4747, 4748, 5199 or `~/.cello`.
  `CELLO_E2E_ONLINE=1` adds the claude.ai test, which needs the internet.

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
- The board's own pages show in the panel without the app's sidebar (`?embed=1`), however they were
  opened: from the board, a `cello://open` link or the address field.
- A link in the panel to a task on the board (a task key in a Cello page, `…/CEL/3` on any site)
  opens the task in the main window; the page stays in the panel. Main sends the key to the board's
  preload, which hands it to the web app as the same `cello:task` message a page in the web viewer's
  iframe posts, so the board opens it with its router, without reloading.
- **Toolbar:** back, forward, reload, the title (click it to type a URL: `localhost:5173`,
  `claude.ai/…`), open in your browser, close. Drag the panel's left edge to resize it.
- **Keys:** ⌘\ toggles the panel (it comes back on the page it showed), ⌘L puts the cursor in the
  address field. Pages in the panel keep their sign-ins across launches (`persist:panel`).
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
- `src/window/`: the main window and its layout (board view, panel views)
- `src/panel/`: the panel (`Panel.ts`), its toolbar page (`chrome.*`) and the URL rules (`urls.ts`)
- `src/server/`: finding or starting the server (`plan.ts` decides, `sidecar.ts` does it)
- `src/preload.ts`: `window.celloDesktop`
- `scripts/`: bundling with Bun (`dist-electron/`), dev, packaging (electron-builder)
- `e2e/`: Playwright Electron tests; `recorder.ts` composes the whole window into videos and screenshots
