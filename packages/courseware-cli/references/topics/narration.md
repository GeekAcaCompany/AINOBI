# Narration & AI teachers (L1)

Read this before any `ainobi narration insert` or teacher selection.

Structure (slides/elements) may come from `batch apply --file`; **TTS remains incremental** — never put `narration insert` in batch.

## Catalog (once per session)

```bash
ainobi ai-teachers list --save
```

- Show **names** (`ai_teacher_name`) to the user; keep `ai_teacher_id` internal.
- When multiple teachers exist, mention each `ai_teacher_language` (zh→Chinese / ja→Japanese / en→English).
- If catalog is empty (`count: 0` / `empty_catalog: true`): **stop** narration; tell the user an admin must create an AI teacher; offer silent slides.
- Optional voice override: `ainobi tts list --save` then `narration insert … --tts-id <id>`.
- Optional **style** override: `narration insert … --tts-style <recommended_key>` (Google TTS voices only).
  - Recommended keys: `friendly_teacher` 亲切教学 · `authoritative_professor` 权威讲解 · `lively_narrator` 活泼讲解 · `calm_storyteller` 沉稳叙事 · `professional_anchor` 专业播音 · `playful_host` 趣味主持 · `serious_formal` 严肃正式 · `soft_gentle` 轻柔平和.
  - Any other non-empty value is a **custom free-text style**: a concise English delivery/persona description (<=200 chars), e.g. `--tts-style "a whispery, mysterious storyteller with a slow pace"`.
  - Omit it → the teacher's bound style, else the platform default (`friendly_teacher`).
  - **Voice vs style**: "换个声音/音色" → change voice (`--tts-id`); "换个语气/风格/人设" → change style (`--tts-style`) — no voice change needed. When the user asks for a vibe, offer 2-3 style keys with their labels via AskUserQuestion; never enumerate the full style catalog (it is human-facing only).
- Agent runtime also auto-loads the teacher catalog on `narration insert` when it is missing from the session — still prefer an explicit `ai-teachers list --save` so you can present choices before inserting.

## Language contract

Transcript language is locked to the chosen teacher's `ai_teacher_language`, **not** the chat language. CLI `warnings[]` on language mismatch = defect: rewrite transcript or switch teacher (with confirmation), then re-run.

## Per narrated slide (TTS-first)

1. Draft `--transcript` in `work_dir` in the teacher language (phrase/sentence breaks; avoid over-segmentation — see design-excellence.md §6).
2. `slide get <slide>` (no `--with-children` until children exist).
3. `narration insert <slide> --teacher-id <id> --transcript … --fit-slide --tail-ms 500` — retry on TTS/OSS failure; never ship without audio. Reuse the same teacher unless the user switches. Subtitles show on canvas by default; pass `--no-subtitle-visible` to hide the subtitle band (audio still plays).
4. `slide get <slide> --with-children`; build cumulative ms table from `narration.segments[]` in `work_dir` (**offset by that narration’s `timeline.start_at`**).
5. Insert timed visuals aligned to the segment table; then motion/highlights.
6. `inspect timeline --coverage` and `inspect overlaps <slide>` before the next slide. Also run `ainobi validate` — overlapping narration timelines on the same slide are reported as warnings.
7. If visible copy changes **or the user asks to change voice**: replace the narration+vtuber pair carefully — see **Voice / transcript replace** below.
8. If the user asks to show/hide on-canvas subtitles for an existing narration: `ainobi element update <slide> <narration_ref> --set subtitle_visible=true|false` (do **not** delete/re-insert just to flip this).

`--fit-slide` is on by default. Do not use “single TTS at end” unless the user explicitly requests one synthesis pass.

## On-canvas subtitle visibility

- Field: `narration.subtitle_visible` (boolean, default `true`).
- Insert-time: `--subtitle-visible` (default) / `--no-subtitle-visible`.
- After insert: `element update <slide> <narration_id|index> --set subtitle_visible=false` (or `true`).
- Hiding subtitles does **not** skip TTS, segments, or vtuber lip-sync.

## Multiple narrations on one slide

Sequential AI-teacher segments on the **same** slide are allowed (dialogue, multi-teacher beats).

- Call `narration insert` once per segment; the CLI **auto-staggers** each new pair after the latest existing `narration.timeline.end_at` (optional `--stagger-gap-ms`).
- Do **not** hand-edit overlapping `start_at`/`end_at` on narration tracks — stacked audio is a defect.
- After inserts: `ainobi validate` must not warn about narration timeline overlap.
- Keep each vtuber timeline aligned to its own narration window (CLI does this).

## Voice / transcript replace (safe order)

Changing `--tts-id`, `--tts-style`, or rewriting a transcript requires deleting the old narration+vtuber pair and inserting a new one. **Do not** start a multi-slide `element delete … && narration insert …` loop until catalogs are ready — a failed insert after a successful delete leaves the slide without narration.

Safe workflow:

1. Ensure catalogs first: `ainobi ai-teachers list --save` (and `ainobi tts list --save` when using `--tts-id`). Styles need no catalog — the recommended keys are fixed.
2. Capture each slide's current `--transcript` / `--script` via `element get` before deleting.
3. Prove one insert works: run `narration insert … --tts-id …` successfully on at least one slide (after deleting that slide's old pair) before looping the rest.
4. Then continue per remaining slide: delete narration+vtuber → immediately `narration insert` with the saved transcript. If any insert fails, **stop** and restore that slide before touching others.
5. When replacing a single pair, delete first so the new insert starts at the slide start (not staggered after a leftover track).

## Integrity

- Ground transcripts in `work_dir` notes and user requirements.
- After visuals exist: audio, on-screen text, and requirements must agree.
- Never leave two narration tracks with overlapping timelines on one slide.
