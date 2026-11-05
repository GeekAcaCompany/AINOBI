# @ainobi/tts-minimax

The MiniMax implementation of the `@ainobi/tts` port — the one implementation the platform backend and the courseware CLI share. It speaks the T2A v2 WebSocket (`wss://api.minimax.io/ws/v1/t2a_v2`): `task_start` with the voice and audio settings (and optional pronunciation tone rules), `task_continue` with the text, audio collected until `is_final`. `provider.synthesize()` also returns the duration MiniMax reports; `synthesizeMiniMaxSpeech` is the provider-independent call. Invalid hex audio is rejected rather than silently truncated.

Runtime: Node.

```ts
import { registerTTSProvider } from '@ainobi/tts';
import { MiniMaxProvider } from '@ainobi/tts-minimax';

registerTTSProvider('minimax', new MiniMaxProvider({ api_key: process.env.MINIMAX_API_KEY }));
```

The provider reads no environment variables: pass credentials and settings to the constructor at your composition root. It implements `TTSProvider` from `@ainobi/tts`; see that package for the interface and the registry.

## Using it outside this repository

The package is part of AINOBI-PRIVATE and is not published yet (`"private": true`). To use it elsewhere, build and pack it from the repository root:

```sh
pnpm --filter @ainobi/tts-minimax build
pnpm --filter @ainobi/tts-minimax pack --pack-destination ./tarballs
npm install ./tarballs/ainobi-tts-minimax-*.tgz
```

The tarball carries `dist/` (ESM, type declarations, source maps) and the published `exports`; internal `@ainobi/*` dependencies resolve to their own tarballs. `node scripts/verify-public-packages.mjs` checks that every public package installs and imports this way.
