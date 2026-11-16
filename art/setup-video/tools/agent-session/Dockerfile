# A clean Linux machine for recording the CEL-94 onboarding video's agent scenes.
# Someone drives it by hand (record.sh): a real Claude Code session sets Cello up from one sentence,
# then a second one runs /cello:orchestrate. Nothing from the Mac is mounted except the output folder.
FROM mcr.microsoft.com/playwright:v1.65.1-noble

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl unzip ca-certificates asciinema ffmpeg fonts-inter \
 && rm -rf /var/lib/apt/lists/*

# Claude Code, pinned to the version on the Mac that recorded the rest.
RUN npm install -g @anthropic-ai/claude-code@2.1.325

# The board recorder: Playwright drives the image's own Chromium, headless.
WORKDIR /opt/recorder
RUN npm init -y >/dev/null && npm install --no-audit --no-fund playwright@1.65.1 @xterm/xterm@5.5.0
COPY record-board.mjs render-cast.mjs /opt/recorder/

# A new user with a small project. Bun is already installed, as on most developers' machines.
RUN useradd -m -s /bin/bash dev
USER dev
WORKDIR /home/dev
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.4"
ENV PATH="/home/dev/.bun/bin:/home/dev/.local/bin:${PATH}"
RUN git config --global user.name "Sam Rivera" \
 && git config --global user.email "sam@example.com" \
 && git config --global init.defaultBranch main
COPY --chown=dev:dev acme-shop /home/dev/acme-shop
RUN cd /home/dev/acme-shop && git init -q && git add -A && git commit -qm "Acme Shop: products, cart, tests"
# Claude Code's first-run screens (theme, trust this folder) are answered, so the video starts at the prompt.
COPY --chown=dev:dev claude.json /home/dev/.claude.json
COPY --chown=dev:dev session.sh setup-demo.sh /home/dev/
ENTRYPOINT ["bash", "/home/dev/session.sh"]
