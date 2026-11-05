# Quiz Components & AST Reference

Authoritative reference for the quiz authoring surface. SKILL.md gives the quick path; this doc lists every functional component, prop, interpolation, and validation rule the CLI applies when you write `--jsx`.

The CLI parses JSX strings into a **whitelist AST** on write and stores it on `scene.quiz.questions[].react_layout`. The frontend renders the AST recursively — there is no runtime JSX parsing, no `eval`, no Babel, no `dangerouslySetInnerHTML`, no iframe.

---

## 1. AST root: `<QuizContainer>` (required)

Every `react_layout` MUST be a single `<QuizContainer>` as the root. Nested `<QuizContainer>`s are rejected.

### Sizing model (read this before custom JSX)

Three nested boxes — do **not** confuse them:

| Layer | What it is | Typical size | Agent controls |
|-------|------------|--------------|----------------|
| **Slide** | Full canvas | 1920×1080 | `slide` background, **sibling** `image`/`text` via `element insert` |
| **Quiz element** | Blue frame on slide (`element_type: "quiz"`) | e.g. 1200×920 via `--size-w/--size-h` | `quiz insert/update --position-x/y --size-w/h` |
| **`QuizContainer`** | `react_layout` root — **fills the quiz element** | `width/height: 100%` of blue frame | `--jsx` / `--jsx-file`; **in-question** images/audio via `<QuizMedia>` here |

**Agent placement rule (default = in-question):** On a quiz slide, **start with `quiz update --jsx-file`**, not `element insert`, whenever the user mentions 配图、听题、题目里、整合到题目、教师形象 in the question, or **speech** reference audio the learner should hear. Put those assets in **`react_layout`** (`<QuizMedia>` / `<QuizReferenceAudio>` / `<img>`) after `ainobi asset upload` or `ainobi asset get <file_id>` (editor @ library files — editor context lists `file_id` only). **Shadowing scoring audio** is different: use `--set reference_audio_url=…` on the question (hidden from learners) — do **not** add `<QuizReferenceAudio>` to shadowing JSX expecting learners to hear it. Use `ainobi element insert --type image|audio` **only** for decor clearly **outside** the blue frame (corner avatar, watermark, narrated-slide beat unrelated to the question). Slide-layer images/audio are **siblings** of `el_quiz_*` — they do not appear inside the student question UI and trigger `inspect overlaps` / insert `warnings[]`. **`--allow-slide-media` does not move media into the question**; it only suppresses warnings for intentional slide decor.

**Anti-pattern:** a 1200×920 quiz element with `<div style={{ width: 680 }}>` centered inside — the card looks tiny with huge margins. **Fix:** `<QuizContainer style={{ width: "100%", height: "100%", … }}>` and let sections use `width: "100%"`. To make the whole question smaller on the slide, shrink `--size-w/--size-h`, not an inner fixed card.

Before styling: `ainobi quiz list --pretty` → read each entry's `size.width` / `size.height` (the box your JSX must fill). `ainobi validate` / `quiz validate` warn when root lacks `100%` or an inner layout uses fixed width ≥400px.

| Prop | Type | Notes |
|------|------|-------|
| `padding` | number \| string | Forwarded to the rendered `<form>` `style.padding`. |
| `gap` | number \| string | Forwarded to the rendered `<form>` `style.gap`. |
| `narrationAudioUrl` | string | Optional override for content narration audio (defaults to `question.content_narration_audio_url`). |
| `narrationDurationMs` | number | Optional narration duration. |
| `className`, `style`, `id`, `aria-*`, `data-*`, `role`, `tabIndex`, `title`, `lang`, `dir` | — | Common HTML props (whitelisted). |

---

## 2. Functional components

Each row shows the tag, what it renders, required props, and which question types it is allowed on.

| Tag | Renders | Required props | Allowed on |
|-----|---------|----------------|------------|
| `QuizTitle` | Question stem container (any children) | — | All |
| `QuizMedia` | `<img>` or `<audio>` | `type="image" \| "audio"`, `src` (https:// or `data:`) | All |
| `QuizOptionGroup` | `<div role="radiogroup" \| "group">` | — | single_choice / multiple_choice |
| `QuizOption` | Selectable `<button type="button">` | `value` (MUST equal an `options[].option_id`) | single_choice / multiple_choice |
| `QuizInput` | Controlled `<input type="text">` | `name` (blank_id for fill_blank; free-form for essay/speech); **`inline`** on fill_blank (underline-only, no box chrome) | fill_blank / essay / speech |
| `QuizTextarea` | Controlled `<textarea>` | `name` | essay |
| `QuizSubmitButton` | Submit `<button type="submit">` | optional `disabledWhenEmpty` (default `true`): choice / fill / essay need answers; **shadowing / speech need a finished recording** before enable | All — exactly ONE |
| `QuizSkipButton` | Skip `<button>` (visible only if `!required && !submitted && !skipped`) | — | All |
| `QuizResubmitButton` | Reset `<button>` (visible only if `submitted && allow_resubmit`) | — | All |
| `QuizContinueButton` | Advance `<button>` (visible only after host clears `canAdvance`) | — | All |
| `QuizExplanation` | `<div>` rendered after submit when `explanation` is non-empty | — | All |
| `QuizFeedback` | `<div role="status" data-variant="…">` rendered after submit | optional `variant` | All |
| `QuizScore` | `<span>` with `earned/total` (visible if `submitted && show_feedback_score`) | — | All |
| `QuizReferenceAudio` | `<audio controls>` for **learner-visible** reference audio (optional) | `src` (may be `""`; falls back to `reference_audio_url` on **speech**) | **speech** only (learner UI). On **shadowing**, the tag may parse but is **not shown** to learners — use `--set reference_audio_url` for scoring instead |
| `QuizShadowingControl` | Recorder start/stop `<button>` — **only AST `children` render inside** (no built-in icon/label/timer) | optional `name` (default `recording`); optional **`recordingStyle`** (simple red-active shortcut); prefer **`<QuizStateView>`** branches for per-state UI | shadowing / speech |
| `QuizStateView` | **Not a DOM node** — declares alternate markup for a stateful host | required `when="idle\|recording\|disabled\|submitted"` (per host); optional `style` merged onto host chrome for that state | direct child of `QuizShadowingControl` (more hosts later) |
| `QuizRecordingTimer` | Live `m:ss` clock (or custom children) while recording | optional `name` (match control); `hideWhenIdle` (default `true`) | shadowing / speech |
| `QuizRecordingPlayback` | `<audio controls>` for the latest learner take | optional `name` (must match control) | shadowing / speech |

Singleton constraints (enforced by the AST validator):

- Exactly **one** `<QuizSubmitButton>` per `react_layout`.
- At most **one** `<QuizTitle>`, **one** `<QuizContainer>`, **one** `<QuizFeedback>`, **one** `<QuizExplanation>`, **one** `<QuizScore>`.
- For `single_choice` / `multiple_choice`: `<QuizOption value="...">` MUST cover every `options[].option_id`.
- For `fill_blank`: `<QuizInput name="...">` MUST cover every `blanks[].blank_id`. **Only** inline `<QuizInput inline />` **inside** `<QuizTitle>` — no list-style `ol` + standalone inputs. Blank slots come from `question.title` runs of **2+ underscores** (`___`); CLI/editor sync title → `blanks[]` → AST.
- For `essay`: requires a `<QuizTextarea>`.
- For `shadowing`: requires `<QuizShadowingControl>`; pair with `<QuizRecordingPlayback>` for playback. Learner layout = stem (`{$title}`) + record + submit — **no** `{$reference_text}` block and **no** `<QuizReferenceAudio>` for learners. Optional scoring fields: `--set reference_text=…` (empty → use stem) and `--set reference_audio_url=…` (AI pronunciation compare only; hidden).
- For `speech`: requires `<QuizShadowingControl>` + `<QuizRecordingPlayback>`. `<QuizReferenceAudio>` optional when learners should hear reference audio (`reference_audio_url` + AST `src` stay in sync).

### Shadowing scoring fields (hidden from learners)

| Field | Purpose | How to set | Learner sees? |
|-------|---------|------------|---------------|
| `reference_text` | AI pronunciation compare text | `quiz update … --set reference_text=…` (optional; empty → `title`) | **No** — `{$reference_text}` renders empty on shadowing |
| `reference_audio_url` | AI pronunciation compare audio | `asset upload` → `--set reference_audio_url=…` | **No** — do not rely on `<QuizReferenceAudio>` in shadowing JSX |

Default starter + [quiz-shadowing-minimal.example.jsx](quiz-shadowing-minimal.example.jsx): stem + mic + submit + playback only.

---

## 3. HTML tag whitelist (presentation only)

`div span p h1 h2 h3 h4 ul ol li img figure figcaption strong em code pre hr br label section small blockquote`.

`<img>` requires an https:// or `data:image/...` `src`. Void tags (`img`, `hr`, `br`) must be self-closing.

Forbidden: `<a>`, `<iframe>`, `<script>`, `<style>`, `<form>`, `<button>` (use `QuizSubmitButton`), `<input>`/`<textarea>` (use `QuizInput`/`QuizTextarea`), custom web components.

---

## 4. Prop whitelist

| Class | Keys |
|-------|------|
| Common HTML | `className`, `style`, `id`, `role`, `tabIndex`, `title`, `lang`, `dir` |

`style` allows common presentation keys including `transition`, `textShadow`, `backdropFilter`, `filter` (e.g. `blur(8px)`), `boxShadow`, `outline*`, `overflow*`, `backgroundImage` / `backgroundSize` / `backgroundPosition`, `objectFit`, `aspectRatio`, `boxSizing`, and flex/grid placement (`placeItems`, `order`, `gridColumn`, …). Values containing `url(...)`, `expression(...)`, `!important`, or `position:fixed|absolute|sticky` are still rejected. **`transform`**, **`position`**, **`top`/`left`/`zIndex`** remain disallowed so layouts stay inside the quiz box.
| Data / ARIA | `data-*`, `aria-*` |
| `<img>` only | `src`, `alt`, `width`, `height`, `loading` |
| Per functional component | See §2 |

Rejected unconditionally: every `on*` event handler, `dangerouslySetInnerHTML`, `ref`, `key` as a JSX attribute, `srcDoc`, `href="javascript:…"`.

---

## 5. Style (`style={{ … }}`)

`style` must be an inline object literal whose values are plain strings or numbers. **Keys are permissive** (any camelCase / kebab-case CSS property name). The CLI **silently drops** unsafe entries at parse time; render time re-sanitizes.

**Still blocked (security / layout escape):**

- Values containing `url(`, `expression(`, `javascript:`, `@import`, `!important`, HTML `</`, inline `/*` / `*/`
- `position: fixed | absolute | sticky` (relative/static OK)
- `on*` handlers, `dangerouslySetInnerHTML`, spread props, runtime JS expressions

Use `<QuizMedia type="image">` instead of `background: url(...)`.

---

## 6. Interpolations (`{$key}`)

In **JSX** (`--jsx` / `--jsx-file`), use text placeholders or the self-closing sugar tag:

```jsx
<QuizTitle>{$title}</QuizTitle>
<QuizTitle><interp key="title" /></QuizTitle>
<QuizExplanation><p>{$explanation}</p></QuizExplanation>
```

In **JSON AST** (`--react-layout-file` / `--json '{"react_layout":…}'`), use nodes `{ "kind": "interp", "key": "title" }`. Do not write `<interp>` in JSON files.

Empty `<QuizTitle />` / empty `<QuizExplanation><p /></QuizExplanation>` are **auto-repaired** on `quiz insert|update` (see `layout_interp_fixes` in the command response). Unlabeled action buttons (`<QuizSubmitButton />` …) get the default label in the scene content language (`metadata.language`), so `quiz update` with `--jsx` / `--jsx-file` / `--react-layout-file` requires it just like `quiz insert`. Run `ainobi quiz get` to inspect `missing_dynamic_slots` before save.

| Token | Substituted with |
|-------|------------------|
| `{$title}` | `question.title` |
| `{$explanation}` | `question.explanation` |
| `{$reference_text}` | `question.reference_text` (**speech** learner UI). On **shadowing**, field is scoring-only — interpolation renders **empty** for learners |
| `{$score}` | `<earnedScore> / <totalScore>` after submit, otherwise `<totalScore>` |
| `{$earned_score}` | `earnedScore` (0 before submit) |
| `{$total_score}` | `question.score` |
| `{$question_number}` | `question.question_id` |
| `{$question_count}` | option count / blank count / 1 |
| `{$type}` | `question.type` |
| `{$recording_elapsed}` | `m:ss` while the paired recorder is active (use inside `<QuizRecordingTimer>` or nearby) |
| `{$recording_elapsed_sec}` | integer seconds while recording |
| `{$recorded_duration}` | `m:ss` of the latest completed take |
| `{$recorded_duration_sec}` | integer seconds of the latest completed take |

Interpolations live in **text positions**. They cannot appear inside JSX attribute values.

---

## 7. Styling via `data-*` attributes

Every functional component sets contextual `data-*` attributes so authors can target state via CSS without writing JavaScript:

| Component | Attributes |
|-----------|------------|
| `QuizContainer` | `data-quiz-container="<question_id>"`, `data-quiz-type="<kind>"`, `data-quiz-submitted="true|false"` |
| `QuizOption` | `data-quiz-option="<option_id>"`, `data-quiz-state="idle|selected|submitted-correct|submitted-incorrect|submitted-other"`, `data-quiz-correct="true|false"`, `data-quiz-submitted="true|false"` |
| `QuizInput` / `QuizTextarea` | `data-quiz-input="<name>"`, `data-quiz-submitted="true|false"` |
| `QuizSubmitButton` | `data-quiz-action="submit"`, `data-quiz-submitting="true|false"`, `data-quiz-state="idle|hover|active|disabled|submitting"` |
| `QuizSkipButton` / `QuizResubmitButton` / `QuizContinueButton` | `data-quiz-state="idle|hover|active"` |
| `QuizSkipButton` | `data-quiz-action="skip"` |
| `QuizResubmitButton` | `data-quiz-action="resubmit"` |
| `QuizContinueButton` | `data-quiz-action="continue"` |
| `QuizFeedback` | `data-variant="pass|partial|fail|neutral|<custom>"` |
| `QuizShadowingControl` | `data-quiz-action="start-recording|stop-recording"`, `data-quiz-recording="true|false"`, `data-quiz-submitted="true|false"` |
| `QuizRecordingTimer` | `data-quiz-slot="recording-timer"`, `data-quiz-recording-field`, `data-quiz-recording="true|false"` |
| `QuizRecordingPlayback` | `data-quiz-slot="recording-playback"`, `data-quiz-action="play-recording"` |

`QuizShadowingControl` renders **only** the active branch's children inside the button (or all unbranched children when no `<QuizStateView>` is used).

**Per-state UI (recommended):** wrap alternate markup in `<QuizStateView when="…">` inside the host. The player picks the branch matching runtime state (`idle`, `recording`, `disabled`, `submitted` on `QuizShadowingControl`). Each branch may set its own `style` (merged onto the button for that state) and any whitelisted children (e.g. a white mic `<img>` in `when="recording"` and a gold mic in `when="idle"`). Stored in AST as `kind: "stateBranch"` — not a separate React component tag at runtime.

**Optional color shortcut:** `recordingStyle={{…}}` merges on top of `style` while `data-quiz-recording="true"` when one shared icon is enough and only the button chrome changes.

**Recording duration:** place `<QuizRecordingTimer>` in the layout (often inside `<QuizStateView when="recording">` next to the mic). With no children it shows `m:ss`; custom markup → `<QuizRecordingTimer>{$recording_elapsed}</QuizRecordingTimer>`. Icons, labels, and timer styling all belong in AST children / `<QuizStateView>` branches.

Recommended pattern: write semantic class names in JSX and use Tailwind/utility CSS off the surrounding HTML elements; reserve `data-*` selectors for state-driven hover / focus / submitted styling.

**Built-in interaction chrome (all questions):** `QuizOption`, `QuizSubmitButton`, and secondary action buttons merge runtime styles for hover / active / disabled / submitting. **When AST `style` sets colors/background/border, those author values win** — built-in blue/gold defaults only apply when the author omits appearance keys. Hover/active on customized buttons use subtle `filter`/`opacity` feedback instead of replacing brand colors. Post-submit option feedback (green/red) still overrides for correctness cues. Default chrome uses blue primary submit (`#2563eb`) when unstylized.

---

## 8. Fill-blank stems (`fill_blank`)

Authoring model (May 2026):

1. Put blank markers in **`question.title`** as runs of underscores (`__` minimum, conventionally `___` per blank). Example: `太阳系最大的行星是___，它有___颗卫星。`
2. `blanks[]` length MUST match underscore slot count; CLI `applyFillBlankTitleToQuestion` resizes `blanks[]` and rewrites `react_layout` `<QuizTitle>` children to literal text + `<QuizInput name="{blank_id}" inline />`.
3. Do **not** use legacy list layouts (`<ol><li>…<QuizInput>` outside title) or top-level `<QuizInput>` — validator rejects them.
4. Reference answers live in `blanks[].answer` / `aliases[]` (quiz settings), not inside the stem.
5. Custom JSX: **one** `<QuizTitle />` (empty children); CLI injects stem from `title` with `___`. Do not hand-write `<QuizInput name="…">` — ids change. Removing `___` from `title` without keeping `blanks[]` clears all blanks. `quiz list` shows `blank_ids`. Use `blanks[i].aliases[]` — **`acceptable_answers` is legacy** (mapped to `aliases`). Rich JP example: [quiz-fill-blank-jp-rich.example.jsx](quiz-fill-blank-jp-rich.example.jsx).

Default starter (no `--jsx`): one blank in title `请在此输入题干：___` with a single inline input in `<QuizTitle>`.

---

## 9. Score summary panel (`quiz_score_summary`)

After all questions, add a **results slide** with the aggregate score card. Layout is stored once on **`scene.quiz.score_summary.react_layout`** (global singleton). Each `element_type: "quiz_score_summary"` on a slide is only a **viewport** into that tree.

**Agent commands (do not use `scene update` with a quiz blob or hand-edit scene JSON):**

```bash
ainobi quiz score-summary insert 2                    # default card (copy in metadata.language) + canvas element
ainobi quiz score-summary update --jsx-file work/score-summary.jsx
ainobi quiz score-summary get --verbose
```

Root must be `<QuizScoreSummaryContainer style={{ width: "100%", height: "100%", … }}>`. Functional tags:

| Tag | Renders |
|-----|---------|
| `QuizScoreSummaryContainer` | Root shell (`padding`, `gap`) |
| `QuizTotalScore` | Earned score (or use `{$earned_score}` / `{$score}` in text) |
| `QuizGradeLabel` | Matched `grade_levels[].label` |
| `QuizGradeDescription` | Matched `grade_levels[].description` |

| Token | Substituted with |
|-------|------------------|
| `{$earned_score}` | Sum of submitted question scores |
| `{$total_score}` | `scene.quiz.total_score` |
| `{$score}` | `earned / total` display string |
| `{$grade_label}` | Matched grade label |
| `{$grade_description}` | Matched grade description |
| `{$question_count}` | `questions.length` |
| `{$answered_count}` | Submitted or skipped attempts |

**Grade components:** `<QuizGradeLabel>` / `<QuizGradeDescription>` read from `scene.quiz.grade_levels` via the live score snapshot. Prefer explicit children `{$grade_label}` / `{$grade_description}` in custom JSX. Self-closing tags are **auto-repaired on write** (`layout_interp_fixes`) and **fall back at runtime** if children are empty — you do not need to hand-wire interp for the default case.

**Pitfalls:** Do not hard-code `100` for the total score — use `{$total_score}`. No `position: absolute|fixed`. Nested circles for score display must use flex layout (no overlapping absolute layers). Grade thresholds come from `scene.quiz.grade_levels` (same as per-question feedback). If grade text is blank, check `grade_levels` has a `min_score: 0` band and that learners have submitted at least one question (a score of 0 still maps to the zero band).

---

## 10. Common pitfalls

0. **Quiz media via `element insert` (most common agent mistake).** When the user wants an image, listen clip, or **speech** reference audio **inside the question** (题干配图、听题音频、题目内教师形象、口语题学员可听的参考音), do **not** run `ainobi element insert <slide> --type image|audio` — even if you plan to overlap the blue box or raise `z_index`. That adds a **sibling** slide layer beside `el_quiz_*` (shows in `inspect overlaps`, not in the student question UI). Use `ainobi asset upload` + `<QuizMedia type="image|audio" src="…">` or (speech only) `<QuizReferenceAudio src="…">` + `ainobi quiz update <slide> <quiz_element_id> --jsx-file`. **Shadowing** scoring audio: `--set reference_audio_url=…` only — not learner JSX. If insert warns about quiz overlap, **delete the slide image/audio and switch to quiz JSX** — do not “fix” with `--allow-slide-media`. Use `element insert` only for slide-level decor and narrated-slide beats unrelated to the question.
1. **Mismatched option/blank ids.** `QuizOption value="…"` and `QuizInput name="…"` must match `options[].option_id` / `blanks[].blank_id`. Read IDs from `quiz list` or `scene info --verbose` before custom JSX.
2. **`options[].value` is not option label text.** It is the answer payload id and must equal `option_id` after save. Option labels live only in `react_layout` (`<QuizOption value="qz_op_1">月球</QuizOption>`). If you `--set options[i].value=月球` before insert, the CLI copies that string into the default AST label once, then normalizes `value` back to `option_id`. Prefer `--jsx` for styled layouts.
3. **`option_text` was removed.** Do not use `--set options[i].option_text=…` (old HTML-form API). The CLI maps it to labels for backward compatibility, but agents should use `value=<label>` or custom `--jsx`.
4. **`--set options[i].…` replaces the entire `options[]` array.** You must set every option index you need (typically 2–4 for choice questions); partial patches drop default `option_id`s.
5. **Multiple submit buttons.** Validator rejects more than one `<QuizSubmitButton>`. Use `<QuizResubmitButton>` / `<QuizContinueButton>` after submit instead.
6. **Forbidden style values.** Backgrounds with `url(...)` (image refs) are rejected — use `<QuizMedia type="image" src="https://courseware.example.com/...">` instead.
7. **Nested `<QuizContainer>`.** Only allowed at the root. Nested containers will error.
8. **Event handlers.** `onClick`, `onChange`, … are rejected. Submission / selection is wired through `QuizFormContext`; you cannot inject custom JS via JSX.
9. **HTML in interpolations.** `{$title}` is rendered as plain text; HTML inside `question.title` will not be parsed.
10. **Default starter layout.** When `--jsx` is omitted, the CLI writes a functional starter AST with no `className` so the layout renders unstyled. Replace it via `quiz update --jsx`/`--jsx-file` whenever you want a custom design.
11. **`QuizShadowingControl` has no built-in UI.** Unlike `QuizSubmitButton` (which falls back to 「提交」 when children are omitted in some hosts), the recorder button renders **exactly** what is in `react_layout` children. Empty `<QuizShadowingControl />` → empty circle. To show a mic icon, put `<img src="https://…" />` or `data:image/svg+xml,…` **inside** the tag, or literal text. Do **not** tune `overflow`/`background` expecting hidden content to appear — there is none in scene JSON.
12. **Shadowing reference text/audio in JSX (common mistake).** Do **not** add a “参考文本” section with `{$reference_text}` or `<QuizReferenceAudio>` on shadowing questions — learners will not see/hear them. Set scoring compare text/audio via `--set reference_text` / `--set reference_audio_url` instead (both optional).
13. **Letterboxed quiz card.** `<QuizContainer>` fills the slide quiz element (blue frame), not the whole slide. Do not put `width: 680` (or similar) inner cards inside a large box — use `width/height: "100%"` on the root. **If the question looks small, run `quiz update --jsx` first — do not `element update --set size` first** (that only enlarges the outer frame while JSX stays letterboxed). Shrink the whole question on slide via `--size-w/--size-h` on `quiz insert/update` only when intentional.

### Icons & decoration (agent)

Functional tags do not ship artwork. Add icons explicitly in JSX:

| Approach | Example |
|----------|---------|
| `<img>` inside a button | `<QuizShadowingControl style={{…}}><img src="https://…/mic.svg" alt="" style={{ width: 36, height: 36 }} /></QuizShadowingControl>` |
| `data:image/svg+xml,…` | Small inline SVG encoded as img `src` (no `<svg>` tag — not whitelisted) |
| `ainobi asset upload` / `ainobi asset get <file_id>` | Upload new files or resolve @-mentioned library assets; use returned `url` in `img`/`QuizMedia` — do not hand-write OSS URLs |
| Sibling caption | Label under the button: `<span>点击录音</span>` next to the control in a flex column |

Verify with `ainobi quiz list --pretty` or read saved JSON: `"children": []` under `QuizShadowingControl` confirms nothing will render inside the button.

### JSX parser (write-time; CLI auto-normalizes)

The parser is **not** full React/JSX, but the CLI **strips comments for you** and **sanitizes styles** so agents do not need perfect syntax.

| Auto-handled | Still rejected |
|--------------|----------------|
| `{/* JSX comment */}` and `{// line comment}` in children (removed) | `{title}` without `$`, `{expr && …}`, spread `{...x}`, fragments `<>` |
| `//` and `/* */` between sibling tags | `prop={variable}` — attributes must be literals or `style={{…}}` |
| `<QuizReferenceAudio />` → `src=""` | Unknown tags, `onClick`, `javascript:` URLs |
| Unknown `style` keys kept if value is safe; unsafe values dropped | `position: fixed/absolute/sticky`, `url(...)` in values |

Dynamic copy: **`{$title}`**, **`{$explanation}`**, … in text nodes only (not in attributes). Use **`{$reference_text}`** on **speech** when learners should read compare text; skip it on **shadowing** (scoring field only).

**Shadowing quick path:** `--title "…"` + optional `--set reference_text=…` / `--set reference_audio_url=…` (scoring only) + `--jsx-file references/quiz-shadowing-minimal.example.jsx` + `ainobi quiz validate`.
