# Design & Content Excellence

Visual, pedagogical, and craft standards for AINOBI courseware. **Process and command order** are in [workflows.md](workflows.md) and [SKILL.md](../SKILL.md) — read those first; this file does not repeat the full per-slide CLI loop.

---

## How to use this guide

- Read **after** requirements and authoring mode (bulk batch vs micro-edit) are clear.
- Apply during **architecture** (palette, type scale) and during **each slide’s polish pass**.
- Re-check **§12** before ship.
- Unknown CLI flags or JSON shapes → `ainobi help element <type>`, not guesses from web CSS.

---

## 1. TTS-first and narration integrity (summary)

**Hard rule (narrated slides):** no `element insert` of any kind before the **first** `narration insert` on that slide — **cover included**. Exception: user-marked **silent** slides.

**Why:** Real `segments` duration drives beat-synced visual timing; transcript in `work_dir` stays the contract until audio exists.

**Numbered pipeline:** [SKILL.md](../SKILL.md) and [workflows.md](workflows.md) § Per-slide pipeline — follow that order exactly.

**Alternative (rare):** User explicitly wants **one** final `narration insert` after all visuals match a frozen transcript — do not use by default.

**After visuals exist:** on-screen claims must match audio. New numbers/names on screen → update transcript → delete `narration`+`vtuber` → `narration insert` again.

### Agent pitfalls (schema & coordinates)

| Pitfall | Correct approach |
|---------|------------------|
| Cover exempt from TTS-first | Index `0` follows the same rule |
| `ainobi help element align` | Valid — `align` is a command, not an element type |
| `element align` modes | Only `left \| right \| top \| bottom \| center-x \| center-y` — no `top-left`; no `--padding-x` on CLI |
| `element insert` position | Use JSON `position`/`size` or `--set position.x=…`; no `--position` flag unless `help` shows it |
| `--fit-slide` lengthens slide | Extends existing child timelines intentionally |
| `work_dir` | `ainobi status` or `scene info --verbose` |
| Text JSON | `ainobi help element text` — flat `text`, `font_size`, `color`, `align`; `style` only `opacity`, `rotation_deg`, `z_index` |
| Chinese quotes in JSON | U+201C/U+201D break parsers — ASCII quotes or `\u201c` |
| `position.x = 960` on 1920 slide | **Not** horizontal center — use `--center-x`, `x = (1920 - width) / 2`, or `element align … --mode slide-center-x` |
| Transcript vs visible copy | e.g. 「约10家」 in audio must not disappear from titles after insert |
| “高亮” = colored overlay elements | **No** — use `highlight add` → `highlight_segments[]` on an existing element; verify with `element get` |
| “Already has highlights” from colored boxes | Check `highlight_segments` in JSON, not rectangle count |
| Motion = recolor or move rectangles manually | Use `animation preset` / `stagger` or `enter_effect`; inspect `keyframes[]` |
| `animations[]` vs `keyframes[]` | Presets write **keyframes**; `animations[]` is timed **effect** segments — different fields |

---

## 2. Layout & typography (1920×1080)

**Canvas:** 1920×1080 logical px; player scales uniformly — do not shrink type “for small screens.”

**Type sizes (starting bands):**

| Role | `font_size` | Notes |
|------|-------------|--------|
| Display / slide title | 56–96 | Set explicitly — default is body-scale |
| Section | 40–56 | |
| Body | 32–44 | Avoid 24 as primary teaching size |
| Caption | 24–32 | Short secondary lines only |

**Box sizing:** `size.height` ≥ `line_height × font_size × line_count` (default `line_height` 1.2, range 0.5–5). The player **does not clip or shrink** text — undersized boxes overflow silently.

**Enforced now (CLI warnings):** `element insert` / `element update` and `ainobi validate` emit warnings when a teaching `text` uses `font_size < 32` on the 1920 canvas, or when the copy likely **overflows** its box (`size.height` too small for the estimated wrapped line count). Treat both as defects: bump `font_size` into the bands below, enlarge `size.height`, widen the box, or shorten the copy — do not ship with these warnings. Note: omitting `font_size` now defaults to **36** (was 24).

**Text box vs align:** `position.x/y` = **top-left** of box. `align` only inside the box. Center on slide → `--center-x` or `x = (1920 - width) / 2`.

**Grid:** mental 12-column grid; one focal anchor per slide; proximity groups ideas.

**Anti-patterns:** identical centered-card stack on consecutive slides; orphan headers.

---

## 3. Color systems

- **Roles:** background, surface, primary/secondary text, hairline, accent (+ semantic success/danger if needed). **3–5 hues** total.
- **One accent family** per course.
- **Default light** decks unless user/brand requests dark (`ainobi init` / templates).
- Avoid neon purple/cyan slop, meaningless glassmorphism, glow for glow’s sake.
- Body text: comfortable contrast; test captions on busy regions.

---

## 4. Motion design

**Four mechanisms** (see [SKILL.md](../SKILL.md) § Motion & animation):

| Field | Agent CLI |
|-------|-----------|
| `enter_effect` / `exit_effect` | `--set enter_effect=fade_in` on insert/update; enums via `ainobi help enums` |
| `keyframes[]` | **`animation preset`**, **`animation stagger`** (`--start`/`--to`, `--kind`) |
| `animations[]` | Schema-only for most agent work — timed effect segments; use preset/enter_effect instead |
| `highlight_segments[]` | **`highlight add`** — focus, not motion (§5) |

**Practice**

- **Staging** before ornament; **`animation stagger`** with intent for lists and comparisons.
- Short moves ~300–700ms; preset default window is 800ms unless you shorten `--to`.
- **Explicit `--start`** on inserts **and** on `animation preset` / `stagger` — align to the narration segment table; `0` only for true frame-0 decor.
- If motion does not clarify structure, omit it.
- Every non-narration child needs motion before leaving a slide (`preset`, `stagger`, enter/exit, or keyframes) unless always-on decor — `validate` warns otherwise.

**Preset kinds:** `fade-in`, `fade-up`, `zoom-in`, `pan`, `pulse`, `fade-out`.

---

## 5. Focus & highlights

**Job:** `highlight add` answers *what should the learner inspect during this clause?*

**Model:** timed **spotlight** on an existing element (`highlight_segments[]` in scene JSON). **Not** a separate layer element — do not fake focus with extra `rectangle` tints unless the lesson design truly needs a static callout box (that still is not `highlight_segments`).

**When:** new term, diagram branch, comparison winner, quiz option — not decoration.

**CLI:**

```bash
ainobi highlight add <slide> <element_id> --from <ms> --to <ms> \
  [--padding <px>] [--radius <px>] [--opacity <0-1>] [--color <css-color>]
```

- Target must **already exist** (`element insert` first).
- Same element, multiple phrases → multiple `highlight add` on the **same** `element_id`.
- Use **`--from` / `--to`** (not `--start` / `--end`).
- Align windows to **narration clauses** (same table as element `--start`).
- **≥ 500ms** per segment; inside element timeline.
- Prefer **one** active spotlight per beat on screen.
- Defaults: padding 12, radius 24, opacity 0.62.
- **Audit:** `element get` — if `highlight_segments` is empty, there are no CLI highlights yet.

Full rules and anti-patterns: [SKILL.md](../SKILL.md) § Highlights.

---

## 6. Narration & explanation

- Script matches visible anchors — no mystery numbers.
- **One primary takeaway** per slide.
- Concrete beats slogans.
- Hollow voiceover test: if narration fits any slide, rewrite.

### Transcript line breaks (`\n`)

**Mechanics (CLI / player)**

- Each `\n` in `--transcript` (or `--script` when transcript is omitted) becomes **one TTS segment** and **one subtitle line**. Timing and highlights align to these segments — not to commas inside a line.
- `narration insert` **rejects** a single line longer than **50 characters** with no `\n`. That is a hard floor, not a target line length.
- Row-internal punctuation (`，` `。` `,` `.`) does **not** split audio; only `\n` does. Do not try to force segment breaks by sprinkling commas — use **fewer, longer** complete lines instead.
- **Numbers:** write every number in the transcript with Arabic digits (`2026年`, `25%`, `N2`, `第3問`) — the transcript is also the subtitle, and TTS reads digits correctly in zh / ja / en (Japanese counters are handled by the host pronunciation dictionary). Never spell numbers out as `二零二六年` / `二十五` / `N二` / `一番` for TTS; if a source document does, convert them back to digits.
- **Never cut or wrap transcript / slide text with shell tools** (`awk substr`, `cut -c`, `fold`, `printf %.Ns`, `head -c`, `dd`). They count **bytes**, split Chinese / Japanese characters in half and produce `�` (U+FFFD). Write the line breaks yourself at sentence boundaries; if you must process text programmatically, use `node -e` (string/`Array.from` operations are character-safe). Any write containing `�` is rejected by the CLI — rewrite it from the original source.

**When to break (good `\n`)**

- After a **complete phrase or sentence** the learner can hear as one thought (question finished, new fact, a new beat to sync visuals to).
- When a line would exceed ~50 characters **and** the nearest natural boundary is a clause/sentence end — break **there**, not at an arbitrary column.
- Typical narrated slide: about **2–6 lines** for one teaching beat; more only when the slide truly has multiple distinct beats.

**Do not over-break (bad `\n`)**

Avoid “subtitle-typesetting” line breaks — wrapping because a line *looks* long on paper, or breaking at every pause mark. Each micro-line forces a new TTS call, a new subtitle flash, and a new segment in the timing table; choppy audio and timing noise follow.

**Never break `\n` inside:**

| Avoid | Example (bad) |
|-------|----------------|
| Predicate / object split | `出版了` / `《C程序设计语言》这本书` |
| Modifier / head split | `Hello World` / `是怎么变得…` |
| Name or date split | `布莱恩·克尼汉和` / `丹尼斯·里奇` ; `1978年，` alone on next line |
| Question mid-clause | `是怎么` / `变得这么有名的呢？` |
| Book / product title split | `Hello World` across two lines |

**Classic bad case (over-segmented)**

```
那么，Hello World是怎么
变得这么有名的呢？
1978年，布莱恩·克尼汉和
丹尼斯·里奇出版了
《C程序设计语言》这本书。
在这本经典的编程教材中，
他们沿用了Hello World
作为第一个示例。
随着C语言的广泛流行，
Hello World也传遍了全世界。
```

Eleven lines for one short story — most breaks are mid-phrase. TTS will sound clipped; subtitles will flicker; segment timing is harder to align with visuals.

**Better (same content, fewer boundaries)**

```
那么，Hello World 是怎么变得这么有名的呢？
1978 年，布莱恩·克尼汉和丹尼斯·里奇出版了《C程序设计语言》这本经典教材。
书中第一个示例用的就是 Hello World。
随着 C 语言广泛流行，Hello World 也传遍了全世界。
```

Four lines — one `\n` per complete sentence or clear rhetorical beat. Read each line aloud: it should sound like something a teacher would say in one breath, not a broken SMS.

**Self-check before `narration insert`**

1. **Aloud test** — every line is a complete spoken unit; no line starts or ends with a dangling particle (`的` `是` `和` `了` …) unless intentional emphasis.
2. **Merge test** — if two adjacent lines are each under ~20 characters and belong to the same sentence, merge them unless you need a separate visual-sync beat.
3. **50-character rule** — if you must split a long sentence, walk backward to the nearest `，` / `。` / `？` / clause boundary; do not split mid-word (Latin or CJK) or mid proper noun.
4. **Beat test** — each `\n` should map to something you might highlight or reveal on screen; gratuitous lines mean gratuitous segments.

---

## 7. HTML widgets

- `element insert --type html --asset …` for interactives, charts, explorables — not `html` on slide root.
- Semantic HTML (`article`, `dl`, `table`, `<details>`).
- Scoped CSS; `prefers-reduced-motion` where possible.
- Contrast, focus states, keyboard use.

---

## 8. Timeline cadence

- Hook (0–1.2s): minimal motion + anchor.
- Teaching window: elements land **just before** named in audio.
- Exits: declutter before next idea.
- `inspect timeline --coverage` — no accidental dead tails.
- `inspect overlaps <slide>` on dense slides.

---

## 9. Component choice

| Primitive | Use for |
|-----------|---------|
| `text` | A single headline / paragraph; definitions, careful wording |
| `rich` (Tailwind) | **Any multi-part container** — stat grids, two-up compare, callout/definition cards, step rows, labeled lists. Children flow inside (flex/grid) so text wraps, never overflows. Author via `element rich insert --jsx-file`. **Prefer this over stacking many absolute boxes.** See SKILL.md § Rich component. |
| `rectangle` / `ellipse` / `line` | Single decorative blocks, panels, rules, circles — **before** SVG |
| `svg` | Paths, diagrams, icons, gradients — when shapes insufficient |
| `image` / `video` | Photo evidence, footage |
| `html` | Interactive widgets / full pages schema cannot model (sandboxed iframe) |
| Quiz canvas | Retrieval at checkpoints — `quiz init` → `add-question` → `build-canvas` |

**Card/grid decision:** if a "box" has more than one inner element, or alignment/wrapping matters, reach for `rich` (one element, nested DOM) instead of a `rectangle` + several absolutely-positioned `text` boxes (which overflow and drift). Keep `text` for genuinely single-line/single-paragraph content.

```bash
# Shapes (timed after narration segments known)
ainobi element insert 0 --type line --set color="#B08D57" --set stroke_width=4 \
  --set position.x=120 --set position.y=880 --set size.width=640 --set size.height=8 \
  --start 2400 --duration 9600

ainobi element insert 0 --type rectangle --set color="#FFFFFF" --set border_radius_px=20 \
  --set position.x=100 --set position.y=320 --set size.width=720 --set size.height=280 \
  --start 1200 --duration 10000
```

**SVG:** `viewBox="0 0 W H"` must match `size.width` / `size.height`; 2–4px stroke padding; run `inspect svg-bounds` after insert.

---

## 10. Visual variety (one design system)

- Rotate layout grammar across slides — asym hero, two-up compare, process rail, evidence board, quiz focus, closing callback.
- Same **tokens**, different **compositions**.
- Each slide: at least one craft moment (timed highlight sequence, bespoke SVG, thoughtful widget).

---

## 11. Frameworks (use deliberately)

Progressive disclosure, information scent, cognitive load / chunking, dual coding, data-ink restraint, Fitts/Hick for interactions, aesthetic-usability (accuracy first).

Golden ratio / rule of thirds: compositional hints — optical tuning still wins.

---

## 12. Pre-ship checklist

**Pedagogy**

- [ ] Each slide has a clear arc role
- [ ] Text and narration agree
- [ ] Transcript `\n` only at phrase/sentence boundaries — no mid-clause or mid-name wraps (§6)
- [ ] Subtitle lines are complete spoken units (~2–6 per beat, not comma-chopped micro-lines)
- [ ] Quizzes/HTML test the just-taught idea

**Visual**

- [ ] Palette and accent disciplined
- [ ] Type hierarchy obvious at a glance
- [ ] No low-contrast captions

**Motion & time**

- [ ] Timed entrances; stagger intentional
- [ ] No idle tails (`inspect timeline --coverage`)
- [ ] Overlaps checked (`inspect overlaps`)
- [ ] SVG bounds clean (`inspect svg-bounds`)

**Technical**

- [ ] `validate --publish` passes
- [ ] Highlights on narration beats
- [ ] HTML scoped and readable

---

## 13. Dimensions → CLI (quick reference)

| Dimension | Primary levers |
|-----------|----------------|
| Layout | `element insert`, `element align`, `rectangle`/`ellipse`/`line`, then `svg` |
| Color | slide/element colors, shape stroke/fill, HTML CSS |
| Motion | `animation preset`, `animation stagger`, `--start`/`--duration`/`--end` |
| Focus | `highlight add --from`/`--to` on clause windows |
| Content | `work_dir` transcript → narration → timed inserts |
| Timeline | `inspect timeline --coverage`, `inspect overlaps` |

---

## 14. Mindset

Premium courseware reads as a **designed lesson**, not a generator export. Clarity, specificity, restraint — every color, motion, and highlight answers: *What matters right now?*
