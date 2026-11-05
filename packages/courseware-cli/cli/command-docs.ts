// SPDX-License-Identifier: AGPL-3.0-only
export interface CommandDoc {
  path: string;
  summary: string;
  aliases?: string[];
  requires_scene?: boolean;
}

export const COMMAND_DOCS: CommandDoc[] = [
  { path: "init", summary: "Create and load a new empty scene, including a managed temporary work_dir." },
  { path: "load <path|->", summary: "Load JSON courseware from path or stdin (`-`) and return a managed temporary work_dir." },
  { path: "save", summary: "Save scene and clean the managed work_dir. Standalone shell: write JSON to path or AINOBI_OUTPUT_DIR. Agent runtime (`AINOBI_CLI_RUNTIME=agent`): PUT to host persistence (`ainobi save`, no path). `--stdout` dumps JSON only.", requires_scene: true },
  { path: "status", summary: "Show whether a scene is loaded and a summary." },
  { path: "reset", summary: "Clear the current shell session's loaded scene." },
  {
    path: "recall <id>",
    summary:
      "Fetch an archived oversized tool result by blob id (agent runtime only). Use when a prior Bash/Read output was stubbed with `ainobi recall <id>`.",
  },
  { path: "scene info", summary: "Show current scene metadata.", requires_scene: true },
  { path: "scene update", summary: "Update top-level scene fields.", requires_scene: true },
  { path: "slide list", summary: "List slides with element_id, name, summary.", requires_scene: true },
  {
    path: "slide get <ref>",
    summary:
      "Fetch a single slide by index or element_id (alias: slide info). With --with-children, large inline strings are compacted; use --full-children for the previous full JSON.",
    aliases: ["slide info"],
    requires_scene: true,
  },
  { path: "slide insert", summary: "Insert a new empty slide.", aliases: ["slide add"], requires_scene: true },
  { path: "slide update <ref>", summary: "Update slide top-level fields.", requires_scene: true },
  {
    path: "slide delete <ref>",
    summary:
      "Delete a slide by index or element_id. Cascades: removes any quiz elements' bound scene.quiz.questions[] entries (same as quiz delete).",
    aliases: ["slide remove"],
    requires_scene: true,
  },
  { path: "slide template <kind>", summary: "Insert a high-level slide layout template.", requires_scene: true },
  { path: "slide duplicate <ref>", summary: "Duplicate a slide and regenerate element ids.", requires_scene: true },
  { path: "slide move <ref> --to <index>", summary: "Move a slide to a new index.", requires_scene: true },
  {
    path: "element list <slide>",
    summary: "List children of a slide. Verbose mode embeds elements with large-string compaction unless --full-elements.",
    requires_scene: true,
  },
  { path: "element get <slide> <ref>", summary: "Get a child element of a slide.", requires_scene: true },
  {
    path: "element insert <slide> --type <type>",
    summary:
      "Insert a new element into slide.children_elements. Use --start/--end/--duration for timeline placement and --asset <path> for supported media/document files. `html` defaults to the parent slide's full timeline when timing flags are omitted. SVG: --file payload.json (source field) or --file drawing.svg (raw markup); returns bounds warnings when inline SVG viewBox/size look wrong.",
    aliases: ["element add"],
    requires_scene: true,
  },
  { path: "element update <slide> <ref>", summary: "Update a child element. element_type cannot change.", requires_scene: true },
  { path: "element delete <slide> <ref>", summary: "Delete a child element.", aliases: ["element remove"], requires_scene: true },
  { path: "element align <slide>", summary: "Align multiple slide children by bounds.", requires_scene: true },
  { path: "element distribute <slide>", summary: "Distribute multiple slide children across an axis.", requires_scene: true },
  { path: "element layer <slide> <ref>", summary: "Move an element layer forward/backward/top/bottom.", requires_scene: true },
  { path: "animation preset <slide> <element>", summary: "Apply a canned keyframe/effect animation. Use --start as a timeline-first alias for --from.", requires_scene: true },
  { path: "animation stagger <slide>", summary: "Apply animation presets to multiple elements with offsets. Use --start to place the sequence on the slide timeline.", requires_scene: true },
  { path: "animation timeline <slide>", summary: "Resize a slide timeline and optionally fit children.", requires_scene: true },
  { path: "highlight add <slide> <element>", summary: "Add a spotlight/highlight segment.", requires_scene: true },
  {
    path: "flow-pause add <slide>",
    summary:
      "Add a slide-level flow pause (playback halts until Continue). Do not add by default on text/rich-only slides. Proactively add only after inserting html (`--element <html_ref>`, default `--when end`), or when the user explicitly requests a pause. Use `--at <ms>` only when not tied to an element. `--when start` = after fade-in (rare). Never on quiz elements.",
    requires_scene: true,
  },
  { path: "flow-pause remove <slide> <pause_id>", summary: "Remove a flow pause point from a slide.", requires_scene: true },
  { path: "flow-pause list <slide>", summary: "List normalized flow_pause_points on a slide.", requires_scene: true },
  { path: "narration insert <slide>", summary: "Insert vtuber + narration with required TTS synthesis. **Required:** --teacher-id <ai_teacher_id> from `ainobi ai-teachers list`. Optional: --tts-id from `ainobi tts list` to override voice; --tts-style to set the delivery style (Google voices): a recommended key (friendly_teacher/authoritative_professor/lively_narrator/calm_storyteller/professional_anchor/playful_host/serious_formal/soft_gentle) OR a concise custom English style description (<=200 chars); default = teacher style or friendly_teacher. Voice changes timbre, style changes tone/persona. Provide --transcript or --script (each \\n = one segment; >50 chars without \\n fails). Break at phrase/sentence boundaries only — avoid over-segmentation (design-excellence.md §6). --fit-slide is on by default. Subtitles show by default; --no-subtitle-visible hides the on-canvas subtitle band (toggle later via element update --set subtitle_visible=…). When the slide already has narration tracks, the new pair is auto-staggered after the latest narration.end_at so AI-teacher audio does not overlap. Transient TTS/upload errors retry automatically.", aliases: ["narration add"], requires_scene: true },
  {
    path: "search <query>",
    summary:
      "Web search via Tavily for fact-checking and courseware research. Prefer 2–3 iterative searches (landscape → depth → verify) for time-sensitive topics. Use --time-range / --topic for recency. Agent runtime POSTs to host `/courseware/search/run`. Returns query, optional LLM answer, and ranked results.",
  },
  {
    path: "image replicate-html <path>",
    summary:
      "Replicate a reference image as standalone HTML via host multimodal vision (`OPENAI_*`). Agent runtime POSTs to `/courseware/image/replicate-html`. Use before `element insert --type html` when matching layout/visuals; use `doc read` for text-only description.",
  },
  {
    path: 'image generate --prompt "<text>"',
    summary:
      'Generate an illustration from a text prompt (gpt-image-2) and save it to the courseware asset library (billed). Agent runtime POSTs to `/courseware/image/generate`; success returns `data.source` (asset URL) for `element insert --type image --set source="<url>"`. Agent quiet mode omits the fat `asset` object but keeps `source`/`file_id`/`file_name`. Run as foreground blocking Bash only — never background/Task. Flags: --size auto|1024x1024|1536x1024|1024x1536, --quality auto|low|medium|high, --name <file.png>.',
  },
  {
    path: "quiz init",
    summary:
      "Create or update scene.quiz (enabled / total_score / time_limit_minutes). Accepts minute/second CLI flags and stores fractional minutes (e.g. 30s → 0.5).",
    requires_scene: true,
  },
  {
    path: "quiz insert <slide> --type <kind>",
    summary:
      "Insert a quiz element on a slide AND create the matching scene.quiz.questions[] entry in one transaction. --type ∈ single_choice|multiple_choice|fill_blank|essay|shadowing|speech. Timeline defaults to the full slide (start_at = slide start, end_at = slide end) unless --start/--duration/--end are passed. Optionally pass --jsx '<QuizContainer>…</QuizContainer>' (or --jsx-file) to write a custom React layout; the CLI parses+validates against the whitelist before saving. Without --jsx the CLI uses the default starter layout for that type. Choice labels: --set options[i].value=<text> (not option_text; each --set options[i].… replaces the whole options[]). Use --set / --json / --title for other metadata, --position-x/y --size-w/h --start --duration --name for the slide element.",
    aliases: ["quiz add"],
    requires_scene: true,
  },
  {
    path: "quiz update <slide> <quiz_element_ref>",
    summary:
      "Update a quiz element + its bound scene.quiz.questions[] entry atomically. Pass --jsx to rewrite the React layout (or --json with a JSON AST), --set / --json / --title to patch question metadata, --position-x/y --size-w/h --start --duration --name for element layout. AST + question consistency are revalidated; failures roll back.",
    requires_scene: true,
  },
  {
    path: "quiz delete <slide> <quiz_element_ref>",
    summary: "Remove a quiz element AND its scene.quiz.questions[] entry.",
    aliases: ["quiz remove"],
    requires_scene: true,
  },
  {
    path: "quiz prune-orphans",
    summary:
      "Remove scene.quiz.questions[] entries that are not bound to any slide quiz element. Use when validate reports \"is not inserted on any slide\" after a legacy delete left orphans. Prefer quiz delete / slide delete (which now cascade) for new edits.",
    aliases: ["quiz prune", "quiz prune_orphans"],
    requires_scene: true,
  },
  {
    path: "quiz list",
    summary: "List every quiz element with its slide, bound question id, type, and AST node count.",
    requires_scene: true,
  },
  { path: "quiz validate", summary: "Validate quiz config + every question's react_layout AST + slide bindings.", requires_scene: true },
  {
    path: "quiz score-summary insert <slide>",
    summary:
      "Insert a quiz_score_summary viewport on a slide AND set scene.quiz.score_summary.react_layout (default card or --jsx / --jsx-file / --react-layout-file). Optional --position-x/y --size-w/h --start --duration for the element box.",
    aliases: ["quiz score-summary add"],
    requires_scene: true,
  },
  {
    path: "quiz score-summary update",
    summary:
      "Update the global score-summary react_layout AST and/or a specific quiz_score_summary element's position/size/timeline. Do not use scene update with a quiz blob.",
    requires_scene: true,
  },
  {
    path: "quiz score-summary get",
    summary:
      "Show score_summary AST diagnostics, recommended {$…} interpolation coverage, and all quiz_score_summary elements on slides.",
    requires_scene: true,
  },
  { path: "validate", summary: "Validate scene schema, scene-wide unique element_id values, optional --publish rules, SVG bounds warnings, slides with no motion, html/quiz partial-slide timeline warnings, overlapping narration timelines on the same slide, and text colors too close to slide background.", requires_scene: true },
  { path: "inspect timeline", summary: "Inspect slide and element timing. Add --coverage to report visual gaps, idle tails, and narration duration mismatches.", requires_scene: true },
  { path: "inspect overlaps <slide>", summary: "Detect rough visual overlaps on a slide.", requires_scene: true },
  {
    path: "inspect svg-bounds [slide]",
    summary:
      "Check inline SVG viewBox, geometry vs element size, slide overflow, and common agent mistakes. Omit slide to scan the whole scene.",
    requires_scene: true,
  },
  { path: "inspect assets", summary: "List referenced media/assets.", requires_scene: true },
  {
    path: "inspect scene-sync",
    summary:
      "Paginated diff after host reloads stale CLI session from DB (report in .ainobi-cli/scene-sync-diff-report.json). Flags: --page, --page-size.",
  },
  { path: "diff <before> <after>", summary: "Summarize two scene JSON files." },
  {
    path: "reference inspect <path>",
    summary:
      "Quick read-only overview from `./reference/*.brief.json` (or rebuild from `.scene.json`). Use finer `reference slide|element` commands for full payloads.",
  },
  {
    path: "reference scene info <scene.json>",
    summary: "Scene metadata from a staged reference file (does not load into the editing session).",
  },
  {
    path: "reference slide list <scene.json>",
    summary: "List slides in a staged reference scene. Flags: --verbose.",
  },
  {
    path: "reference slide get <scene.json> <slide>",
    summary:
      "Get one reference slide. Flags: --with-children, --full-children (same semantics as `slide get`).",
  },
  {
    path: "reference element list <scene.json> <slide>",
    summary: "List child elements on a reference slide. Flags: --verbose, --full-elements.",
  },
  {
    path: "reference element get <scene.json> <slide> <element>",
    summary: "Get one child element from a reference slide. Flag: --full.",
  },
  {
    path: "reference import <scene.json> [--slides all|0,2-4] [--at N]",
    summary:
      "Import selected slides from a staged reference `.scene.json` into the CURRENT editing session (regenerates element ids; clones bound quiz questions; keeps target quiz.total_score and reallocates all question scores by prior score weights). Default `--slides all` appends; use `--at` to insert. Do NOT `ainobi load` the reference file.",
    requires_scene: true,
  },
  {
    path: "asset get <file_id>",
    summary:
      "Fetch a courseware library asset by file_id (editor @-mentions; same as list API fileId). Returns metadata and a fresh signed URL via the AINOBI host in agent runtime.",
  },
  { path: "asset upload <path>", summary: "Upload a supported courseware asset to OSS. Use --convert for pdf/pptx html conversion." },
  {
    path: "ai-teachers list",
    summary:
      "REQUIRED step before any `narration insert`. Lists active AI teachers for the courseware organization via the AINOBI host; falls back to a built-in single teacher when no org is bound. Use --save (or `ai-teachers sync`) to persist into the session ai_teachers[]; subsequent narration inserts validate --teacher-id against this pool.",
  },
  {
    path: "ai-teachers sync",
    summary:
      "Refresh the loaded session's ai_teachers[] from the organization catalog. Equivalent to `ai-teachers list --save`; requires a loaded scene.",
    requires_scene: true,
  },
  {
    path: "tts list",
    summary:
      "List platform TTS voices (Google Gemini base voices; FishAudio / MiniMax are inactive). Use --provider / --language filters. Use --save (or `tts sync`) to persist into session tts_voices[] for `narration insert --tts-id`.",
  },
  {
    path: "tts sync",
    summary:
      "Refresh the loaded session's tts_voices[] from the platform catalog. Equivalent to `tts list --save`; requires a loaded scene.",
    requires_scene: true,
  },
  {
    path: "design-template list",
    summary:
      "List org-scoped design templates (Markdown style guides) via the AINOBI host. Use before save/extract to avoid duplicates.",
  },
  {
    path: "design-template get <id>",
    summary: "Fetch one org design template (full Markdown content) by id.",
  },
  {
    path: "design-template save",
    summary:
      "Create a design template in the org library (--name, --content or --content-file). Host-backed in agent runtime.",
  },
  {
    path: "design-template extract",
    summary:
      "Extract a design template from a courseware (--from courseware --courseware-id) or asset (--from asset --asset-id) via host LLM pipeline.",
  },
  {
    path: "design-template delete <id>",
    summary: "Delete an org design template by id.",
  },
  {
    path: "content-template list",
    summary:
      "List org-scoped content templates (Markdown outline guides) via the AINOBI host. Use before save/extract to avoid duplicates.",
  },
  {
    path: "content-template get <id>",
    summary: "Fetch one org content template (full Markdown content) by id.",
  },
  {
    path: "content-template save",
    summary:
      "Create a content template in the org library (--name, --content or --content-file). Host-backed in agent runtime.",
  },
  {
    path: "content-template extract",
    summary:
      "Extract a content template from a courseware (--from courseware --courseware-id) or asset (--from asset --asset-id) via host LLM pipeline.",
  },
  {
    path: "content-template delete <id>",
    summary: "Delete an org content template by id.",
  },
  { path: "batch apply", summary: "Apply structured operations from --file (preferred for multi-slide structure in agent sessions).", requires_scene: true },
  { path: "batch dry-run", summary: "Validate structured operations without saving.", requires_scene: true },
  { path: "help", summary: "Show help. Topics: types | commands | enums | session | scene | slide | narration | search | doc | image | ai-teachers | quiz | element (verbs+types) | element <verb|type>." },
];
