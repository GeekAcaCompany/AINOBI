# Motion & timing (L1)

Read this when inserting timed visuals, animations, highlights, or flow-pause.

Slide/element structure may be applied via `batch apply --file`; timing polish and TTS-aligned inserts stay incremental CLI.

## Timed insert (narrated slides)

Every teaching visual `element insert` must include `--start` and `--duration` or `--end` from the segment table. Omitting flags defaults to `0` — that is a defect.

- Land each element just before the narration clause names it; stagger siblings (`animation stagger`).
- `--start 0` only for full-slide backgrounds or elements truly visible from frame 0.
- Before leaving a slide: every non-narration / non-vtuber child needs enter/exit effects, `animation preset` / `stagger`, or keyframes (except intentional always-on decor).
- Do **not** defer timing/animation to a later polish pass.

Example:

```bash
ainobi element insert 2 --type text --set text='…' --set font_size=56 --center-x --set position.y=200 \
  --start 4200 --duration 3600
ainobi animation preset 2 <element_id> --kind fade-up --start 4200 --to 5000
ainobi highlight add 2 <element_id> --from 4200 --to 7800
```

## html / quiz timeline

`element insert --type html` and `quiz insert` default to the **full slide** timeline. Do not leave scaffold 5s / 1s bars unless intentional. `validate` warns when html/quiz do not span the slide.

## Flow pause

Slide-level stop until the learner clicks Continue.

- **Do not** add by default on text/rich-only slides.
- **Proactively add** after inserting `html`: `ainobi flow-pause add <slide> --element <html_ref>` (default `--when end`).
- Also when the user explicitly requests a pause.
- Never default `--when start` / `--at 0`. Never on quiz / quiz_score_summary.

## Silent slides

User marks no TTS — visuals only; still set explicit `--start` / `--duration` and motion when the slide has a timeline.

## Layout origin

Canvas `(0,0)` is top-left; `position.x/y` is box top-left. On 1920-wide slides, `x: 960` is **not** horizontal center — use `--center-x` or `(1920 - width) / 2`. See design-excellence.md §2.
