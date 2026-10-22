FROM node@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates && rm -rf /var/lib/apt/lists/*
ENV CHROME_PATH=/usr/bin/chromium
USER node
WORKDIR /repo
CMD ["node", "--test", "--test-concurrency=1", "tests/browser.test.mjs", "tests/deny-proxy.test.mjs", "tests/draw.test.mjs", "tests/network-policy.test.mjs", "tests/package.test.mjs", "tests/public-server.test.mjs", "tests/visual.test.mjs"]
