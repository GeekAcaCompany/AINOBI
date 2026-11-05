# Quiz authoring (L1)

**Before any `quiz insert` / `quiz update` / `--jsx` / score-summary work, read this file.**

Deep AST whitelist: [quiz-components.md](../quiz-components.md) (L2 — only when styling complex JSX).

## Quick path

1. `ainobi quiz init` once per scene.
2. `ainobi quiz insert <slide> --type <kind>` — creates slide element **and** `scene.quiz.questions[]` together.

Kinds: `single_choice | multiple_choice | fill_blank | essay | shadowing | speech` (no `true_false`).

Without `--jsx`, CLI writes a styled default layout. Choice labels: `--set options[i].value=<label>` (not `option_text`). Each `--set options[i].…` replaces the whole options array — set every index (≥2).

## Add a question styled like an existing one

Do not re-invent a layout from what the slide looks like — read it:

1. Check first: `ainobi quiz get <slide> <existing_quiz_element> --layout --select layout_jsx_lossless`.
2. Export in the matching format:
   - `true` → `ainobi quiz get <slide> <existing_quiz_element> --layout --select layout_jsx > "$AINOBI_WORK_DIR/q.jsx"`, later write back with `--jsx-file`.
   - `false` (text JSX cannot express, e.g. literal `<` or `{`) → `ainobi quiz get <slide> <existing_quiz_element> --layout --select react_layout > "$AINOBI_WORK_DIR/q.json"`, later write back with `--react-layout-file`. Never use `layout_jsx` in this case.
3. Write a copy with the new option ids / labels (`QuizOption value` — in JSON, the `value` prop of `QuizOption` nodes — must equal the new `option_id`s).
4. `ainobi quiz insert <slide> --type <kind> --title "…" --set 'options:json=[{"option_id":"q3_a","is_correct":true},…]' --jsx-file "$AINOBI_WORK_DIR/q3.jsx"` (or `--react-layout-file "$AINOBI_WORK_DIR/q3.json"`) `--size-w <w> --size-h <h> --position-x <x> --position-y <y>` — the response's `quiz_element_size` / `quiz_element_position` are the real box.

## Quiz media vs slide media (hard)

On a slide with `el_quiz_*`, media that belongs **inside** the blue question frame goes in `react_layout`:

| Intent | Path |
|--------|------|
| 题干配图 / 听题 / 选项旁示意图 | `asset upload` → `quiz update --jsx-file` with `<QuizMedia>` |
| Speech learner reference audio | `<QuizReferenceAudio>` + `--set reference_audio_url` |
| Shadowing scoring audio/text (hidden) | `--set reference_audio_url` / `reference_text` only — no reference blocks in JSX |
| Decor outside the blue frame | `element insert --type image\|audio` (+ timing if narrated) |

**Never** start with `element insert --type image|audio` for in-question media. **Never** use `--allow-slide-media` to “fix” overlap for in-question media.

If insert returns quiz+media `warnings[]`, treat as routing mistake: delete sibling, use JSX.

## Numbering (hard)

Learner-visible numbers live in `question.title` as course-global **1..N** in `quiz list` order (not per-type, not slide index). After any structural quiz change, rewrite **every** title prefix. Prefer `quiz update` in place. Verify with `quiz list --pretty` before save.

## Sizing

If the question looks too small, fix **JSX** (`QuizContainer` width/height `100%`, no inner fixed-width card) — do **not** first `element update --set size`.

## Restyle after insert

1. `quiz list --pretty` → `element_id`, size, `options[].option_id`.
2. Edit JSX (see `references/quiz-styled-layout.example.jsx`); replace placeholder option ids.
3. `quiz update … --jsx-file` → `quiz validate` (read `layout_sizing_warnings`) → `save`.

`--jsx-file` **replaces** the entire `react_layout` — start from the current AST.

## Score summary

Layout on `scene.quiz.score_summary.react_layout`. Use `quiz score-summary insert|update|get`. Use `{$total_score}` etc. — never hard-code the total score. See quiz-components.md §9.

## fill_blank tips

Mark blanks in `title` with `___`. Prefer insert then `quiz update --jsx-file` for custom shells. Do not hand-write `QuizInput name=` with stale blank_ids.

## Validate / orphans

```bash
ainobi quiz validate
ainobi quiz prune-orphans   # if validate reports unbound questions[]
ainobi save
```
