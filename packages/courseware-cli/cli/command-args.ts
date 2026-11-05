// SPDX-License-Identifier: AGPL-3.0-only
import { flagString, type ParsedArgs } from "./args.ts";
import { AinobiCliError } from "./errors.ts";

/** Flags accepted on any command (output / shared input helpers). */
export const GLOBAL_FLAGS = new Set([
  "pretty",
  "json",
  "file",
  "stdin",
  "set",
  "unset",
  "verbose",
  "quiet",
  "select",
]);

export interface RequireOneOfRule {
  flags: string[];
  message: string;
}

export interface CommandArgSpec {
  /** Full usage line shown in USAGE errors. */
  usage: string;
  positional?: {
    min: number;
    max?: number;
    /** Label for error messages, e.g. "slide". */
    name?: string;
  };
  /** Flags that take a value. */
  flags?: string[];
  /** Boolean switches; `--no-<name>` is also accepted. */
  booleanFlags?: string[];
  /** At least one listed flag must be present with non-empty text. */
  requireOneOf?: RequireOneOfRule[];
  /** Friendly hints when a known-but-unsupported alias flag is used. */
  deprecatedFlagHints?: Record<string, string>;
}

const collectFlagKeys = (args: ParsedArgs): string[] => {
  const keys = new Set<string>(Object.keys(args.flags));
  for (const key of Object.keys(args.multi)) keys.add(key);
  return [...keys];
};

const isAllowedFlag = (key: string, allowed: Set<string>): boolean => {
  if (allowed.has(key)) return true;
  if (key.startsWith("no-")) {
    const positive = key.slice(3);
    return allowed.has(positive);
  }
  return false;
};

const formatUnknownFlagMessage = (
  unknownFlags: string[],
  spec: CommandArgSpec,
  commandLabel: string,
): { message: string; hint: string } => {
  const deprecated = unknownFlags
    .map((flag) => {
      const hint = spec.deprecatedFlagHints?.[flag];
      return hint ? `--${flag}: ${hint}` : null;
    })
    .filter((item): item is string => item !== null);

  const unknownList = unknownFlags.map((flag) => `--${flag}`).join(", ");
  const message =
    deprecated.length > 0
      ? `Unsupported flag(s): ${unknownList}.`
      : `Unknown flag(s): ${unknownList}.`;

  const hintParts = [
    ...deprecated,
    `Usage: ${spec.usage}`,
    `Run \`ainobi help ${commandLabel.split(" ")[0]}\` for details.`,
  ];
  return { message, hint: hintParts.join(" ") };
};

export const validateCommandArgs = (
  args: ParsedArgs,
  spec: CommandArgSpec,
  commandLabel: string,
): void => {
  const allowed = new Set<string>([
    ...GLOBAL_FLAGS,
    ...(spec.flags ?? []),
    ...(spec.booleanFlags ?? []),
  ]);

  const unknownFlags = collectFlagKeys(args).filter((key) => !isAllowedFlag(key, allowed));
  if (unknownFlags.length > 0) {
    const { message, hint } = formatUnknownFlagMessage(unknownFlags, spec, commandLabel);
    throw new AinobiCliError("USAGE", message, { hint });
  }

  const positionalRule = spec.positional;
  if (positionalRule) {
    const max = positionalRule.max ?? positionalRule.min;
    const label = positionalRule.name ?? "argument";
    if (args.positionals.length < positionalRule.min) {
      throw new AinobiCliError(
        "USAGE",
        `Missing required ${label}${positionalRule.min === 1 ? "" : "s"} for \`${commandLabel}\`.`,
        {
          hint: `Usage: ${spec.usage}. Run \`ainobi help ${commandLabel.split(" ")[0]}\` for details.`,
        },
      );
    }
    if (args.positionals.length > max) {
      throw new AinobiCliError(
        "USAGE",
        `Too many positional arguments for \`${commandLabel}\`.`,
        {
          hint: `Usage: ${spec.usage}. Run \`ainobi help ${commandLabel.split(" ")[0]}\` for details.`,
        },
      );
    }
  }

  for (const rule of spec.requireOneOf ?? []) {
    const hasValue = rule.flags.some((name) => {
      const value = flagString(args, name);
      return value !== undefined && value.trim() !== "";
    });
    if (!hasValue) {
      throw new AinobiCliError("USAGE", rule.message, {
        hint: `Usage: ${spec.usage}. Run \`ainobi help ${commandLabel.split(" ")[0]}\` for details.`,
      });
    }
  }
};

export const ELEMENT_INSERT_ARG_SPEC: CommandArgSpec = {
  usage:
    "ainobi element insert <slide> --type <type> [--set path=value ...] [--file payload.json | --json '{...}'] [--asset <path>] [--name <text>] [--at <index>] [--center-x | --center-y] [--allow-slide-media] [--start <ms>] [--end <ms>|--duration <ms>]",
  positional: { min: 1, max: 1, name: "slide" },
  flags: ["type", "asset", "name", "at", "start", "end", "duration"],
  booleanFlags: ["center-x", "center-y", "allow-slide-media"],
  deprecatedFlagHints: {
    text: 'use --set text="..." instead of --text',
    left: "use --set position.x=<n> instead of --left",
    top: "use --set position.y=<n> instead of --top",
    right: "use --set position.x=<n> (with size) instead of --right",
    bottom: "use --set position.y=<n> (with size) instead of --bottom",
    width: "use --set size.width=<n> instead of --width",
    height: "use --set size.height=<n> instead of --height",
    x: "use --set position.x=<n> instead of --x",
    y: "use --set position.y=<n> instead of --y",
    "font-size": "use --set font_size=<n> instead of --font-size",
    fontsize: "use --set font_size=<n> instead of --font-size",
    "line-height": "use --set line_height=<n> instead of --line-height",
    lineheight: "use --set line_height=<n> instead of --line-height",
    color: 'use --set color="#rrggbb" instead of --color',
    align: 'use --set align=left|center|right instead of --align',
    position: "use --set position.x=… and --set position.y=… instead of --position",
    size: "use --set size.width=… and --set size.height=… instead of --size",
  },
};

export const DOC_READ_ARG_SPEC: CommandArgSpec = {
  usage:
    "ainobi doc read [<path>] [--file-id <uuid>] [--from-work-dir] [--out <markdown-path>] [--preview-chars <n>] [--max-output-chars <n>] [--llm-prompt <text>] [--no-llm] [--no-save]",
  positional: { min: 0, max: 1, name: "path" },
  flags: ["file-id", "file_id", "out", "preview-chars", "max-output-chars", "llm-prompt"],
  booleanFlags: ["from-work-dir", "no-llm", "no-save"],
};

export const KNOWLEDGE_LIST_ARG_SPEC: CommandArgSpec = {
  usage: "ainobi knowledge list",
  positional: { min: 0, max: 0 },
  flags: [],
  booleanFlags: [],
};

export const KNOWLEDGE_READ_ARG_SPEC: CommandArgSpec = {
  usage:
    "ainobi knowledge read --file-id <uuid> [--offset <n>] [--limit <n>] [--section-id <uuid>] [--out <markdown-path>]",
  positional: { min: 0, max: 0 },
  flags: ["file-id", "file_id", "offset", "limit", "section-id", "section_id", "out"],
  booleanFlags: [],
};

export const IMAGE_REPLICATE_HTML_ARG_SPEC: CommandArgSpec = {
  usage:
    "ainobi image replicate-html <path> [--from-work-dir] [--out <html-path>] [--preview-chars <n>] [--max-output-chars <n>] [--llm-prompt <text>] [--no-save]",
  positional: { min: 1, max: 1, name: "path" },
  flags: ["out", "preview-chars", "max-output-chars", "llm-prompt"],
  booleanFlags: ["from-work-dir", "no-save"],
};

export const IMAGE_GENERATE_ARG_SPEC: CommandArgSpec = {
  usage:
    'ainobi image generate --prompt "<text>" [--size auto|1024x1024|1536x1024|1024x1536] [--quality auto|low|medium|high] [--name <file.png>] [--courseware-id <id>] [--out <png-path>] [--no-save]',
  positional: { min: 0, name: "prompt" },
  flags: ["prompt", "size", "quality", "name", "courseware-id", "courseware-org-id", "out"],
  booleanFlags: ["no-save"],
};

export const SEARCH_ARG_SPEC: CommandArgSpec = {
  usage:
    "ainobi search <query> [--max-results <n>] [--depth basic|advanced|fast|ultra-fast] [--topic general|news|finance] [--time-range day|week|month|year] [--answer] [--answer-level basic|advanced] [--raw-content]",
  positional: { min: 1, name: "query" },
  flags: ["max-results", "depth", "topic", "time-range", "answer-level"],
  booleanFlags: ["answer", "raw-content"],
};

export const AI_TEACHERS_LIST_ARG_SPEC: CommandArgSpec = {
  usage: "ainobi ai-teachers list [--org-id <uuid>] [--page-size <n>] [--save]",
  positional: { min: 0, max: 0 },
  flags: ["org-id", "org_id", "page-size"],
  booleanFlags: ["save"],
};

export const AI_TEACHERS_SYNC_ARG_SPEC: CommandArgSpec = {
  usage: "ainobi ai-teachers sync [--org-id <uuid>] [--page-size <n>]",
  positional: { min: 0, max: 0 },
  flags: ["org-id", "org_id", "page-size"],
  booleanFlags: [],
};

export const TTS_LIST_ARG_SPEC: CommandArgSpec = {
  usage:
    "ainobi tts list [--org-id <uuid>] [--provider fishaudio|minimax] [--language zh|ja|en] [--page-size <n>] [--save]",
  positional: { min: 0, max: 0 },
  flags: ["org-id", "org_id", "provider", "language", "page-size"],
  booleanFlags: ["save"],
};

export const TTS_SYNC_ARG_SPEC: CommandArgSpec = {
  usage:
    "ainobi tts sync [--org-id <uuid>] [--provider fishaudio|minimax] [--language zh|ja|en] [--page-size <n>]",
  positional: { min: 0, max: 0 },
  flags: ["org-id", "org_id", "provider", "language", "page-size"],
  booleanFlags: [],
};

export const NARRATION_INSERT_ARG_SPEC: CommandArgSpec = {
  usage:
    "ainobi narration insert <slide> --teacher-id <ai_teacher_id> --transcript <text> [--script <text>] [--tts-id <tts_id>] [--tts-style <recommended_key>] [--no-fit-slide] [--no-subtitle-visible] [--tail-ms <ms>] [--stagger-gap-ms <ms>] [--duration <ms>] [--teacher-file <path>] [--teacher-name <name>] [--tts-gap-ms <ms>]",
  positional: { min: 1, max: 1, name: "slide" },
  flags: [
    "script",
    "transcript",
    "duration",
    "tail-ms",
    "stagger-gap-ms",
    "tts-gap-ms",
    "tts-id",
    "tts-style",
    "teacher-file",
    "teachers",
    "teacher-id",
    "teacher-name",
  ],
  booleanFlags: ["fit-slide", "tts", "subtitle-visible"],
  requireOneOf: [
    {
      flags: ["script", "transcript"],
      message: "Narration insert requires --script and/or --transcript with non-empty text.",
    },
    {
      flags: ["teacher-id"],
      message:
        "Narration insert requires --teacher-id <ai_teacher_id>. Run `ainobi ai-teachers list` first to obtain the catalog, ask the user to pick one, then pass its ai_teacher_id here.",
    },
  ],
  deprecatedFlagHints: {
    text: "use --script and/or --transcript instead of --text",
    voice:
      "prefer `ainobi tts list --save` then `narration insert --tts-id <tts_id>` to pick a catalog voice; otherwise voice comes from the AI teacher TTS binding.",
    "no-tts": "there is no flag to skip TTS; synthesis is always required (retries on transient failures).",
    tts: "TTS is always on for narration insert; there is no separate --tts switch.",
  },
};
