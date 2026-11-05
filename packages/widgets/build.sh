#!/bin/bash
# Build the ainobi-widgets IIFE bundle with all Vite env vars defined.
# This is the reproducible build script for the embeddable widgets.
set -e
cd "$(dirname "$0")"

npx esbuild src/index.ts \
  --bundle --format=iife --outfile=dist/ainobi-widgets.js \
  --alias:@=../../apps/student-frontend/app \
  --loader:.tsx=tsx --loader:.ts=ts --loader:.css=css \
  --loader:.ttf=file --loader:.woff=file --loader:.woff2=file \
  --minify \
  --define:import.meta.env.DEV=false \
  --define:import.meta.env.PROD=true \
  --define:import.meta.env.MODE='"production"' \
  --define:import.meta.env.VITE_BUILD_ENV='"production"' \
  --define:import.meta.env.VITE_COURSEWARE_ASSET_PRESIGN_ENABLED='""' \
  --define:import.meta.env.VITE_DEBUG_ENABLED='""' \
  --define:import.meta.env.VITE_DEBUG_VERBOSE='""' \
  --define:import.meta.env.VITE_ENABLE_DEVICE_SESSIONS='""' \
  --define:import.meta.env.VITE_FILE_STORAGE_TYPE='"remote"' \
  --define:import.meta.env.VITE_GOOGLE_CLIENT_ID='""' \
  --define:import.meta.env.VITE_INTERACTION_API_ENABLED='""' \
  --define:import.meta.env.VITE_INTERACTION_TOOL_DETAILS_EXPAND='""' \
  --define:import.meta.env.VITE_OPENAI_DEFAULT_MODEL='""' \
  --define:import.meta.env.VITE_OPENAI_ENABLED='""' \
  --define:import.meta.env.VITE_OPENAI_MAX_TOKENS='""' \
  --define:import.meta.env.VITE_OPENAI_TEMPERATURE='""' \
  --define:import.meta.env.VITE_ORIGIN_API='""' \
  --define:import.meta.env.VITE_ORIGIN_COURSEWARE_API='""' \
  --define:import.meta.env.VITE_ORIGIN_INTERACTION_API='""' \
  --define:import.meta.env.VITE_ORIGIN_MANAGE='""' \
  --define:import.meta.env.VITE_ORIGIN_PDF='""' \
  --define:import.meta.env.VITE_ORIGIN_PPTX='""' \
  --define:import.meta.env.VITE_ORIGIN_STATIC='""' \
  --define:import.meta.env.VITE_REQUEST_TIMEOUT='"30000"' \
  --define:import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY='""' \
  --define:import.meta.env.VITE_WEBSOCKET_URL='""' \
  --define:process.env.NODE_ENV='"production"'

echo "Built dist/ainobi-widgets.js ($(du -h dist/ainobi-widgets.js | cut -f1))"
