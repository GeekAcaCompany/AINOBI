# @ainobi/widgets

The AINOBI embedding SDK: embed the courseware editor, the player, the AI avatar, or the sign-in page in any web page. It provides the custom elements `<ainobi-editor>`, `<ainobi-player>`, `<ainobi-avatar>` and `<ainobi-login>`, a framework-agnostic iframe loader, the versioned postMessage protocol, and the guest runtime the embedded pages use. Identity crosses only as one-time handoff codes over postMessage, never in a URL.

Runtime: browser.

With a script tag (the `bundle` entry, `dist/ainobi-widgets.js`):

```html
<script src="ainobi-widgets.js"></script>
<ainobi-player base-url="https://app.example.com" courseware-id="..." auto-resize></ainobi-player>
```

With a bundler:

```ts
import { mountEmbed } from '@ainobi/widgets';

const embed = mountEmbed(document.querySelector('#editor')!, {
  baseUrl: 'https://app.example.com',
  surface: 'editor',
  coursewareId: '...',
  autoResize: true,
  getHandoff: () => client.mintEmbedHandoff({ coursewareId: '...' }),
});
embed.on('saved', ({ coursewareId }) => console.log('saved', coursewareId));
```

## API

| Entry | Exports |
| --- | --- |
| `@ainobi/widgets` | `defineAinobiElements()`, the element classes, `mountEmbed(container, options)` → `EmbedController` (`on(event, listener)`, `destroy()`), `buildEmbedUrl`, and the protocol. |
| `@ainobi/widgets/protocol` | `EMBED_PROTOCOL`, `EMBED_PROTOCOL_VERSION`, the message types, `readGuestMessage` / `readHostMessage` for untrusted `event.data`, `parseOriginList`. |
| `@ainobi/widgets/guest` | `startEmbedGuest(options)` for the embedded page: it answers only `window.parent` on its origin allowlist and pins the host origin. |
| `@ainobi/widgets/bundle` | The IIFE script: defines the elements and exposes `window.AinobiWidgets`. |

Events: `ready`, `resize`, `saved`, `signedIn`, `error`, `close`. Element attributes: `base-url`, `src`, `courseware-id`, `course-id`, `org-id`, `model-url` (avatar: a model the frame can render, such as an Inochi2D `.inx`), `height`, `auto-resize`. See `docs/embedding-guide.md` in the repository for the platform side (allowed origins, handoff).

## Using it outside this repository

The package is part of AINOBI-PRIVATE and is not published yet (`"private": true`). To use it elsewhere, build and pack it from the repository root:

```sh
pnpm --filter @ainobi/widgets build
pnpm --filter @ainobi/widgets pack --pack-destination ./tarballs
npm install ./tarballs/ainobi-widgets-*.tgz
```

The tarball carries `dist/` (ESM, type declarations, source maps) and the published `exports`; internal `@ainobi/*` dependencies resolve to their own tarballs. `node scripts/verify-public-packages.mjs` checks that every public package installs and imports this way.
