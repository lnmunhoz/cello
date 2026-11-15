---
title: How evidence videos and screenshots are made
summary: Every video in a review packet comes from a real test run against a real Cello server, recorded by Playwright and converted with ffmpeg, then attached with cello task submit.
---

## The short version

The videos and screenshots in review packets aren't screen recordings of someone's desktop. They come from **automated end-to-end tests**: a headless browser (or the desktop app) drives the real Cello against a real server with a throwaway data folder, and records what it sees. ffmpeg turns the recording into an MP4 that plays everywhere, and the agent attaches it to the task with `cello task submit`.

```mermaid
flowchart TD
    A["① A test drives Cello<br/>Playwright: browser or desktop app<br/>real server, temp data folder, its own ports"] --> B["② The page draws a cursor, click ripples and captions<br/>so the video shows what happens"]
    B --> C["③ Playwright records the run<br/>WebM, 1440×900"]
    C --> D["④ ffmpeg converts it to MP4<br/>H.264, plays on phones"]
    D --> E["⑤ The agent attaches it<br/>cello task submit --attach video.mp4 --caption …"]
    E --> F["⑥ The server copies it into ~/.cello/assets<br/>and grabs a poster frame with ffmpeg"]
    F --> G(["⑦ It plays on the Review page<br/>and in the viewer side panel"])
```

## Tools

| Tool | Version | What it does here |
| --- | --- | --- |
| Playwright (`@playwright/test`) | 1.65.1 | Drives the browser and the desktop app, records video, takes screenshots |
| Chromium headless shell | from Playwright | The browser the web tests run in, with no window on screen |
| Electron + Playwright `_electron` | Electron 44 | Launches and drives the desktop app in its own tests |
| ffmpeg | 8.1.2 | Converts recordings to MP4, burns in captions for desktop videos, grabs poster frames |
| Bun | 1.4.4 | Runs the test servers, the build and the `cello` CLI |
| `cello` CLI | this repo | `cello task submit` attaches the files to a task as a review packet |

## 1. Web end-to-end videos (most review evidence)

- **Where:** `e2e/*.spec.ts`, settings in `playwright.config.ts`.
- **Setup per run:** Playwright starts a real Cello server (`apps/server`) with a temporary data folder, plus `vite preview` serving the built web app. Each run uses its own ports (`CELLO_E2E_SERVER_PORT`, `CELLO_WEB_PORT`), so it never touches your board on 4747.
- **Recording:** every test is recorded (`video: { mode: "on", size: 1440×900 }`), as a WebM per browser tab.
- **What makes it readable:** `e2e/fixtures.ts` injects a small overlay into every page:
  - a dot that follows the mouse (headless browsers draw no cursor)
  - a ripple on every click
  - a caption box at the bottom; tests call `caption(page, "Open it")` before each step
- **Slow motion for review videos:** `CELLO_E2E_SLOWMO=400` slows every browser action by 400 ms, so each step is visible. Tests never depend on it; it's only for recording.
- **After the run:** `e2e/teardown.ts` converts each WebM to MP4 with ffmpeg (`-c:v libx264 -pix_fmt yuv420p -movflags +faststart -an`) into `e2e/videos/`, and deletes the temporary data folder.

```bash
bun run --filter @cello/web build
CELLO_WEB_PORT=5491 CELLO_E2E_SERVER_PORT=4791 CELLO_E2E_SLOWMO=400 npx playwright test e2e/review.spec.ts
# → e2e/videos/<test name>.mp4
```

## 2. Desktop app videos

- **Where:** `apps/desktop/e2e/desktop.spec.ts`, recorder in `apps/desktop/e2e/recorder.ts`.
- **Why a custom recorder:** the app window is three web views side by side (the board, the panel's toolbar, the panel's page), and Playwright records one page at a time. The recorder captures each visible view, puts them together into one frame of the whole window, and saves JPEG frames with timestamps.
- **Encoding:** ffmpeg joins the frames into an MP4 and burns the step captions into the picture.
- **Limits:** no cursor or click ripples in these videos, and the screen itself is never recorded, so other windows can't leak in.

```bash
cd apps/desktop && bun run test:e2e
# → apps/desktop/test-results/videos/<test name>.mp4
```

## 3. Screenshots and demo recordings

- **Screenshots** come from Playwright's `page.screenshot`, usually at 2× scale, in both themes (`colorScheme: "dark" | "light"`). Before-and-after pairs are taken against your real board on 4747, **view only**: the script opens pages and clicks nothing that changes data.
- **Demo walkthroughs** (like "setting up the Cello project") are one-off Playwright scripts with the same cursor, ripple and caption overlay, recorded the same way and converted with the same ffmpeg command.

## 4. From a file to evidence on the task

```bash
cello task submit CEL-12 \
  --summary "What changed, in a sentence or two" \
  --step "How to check it, step 1" \
  --attach e2e/videos/<test>.mp4 --caption "What the video shows" \
  --attach shots/after.png --caption "After"
```

- The CLI passes the local file paths; the server **copies** each file into `~/.cello/assets/<task>/` (up to 50 MB each; images, videos and text files only).
- For each video the server grabs a **poster frame** with ffmpeg, if ffmpeg is installed.
- Files are served at `/attachments/<id>` with seeking support, and play on the Review page, in the task panel and in the viewer side panel.
- The copy in `~/.cello/assets` is the one that's kept. The raw recordings in `e2e/videos/` and in agents' worktrees are temporary.

## Known limits

- **Headless runs:** frame rates are measured in a headless browser, not on a real display.
- **Short videos:** at full speed a test finishes in seconds; use `CELLO_E2E_SLOWMO` when recording for review.
- **First frame:** some posters show a white frame because recording starts while the page is still loading.
- **Codecs:** Playwright's Chromium can't play H.264, so the one test that plays a video in the browser attaches a VP9 file; everything else is H.264.
- **Backups:** evidence lives only in `~/.cello` on this Mac (CEL-23 adds automatic local backups).
