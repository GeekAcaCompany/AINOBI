# @ainobi/avatar

Avatar rendering for React: Inochi2D (`.inx`) models, with model caching, load queues, and the helpers courseware stages use.

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
| `assetPresignEnabled`, `presignModelUrls` | Sign private model files at runtime. |
| `publicModelBaseUrl` | Model URLs under this base load directly if signing fails. |
| `defaultModelUrl` | The model of an avatar that names none. Default: none. |
| `aiTeacherDefaultModelUrl` | The model of an AI teacher without one of its own. Default: none. |
| `useTranslate` | A React hook returning the function that translates the package's labels. Default English. |

## Entry points

`@ainobi/avatar/Inochi2DModel` is the component. The other subpaths expose the cache, load queues, and stage helpers it is built on.

## Other model formats

Courseware stages hand every model that is not Inochi2D to `@ainobi/avatar/Live2dStageModel`. It draws with the runtime a host registered through `registerLive2dRuntime` (`@ainobi/avatar/model-runtime`); without one, it shows that the format is not supported.
