# @ainobi/avatar

Avatar rendering for React: Live2D (`.model3.json`) and Inochi2D (`.inx`) models, with model caching, a shared stage, and load queues.

Runtime: browser, React 19.

```tsx
import { configureAvatar } from '@ainobi/avatar';
import Inochi2DModel from '@ainobi/avatar/Inochi2DModel';

configureAvatar({ logger: console });

export const Teacher = () => <Inochi2DModel modelUrl="/models/teacher.inx" width={320} height={480} />;
```

Add the package's source to your Tailwind content, since its components use Tailwind classes.

## Host settings

`configureAvatar` takes the following, once at startup. Every setting is optional for public model URLs.

| Setting | Purpose |
| --- | --- |
| `logger` | Receives the package's logs. |
| `cubismCoreUrl` | Where the Live2D Cubism Core script is served from. Only Live2D models load it. Default `/live2dcubismcore.min.js`. |
| `assetPresignEnabled`, `presignModelUrls` | Sign private model files at runtime. |
| `publicModelBaseUrl` | Model URLs under this base load directly if signing fails. |
| `useTranslate` | A React hook returning the function that translates the package's labels. Default English. |

## Entry points

`@ainobi/avatar/Live2DModel` and `@ainobi/avatar/Inochi2DModel` are the components. The other subpaths expose the cache, load queues, and stage helpers they are built on. Import components by subpath so a page that uses one runtime does not load the other.
