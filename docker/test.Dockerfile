# The image Cello's tests run in (scripts/test-in-docker.ts), so UI tests never open a window on the Mac.
# Playwright's Ubuntu 24.04 image, whose browsers match the pinned @playwright/test exactly (the runner
# passes its version from package.json), plus Bun (.bun-version), ffmpeg for the MP4s, Xvfb for
# Electron, and Inter, the board's font, so screenshots look like the app instead of a fallback font.
# The runner tags the image by a hash of this file and both versions; change either and it rebuilds.
ARG PLAYWRIGHT_VERSION
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble

ARG BUN_VERSION

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl unzip ffmpeg xvfb xauth fonts-inter fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

# Bun from its GitHub release, checked against the release's SHASUMS256.txt.
RUN set -eu; \
    case "$(dpkg --print-architecture)" in arm64) arch=aarch64 ;; amd64) arch=x64 ;; *) echo "unsupported architecture" >&2; exit 1 ;; esac; \
    cd /tmp; \
    base="https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}"; \
    curl -fsSLO "$base/bun-linux-$arch.zip"; \
    curl -fsSL "$base/SHASUMS256.txt" | grep " bun-linux-$arch.zip\$" | sha256sum -c -; \
    unzip -q "bun-linux-$arch.zip"; \
    install -m 0755 "bun-linux-$arch/bun" /usr/local/bin/bun; \
    ln -s /usr/local/bin/bun /usr/local/bin/bunx; \
    rm -rf /tmp/bun-linux-*; \
    test "$(bun --version)" = "$BUN_VERSION"
