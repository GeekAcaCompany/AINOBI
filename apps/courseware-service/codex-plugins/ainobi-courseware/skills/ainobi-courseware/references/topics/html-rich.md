# Rich & HTML elements (L1)

Read before authoring `rich` or complex `html` elements.

## rich (Tailwind, in-host DOM)

Use `rich` for cards/grids/multi-part blocks instead of stacks of absolute boxes.

```bash
ainobi element rich insert <slide> --jsx-file card.jsx \
  --set position.x=360 --set position.y=240 --set size.width=1200 --set size.height=600 \
  --start 0 --duration 5000
ainobi element rich update <slide> <element_id> --jsx-file card.jsx
```

Allowed: standard HTML tags + `className` (Tailwind safelist) + sanitized `style`. Not allowed: custom React components, event handlers, `position:fixed/sticky`, `url()` in style, scripts.

When to use:

- One headline / paragraph / shape → `text` / `rectangle`
- Box with multiple inner parts → `rich`
- Interactive third-party / full page → `html` (iframe)
- Graded question UI → `quiz`

Always set `size.height` large enough; `validate` flags canvas overflow.

## html (sandboxed iframe)

- Defaults to **full slide** timeline unless `--start` / `--duration` / `--end` passed.
- Complex interactive / animated HTML: prefer Task → `html-builder` subagent; insert with `element insert --type html --asset <path>`.
- After insert, consider `flow-pause add <slide> --element <html_ref>` (default `--when end`).

## Slide backgrounds

Full-bleed behind children via `slide update` fields (`background_color`, `background_image_url`, `background_html_src`) — not a positioned element. Layer: color < image < html < children.
