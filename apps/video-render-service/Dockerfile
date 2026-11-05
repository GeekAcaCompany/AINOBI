# apps/video-render-service — monorepo root-context build.
#
#   docker build -f deploy/dockerfiles/video-render-service.Dockerfile .
#
# Dependencies follow pnpm's Docker pattern (`pnpm fetch` from the lockfile, an offline
# install of the full context), as in the other service Dockerfiles. The runtime tree is
# `pnpm deploy --prod` (hoisted, flat node_modules) plus dist/, with the Hyperframes
# download/audio patches applied to that tree — the app-local image ran them as the
# yarn postinstall.

FROM node:22.23.4-bookworm-slim AS build
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV npm_config_registry=$NPM_REGISTRY \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
WORKDIR /app

RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
RUN pnpm fetch

COPY . .
RUN pnpm install --offline --frozen-lockfile --filter ainobi-video-render-service...
RUN pnpm --filter ainobi-video-render-service run build

RUN npm_config_node_linker=hoisted pnpm --filter ainobi-video-render-service deploy --prod --legacy /out \
    && rm -rf /out/dist /out/src \
    && cp -a apps/video-render-service/dist /out/dist \
    && mkdir -p /out/scripts \
    && cp apps/video-render-service/scripts/patch-hyperframes-url-downloader.mjs /out/scripts/ \
    && cd /out && node scripts/patch-hyperframes-url-downloader.mjs \
    && rm -rf /out/scripts \
    # The patch script only logs when it finds nothing to patch; never ship an unpatched tree.
    && grep -q AINOBI_DOWNLOAD_RETRY_PATCH_V1 node_modules/@hyperframes/engine/dist/utils/urlDownloader.js \
    && grep -q AINOBI_AUDIO_FAIL_HARD_V1 node_modules/@hyperframes/engine/dist/services/audioMixer.js \
    && grep -q AINOBI_DOWNLOAD_RETRY_PATCH_V1 node_modules/@hyperframes/producer/dist/index.js \
    && grep -q AINOBI_AUDIO_FAIL_HARD_V1 node_modules/@hyperframes/producer/dist/index.js

FROM node:22.23.4-bookworm-slim
WORKDIR /app

RUN sed -i 's|deb.debian.org|mirrors.ustc.edu.cn|g' /etc/apt/sources.list.d/debian.sources /etc/apt/sources.list 2>/dev/null || true \
    && apt-get -o Acquire::Retries=10 update \
    && apt-get -o Acquire::Retries=10 install -y --no-install-recommends \
        ca-certificates chromium fonts-ipafont fonts-noto-cjk ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /out ./

ENV NODE_ENV=production \
    PORT=3000 \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    AINOBI_VIDEO_RENDER_BROWSER_EXECUTABLE=/usr/bin/chromium \
    HYPERFRAMES_FFMPEG_PATH=/usr/bin/ffmpeg \
    HYPERFRAMES_FFPROBE_PATH=/usr/bin/ffprobe

EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/index.js"]
