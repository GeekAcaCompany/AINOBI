# Batch Operations

Non-interactive `batch dry-run` / `batch apply` for **agent multi-slide structure**, plus replay / migration / regression. Micro-edits still use incremental `ainobi` commands ([workflows.md](workflows.md)).

## Limits (read before using)

| Supported in batch | **Not** in batch — use incremental CLI |
|--------------------|----------------------------------------|
| Scene/slide/element structure, align, layer | `narration insert` (TTS + OSS) |
| Animation, highlight, quiz init/insert/update/delete (with optional `--jsx`/`react_layout`) | `asset upload`, live preview hooks |
| `ppt.ranges` on PPT elements | Requirements discovery |

Batch **cannot** replace the **TTS-first** narrated-slide pipeline. After structure lands via batch, run narration per slide with incremental CLI.

## Agent bulk authoring (preferred for multi-slide builds)

Use this instead of chaining dozens of `element insert` in Bash (that inflates model context).

1. Resolve `work_dir` from `ainobi status` / `scene info --verbose`.
2. Write `$work_dir/batch/plan.json` (or per-slide `$work_dir/batch/slide-01.json`, …).
3. Validate then apply:

```bash
ainobi batch dry-run --file "$WORK_DIR/batch/plan.json"
ainobi batch apply --file "$WORK_DIR/batch/plan.json"
```

4. Spot-check: `slide list --verbose`, `slide get <n>`, `inspect overlaps <n>` as needed.
5. For narrated slides: TTS-first incremental loop ([topics/narration.md](topics/narration.md)).

Minimal plan shape (use numeric slide indices; animation targets need real `element_id`s — either apply structure first, then a second plan for motion, or omit presets until after a quiet apply + `element list`):

```json
{
  "operations": [
    {
      "op": "slide.insert",
      "slide": {
        "name": "核心发现",
        "background_color": "#0E141B",
        "timeline": { "start_at": 0, "end_at": 6000 }
      }
    },
    {
      "op": "element.insert",
      "slide": 0,
      "type": "text",
      "element": {
        "text": "核心发现速览",
        "font_size": 48,
        "color": "#FFFFFF",
        "bold": true,
        "position": { "x": 160, "y": 120 },
        "size": { "width": 1600, "height": 80 },
        "timeline": { "start_at": 0, "end_at": 6000 }
      }
    },
    {
      "op": "element.insert",
      "slide": 0,
      "type": "rectangle",
      "element": {
        "color": "#FF5C5C",
        "position": { "x": 160, "y": 220 },
        "size": { "width": 8, "height": 56 },
        "timeline": { "start_at": 0, "end_at": 6000 }
      }
    }
  ]
}
```

Practical pattern: **one file per slide** (`s0.json` with `element.insert` + `animation.preset` ops together) to halve Write/apply round-trips. For multi-slide scaffolding, use `slides.json` then per-slide element/motion files. Add `animation.preset` using quiet `element_id`s from apply / `element list`.

Agent runtime defaults to `--quiet` mutation output (`operations_applied` + `dirty`; per-op `results[]` omitted when ≥3 ops). Use `--no-quiet` only when debugging.

## Workflow

```bash
ainobi batch dry-run --file plan.json
ainobi batch apply --file plan.json
```

On failure: `operations[index]` and the failing payload. Optional `id` per op for debugging.

```json
{
  "operations": [
    { "id": "op-1", "op": "slide.template", "kind": "hero", "title": "Intro", "duration": 10000 }
  ]
}
```

Op names use **dot notation** (`slide.insert`, `quiz.insert`).

---

## Scene

```json
{ "op": "scene.update", "patch": { "name": "New Course" } }
```

---

## Slides

```json
{ "op": "slide.insert", "at": 0, "slide": { "name": "Blank", "background_color": "#FFFFFF", "timeline": { "start_at": 0, "end_at": 12000 } } }
```

```json
{
  "op": "slide.template",
  "kind": "hero",
  "title": "AI Foundations",
  "subtitle": "A visual introduction",
  "visual": "https://example.com/cover.png",
  "background": "#FFFFFF",
  "duration": 10000
}
```

`kind`: `hero` | `section`. `visual` (optional URL) adds a right-side image on hero templates.

```json
{ "op": "slide.update", "slide": 0, "patch": { "background_color": "#F3EFE7" } }
```

Full-bleed background fill (behind all elements; color < image < html < elements):

```json
{ "op": "slide.update", "slide": 0, "patch": { "background_image_url": "courseware_assets/…/bg.png", "background_image_fit": "cover" } }
```

```json
{ "op": "slide.update", "slide": 0, "patch": { "background_html_src": "data:text/html,…", "background_html_content_zoom": 1.5 } }
```

```json
{ "op": "slide.duplicate", "slide": 0, "name": "Copy" }
```

```json
{ "op": "slide.move", "slide": 3, "to": 1 }
```

```json
{ "op": "slide.delete", "slide": 2 }
```

`slide.delete` also removes any `scene.quiz.questions[]` entries bound to quiz
children on that slide (same cascade as `quiz.delete`).

---

## Elements

```json
{
  "op": "element.insert",
  "slide": 0,
  "type": "text",
  "element": {
    "name": "Title",
    "text": "Hello",
    "font_size": 64,
    "color": "#0F172A",
    "position": { "x": 120, "y": 160 },
    "size": { "width": 1200, "height": 120 },
    "timeline": { "start_at": 0, "end_at": 10000 }
  }
}
```

```json
{ "op": "element.update", "slide": 0, "element": "el_text_xxx", "patch": { "text": "Updated" } }
```

```json
{ "op": "element.delete", "slide": 0, "element": "el_text_xxx" }
```

**Rich (`type: "rich"`)**: prefer `ainobi element rich insert/update --jsx-file`. In batch, `element.insert` must carry the **complete** `react_layout` AST (it is rejected without one), and a `react_layout` in `element.update` **replaces the whole tree** — it is never merged node by node. A write that leaves the scaffold copy ("Rich component" / "Edit this block with Tailwind classes and nested HTML.") in a layout is rejected.

When the element is `element_type: "quiz"`, its bound `scene.quiz.questions[]`
entry is removed as well (same as `quiz.delete`).

---

## Layout

```json
{ "op": "element.align", "slide": 0, "ids": ["el_a", "el_b"], "mode": "center-x" }
```

Modes: `left`, `right`, `top`, `bottom`, `center-x`, `center-y`, `slide-center-x`, `slide-center-y` (see `ainobi help element align`).

```json
{ "op": "element.distribute", "slide": 0, "ids": ["el_a", "el_b", "el_c"], "axis": "y", "gap": 24 }
```

```json
{ "op": "element.layer", "slide": 0, "element": "el_text_xxx", "front": true }
```

---

## Animation & highlights

**Highlight** = `highlight.add` appends to an element’s `highlight_segments[]` (timed spotlight). Not a new slide child. See [SKILL.md](../SKILL.md) § Highlights.

```json
{ "op": "animation.preset", "slide": 0, "element": "el_text_xxx", "kind": "fade-up", "from": 0, "to": 800 }
```

```json
{ "op": "animation.stagger", "slide": 0, "ids": ["el_a", "el_b"], "kind": "fade-in", "from": 400, "duration": 800, "gap": 160 }
```

```json
{ "op": "animation.timeline", "slide": 0, "duration": 12000, "fit_elements": true }
```

```json
{
  "op": "highlight.add",
  "slide": 0,
  "element": "el_text_xxx",
  "from": 3000,
  "to": 5000,
  "padding": 16,
  "radius": 24,
  "opacity": 0.5
}
```

`kind` values for presets match interactive CLI: `fade-in`, `fade-up`, `zoom-in`, `pan`, `pulse`, `fade-out`. Enter/exit enums: `ainobi help enums`. Motion model: [SKILL.md](../SKILL.md) § Motion & animation.

**Flow pause** = `flow_pause.add` appends to the slide’s `flow_pause_points[]` (playback halts until Continue). Not an element. **Do not add by default** on text/rich-only slides. Proactively add only after inserting **html**, binding to that element’s **timeline end** (`when: "end"`, the default), or when the user explicitly requests a pause. Do **not** use for quiz slides/elements — quizzes pause on their own.

```json
{ "op": "flow_pause.add", "slide": 0, "element": "el_html_xxx", "when": "end" }
```

```json
{ "op": "flow_pause.add", "slide": 0, "element": "el_html_xxx" }
```

(Omitted `when` defaults to `"end"` → `element.timeline.end_at`.)

```json
{ "op": "flow_pause.add", "slide": 0, "at": 8400 }
```

```json
{ "op": "flow_pause.remove", "slide": 0, "pause_id": "pause_abc123" }
```

---

## Quiz (single-element model with AST layout)

Every quiz is **one** `element_type: "quiz"` slide element wired by
`quiz_question_id` to one `scene.quiz.questions[]` entry. The question's UI
structure lives in `react_layout` (whitelist AST authored as JSX and parsed by
the CLI). There is no `template_kind`, no `member_element_ids`, no separate
"build canvas" / "add question" / "html-form" step.

```json
{ "op": "quiz.init", "enabled": true, "total_score": 100 }
```

`quiz.insert` creates the slide element **and** the question entry atomically.
Pass `jsx` to author a custom layout; omit it to use the type's default AST.

```json
{
  "op": "quiz.insert",
  "slide": 1,
  "type": "single_choice",
  "jsx": "<QuizContainer><QuizTitle>2 + 2 = ?</QuizTitle><QuizOptionGroup><QuizOption value=\"qz_op_a\">4</QuizOption><QuizOption value=\"qz_op_b\">5</QuizOption></QuizOptionGroup><QuizSubmitButton>提交</QuizSubmitButton></QuizContainer>",
  "question": {
    "title": "2 + 2 = ?",
    "explanation": "2 + 2 equals 4.",
    "options": [
      { "option_id": "qz_op_a", "value": "qz_op_a", "is_correct": true },
      { "option_id": "qz_op_b", "value": "qz_op_b", "is_correct": false }
    ]
  },
  "element": {
    "position": { "x": 240, "y": 160 },
    "size": { "width": 1440, "height": 760 }
  }
}
```

`quiz.update` replaces the AST and/or patches question data and/or patches
slide element fields in one transaction; pass `jsx` (string) or
`react_layout` (already-parsed AST JSON) to swap the layout.

```json
{
  "op": "quiz.update",
  "slide": 1,
  "element": "el_quiz_xxx",
  "jsx": "<QuizContainer>…</QuizContainer>",
  "question": { "explanation": "新的解析" },
  "element_patch": { "position": { "x": 120, "y": 120 } }
}
```

`quiz.delete` removes the slide element and its bound question entry.

```json
{ "op": "quiz.delete", "slide": 1, "element": "el_quiz_xxx" }
```

`quiz.prune_orphans` drops `scene.quiz.questions[]` entries that are not bound
to any slide quiz element (leftovers from older CLI versions that deleted slides
without cascading). Prefer `quiz.delete` / `slide.delete` for new edits.

```json
{ "op": "quiz.prune_orphans" }
```

Supported question `type`s: `single_choice`, `multiple_choice`, `fill_blank`,
`essay`, `shadowing`, `speech`. AST whitelist + structural rules:
[references/quiz-components.md](quiz-components.md).

Interactive flow: `quiz init` → `slide insert` → `quiz insert --type … [--jsx …]` →
`quiz update --jsx …` (optional re-style) → `quiz validate`
([workflows.md](workflows.md)).

---

## PPT element

```json
{ "op": "ppt.ranges", "slide": 0, "element": "el_ppt_xxx", "ranges": "1, 3-5" }
```

---

## Mapping batch ↔ interactive CLI

| Batch `op` | Interactive command |
|------------|---------------------|
| `slide.insert` | `ainobi slide insert` |
| `element.insert` | `ainobi element insert` |
| `highlight.add` | `ainobi highlight add` |
| `flow_pause.add` | `ainobi flow-pause add` |
| `flow_pause.remove` | `ainobi flow-pause remove` |
| `quiz.init` | `ainobi quiz init` |
| `quiz.insert` | `ainobi quiz insert <slide> --type … [--jsx …]` |
| `quiz.update` | `ainobi quiz update <slide> <quiz_element> [--jsx …]` |
| `quiz.delete` | `ainobi quiz delete <slide> <quiz_element>` |
| `quiz.prune_orphans` | `ainobi quiz prune-orphans` |
| `quiz.score_summary.insert` | `ainobi quiz score-summary insert <slide> [--jsx-file …]` |
| `quiz.score_summary.update` | `ainobi quiz score-summary update [--jsx-file …]` |

For flags and JSON schemas, prefer `ainobi help` over guessing from this file.
