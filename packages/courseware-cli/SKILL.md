---
name: ainobi-courseware-cli
description: Creates, incrementally edits, validates, and saves AINOBI courseware JSON through the project CLI. Use for step-by-step slides, elements, animations, quizzes, highlights, narration, or when the user mentions @ainobi-courseware-cli, ainobi CLI, courseware, scene JSON, or agent courseware authoring.
---

# AINOBI Courseware CLI (L0 core)

Use `ainobi` as the only authoring surface. Prefer **file + batch** for multi-slide structure; use **incremental CLI** for micro-edits. Runtime returns quiet mutation JSON (ids/warnings) by default.

This is the **L0 bootstrap**. Read it first. For deep topics, read the matching **L1** file under `references/topics/` **before** that work (do **not** read every topic or L2 reference up front).

## User communication (agent host)

Users work in the AINOBI courseware editor—they are **not** CLI operators.

- **Editor language only:** slides, elements, narration/voiceover, motion, quizzes, layout, preview. Never mention `ainobi`, commands, flags, shell, `work_dir`, or JSON responses in chat.
- **No command dumps / no delegation:** execute authoring yourself; describe progress in course terms (e.g. “Narration for page 3 is ready”), written in the user's language.
- **Questions:** content and design; show `ai_teacher_name` when picking a teacher; keep `ai_teacher_id` internal.

## Runtime

- Run `ainobi <command>` from the **current session directory**.
- Helper payloads only under `data.work_dir` from `status` / `scene info --verbose`.
- **Save:** `ainobi save` with **no path** (host DB). Do not write scene JSON to arbitrary local paths.
- **Preloaded scene:** do **not** re-run `init` / `load` unless the user asks to start over.
- Every command returns JSON — read `ok`, `data`, `warnings`, `error.issues` before the next step. Mutation success is often quiet (ids only); use `slide get` / `element get` or `--no-quiet` when you need full payloads.
- Oversized prior tool outputs may be archived to a stub; use `ainobi recall <id>` only when you need the full body. Prefer live `slide get` / `element get` for current scene state.

## Before structural CLI

Do **not** run `init` / `load` / `slide insert` / `element insert` / `narration insert` on a vague new-course ask. Align on a content framework first (slide inventory, audience, narration/quiz intent). Checklist: [workflows.md](references/workflows.md) § Requirements discovery.

## Authoring modes (required)

- **Bulk build** (new multi-slide course, large structural rewrite after framework approval): Write batch JSON under `work_dir/batch/` (e.g. `plan.json` or per-slide `sN.json` combining **elements + animations** in one file), then `ainobi batch dry-run --file …` → `ainobi batch apply --file …`. Large Write bodies may be archived; use `ainobi recall <id>` only if needed. Spot-check with `slide get` / `inspect`. Details: [batch-operations.md](references/batch-operations.md) § Agent bulk authoring.
- **Micro-edit** (one slide/element/copy/timing tweak): incremental `ainobi` commands (`element insert|update`, `animation preset`, …) — one Bash tool call per logical change; inspect `ok`/`warnings` before continuing.
- **TTS-first** on narrated slides (cover included): teacher catalog → transcript in teacher language → `narration insert --teacher-id … --fit-slide` → segment table → timed inserts → motion → timeline inspect. Narration is **never** in batch. Details: **Read [topics/narration.md](references/topics/narration.md) before any `narration insert`.**
- **Silent slides:** still set explicit `--start` / `--duration` and motion when the slide has a timeline. Details: **Read [topics/motion-timing.md](references/topics/motion-timing.md)** when authoring timed visuals.

### Forbidden

- Long Bash chains of many `element insert` / `animation preset` with `&&`. Prefer one batch file.
- Shell/heredoc builders that bypass `batch apply`.
- Hand-writing a full scene JSON as the loaded scene (use `batch` ops or incremental CLI on the preloaded scene).

## Workflow skeleton

0. Requirements when vague.
1. Scene — preloaded: `status` / `scene info --verbose`; else confirm the content language (AskUserQuestion, zh / en / ja) then `init --name … --language <code> --first-slide`.
2. Inspect — `slide list --verbose`, `slide get`, `element get <slide> <ref>`.
3. Architecture once — slide inventory + compact design system.
4. Structure — Write `work_dir/batch/*.json` → dry-run → apply (or micro-edit if tiny).
5. Per narrated slide — TTS-first incremental loop → quality checks.
6. Ship — `validate --publish` (+ `quiz validate` if quizzes) → `ainobi save`.

## Hard rules (always)

- **Quiz media:** on a slide with `el_quiz_*`, question image/audio goes in `react_layout` via `quiz update --jsx-file` (`<QuizMedia>` / speech `<QuizReferenceAudio>`), **never** `element insert --type image|audio` first. **Before any quiz insert/update/jsx:** Read [topics/quiz.md](references/topics/quiz.md).
- **Reading JSON:** add `--select <path>` to any command instead of piping into jq/python (`ainobi slide get 2 --with-children --select 'slide.children_elements[]{element_id,name,text}'`). Helper files live in `$AINOBI_WORK_DIR`.
- **Numbers:** write every number with Arabic digits in slide copy, narration/subtitles, quizzes and chat (`2026年`, `25%`, `N2`, `第3章`, `1番`) — never spell them out as `二零二六年` / `二十五` / `N二` / `一番`, not even for TTS: narration TTS reads digits correctly in zh / ja / en. Keep numeral characters only inside fixed words or idioms (`一起`, `三角形`) or when the lesson teaches numerals.
- **Quiz numbering:** course-global `1..N` in `question.title` matching `quiz list` order; renumber all after structural quiz changes.
- **Shapes:** prefer `rectangle` / `ellipse` / `line`; `svg` only when needed.
- **Cards / grids:** prefer `rich` (Tailwind) over stacks of absolute boxes — Read [topics/html-rich.md](references/topics/html-rich.md) before rich/html work.
- **Complex interactive HTML:** prefer Task → `html-builder` subagent; then `element insert --type html --asset …`.
- **html / quiz** default to **full slide** timeline.
- **Flow pause:** do not add by default on text-only slides; add after `html` insert or when the user asks.
- **@ library files:** `asset get <file_id>` for signed URL. **@ reference courseware:** `reference inspect` / `reference import` — never `load` reference scenes.
- **Medical / legal / finance:** auto-enter Strict Mode; read @ reference files first; generate content only from those sources (see [workflows.md](references/workflows.md) § Medical / legal / financial topics).
- **Search / docs / images:** Read [topics/assets-search.md](references/topics/assets-search.md) before `search` / `doc read` / `image *`.
- **`image generate`:** always **foreground** Bash (blocking). Never background / Task / TaskOutput for billed generates — you will lose `data.source` and regenerate. Use `data.source` as the image element URL.

## Topic index (L1 — read on demand)

| Before you… | Read |
|-------------|------|
| Any `narration insert` / AI teacher voice | [topics/narration.md](references/topics/narration.md) |
| Timed inserts, motion, highlights, flow-pause | [topics/motion-timing.md](references/topics/motion-timing.md) |
| Any `quiz *` / score-summary / quiz JSX | [topics/quiz.md](references/topics/quiz.md) |
| `rich` or complex `html` elements | [topics/html-rich.md](references/topics/html-rich.md) |
| `search` / `doc read` / `image *` / assets | [topics/assets-search.md](references/topics/assets-search.md) |

## L2 references (only when needed)

| Need | File |
|------|------|
| Requirements checklist / forbidden patterns | [workflows.md](references/workflows.md) |
| Command flags encyclopedia | `ainobi help <command>` (or `ainobi <command> --help`) |
| Aesthetics / TTS timing polish | [design-excellence.md](references/design-excellence.md) |
| Quiz AST whitelist / components | [quiz-components.md](references/quiz-components.md) |
| Bulk structure / batch ops | [batch-operations.md](references/batch-operations.md) |

## Quality gate

```bash
ainobi validate --publish
ainobi quiz validate   # if quizzes exist
ainobi inspect timeline --coverage
ainobi inspect overlaps <slide>
ainobi save
```

Fix publish warnings (no motion, timeline gaps, contrast) before treating the course as done.
