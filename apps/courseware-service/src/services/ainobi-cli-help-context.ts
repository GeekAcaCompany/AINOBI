// SPDX-License-Identifier: AGPL-3.0-only
import { spawnSync } from 'node:child_process';

import { ainobiCliEntry } from '../runtime-paths.ts';

type CliHelpEnvelope = { ok: boolean; data?: unknown; error?: unknown };

export type AinobiCliHelpContextParams = {
  cwd: string;
  path: string;
};

/** Full help topics (CHAT_AINOBI_HELP_CONTEXT=full). */
const HELP_TOPICS_FULL: ReadonlyArray<{ label: string; args: string[] }> = [
  { label: 'overview', args: ['help'] },
  { label: 'commands', args: ['help', 'commands'] },
  { label: 'element', args: ['help', 'element'] },
  { label: 'narration', args: ['help', 'narration'] },
  { label: 'quiz', args: ['help', 'quiz'] },
];

/** Slim default: overview + commands index only (no long narration/quiz dumps). */
const HELP_TOPICS_SLIM: ReadonlyArray<{ label: string; args: string[] }> = [
  { label: 'overview', args: ['help'] },
  { label: 'commands', args: ['help', 'commands'] },
];

/** High-frequency commands kept in the slim commands index (must match COMMAND_DOCS.path). */
const SLIM_COMMAND_PATHS = new Set([
  'init',
  'load <path|->',
  'save',
  'status',
  'scene info',
  'slide list',
  'slide get <ref>',
  'slide insert',
  'slide update <ref>',
  'slide delete <ref>',
  'element list <slide>',
  'element get <slide> <ref>',
  'element insert <slide> --type <type>',
  'element update <slide> <ref>',
  'element delete <slide> <ref>',
  'narration insert <slide>',
  'quiz init',
  'quiz insert <slide> --type <kind>',
  'quiz update <slide> <quiz_element_ref>',
  'quiz list',
  'quiz validate',
  'validate',
  'search <query>',
  'asset get <file_id>',
  'asset upload <path>',
  'recall <id>',
  'ai-teachers list',
  'tts list',
]);

const PITFALLS = [
  'INVALID: `ainobi element text update <id> …` — `text` is an element *type* (schema / `--type text`), not an `element` subcommand.',
  'VALID: `ainobi element update <slide> <ref> --set text="…"` (slide is index or `el_slide_…`; ref is index or `el_text_…`).',
  'INVALID: `--text` on element commands — use repeatable `--set path=value` (e.g. `--set text=Hello`).',
  'INVALID: `ainobi element get <element_id>` without slide — first arg is always the slide.',
  'Schema for a type: `ainobi help element text`. Verbs: `ainobi help element update`. Quiz: run `quiz init` once, then `ainobi quiz insert <slide> --type <kind> [--jsx \'<QuizContainer>…</QuizContainer>\']` per question to create the slide element + scene.quiz entry together. Use `quiz update <slide> <ref> --jsx …` to rewrite a question\'s React layout; do NOT author quiz markup with `element insert/update` (the JSX AST lives on scene.quiz.questions[].react_layout and must be parsed+validated by the CLI). Quiz sizing: `<QuizContainer style={{ width:"100%", height:"100%" }}>` fills the slide quiz element (blue frame); if the question looks too small, fix inner JSX — do NOT `element update --set size` first. `quiz validate` returns layout_sizing_warnings for fixed-width inner cards (e.g. width:680). `ainobi validate` errors if any quiz.questions[] entry is missing its slide quiz element or if any react_layout fails the whitelist.',
  'Quiz looks small on slide: INVALID first step `element update … --set size.width=…` — VALID `quiz update … --jsx-file` with QuizContainer width/height 100% and no inner fixed-width card; read target box from `quiz list` size field.',
  'Quiz slide image/audio: INVALID `element insert --type image|audio` when the asset belongs inside the question (question-stem images, listening audio, in-question teacher figures, learner-audible reference audio for speech) — VALID `asset upload` then `<QuizMedia>` or (speech only) `<QuizReferenceAudio>` in react_layout via `quiz update --jsx-file`. Shadowing scoring audio/text: `--set reference_audio_url` / `--set reference_text` only (hidden from learners; do not use shadowing JSX for reference blocks). Slide `element insert` is only for decor beside/unrelated to the blue quiz frame. On quiz slides, read `warnings[]` on insert—do not answer overlap hints with `--allow-slide-media` unless the user explicitly wants slide-layer decor.',
  'Decorative geometry: default to `--type rectangle|ellipse|line` (`color`, optional `stroke_color` / `stroke_width`, `border_radius_px` on rectangles). Use `--type svg` only when paths/gradients/icons/diagrams exceed those primitives—not for plain bars or color blocks. Do not use empty `text` + `metadata.background_color` as shapes.',
  'Element names: if `name` is omitted or blank on `element insert`, the CLI assigns per-slide defaults (图片1, 文本2, 矩形3, …). Use `--name` when a specific label is needed.',
  'Effects: use snake_case (`fade_in`, `scale_in`); camelCase (`fadeIn`) is normalized on write.',
  'Narration: `narration insert` always runs TTS synthesis (no opt-out). Optional `--tts-id` from `ainobi tts list --save` overrides the teacher voice. Uses `--fit-slide` by default; pass `--no-fit-slide` only when you must keep a fixed slide duration. Subtitles show on canvas by default; pass `--no-subtitle-visible` to hide, or `element update … --set subtitle_visible=false|true` after insert.',
  'Layering: use `--set style.z_index=<n>` — root-level `z_index` is rejected.',
  'Text styling: canonical root `color`, `font_size`, `line_height`, `bold`, `align`. `line_height` is unitless (1.2 default, 0.5–5). `--set style.color` / `style.font_size` / `style.line_height` are accepted aliases (CLI copies to root on insert/update).',
  'Layering only: `style` holds `opacity`, `rotation_deg`, `z_index` — not typography.',
  'Numeric-looking copy: `--set text:str=01` or `--set text=\'"01"\'` (bare `text=01` coerces to number).',
  '`ainobi validate` warns when every child on a slide has no enter/exit effects, `animations[]`, or `keyframes[]`.',
  '`ainobi validate` warns when `html` or `quiz` slide elements do not span the full slide timeline (prefer start_at/end_at matching the slide duration).',
  '`ainobi validate` warns when text `color` is too close to slide `background_color` (contrast below 3:1).',
  '`ainobi validate` warns on `color` vs `style.color` mismatch until the next save normalizes editor JSON.',
  'Flow pause: do NOT add by default on text/rich-only slides. Proactively add only after inserting html (`ainobi flow-pause add <slide> --element <html_ref>` — default `--when end` at element.timeline.end_at), or when the user explicitly requests a pause. NOT at 0ms/slide start. `--when start` only when you must stop right after fade-in (rare). INVALID on quiz/quiz_score_summary or overlapping quiz timelines.',
  'Details: run `ainobi help <topic>` (element, narration, quiz, …) or Read skill topic files under `.claude/skills/ainobi-courseware-cli/references/topics/`.',
];

let cached: string | null = null;

function helpContextMode(): 'off' | 'slim' | 'full' {
  const raw = process.env.CHAT_AINOBI_HELP_CONTEXT?.trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'off') {
    return 'off';
  }
  if (raw === 'full' || raw === 'true' || raw === '1') {
    return 'full';
  }
  return 'slim';
}

function runAinobiHelp(params: AinobiCliHelpContextParams, args: string[]): CliHelpEnvelope | null {
  const proc = spawnSync(process.execPath, [ainobiCliEntry, ...args], {
    cwd: params.cwd,
    env: { ...process.env, PATH: params.path, AINOBI_CLI_RUNTIME: 'agent' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (proc.error || proc.status !== 0) {
    return null;
  }

  try {
    return JSON.parse(proc.stdout ?? '') as CliHelpEnvelope;
  } catch {
    return null;
  }
}

function formatOverview(data: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (typeof data.description === 'string') {
    lines.push(data.description);
  }
  if (Array.isArray(data.global_flags)) {
    lines.push('', 'Global flags:');
    for (const flag of data.global_flags) {
      lines.push(`- ${String(flag)}`);
    }
  }
  if (Array.isArray(data.rules)) {
    lines.push('', 'Rules:');
    for (const rule of data.rules) {
      lines.push(`- ${String(rule)}`);
    }
  }
  return lines;
}

function formatCommands(data: Record<string, unknown>, slim: boolean): string[] {
  const commands = data.commands;
  if (!Array.isArray(commands)) {
    return [];
  }
  const lines = slim
    ? [
        'High-frequency commands (slim index):',
        'For full flags run `ainobi help <path>` (e.g. `ainobi help quiz`, `ainobi help narration`).',
      ]
    : ['Registered commands:'];
  for (const doc of commands) {
    if (!doc || typeof doc !== 'object') continue;
    const row = doc as { path?: string; summary?: string; aliases?: string[] };
    const path = row.path ?? '?';
    if (slim && !SLIM_COMMAND_PATHS.has(path)) {
      continue;
    }
    const alias =
      Array.isArray(row.aliases) && row.aliases.length > 0 ? ` (aliases: ${row.aliases.join(', ')})` : '';
    const summary =
      slim && row.summary && row.summary.length > 120 ? `${row.summary.slice(0, 120)}…` : (row.summary ?? '');
    lines.push(`- \`ainobi ${path}\`${alias}: ${summary}`);
  }
  return lines;
}

function formatElement(data: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (typeof data.description === 'string') {
    lines.push(data.description);
  }
  const verbs = data.element_verbs;
  if (Array.isArray(verbs)) {
    lines.push('', 'Element verbs (executable subcommands):');
    for (const item of verbs) {
      if (!item || typeof item !== 'object') continue;
      const v = item as { verb?: string; usage?: string; note?: string; modes?: string[] };
      lines.push(`- **${v.verb ?? '?'}**: ${v.usage ?? ''}`);
      if (v.note) lines.push(`  ${v.note}`);
      if (Array.isArray(v.modes) && v.modes.length > 0) {
        lines.push(`  modes: ${v.modes.join(', ')}`);
      }
    }
  }
  if (typeof data.tip === 'string') {
    lines.push('', data.tip);
  }
  return lines;
}

function formatQuiz(data: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (typeof data.description === 'string') {
    lines.push(data.description);
  }
  const subcommands = data.subcommands;
  if (Array.isArray(subcommands)) {
    lines.push('', 'Subcommands:');
    for (const item of subcommands) {
      if (!item || typeof item !== 'object') continue;
      const row = item as { name?: string; usage?: string; note?: string };
      lines.push(`- **${row.name ?? '?'}**: ${row.usage ?? ''}`);
      if (row.note) lines.push(`  ${row.note}`);
    }
  }
  if (Array.isArray(data.notes)) {
    lines.push('', 'Notes:');
    for (const note of data.notes) {
      lines.push(`- ${String(note)}`);
    }
  }
  return lines;
}

function formatNarration(data: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (typeof data.usage === 'string') {
    lines.push(`Usage: ${data.usage}`);
  }
  if (data.flags && typeof data.flags === 'object') {
    lines.push('', 'Flags:');
    for (const [name, desc] of Object.entries(data.flags as Record<string, string>)) {
      lines.push(`- --${name}: ${desc}`);
    }
  }
  if (Array.isArray(data.notes)) {
    lines.push('', 'Notes:');
    for (const note of data.notes) {
      lines.push(`- ${String(note)}`);
    }
  }
  return lines;
}

function formatTopic(label: string, data: unknown, slim: boolean): string {
  if (!data || typeof data !== 'object') {
    return `### ainobi help ${label}\n(unavailable)\n`;
  }
  const record = data as Record<string, unknown>;
  let body: string[];
  switch (label) {
    case 'overview':
      body = formatOverview(record);
      break;
    case 'commands':
      body = formatCommands(record, slim);
      break;
    case 'element':
      body = formatElement(record);
      break;
    case 'narration':
      body = formatNarration(record);
      break;
    case 'quiz':
      body = formatQuiz(record);
      break;
    default:
      body = [JSON.stringify(record, null, 2)];
  }
  return `### ainobi help ${label}\n${body.join('\n')}\n`;
}

function buildHelpContext(params: AinobiCliHelpContextParams, mode: 'slim' | 'full'): string {
  const sections: string[] = [
    '## AINOBI CLI reference (live `ainobi help` output)',
    '',
    mode === 'slim'
      ? 'Slim CLI index for this turn. Treat pitfalls as authoritative. For full flags run `ainobi help <topic>`.'
      : 'Treat this block as authoritative CLI grammar. Do not invent subcommands or flags.',
    '',
    '### Common pitfalls',
    ...PITFALLS.map((line) => `- ${line}`),
    '',
  ];

  const topics = mode === 'full' ? HELP_TOPICS_FULL : HELP_TOPICS_SLIM;
  let anyOk = false;
  for (const topic of topics) {
    const envelope = runAinobiHelp(params, topic.args);
    if (envelope?.ok && envelope.data !== undefined) {
      anyOk = true;
      sections.push(formatTopic(topic.label, envelope.data, mode === 'slim'));
    }
  }

  if (!anyOk) {
    sections.push(
      '_(Help preload failed; run `ainobi help`, `ainobi help commands`, and `ainobi help element` before editing.)_',
    );
  }

  return sections.join('\n').trim();
}

/** Cached CLI help text for Claude Agent SDK system prompt append. */
export function getAinobiCliHelpContext(params: AinobiCliHelpContextParams): string {
  const mode = helpContextMode();
  if (mode === 'off') {
    return '';
  }
  if (!cached) {
    cached = buildHelpContext(params, mode);
  }
  return cached;
}

/** @internal test-only */
export function clearAinobiCliHelpContextCache(): void {
  cached = null;
}
