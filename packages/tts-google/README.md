# @ainobi/tts-google

The Google (Gemini, Interactions API) implementation of the `@ainobi/tts` port — the one implementation the platform backend and the courseware CLI share. Long text is split at sentences on code points (≤500 per request), synthesized up to four chunks at a time with per-chunk retries of transient failures (`chunk_attempts`, `retry_delay_ms`), concatenated, gained, and encoded to MP3 (LAME) or WAV. `synthesizeGoogleSpeech` is the provider-independent call returning PCM; the building blocks (`splitGoogleTtsText`, `buildGoogleTtsPayload`, `decodeGooglePcm`, `applyPcmGain`, `encodePcmToMp3Async`, `encodePcmToWav`, …) are exported too.

Runtime: Node.

```ts
import { registerTTSProvider } from '@ainobi/tts';
import { GoogleTTSProvider } from '@ainobi/tts-google';

registerTTSProvider('google', new GoogleTTSProvider({ api_key: process.env.GEMINI_API_KEY }));
```

It runs on the Gemini Developer API (AI Studio) with an API key, or on Google Cloud Vertex AI with a service account: `settings: { backend: 'vertexai', credentials_path: process.env.GOOGLE_APPLICATION_CREDENTIALS }`. Vertex AI's Interactions API takes no API key; `createGoogleAccessToken` mints and caches the token, and the project defaults to the service account's. With `backend` empty, an API key means AI Studio and a service account alone Vertex AI (`chooseGoogleTtsBackend`). The request body is the same on both, so a voice's delivery style travels in its own `speech_metadata` field and is never read aloud.

The provider reads no environment variables: pass credentials and settings to the constructor at your composition root. It implements `TTSProvider` from `@ainobi/tts`; see that package for the interface and the registry.

## Using it outside this repository

The package is part of AINOBI-PRIVATE and is not published yet (`"private": true`). To use it elsewhere, build and pack it from the repository root:

```sh
pnpm --filter @ainobi/tts-google build
pnpm --filter @ainobi/tts-google pack --pack-destination ./tarballs
npm install ./tarballs/ainobi-tts-google-*.tgz
```

The tarball carries `dist/` (ESM, type declarations, source maps) and the published `exports`; internal `@ainobi/*` dependencies resolve to their own tarballs. `node scripts/verify-public-packages.mjs` checks that every public package installs and imports this way.
