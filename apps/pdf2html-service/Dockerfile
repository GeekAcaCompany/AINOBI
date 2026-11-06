# apps/pdf2html-service — monorepo root-context build.
#
#   docker build -f apps/pdf2html-service/Dockerfile .
#
# The runtime keeps the former app Dockerfile's shape: ubuntu:20.04 (the base the committed
# pdf2htmlEX bionic .deb installs on), Node from the official image, poppler-utils for
# pdfinfo. Dependencies come from the root lockfile through `pnpm deploy --prod` instead of
# the former `npm ci`, which needs a package-lock.json the monorepo no longer has.

ARG PDF2HTMLEX_PLATFORM=linux/amd64
# The deb actually committed in the repository (rc1 bionic builds and installs fine on ubuntu:20.04).
ARG PDF2HTMLEX_DEB_FILE="pdf2htmlEX-0.18.8.rc1-master-20200630-Ubuntu-bionic-x86_64.deb"

FROM node:22.23.4-bookworm-slim AS build
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV npm_config_registry=$NPM_REGISTRY
WORKDIR /app

RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
RUN pnpm fetch

COPY . .
RUN pnpm install --offline --frozen-lockfile --filter ainobi-pdf2html-service...
RUN npm_config_node_linker=hoisted pnpm --filter ainobi-pdf2html-service deploy --prod --legacy /out

FROM node:22.23.4-bookworm-slim AS node-runtime

FROM --platform=$PDF2HTMLEX_PLATFORM ubuntu:20.04
ARG PDF2HTMLEX_DEB_FILE

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PORT=3000 \
    WORK_DIR=/tmp/ainobi-pdf2html-service \
    PDF2HTMLEX_PATH=/usr/local/bin/pdf2htmlEX \
    PDFINFO_PATH=/usr/bin/pdfinfo

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node

# Build environments sit behind a proxy chain: archive.ubuntu.com intermittently returns 502 and
# large plain-http transfers stall. Switch to the Aliyun mirror with only main/restricted (a
# smaller index), install ca-certificates over http, then move to https for the rest.
# An empty APT_MIRROR keeps Ubuntu's own archive.
ARG APT_MIRROR=
RUN if [ -n "$APT_MIRROR" ]; then \
      sed -i "s|http://archive.ubuntu.com|http://${APT_MIRROR}|g; s|http://security.ubuntu.com|http://${APT_MIRROR}|g; s/ main restricted universe multiverse/ main restricted/g" /etc/apt/sources.list; \
    fi \
  && apt-get update -o Acquire::Retries=10 -o Acquire::http::Timeout=60 \
  && apt-get install -y --no-install-recommends -o Acquire::Retries=10 ca-certificates \
  && if [ -n "$APT_MIRROR" ]; then sed -i "s|http://${APT_MIRROR}|https://${APT_MIRROR}|g" /etc/apt/sources.list; fi \
  && apt-get update -o Acquire::Retries=10 -o Acquire::https::Timeout=60 \
  && apt-get install -y --no-install-recommends -o Acquire::Retries=10 \
    curl \
    poppler-utils \
  && rm -rf /var/lib/apt/lists/*

# pdf2htmlEX (GPLv3) comes from the directory when the package is there, otherwise from the project's own release, the
# same file (sha256 below), so a checkout need not carry the binary.
ARG PDF2HTMLEX_DEB_URL=https://github.com/pdf2htmlEX/pdf2htmlEX/releases/download/v0.18.8.rc1/pdf2htmlEX-0.18.8.rc1-master-20200630-Ubuntu-bionic-x86_64.deb
ARG PDF2HTMLEX_DEB_SHA256=84006d64edd0eb246c4e5690c0fbac782c088d4b2408f9559179b78b963b42cb
COPY apps/pdf2html-service/pdf2htmlEX/ /tmp/pdf2htmlex/
RUN set -eux; \
  if [ -f "/tmp/pdf2htmlex/${PDF2HTMLEX_DEB_FILE}" ]; then \
    mv "/tmp/pdf2htmlex/${PDF2HTMLEX_DEB_FILE}" /tmp/pdf2htmlex-package.deb; \
  else \
    curl -fsSL --retry 5 -o /tmp/pdf2htmlex-package.deb "${PDF2HTMLEX_DEB_URL}"; \
    echo "${PDF2HTMLEX_DEB_SHA256}  /tmp/pdf2htmlex-package.deb" | sha256sum -c -; \
  fi; \
  rm -rf /tmp/pdf2htmlex; \
  apt-get update -o Acquire::Retries=10 -o Acquire::http::Timeout=30; \
  apt-get install -y --no-install-recommends -o Acquire::Retries=10 /tmp/pdf2htmlex-package.deb; \
  rm -f /tmp/pdf2htmlex-package.deb; \
  rm -rf /var/lib/apt/lists/*; \
  pdf2htmlEX --version; \
  pdfinfo -v

WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY apps/pdf2html-service/package.json ./package.json
COPY apps/pdf2html-service/index.js ./index.js
COPY apps/pdf2html-service/src ./src

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "index.js"]
