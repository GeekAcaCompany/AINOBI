# Courseware System example

A minimal courseware system assembled only from the public AINOBI packages. It contains no
platform features of its own: every screen is an AINOBI component, and the app only wires
them together.

| Feature | Built from |
| --- | --- |
| Sign-in / sign-up (password, Google, reset) | `<ainobi-login>` from `@ainobi/widgets` — the platform's own login page; it hands back a one-time code (`ainobi-signed-in`) that `@ainobi/client` redeems for this app's session |
| AI courseware home | `@ainobi/client` — `listOrganizations`, `chooseOrganization`, `listCoursewares` |
| AI avatar on the home page | `<ainobi-avatar>` |
| Courseware editor (new and existing) | `<ainobi-editor>` — a new courseware is a new key: the editor creates it in the chosen organization (`org-id`) |
| Courseware player | `<ainobi-player>` |

Every embedded page signs in with a one-time code from `client.mintEmbedHandoff()` passed as
the element's `handoffProvider`. The access token stays in this app (sessionStorage) and
never appears in a URL or crosses into a frame.

## Run

Prerequisites: the AINOBI platform running — the web app (student frontend), the platform API
(backend) and the courseware API (courseware service). The web app must allow this example's
origin to embed it:

```sh
# in the web app's environment
VITE_EMBED_ALLOWED_ORIGINS=http://localhost:5180
```

Then:

```sh
cp examples/courseware-system/.env.example examples/courseware-system/.env   # adjust the URLs
pnpm --filter ainobi-example-courseware-system dev                           # http://localhost:5180
```

`build` produces a static site in `dist/`; `typecheck` and the root `pnpm test` cover it.

## Layout

| File | Role |
| --- | --- |
| `src/main.ts` | Defines the AINOBI elements and routes between the views |
| `src/session.ts` | The `@ainobi/client` session, organization choice, persistence |
| `src/views/login.ts` | `<ainobi-login>` and the sign-in hand-back |
| `src/views/home.ts` | Courseware list, create / edit / play, `<ainobi-avatar>` |
| `src/views/courseware.ts` | `<ainobi-editor>` / `<ainobi-player>` |
