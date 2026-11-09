# Integration guide

Install the smallest piece that does the job, and add more only when you need it. Find your goal below; each section is complete on its own.

`npm run add -- <profile> --to <your app>` is run from a clone of this repository. It packs that profile's packages into `<your app>/vendor/ainobi` and installs them, since the packages are not on npm yet. Commit that directory, or rerun the command, so your builds can find them.

| Goal | Section | Service to run |
| --- | --- | --- |
| An avatar in my React app | [Avatar only](#avatar-only) | None |
| Work with courseware JSON | [Format only](#format-only) | None |
| Play courseware in my React app | [Player](#player) | `courseware-service` |
| Edit courseware in my React app | [Editor](#editor) | `courseware-service` |
| Any web page, no React | [Embed](#embed) | Studio |
| A complete system | [Studio](#studio) | Studio |
| My own users and storage | [Connecting your own system](#connecting-your-own-system) | `courseware-service` |

## Avatar only

```sh
npm run add -- avatar --to ../my-app
```

```tsx
import Inochi2DModel from '@ainobi/avatar/Inochi2DModel';

export const Teacher = () => <Inochi2DModel modelUrl="/models/teacher.inx" maxWidth={320} maxHeight={480} />;
```

For a Live2D model, import `@ainobi/avatar/Live2DModel` and pass a `.model3.json` URL. Live2D also needs the Cubism Core script served from your site root, or from wherever `configureAvatar({ cubismCoreUrl })` points; read its terms in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) first.

The components use Tailwind classes, so add the package to your Tailwind sources:

```css
@source "../node_modules/@ainobi/avatar/dist";
```

Peer dependencies: `react`, `react-dom`, `pixi.js`, `pixi-live2d-display`, `three`. The [package README](../packages/avatar/README.md) lists every setting.

## Format only

```sh
npm run add -- format --to ../my-app
```

`@ainobi/courseware-core` validates and edits courseware with no React, Node.js APIs, or storage, so it runs in a browser, a server, or a build step. See its [README](../packages/courseware-core/README.md) and the [format reference](../packages/courseware-cli/references/workflows.md).

## Player

```sh
npm run add -- player --to ../my-app
```

The player loads courseware from `courseware-service`, so start one first: `npm start` here runs it on port 5633, and `CORS_ALLOW_ORIGIN=<your app's origin> npm start` lets your app call it. Then install Tailwind 4 and React Router 7, import the styles from your stylesheet:

```css
@import "@ainobi/courseware-player/styles/app.css";
```

and connect the package and give it a route:

```tsx
import { configureCoursewareHost } from '@ainobi/courseware-player';
import { createCoursewareRequester } from '@ainobi/courseware-player/host/simple-requester';
import { I18nNewProvider } from '@ainobi/courseware-player/hooks/useI18nNew';
import CoursewarePreview from '@ainobi/courseware-player/routes/courseware-preview';

const coursewareApi = 'http://127.0.0.1:5633';
const session = { access_token: myToken, current_org_id: myOrgId };

configureCoursewareHost({
  config: { origin: { coursewareApi, manage: '', static: '' }, modules: { courseware: { assetPresignEnabled: true } } },
  coursewareApi: createCoursewareRequester({ baseUrl: coursewareApi, getAccessToken: () => myToken }),
  sessionManager: { acquireSession: async () => session, setEventCallbacks: () => undefined },
  useAuth: () => ({ isAuthenticated: true, isLoading: false, session, userInfo: null }),
});

// A route in a React Router *data* router, at /courseware-preview?courseware_id=<key>&org_id=<org>:
<I18nNewProvider><CoursewarePreview /></I18nNewProvider>;
```

Three things go wrong most often:

- **The page is unstyled.** Import `styles/app.css` from a stylesheet that Tailwind 4 processes.
- **`useBlocker must be used within a data router`.** Use `createBrowserRouter`, not `<BrowserRouter>`.
- **Requests are refused by the browser.** Set `CORS_ALLOW_ORIGIN` on the service to your app's origin.

- **Broken images in the assistant panel.** Copy `AINOBI-Agent.svg` and `avatar-unnamed.png` from `apps/studio/public` into your site root.

[`apps/studio/src`](../apps/studio/src) is a complete, small host to copy from.

## Editor

```sh
npm run add -- editor --to ../my-app
```

The same as the player, importing the page from the editor package. It needs a data router, because it blocks navigation while there are unsaved changes.

```tsx
import CoursewareEditor from '@ainobi/courseware-editor/routes/courseware-editor';
// At /courseware-editor?courseware_id=<key>&org_id=<org>. A new key creates new courseware.
```

## Embed

For a page that is not React, the elements frame a running Studio. Studio refuses to be framed unless you allow your site, so start it with your origin:

```sh
AINOBI_EMBED_ORIGINS=https://your-site.example npm start
```

```sh
npm run add -- embed --to ../my-app
```

```html
<script src="ainobi-widgets.js"></script>
<ainobi-player base-url="http://127.0.0.1:5600" courseware-id="..." auto-resize></ainobi-player>
<ainobi-editor base-url="http://127.0.0.1:5600" courseware-id="..."></ainobi-editor>
<ainobi-avatar base-url="http://127.0.0.1:5600"></ainobi-avatar>
```

`ainobi-widgets.js` is in `node_modules/@ainobi/widgets/dist`. `courseware-id` is the `key` in the courseware list; a new key opens a new courseware in the editor. `<ainobi-avatar>` shows the built-in teacher, or the model in `model-url`. Listen for `ainobi-ready` and `ainobi-saved`. `<ainobi-login>` has nothing to do here, because Studio has no accounts.

Studio on loopback can only be embedded by pages open on the same machine. Anyone able to open the framed page acts as the local user, so serving it to other people needs your own users and session: see [Connecting your own system](#connecting-your-own-system).

See the [widgets README](../packages/widgets/README.md).

## Studio

```sh
npm start
```

The complete system at <http://127.0.0.1:5600>. Move it with `AINOBI_PORT_OFFSET=1000 npm start`, which moves every port together, and move stored objects with `AINOBI_STORAGE_DIR`. Settings go in `.env.local`.

| Service | Default address |
| --- | --- |
| Web app | `127.0.0.1:5600` |
| Local host | `127.0.0.1:5601` |
| `courseware-service` and MCP | `127.0.0.1:5633` |
| PostgreSQL protocol | `127.0.0.1:55432` |
| Redis protocol | `127.0.0.1:56379` |
| Object storage | `127.0.0.1:56390` |

Everything listens on loopback only. Studio has one user and no sign-in, so do not expose these ports. To run for several people, see the next section.

**AI teachers.** Studio ships with one, always available unless you remove it. An agent that can generate images makes more with no key, through the `ainobi-ai-teacher` skill. People generate them from the courseware list once `OPENAI_API_KEY` is in `.env.local`. To use another OpenAI compatible provider, set `LLM_API_KEY` and `LLM_API_BASE`, and if needed `AVATAR_IMAGE_MODEL` and `AVATAR_VISION_MODEL`; with `LLM_API_BASE` set, the OpenAI key is not used. A generation takes a few minutes and bills your key, and quality checks can reject a drawing, in which case the dialog tries once more by itself. Generated teachers live in `.ainobi/ai-teachers`. To bring back a removed built-in teacher, set `builtInRemoved` to `false` in `.ainobi/ai-teachers/teachers.json`.

**Narration.** With `GEMINI_API_KEY` (or `GOOGLE_CLOUD_API_KEY`), or a Google Cloud service account ([docs/google-cloud.md](google-cloud.md)), Add narration in the editor and the agent's `courseware_narration` synthesize speech and store it locally. The voices are the catalog in `apps/studio/server/tts_models.json`.

**Quiz scoring.** Choice and exact fill-in questions need nothing. Essay, shadowing, and speech questions are scored by Gemini, with the same key or service account as narration; without one, submitting such a question reports that scoring is not configured, so set it up before giving learners those questions.

## Connecting your own system

`courseware-service` knows nothing about your users. It asks an identity host over HTTP, which you point at your own system with `AINOBI_BACKEND_API_BASE`. [`apps/studio/server/local-host.mjs`](../apps/studio/server/local-host.mjs) is a complete implementation for one local user, and the shortest reference for what to answer. The essential call:

```http
POST /v1/user/check_session
Authorization: Bearer <your user's token>

{ "code": 0, "success": true, "data": {
    "user": { "user_id": "...", "user_name": "...", "user_status": "active" },
    "current_org_id": "...",
    "permissions": ["manage_login"],
    "expire_at": "2099-01-01T00:00:00Z"
} }
```

Answer `GET /v1/organization/list` with the workspaces the user belongs to. Every courseware belongs to one of them.

Studio's PGlite, in-memory Redis, and disk storage are the smallest setup, not a requirement. To replace a store, point the service at your own; each one can be swapped independently:

- **PostgreSQL:** `DB_TYPE=postgres`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE`. Create the tables from [`apps/studio/server/schema.sql`](../apps/studio/server/schema.sql). Leave `AINOBI_DB_JOIN_NESTED_TRANSACTIONS` off: only PGlite's single session needs it.
- **Redis:** `REDIS_HOST`, `REDIS_PORT`, and if needed `REDIS_USER`, `REDIS_PASSWORD`, `REDIS_DB`.
- **S3 compatible storage:** `STORAGE_BACKEND=oci_s3`, `OCI_S3_ENDPOINT`, `OCI_S3_BUCKET`, `OCI_S3_ACCESS_KEY_ID`, `OCI_S3_SECRET_KEY`, `OCI_S3_REGION`. Set `AINOBI_STORAGE_LOCAL_ENDPOINT=true` only for a plain `http://` endpoint on your own machine.

`npm start` does not read these: Studio always runs its embedded stores, so run `apps/courseware-service` yourself to use your own.

Then give your frontend your own session in `configureCoursewareHost`. `ProtectedRoute`, `useAuth`, and `FeatureGate` are yours to replace, and the [player README](../packages/courseware-player/README.md) lists every setting.

If a piece here pulls in more than you need, please [open an issue](https://github.com/GeekAcaCompany/AINOBI/issues): splitting it further is in scope.
