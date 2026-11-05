# @ainobi/tts-fishaudio

The Fish Audio implementation of the `@ainobi/tts` port — the one implementation the platform backend and the courseware CLI share. Requests are JSON (`POST /v1/tts`) with normalized loudness and the volume as prosody gain in dB; sampling parameters (`temperature`, `top_p`) are sent only when given, and there is no timeout unless `timeout_ms` is set. `synthesizeFishAudioSpeech` is the provider-independent call, `buildFishAudioRequest` the request body, `FishAudioHttpError` the API failure (API code, HTTP status, raw body). Billing units are UTF-8 bytes, as Fish Audio bills them.

Runtime: Node.

```ts
import { registerTTSProvider } from '@ainobi/tts';
import { FishAudioProvider } from '@ainobi/tts-fishaudio';

registerTTSProvider('fishaudio', new FishAudioProvider({ api_key: process.env.FISH_AUDIO_API_KEY }));
```

The provider reads no environment variables: pass credentials and settings to the constructor at your composition root. It implements `TTSProvider` from `@ainobi/tts`; see that package for the interface and the registry.

## Using it outside this repository

The package is part of AINOBI-PRIVATE and is not published yet (`"private": true`). To use it elsewhere, build and pack it from the repository root:

```sh
pnpm --filter @ainobi/tts-fishaudio build
pnpm --filter @ainobi/tts-fishaudio pack --pack-destination ./tarballs
npm install ./tarballs/ainobi-tts-fishaudio-*.tgz
```

The tarball carries `dist/` (ESM, type declarations, source maps) and the published `exports`; internal `@ainobi/*` dependencies resolve to their own tarballs. `node scripts/verify-public-packages.mjs` checks that every public package installs and imports this way.
