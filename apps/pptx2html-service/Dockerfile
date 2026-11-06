# apps/pptx2html-service — monorepo root-context build.
#
#   docker build -f apps/pptx2html-service/Dockerfile .
#
# The runtime keeps the former app Dockerfile's shape: puppeteer-core drives Chromium to render
# runtime/converter.html, with CJK fonts for Japanese courseware. Dependencies come from the root
# lockfile through `pnpm deploy --prod` instead of the former `yarn install`, which needs a
# yarn.lock the monorepo no longer has.

FROM node:22.23.4-bookworm-slim AS build
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV npm_config_registry=$NPM_REGISTRY
WORKDIR /app

RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
RUN pnpm fetch

COPY . .
RUN pnpm install --offline --frozen-lockfile --filter ainobi-pptx2html-service...
RUN npm_config_node_linker=hoisted pnpm --filter ainobi-pptx2html-service deploy --prod --legacy /out

FROM node:22.23.4-bookworm-slim
WORKDIR /app

# Rendering dependencies: Chromium (in place of chrome-headless-shell) + CJK fonts.
# Build environments sit behind a proxy chain: deb.debian.org intermittently returns 502 and
# large plain-http transfers stall. Switch to the Aliyun mirror with only main (a smaller
# index), install ca-certificates over http, then move to https for the rest.
# An empty APT_MIRROR keeps Debian's own archive.
ARG APT_MIRROR=
RUN if [ -n "$APT_MIRROR" ]; then \
      sed -i "s|http://deb.debian.org|http://${APT_MIRROR}|g; s|^Components:.*|Components: main|" /etc/apt/sources.list.d/debian.sources; \
    fi \
    && apt-get update -o Acquire::Retries=10 -o Acquire::http::Timeout=60 \
    && apt-get install -y --no-install-recommends -o Acquire::Retries=10 ca-certificates \
    && if [ -n "$APT_MIRROR" ]; then sed -i "s|http://${APT_MIRROR}|https://${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources; fi \
    && apt-get update -o Acquire::Retries=10 -o Acquire::https::Timeout=60 \
    && apt-get install -y --no-install-recommends -o Acquire::Retries=10 \
        chromium fonts-ipafont fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /out/node_modules ./node_modules
COPY apps/pptx2html-service/package.json ./package.json
COPY apps/pptx2html-service/index.js ./index.js
COPY apps/pptx2html-service/src ./src
COPY apps/pptx2html-service/runtime ./runtime

ENV NODE_ENV=production \
    PORT=3000 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_ARGS=--no-sandbox,--disable-setuid-sandbox

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "index.js"]
