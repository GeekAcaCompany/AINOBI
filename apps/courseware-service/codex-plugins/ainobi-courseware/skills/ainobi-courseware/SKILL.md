---
name: ainobi-courseware
description: Creates, incrementally edits, validates, and saves AINOBI courseware JSON through MCP tools (course_list, courseware_list, courseware_open, ainobi_exec, courseware_workspace_write, courseware_save, courseware_ui_links, asset upload, narration/search) and host fallbacks. Use when the user mentions AINOBI courseware, courses, slides, scenes, quizzes, narration, previewing the courseware, or @ainobi-courseware.
---

# AINOBI Courseware (Codex Plugin L0)

Author AINOBI courseware through **MCP tools**, not ad-hoc shell. Prefer **file + batch** for multi-slide structure; use **incremental `ainobi_exec`** for micro-edits. Runtime returns quiet mutation JSON (ids/warnings) by default.

This is the **L0 bootstrap**. For deep topics, read the matching **L1** file under `references/topics/` **before** that work (do **not** read every topic or L2 reference up front).

## User communication

Users work in courseware terms—they are **not** CLI operators.

- **Editor language only:** slides, elements, narration/voiceover, motion, quizzes, layout, preview. Never mention `ainobi`, MCP tool names, argv, shell, `work_dir`, or JSON responses in chat.
- **No command dumps / no delegation:** execute authoring yourself; describe progress in course terms (e.g. "Narration for slide 3 is ready").
- **Questions:** content and design; show `ai_teacher_name` when picking a teacher; keep `ai_teacher_id` internal.

## Dedicated tools vs `ainobi_exec` (required)

Use dedicated MCP tools for hosted / billed / catalog work. Use **`ainobi_exec`** only for allowlisted scene CLI (structure, inspect, validate).

| Need | Use this MCP tool | Do **not** |
|------|-------------------|------------|
| Education courses | `course_list` | Local plugin files / invent titles |
| Courseware library | `courseware_list` (+ `course_id`) | `rg` / local `*.scene.json` |
| **Create new courseware** | **`courseware_create`** (`title`, required `language` zh / en / ja — confirm with the user first, optional `course_id`) | Browser UI / invent ids / guess the language from locale |
| **Create a COURSE (the container)** | **`course_create`** (`title`; free-tier orgs need `is_public: true` — ask the user before making it public) | Treating `courseware_create` as course creation — courseware (“课件”) ≠ course (“课程”) |
| **Update course info** | **`course_update`** (`course_id`) | Confusing with `courseware_rename` (that renames the COURSEWARE) |
| **Import courseware into a course library** | **`courseware_import_to_course`** (`courseware_id`, `course_id`) | Assuming the courseware is already bound |
| **Export courseware from a course library** | **`courseware_export_from_course`** (`courseware_id`, `course_id`) | Assuming export deletes the courseware itself (it does not) |
| **Rename courseware** | **`courseware_rename`** | Hand-edit DB / local files |
| **Preview link (login-free)** | **`courseware_ui_links`** | Guessing URLs / asking the user to log in |
| **Register agent name (onboarding)** | **`agent_set_name`** (`name`) | Leaving the agent unnamed in the console list |
| Open / status / close | `courseware_open` / `status` / `close` | — |
| Prepare a batch plan, quiz layout, or HTML file | `courseware_workspace_write` | Guessing server paths / shell redirects |
| Persist scene | `courseware_save` | `ainobi_exec ["save"]` |
| AI teacher catalog | `courseware_ai_teachers` | `ainobi_exec ["ai-teachers",…]` |
| Narration / TTS | `courseware_narration` (`--teacher-id`) | `ainobi_exec ["narration",…]` |
| TTS voice pool (rare) | `courseware_tts_list` | `ainobi_exec ["tts",…]` |
| Research and facts | Your own web search; `courseware_search` only without one (skill **ainobi-research**) | `ainobi_exec ["search",…]` |
| **Images (preferred)** | **Your own image generation → `courseware_asset_upload`** (skill **ainobi-images**) | Host generate first |
| Images (fallback only) | `courseware_image_generate` | `ainobi_exec ["image",…]` |
| Library list / upload | `courseware_asset_list` / `courseware_asset_upload` | `ainobi_exec ["asset",…]` |
| Document → markdown | `courseware_doc_read` | `ainobi_exec ["doc",…]` |
| Scene / slides / elements / animation / quiz / batch / inspect / validate / help / status | `ainobi_exec` argv | Shell metacharacters |

### What `ainobi_exec` **can** do

Allowlisted roots: `status`, `help`, `validate`, `inspect`, `recall`, `scene`, `slide`, `element`, `animation`, `quiz`, `batch`, `reference`, `highlight`, `flow-pause`.

Typical: `["slide","list","--verbose"]`, `["element","insert",…]`, `["batch","apply","--file","batch/plan.json"]`, `["validate","--publish"]`, `["help","element","image"]`.

Blocked after `courseware_open`: `init`, `load`. Blocked always: `save`, `narration`, `search`, `image`, `doc`, `tts`, `ai-teachers`, `asset`, shell meta (`&&`, `|`, `;`, redirects), absolute/`..` filesystem paths in argv.

### Files on this surface

`ainobi_exec` runs in the session's workspace and cannot write files itself. Create them with **`courseware_workspace_write`** (`mcp_session_id`, relative `path`, text `content`), then pass the same relative path to `ainobi_exec`.

The references were written for a shell. Read them with these substitutions:

- `$AINOBI_WORK_DIR/x`, `$WORK_DIR/x`, and `work_dir/x` → the relative path `x`.
- `… > q.jsx` → run the command without the redirect, then write its output with `courseware_workspace_write`.
- "Write" and "Read" tools → `courseware_workspace_write`, and `ainobi_exec` commands such as `slide get` and `quiz get`.

### On a local AINOBI Studio

Studio is the single-machine edition: one organization and no courses. There, `course_*`, `courseware_bind_section`, `courseware_import_to_course`, `courseware_export_from_course`, and `agent_set_name` do nothing useful, so go straight to `courseware_list` / `courseware_create`. `courseware_ui_links` returns only the preview and editor links. Teachers are created on Studio's home page. Narration needs the owner's `GEMINI_API_KEY`; until it is set, narration reports an error, so tell the user and continue with silent slides. Search and pictures are yours to do with your own tools (skills **ainobi-research** and **ainobi-images**); the host versions report an error until the owner configures their keys. Upload media you made with `courseware_asset_upload { local_path }`.

## Tool surface

**Catalog navigation (never local plugin files / `*.scene.json` / `rg` / `jq` on disk):**

1. **`course_list`** — education courses (optional `course_name`).
2. **`courseware_list`** — library items; pass **`course_id`** when scoped to a course.
3. **`courseware_create`** — new blank courseware (`title`, required `language` zh / en / ja confirmed with the user — never inferred from locale, optional `course_id` bind); opens by default (`mcp_session_id`).
4. **`courseware_rename`** — change title only.
5. **`courseware_open`** — preload scene; returns `mcp_session_id`.

**Authoring after open:**

6. **`courseware_status`** — session / workspace binding.
7. **`ainobi_exec`** — allowlisted scene CLI only (see table above).
    **`courseware_workspace_write`** — create the files `ainobi_exec` reads (see "Files on this surface").
8. **`courseware_save`** — persist to AINOBI DB. Refuses with `VERSION_CONFLICT` when someone changed the courseware after this session loaded it (see below).
9. **`courseware_ai_teachers`** — required before narration; show names (+ language); keep ids internal.
10. **`courseware_narration`** — billed TTS (`--teacher-id`).
11. **`courseware_search`** — billed web search, only when you have none of your own.
12. **`courseware_asset_list`** / **`courseware_asset_upload`** — courseware media library.
13. **`courseware_doc_read`** — PDF/DOCX/… → markdown (`file_id` preferred).
14. **`courseware_tts_list`** — optional voice catalog; prefer teachers for narration.
15. **`courseware_image_generate`** — **fallback only** (see Images below).
16. **`courseware_ui_links`** — login-free browser URLs (student preview / student editor / manage course page); hand the user the link, don't tell them to log in.
17. **`agent_set_name`** — register/rename THIS agent's display name (ask the user first; default to the client name). Called during connect onboarding.
18. **`course_close`-family** — `course_create` / `course_update` manage the course CONTAINER (see table above).
19. **`courseware_close`** / **`courseware_recall`**.

### Saving when someone else edited

The user can edit in the browser while you work. On `VERSION_CONFLICT`, nothing was saved and their change is intact:

1. `courseware_open` with the same `courseware_id` to load the latest version. This discards your unsaved edits, so keep your batch plan to replay.
2. Reapply your edits on top, then `courseware_save`.

Use `courseware_save` with `force: true` only when the user says their other change can be replaced. Reopen before each round of edits if the user may have been editing.

An agent save does not redraw the courseware's cover image; the editor regenerates it the next time the courseware is saved there.

### Course vs courseware (hard distinction)

A **course** (“课程”) is the container; a **courseware** (“课件”) is a teaching artifact that lives in an org library and can be imported into a course's library.

- "Create a course / 新建课程" → **`course_create`**. "Create courseware / 新建课件" → **`courseware_create`**. Never substitute one for the other — if the ask is ambiguous, ask.
- Update course info → **`course_update`** (name/description/status). Update courseware title → **`courseware_rename`**.
- Move courseware in/out of a course library → **`courseware_import_to_course`** / **`courseware_export_from_course`** (idempotent bind/unbind; the courseware itself is never moved or deleted).

### Images (you first)

Follow the **ainobi-images** skill. In short: generate the image yourself, upload it with `courseware_asset_upload` (`local_path` on a local Studio, else `content_base64`), insert it with `ainobi_exec element insert --type image --set source=<source>`, and save. Use `courseware_image_generate` only when you cannot generate images. Never call `ainobi_exec ["image",…]`.

### Login-free preview (after authoring)

The user should never be asked to log in to view the courseware. `courseware_ui_links` returns direct browser URLs that carry a short-lived handoff code — the frontend exchanges it for a login session automatically.

```text
User: "打开预览看看" (show me the preview) / "做好了吗，给我看看效果"
→ courseware_ui_links { }  (defaults to the open session courseware; or pass courseware_id)
→ share links.courseware_preview (student preview) in chat; offer links.courseware_editor
  (student editor) / links.manage_course when the user wants to edit
→ re-call the tool for a fresh link if the code expired (10 min TTL / 30 opens)
```

- The URL is user-facing (contains no tool jargon) — paste it as-is.
- Do not construct preview URLs yourself or reuse an old link after expiry.
- The code is a short-lived credential: do not post it into public channels.

### HARD RULE: refresh the preview after every change

After ANY change that affects what the user sees (`courseware_create` / `courseware_save` / `courseware_rename` / `course_create` / `course_update` / `courseware_import_to_course` / `courseware_export_from_course` / narration, images, quiz or any content write), you **MUST call `courseware_ui_links` and send the user the fresh courseware_preview link**:

- Opening the fresh link loads the latest content; if the user already has the preview open, opening the new link refreshes it.
- Not sending the link leaves the user looking at stale content — this is not optional.
- The link carries a 10-min / 30-open handoff code — enough for refresh flows; call the tool again when it expires.

### Common UI addresses (login-free via `courseware_ui_links`)

| Surface | Path | Notes |
|---------|------|-------|
| Courseware preview | `/courseware-preview?courseware_id=…` | Student app — view the courseware |
| Courseware editor | `/courseware-editor?courseware_id=…` | Student app editor |
| Course list | `/course` (manage app) | Course management |
| Agent panel | `/agent` (manage app) | Connected agents: list & manage |

The tool's `links` object already carries the login-free URL for each (preview / editor / manage_course / manage_course_list / manage_agent_panel) — hand them to the user directly; `paths` lists the bare paths for reference.

### Works with ANY MCP client (not just Claude Code / Codex / ChatGPT)

Onboarding is client-agnostic. Any MCP-capable agent can connect with the same credential:

1. Read the connect doc from the instruction URL.
2. Download the credential to a file **without reading it**; reference it only as the env var `AINOBI_AGENT_API_KEY`.
3. Configure your framework's MCP client: transport = Streamable HTTP, `url` = the `AINOBI_MCP_URL` value, auth header = `Authorization: Bearer ${AINOBI_AGENT_API_KEY}` (env-expanded; never plaintext).
4. Verify with `course_list`; register the name with `agent_set_name`.

The doc's Claude Code / Codex / ChatGPT steps are examples — adapt them to your framework's MCP config format. Everything else in this skill applies unchanged.

### Narration dialog

```text
User: "加 AI 老师讲解" (add AI-teacher narration)
→ courseware_ai_teachers (after open)
→ if empty_catalog: tell user to add AI teachers under Teacher Management > AI Teachers (Chinese UI label “教师管理 > AI 教师”); offer silent slides
→ else: present names (+ Chinese / Japanese / English from language); wait for pick
→ courseware_narration with --teacher-id <id> per narrated slide (TTS-first)
→ courseware_save
```

### Hard ban: local filesystem “catalog”

The plugin package and any stray `db-courseware.scene.json` / workspace scene files are **not** the org catalog. If the user asks what courses/coursewares exist:

- Call **`course_list`** / **`courseware_list`** via MCP.
- If MCP auth fails, say Bearer is missing/invalid — do **not** invent empty catalogs or invent titles from local JSON.

### Dialog flow (preferred)

```text
User: "有什么课件？" (what coursewares exist?) / "某某课程下有什么课件？" / "新建一个课件"
→ course_list (optional name filter) when they mean education courses
→ courseware_list { course_id } when scoped to a course
→ courseware_create { title, language, course_id } after confirming the content language (zh / en / ja) with the user
→ courseware_rename { courseware_id, title } when they ask to rename
→ show titles + ids/keys in course language (no MCP jargon)
→ courseware_open { courseware_id } after they pick one (create already opens by default)
```

`org_id` may be omitted (defaults to the authenticated Agent/teacher session org).

## Before structural authoring

Do **not** run `init` / `load` / `slide insert` / `element insert` / `narration` on a vague new-course ask. Align on a content framework first (slide inventory, audience, narration/quiz intent). Checklist: [workflows.md](references/workflows.md) § Requirements discovery.

`courseware_open` already preloads the scene — do **not** `ainobi_exec` `init` / `load` unless the user asks to start over.

## Authoring modes (required)

- **Bulk build** (new multi-slide course, large structural rewrite after framework approval): `courseware_workspace_write` a plan to `batch/plan.json`, then `ainobi_exec` `batch dry-run --file batch/plan.json` → `batch apply --file batch/plan.json`. Spot-check with `slide get` / `inspect`. Details: [batch-operations.md](references/batch-operations.md).
- **Micro-edit**: incremental `ainobi_exec` (`element insert|update`, `animation preset`, …) — one call per logical change; inspect `ok`/`warnings` before continuing.
- **TTS-first** on narrated slides: teacher catalog → transcript → **`courseware_narration`** → timed inserts → motion. Narration is **never** in batch. Read [topics/narration.md](references/topics/narration.md) first.
- **Silent slides:** still set explicit `--start` / `--duration` and motion when the slide has a timeline. Read [topics/motion-timing.md](references/topics/motion-timing.md).
- **Images:** your own image generation → **`courseware_asset_upload`** first; host **`courseware_image_generate`** only if you cannot generate images (skill **ainobi-images**).

### Forbidden

- Long argv chains with `&&` / pipes inside `ainobi_exec`.
- Hand-writing a full scene JSON as the loaded scene (use `batch` ops or incremental CLI on the preloaded scene).
- Calling `courseware_image_generate` when you can generate the image yourself.
- Losing `data.source` after upload / generate.

## Workflow skeleton

0. Requirements when vague.
1. If no courseware id/key yet — `course_list` and/or `courseware_list` (with `course_id` when scoped), then pick one.
2. `courseware_open` with the user’s courseware id/key.
3. Inspect — `ainobi_exec` `slide list --verbose`, `slide get`, `element get`.
4. Architecture once — slide inventory + compact design system.
5. Structure — batch dry-run → apply (or micro-edit if tiny).
6. Media — your own images → `courseware_asset_upload` (skill **ainobi-images**); docs → `courseware_doc_read` as needed.
7. Per narrated slide — TTS-first via `courseware_narration`.
8. Ship — `validate --publish` (+ `quiz validate` if quizzes) → **`courseware_save`**.
9. Hand over — **`courseware_ui_links`** and share the preview URL so the user can view the result without logging in.

## Hard rules (always)

- **Reading JSON:** add `--select <path>` to an `ainobi_exec` argv to get only part of `data` (e.g. `["slide","get","2","--with-children","--select","slide.children_elements[]{element_id,name,text}"]`) instead of re-reading whole payloads.
- **Numbers:** write every number with Arabic digits in slide copy, narration/subtitles, quizzes and chat (`2026年`, `25%`, `N2`, `第3章`, `1番`) — never spell them out as `二零二六年` / `二十五` / `N二` / `一番`, not even for TTS: narration TTS reads digits correctly in zh / ja / en. Keep numeral characters only inside fixed words or idioms (`一起`, `三角形`) or when the lesson teaches numerals.
- **Quiz media:** on a slide with `el_quiz_*`, question image/audio goes in `react_layout` via `quiz update --jsx-file`. Before any quiz insert/update/jsx: Read [topics/quiz.md](references/topics/quiz.md).
- **Shapes:** prefer `rectangle` / `ellipse` / `line`; `svg` only when needed.
- **Cards / grids:** prefer `rich` (Tailwind) — Read [topics/html-rich.md](references/topics/html-rich.md).
- **Complex interactive HTML:** sketch HTML carefully in the workspace, then `element insert --type html --asset …` (no Claude Task subagent on this surface).
- **Search / docs / images:** facts come from research, never invention (skill **ainobi-research**: your own search first, `courseware_search` only without one); pictures follow skill **ainobi-images**. Asset and doc commands: [topics/assets-search.md](references/topics/assets-search.md).
- **Refresh preview after changes:** after any content change, call `courseware_ui_links` and send the user the fresh preview link (see "HARD RULE: refresh the preview after every change" above).
- **Medical / legal / finance:** Strict Mode — generate only from provided / searched sources ([workflows.md](references/workflows.md)).

## Topic index (L1 — read on demand)

| Before you… | Read |
|-------------|------|
| Any narration / AI teacher voice | [topics/narration.md](references/topics/narration.md) |
| Timed inserts, motion, highlights, flow-pause | [topics/motion-timing.md](references/topics/motion-timing.md) |
| Any `quiz *` / score-summary / quiz JSX | [topics/quiz.md](references/topics/quiz.md) |
| `rich` or complex `html` elements | [topics/html-rich.md](references/topics/html-rich.md) |
| search / doc / image / assets | [topics/assets-search.md](references/topics/assets-search.md) |

## L2 references (only when needed)

| Need | File |
|------|------|
| Requirements checklist | [workflows.md](references/workflows.md) |
| Command flags | `ainobi_exec` `["help", …]` |
| Aesthetics / TTS polish | [design-excellence.md](references/design-excellence.md) |
| Quiz AST whitelist | [quiz-components.md](references/quiz-components.md) |
| Bulk structure | [batch-operations.md](references/batch-operations.md) |

## Quality gate

```text
ainobi_exec: validate --publish
ainobi_exec: quiz validate   # if quizzes exist
ainobi_exec: inspect timeline --coverage
ainobi_exec: inspect overlaps <slide>
courseware_save
```

Fix publish warnings before treating the course as done.
