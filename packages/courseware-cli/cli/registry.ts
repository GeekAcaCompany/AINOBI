// SPDX-License-Identifier: AGPL-3.0-only
import type { ParsedArgs } from "./args.ts";
import type { OutputOptions } from "./output.ts";
import {
  AI_TEACHERS_LIST_ARG_SPEC,
  AI_TEACHERS_SYNC_ARG_SPEC,
  ELEMENT_INSERT_ARG_SPEC,
  NARRATION_INSERT_ARG_SPEC,
  DOC_READ_ARG_SPEC,
  KNOWLEDGE_LIST_ARG_SPEC,
  KNOWLEDGE_READ_ARG_SPEC,
  IMAGE_GENERATE_ARG_SPEC,
  IMAGE_REPLICATE_HTML_ARG_SPEC,
  SEARCH_ARG_SPEC,
  TTS_LIST_ARG_SPEC,
  TTS_SYNC_ARG_SPEC,
  validateCommandArgs,
  type CommandArgSpec,
} from "./command-args.ts";
import { AinobiCliError } from "./errors.ts";
import { handleLoad } from "./commands/load.ts";
import { handleSave } from "./commands/save.ts";
import { handleStatus, handleReset } from "./commands/status.ts";
import { handleSceneInfo, handleSceneUpdate } from "./commands/scene.ts";
import {
  handleSlideDelete,
  handleSlideGet,
  handleSlideInsert,
  handleSlideList,
  handleSlideUpdate,
} from "./commands/slide.ts";
import {
  handleElementDelete,
  handleElementGet,
  handleElementInsert,
  handleElementList,
  handleElementUpdate,
} from "./commands/element.ts";
import { handleElementRichInsert, handleElementRichUpdate } from "./commands/element-rich.ts";
import {
  handleDesignTemplateDelete,
  handleDesignTemplateExtract,
  handleDesignTemplateGet,
  handleDesignTemplateList,
  handleDesignTemplateSave,
} from "./commands/design-template.ts";
import {
  handleContentTemplateDelete,
  handleContentTemplateExtract,
  handleContentTemplateGet,
  handleContentTemplateList,
  handleContentTemplateSave,
} from "./commands/content-template.ts";
import { handleHelp } from "./commands/help.ts";
import { handleInit } from "./commands/init.ts";
import { handleBatchApply, handleBatchDryRun } from "./commands/batch.ts";
import { handleSlideDuplicate, handleSlideMove, handleSlideTemplate } from "./commands/slide-advanced.ts";
import { handleElementAlign, handleElementDistribute, handleElementLayer } from "./commands/element-layout.ts";
import { handleAnimationPreset, handleAnimationStagger, handleAnimationTimeline, handleHighlightAdd } from "./commands/animation.ts";
import {
  handleFlowPauseAdd,
  handleFlowPauseList,
  handleFlowPauseRemove,
} from "./commands/flow-pause.ts";
import {
  handleQuizDelete,
  handleQuizGet,
  handleQuizInit,
  handleQuizInsert,
  handleQuizList,
  handleQuizPruneOrphans,
  handleQuizScoreSummaryGet,
  handleQuizScoreSummaryInsert,
  handleQuizScoreSummaryUpdate,
  handleQuizUpdate,
  handleQuizValidate,
} from "./commands/quiz.ts";
import { handleDiff, handleInspectAssets, handleInspectOverlaps, handleInspectSvgBounds, handleInspectTimeline, handleValidate } from "./commands/diagnostics.ts";
import { handleInspectSceneSync } from "./commands/scene-sync-diff.ts";
import { handleNarrationInsert } from "./commands/narration.ts";
import { handleDocRead } from "./commands/doc.ts";
import { handleKnowledgeList, handleKnowledgeRead } from "./commands/knowledge.ts";
import { handleImageGenerate, handleImageReplicateHtml } from "./commands/image.ts";
import { handleSearch } from "./commands/search.ts";
import { handleAssetGet, handleAssetUpload } from "./commands/asset.ts";
import {
  handleReferenceElementGet,
  handleReferenceElementList,
  handleReferenceImport,
  handleReferenceInspect,
  handleReferenceSceneInfo,
  handleReferenceSlideGet,
  handleReferenceSlideList,
} from "./commands/reference.ts";
import { handleAiTeachersList, handleAiTeachersSync } from "./commands/ai-teachers.ts";
import { handleTtsList, handleTtsSync } from "./commands/tts.ts";
import { handleRecall } from "./commands/recall.ts";

export type CommandHandler = (args: ParsedArgs, output: OutputOptions) => void | Promise<void>;

export interface CommandSpec {
  path: string[];
  aliases?: string[][];
  handler: CommandHandler;
  usageHint?: string;
  argSpec?: CommandArgSpec;
}

const specs: CommandSpec[] = [
  { path: ["init"], handler: handleInit },
  { path: ["load"], handler: handleLoad },
  { path: ["save"], handler: handleSave },
  { path: ["status"], handler: handleStatus },
  { path: ["reset"], handler: handleReset },
  { path: ["recall"], handler: handleRecall },
  { path: ["help"], aliases: [["--help"], ["-h"]], handler: handleHelp },
  { path: ["scene"], handler: handleSceneInfo },
  { path: ["scene", "info"], handler: handleSceneInfo },
  { path: ["scene", "update"], handler: handleSceneUpdate, usageHint: "Use info | update." },
  { path: ["slide", "list"], handler: handleSlideList },
  { path: ["slide", "get"], aliases: [["slide", "info"]], handler: handleSlideGet },
  { path: ["slide", "insert"], aliases: [["slide", "add"]], handler: handleSlideInsert },
  { path: ["slide", "update"], handler: handleSlideUpdate },
  { path: ["slide", "delete"], aliases: [["slide", "remove"]], handler: handleSlideDelete },
  { path: ["slide", "template"], handler: handleSlideTemplate },
  { path: ["slide", "duplicate"], handler: handleSlideDuplicate },
  { path: ["slide", "move"], handler: handleSlideMove },
  { path: ["element", "list"], handler: handleElementList },
  { path: ["element", "get"], handler: handleElementGet },
  {
    path: ["element", "insert"],
    aliases: [["element", "add"]],
    handler: handleElementInsert,
    argSpec: ELEMENT_INSERT_ARG_SPEC,
  },
  { path: ["element", "update"], handler: handleElementUpdate },
  { path: ["element", "rich", "insert"], aliases: [["element", "rich", "add"]], handler: handleElementRichInsert },
  { path: ["element", "rich", "update"], handler: handleElementRichUpdate },
  { path: ["element", "delete"], aliases: [["element", "remove"]], handler: handleElementDelete },
  { path: ["element", "align"], handler: handleElementAlign },
  { path: ["element", "distribute"], handler: handleElementDistribute },
  { path: ["element", "layer"], handler: handleElementLayer },
  { path: ["animation", "preset"], handler: handleAnimationPreset },
  { path: ["animation", "stagger"], handler: handleAnimationStagger },
  { path: ["animation", "timeline"], handler: handleAnimationTimeline },
  { path: ["highlight", "add"], handler: handleHighlightAdd },
  { path: ["flow-pause", "add"], handler: handleFlowPauseAdd },
  { path: ["flow-pause", "remove"], handler: handleFlowPauseRemove },
  { path: ["flow-pause", "list"], handler: handleFlowPauseList },
  {
    path: ["narration", "insert"],
    aliases: [["narration", "add"]],
    handler: handleNarrationInsert,
    argSpec: NARRATION_INSERT_ARG_SPEC,
  },
  {
    path: ["search"],
    handler: handleSearch,
    argSpec: SEARCH_ARG_SPEC,
  },
  {
    path: ["doc", "read"],
    handler: handleDocRead,
    argSpec: DOC_READ_ARG_SPEC,
  },
  {
    path: ["knowledge", "list"],
    handler: handleKnowledgeList,
    argSpec: KNOWLEDGE_LIST_ARG_SPEC,
  },
  {
    path: ["knowledge", "read"],
    handler: handleKnowledgeRead,
    argSpec: KNOWLEDGE_READ_ARG_SPEC,
  },
  {
    path: ["image", "replicate-html"],
    handler: handleImageReplicateHtml,
    argSpec: IMAGE_REPLICATE_HTML_ARG_SPEC,
  },
  {
    path: ["image", "generate"],
    aliases: [["image", "gen"]],
    handler: handleImageGenerate,
    argSpec: IMAGE_GENERATE_ARG_SPEC,
  },
  { path: ["quiz", "init"], handler: handleQuizInit },
  { path: ["quiz", "insert"], aliases: [["quiz", "add"]], handler: handleQuizInsert },
  { path: ["quiz", "update"], handler: handleQuizUpdate },
  { path: ["quiz", "delete"], aliases: [["quiz", "remove"]], handler: handleQuizDelete },
  {
    path: ["quiz", "prune-orphans"],
    aliases: [["quiz", "prune_orphans"], ["quiz", "prune"]],
    handler: handleQuizPruneOrphans,
  },
  { path: ["quiz", "list"], handler: handleQuizList },
  { path: ["quiz", "get"], handler: handleQuizGet },
  { path: ["quiz", "validate"], handler: handleQuizValidate },
  {
    path: ["quiz", "score-summary", "insert"],
    aliases: [["quiz", "score-summary", "add"]],
    handler: handleQuizScoreSummaryInsert,
  },
  { path: ["quiz", "score-summary", "update"], handler: handleQuizScoreSummaryUpdate },
  { path: ["quiz", "score-summary", "get"], handler: handleQuizScoreSummaryGet },
  { path: ["validate"], handler: handleValidate },
  { path: ["inspect", "timeline"], handler: handleInspectTimeline },
  { path: ["inspect", "overlaps"], handler: handleInspectOverlaps },
  { path: ["inspect", "svg-bounds"], handler: handleInspectSvgBounds },
  { path: ["inspect", "assets"], handler: handleInspectAssets },
  { path: ["inspect", "scene-sync"], handler: handleInspectSceneSync },
  { path: ["diff"], handler: handleDiff },
  { path: ["asset", "get"], handler: handleAssetGet },
  { path: ["reference", "inspect"], handler: handleReferenceInspect },
  { path: ["reference", "scene", "info"], handler: handleReferenceSceneInfo },
  { path: ["reference", "slide", "list"], handler: handleReferenceSlideList },
  {
    path: ["reference", "slide", "get"],
    aliases: [["reference", "slide", "info"]],
    handler: handleReferenceSlideGet,
  },
  { path: ["reference", "element", "list"], handler: handleReferenceElementList },
  { path: ["reference", "element", "get"], handler: handleReferenceElementGet },
  { path: ["reference", "import"], handler: handleReferenceImport },
  { path: ["asset", "upload"], handler: handleAssetUpload },
  {
    path: ["ai-teachers", "list"],
    handler: handleAiTeachersList,
    argSpec: AI_TEACHERS_LIST_ARG_SPEC,
  },
  {
    path: ["ai-teachers", "sync"],
    handler: handleAiTeachersSync,
    argSpec: AI_TEACHERS_SYNC_ARG_SPEC,
  },
  {
    path: ["tts", "list"],
    handler: handleTtsList,
    argSpec: TTS_LIST_ARG_SPEC,
  },
  {
    path: ["tts", "sync"],
    handler: handleTtsSync,
    argSpec: TTS_SYNC_ARG_SPEC,
  },
  { path: ["design-template", "list"], handler: handleDesignTemplateList },
  { path: ["design-template", "get"], handler: handleDesignTemplateGet },
  { path: ["design-template", "save"], handler: handleDesignTemplateSave },
  { path: ["design-template", "extract"], handler: handleDesignTemplateExtract },
  { path: ["design-template", "delete"], handler: handleDesignTemplateDelete },
  { path: ["content-template", "list"], handler: handleContentTemplateList },
  { path: ["content-template", "get"], handler: handleContentTemplateGet },
  { path: ["content-template", "save"], handler: handleContentTemplateSave },
  { path: ["content-template", "extract"], handler: handleContentTemplateExtract },
  { path: ["content-template", "delete"], handler: handleContentTemplateDelete },
  { path: ["batch", "apply"], handler: handleBatchApply },
  { path: ["batch", "dry-run"], handler: handleBatchDryRun },
];

const matches = (positionals: string[], path: string[]): boolean =>
  path.every((part, index) => positionals[index] === part);

const specMatches = (positionals: string[], spec: CommandSpec): boolean =>
  matches(positionals, spec.path) || (spec.aliases ?? []).some((alias) => matches(positionals, alias));

const wantsHelpFlag = (args: ParsedArgs): boolean =>
  args.flags.help === true || args.flags.h === true;

const stripHelpFlags = (args: ParsedArgs): void => {
  delete args.flags.help;
  delete args.flags.h;
};

const HELP_TOPICS = new Set([
  "types",
  "commands",
  "enums",
  "session",
  "scene",
  "slide",
  "narration",
  "search",
  "doc",
  "image",
  "ai-teachers",
  "tts",
  "design-template",
  "content-template",
  "element",
  "reference",
]);

/** Map a dispatched command path to `ainobi help …` positionals. */
const helpTopicPositionals = (commandPath: string[]): string[] => {
  if (commandPath.length >= 2) {
    const [group, sub] = commandPath;
    if (group === "element" || group === "reference") return [group, sub];
    if (group === "narration" || group === "scene" || group === "slide") return [group];
    if (group === "ai-teachers" || group === "tts" || group === "doc" || group === "image" || group === "reference" || group === "design-template" || group === "content-template") return [group];
  }
  const top = commandPath[0];
  if (HELP_TOPICS.has(top)) return commandPath;
  return [];
};

const routeToHelp = (args: ParsedArgs, topic: string[]): CommandHandler => {
  stripHelpFlags(args);
  args.positionals = topic;
  return handleHelp;
};

const subcommandsForGroup = (group: string): string[] => {
  const subs = new Set<string>();
  for (const spec of specs) {
    if (spec.path[0] !== group || spec.path.length < 2) continue;
    subs.add(spec.path[1]);
    for (const alias of spec.aliases ?? []) {
      if (alias[0] === group && alias.length > 1) subs.add(alias[1]);
    }
  }
  return [...subs].sort();
};

export const dispatchCommand = (args: ParsedArgs): CommandHandler | null => {
  const first = args.positionals[0];
  if (!first) return null;
  const helpRequested = wantsHelpFlag(args);
  const candidates = specs
    .filter((spec) => specMatches(args.positionals, spec))
    .sort((a, b) => b.path.length - a.path.length);
  const spec = candidates[0];
  if (!spec) {
    if (helpRequested) {
      const valid = subcommandsForGroup(first);
      if (valid.length > 0) {
        return routeToHelp(args, [first]);
      }
    }
    const knownFirst = new Set(specs.map((item) => item.path[0]));
    if (!knownFirst.has(first)) {
      throw new AinobiCliError(
        "USAGE",
        `Unknown command "${first}". Run \`ainobi help\` for the full list.`,
      );
    }
    const valid = subcommandsForGroup(first);
    const sub = args.positionals[1] ?? "";
    const validHint =
      valid.length > 0 ? `Valid \`${first}\` subcommands: ${valid.join(", ")}. ` : "";
    throw new AinobiCliError(
      "USAGE",
      `Unknown ${first} subcommand "${sub}".`,
      { hint: `${validHint}Run \`ainobi help ${first}\` or \`ainobi help commands\` for details.` },
    );
  }
  if (helpRequested && spec.path[0] !== "help") {
    return routeToHelp(args, helpTopicPositionals(spec.path));
  }
  const commandLabel = spec.path.join(" ");
  args.positionals.splice(0, spec.path.length);
  if (spec.argSpec) {
    validateCommandArgs(args, spec.argSpec, commandLabel);
  }
  return spec.handler;
};
