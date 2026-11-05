// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import type { ContentLanguage } from "@ainobi/courseware-core/content-language.ts";
import { readSceneContentLanguage } from "@ainobi/courseware-core/content-language.ts";
import { normalizeQuizAst, type QuizAstNode } from "@ainobi/courseware-core/quiz-ast.ts";
import { parseQuizJsxWithMeta } from "../quiz-jsx-parser.ts";
import { quizAstToJsx } from "../quiz-jsx-printer.ts";

import {
  flagBool,
  flagNumber,
  flagString,
  type ParsedArgs,
} from "../args.ts";
import { normalizeMultilineCliText } from "../cli-text.ts";
import { AinobiCliError } from "../errors.ts";
import {
  applyOperation,
  findChildIndexInJson,
  findSlideIndexInJson,
} from "../operations.ts";
import { buildPatchFromSetEntries, deepMerge } from "../patch.ts";
import { readJsonFile, resolveJsonInput } from "../input.ts";
import { printSuccess, type OutputOptions } from "../output.ts";
import { requireScene } from "../state.ts";
import { withSceneTransaction } from "../transaction.ts";
import {
  inspectQuizAstInterpSlots,
  QUIZ_QUESTION_TYPE_VALUES,
  QUIZ_SCORE_SUMMARY_INTERP_KEYS,
  inspectScoreSummaryAstInterpSlots,
  validateQuizForScene,
  collectQuizLayoutSizingWarnings,
  type QuizQuestion,
  type QuizQuestionType,
} from "@ainobi/courseware-core";

const requireQuestionType = (args: ParsedArgs): QuizQuestionType => {
  const raw = flagString(args, "type");
  if (!raw) {
    throw new AinobiCliError("USAGE", `Provide --type <${QUIZ_QUESTION_TYPE_VALUES.join("|")}>.`);
  }
  if (!QUIZ_QUESTION_TYPE_VALUES.includes(raw as QuizQuestionType)) {
    throw new AinobiCliError(
      "USAGE",
      `Unknown question type "${raw}". Valid: ${QUIZ_QUESTION_TYPE_VALUES.join(", ")}.`,
    );
  }
  return raw as QuizQuestionType;
};

const readJsxSource = (args: ParsedArgs, prefix: string): string | undefined => {
  const inline = flagString(args, "jsx");
  const file = flagString(args, "jsx-file");
  const layoutFile = flagString(args, "react-layout-file");
  if ([inline !== undefined, Boolean(file), Boolean(layoutFile)].filter(Boolean).length > 1) {
    throw new AinobiCliError(
      "USAGE",
      `${prefix}: pass only one layout source — --jsx, --jsx-file, or --react-layout-file.`,
    );
  }
  if (file) {
    try {
      return readFileSync(file, "utf8");
    } catch (error) {
      throw new AinobiCliError(
        "INVALID_INPUT",
        `${prefix}: failed to read --jsx-file ${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return inline ?? undefined;
};

const readReactLayoutJson = (args: ParsedArgs, prefix: string): unknown | undefined => {
  const layoutFile = flagString(args, "react-layout-file");
  if (!layoutFile) return undefined;
  if (flagString(args, "jsx") !== undefined || flagString(args, "jsx-file")) {
    throw new AinobiCliError(
      "USAGE",
      `${prefix}: pass only one layout source — --jsx, --jsx-file, or --react-layout-file.`,
    );
  }
  return readJsonFile(layoutFile);
};

const collectQuestionPatch = (args: ParsedArgs): Record<string, unknown> => {
  const json = resolveJsonInput(args);
  let patch =
    json && typeof json === "object" && !Array.isArray(json)
      ? { ...(json as Record<string, unknown>) }
      : {};
  if (args.multi.set?.length) {
    patch = deepMerge(patch, buildPatchFromSetEntries(args.multi.set));
  }
  const title = flagString(args, "title");
  if (title !== undefined) patch.title = normalizeMultilineCliText(title);
  return patch;
};

const collectElementPatch = (args: ParsedArgs): Record<string, unknown> => {
  const patch: Record<string, unknown> = {};
  const positionX = flagNumber(args, "position-x");
  const positionY = flagNumber(args, "position-y");
  const sizeW = flagNumber(args, "size-w");
  const sizeH = flagNumber(args, "size-h");
  const startAt = flagNumber(args, "start");
  const duration = flagNumber(args, "duration");
  if (positionX !== undefined || positionY !== undefined) {
    patch.position = {
      ...(positionX !== undefined ? { x: positionX } : {}),
      ...(positionY !== undefined ? { y: positionY } : {}),
    };
  }
  if (sizeW !== undefined || sizeH !== undefined) {
    patch.size = {
      ...(sizeW !== undefined ? { width: sizeW } : {}),
      ...(sizeH !== undefined ? { height: sizeH } : {}),
    };
  }
  if (startAt !== undefined || duration !== undefined) {
    const start = startAt ?? 0;
    const tl: Record<string, unknown> = {};
    if (startAt !== undefined) tl.start_at = start;
    if (duration !== undefined) tl.end_at = start + duration;
    patch.timeline = tl;
  }
  const name = flagString(args, "name");
  if (name) patch.name = name;
  return patch;
};

export const handleQuizInit = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  const timeLimitMinutesPart = flagNumber(args, "time-limit-minutes");
  const timeLimitSecondsPart = flagNumber(args, "time-limit-seconds");
  const timeLimitMinutes =
    timeLimitMinutesPart !== undefined || timeLimitSecondsPart !== undefined
      ? Math.max(0, (timeLimitMinutesPart ?? 0) + (timeLimitSecondsPart ?? 0) / 60)
      : null;
  await withSceneTransaction(args, output, (sceneJson) => {
    const result = applyOperation(sceneJson, {
      op: "quiz.init",
      enabled: flagBool(args, "enabled", true),
      total_score: flagNumber(args, "total-score") ?? 100,
      time_limit_minutes: timeLimitMinutes,
    });
    return result.data;
  });
};

export const handleQuizInsert = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  const slide = args.positionals[0];
  if (slide === undefined) {
    throw new AinobiCliError("USAGE", "Provide a slide reference (index or element_id).");
  }
  const type = requireQuestionType(args);
  const jsxSource = readJsxSource(args, "quiz insert");
  const questionPatch = collectQuestionPatch(args);
  const elementPatch = collectElementPatch(args);
  const reactLayout = readReactLayoutJson(args, "quiz insert");
  await withSceneTransaction(args, output, (sceneJson) => {
    const result = applyOperation(sceneJson, {
      op: "quiz.insert",
      slide,
      type,
      jsx: jsxSource,
      react_layout: reactLayout,
      question: questionPatch,
      element: elementPatch,
    });
    return result.data;
  });
};

export const handleQuizUpdate = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  const slide = args.positionals[0];
  const elementRef = args.positionals[1];
  if (slide === undefined || elementRef === undefined) {
    throw new AinobiCliError(
      "USAGE",
      "Usage: ainobi quiz update <slide> <quiz_element_ref> [--jsx ... | --jsx-file ...] [--set ...]",
    );
  }
  const jsxSource = readJsxSource(args, "quiz update");
  const reactLayout = readReactLayoutJson(args, "quiz update");
  const questionPatch = collectQuestionPatch(args);
  const elementPatch = collectElementPatch(args);
  if (
    jsxSource === undefined &&
    reactLayout === undefined &&
    Object.keys(questionPatch).length === 0 &&
    Object.keys(elementPatch).length === 0
  ) {
    throw new AinobiCliError(
      "USAGE",
      "Provide at least one of --jsx, --jsx-file, --react-layout-file, --set, --json, --file, --title, --position-x/y, --size-w/h, --start, --duration.",
    );
  }
  await withSceneTransaction(args, output, (sceneJson) => {
    const result = applyOperation(sceneJson, {
      op: "quiz.update",
      slide,
      element: elementRef,
      jsx: jsxSource,
      react_layout: reactLayout,
      question: questionPatch,
      element_patch: elementPatch,
    });
    return result.data;
  });
};

/**
 * `quiz get --layout`: the layout as JSX the agent can copy/edit and write back with
 * `--jsx-file`. The JSX is re-parsed and compared with the stored AST; when that round
 * trip is not exact (e.g. text containing `<` or `{`), the AST is included too so the
 * agent can use `--react-layout-file` instead.
 */
const describeQuizLayoutForAgent = (
  layout: QuizAstNode,
  language: ContentLanguage | null,
): Record<string, unknown> => {
  const jsx = quizAstToJsx(layout);
  let lossless = false;
  try {
    const reparsed = parseQuizJsxWithMeta(jsx, language ?? "en").ast;
    const canonical = (node: QuizAstNode) => JSON.stringify(normalizeQuizAst(node, { fillRootContainer: true }));
    lossless = canonical(reparsed) === canonical(layout);
  } catch {
    lossless = false;
  }
  return {
    layout_jsx: jsx,
    layout_jsx_lossless: lossless,
    ...(lossless
      ? {}
      : {
          react_layout: layout,
          layout_note:
            "layout_jsx is not an exact round trip of this layout; write changes back with --react-layout-file (JSON AST) instead of --jsx-file.",
        }),
  };
};

export const handleQuizGet = (args: ParsedArgs, output: OutputOptions): void => {
  const slide = args.positionals[0];
  const elementRef = args.positionals[1];
  if (slide === undefined || elementRef === undefined) {
    throw new AinobiCliError("USAGE", "Usage: ainobi quiz get <slide> <quiz_element_ref> [--verbose] [--layout]");
  }
  const verbose = flagBool(args, "verbose", false);
  const wantLayout = flagBool(args, "layout", false);
  const { scene } = requireScene();
  const slideIdx = findSlideIndexInJson(scene as unknown as Record<string, unknown>, slide);
  const slideEl = scene.slide_elements[slideIdx];
  const childIdx = findChildIndexInJson(slideEl as unknown as Record<string, unknown>, elementRef);
  const element = slideEl.children_elements[childIdx];
  if (element.element_type !== "quiz") {
    throw new AinobiCliError(
      "INVALID_INPUT",
      `element at ${childIdx} is type "${element.element_type}", not "quiz"`,
    );
  }
  const quizQuestionId = String(element.quiz_question_id ?? "");
  const questions = (scene.quiz?.questions ?? []) as QuizQuestion[];
  const question = questions.find((q) => q.question_id === quizQuestionId);
  if (!question) {
    throw new AinobiCliError("NOT_FOUND", `no scene.quiz.questions[] entry for ${quizQuestionId}`);
  }
  const interp = inspectQuizAstInterpSlots(question.react_layout);
  const hints: string[] = [];
  if (interp.missing_slots.includes("title")) {
    hints.push(
      "The question stem will not render: put {$title} or <interp key=\"title\" /> inside <QuizTitle>, or leave <QuizTitle /> self-closing (the CLI fills in {$title} on update).",
    );
  }
  if (interp.missing_slots.includes("explanation")) {
    hints.push(
      "The explanation will not render: put <p>{$explanation}</p> or <interp key=\"explanation\" /> inside <QuizExplanation>.",
    );
  }
  printSuccess(
    {
      slide_index: slideIdx,
      slide_id: slideEl.element_id,
      element_id: element.element_id,
      element_name: element.name,
      question_id: question.question_id,
      type: question.type,
      title: question.title,
      explanation: question.explanation ?? null,
      options:
        question.type === "single_choice" || question.type === "multiple_choice"
          ? question.options.map((opt) => ({
              option_id: opt.option_id,
              is_correct: opt.is_correct,
            }))
          : null,
      blank_ids: question.type === "fill_blank" ? question.blanks.map((b) => b.blank_id) : null,
      size: { width: element.size.width, height: element.size.height },
      layout: {
        ast_node_count: countAstNodes(question.react_layout),
        has_title_interp: interp.has_title_interp,
        has_explanation_interp: interp.has_explanation_interp,
        missing_dynamic_slots: interp.missing_slots,
      },
      hints,
      // Agent quiet mode never dumps full AST even with --verbose (use --no-quiet).
      ...(verbose && !output.quiet ? { react_layout: question.react_layout } : {}),
      // Explicit --layout: readable JSX of the current layout (quiet mode included).
      ...(wantLayout ? describeQuizLayoutForAgent(question.react_layout, readSceneContentLanguage(scene)) : {}),
    },
    output,
    hints.map((message) => ({ path: "react_layout", message })),
  );
};

export const handleQuizDelete = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  const slide = args.positionals[0];
  const elementRef = args.positionals[1];
  if (slide === undefined || elementRef === undefined) {
    throw new AinobiCliError("USAGE", "Usage: ainobi quiz delete <slide> <quiz_element_ref>");
  }
  await withSceneTransaction(args, output, (sceneJson) => {
    const result = applyOperation(sceneJson, {
      op: "quiz.delete",
      slide,
      element: elementRef,
    });
    return result.data;
  });
};

/**
 * Remove `scene.quiz.questions[]` entries that are not bound to any slide quiz element.
 * Use after legacy `slide delete` / `element delete` left orphans, or when validate reports
 * "is not inserted on any slide".
 */
export const handleQuizPruneOrphans = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  await withSceneTransaction(args, output, (sceneJson) => {
    const result = applyOperation(sceneJson, { op: "quiz.prune_orphans" });
    return result.data;
  });
};

export const handleQuizList = (_args: ParsedArgs, output: OutputOptions): void => {
  const { scene } = requireScene();
  const quizQuestions = scene.quiz?.questions ?? [];
  const entries: Array<{
    slide_index: number;
    slide_id: string;
    element_id: string;
    element_name: string;
    quiz_question_id: string;
    type: string | null;
    title: string | null;
    blank_ids: string[] | null;
    ast_node_count: number | null;
    size: { width: number; height: number } | null;
  }> = [];
  for (let i = 0; i < scene.slide_elements.length; i += 1) {
    const slide = scene.slide_elements[i];
    for (const child of slide.children_elements) {
      if (child.element_type !== "quiz") continue;
      const question = quizQuestions.find((q) => q.question_id === child.quiz_question_id) ?? null;
      entries.push({
        slide_index: i,
        slide_id: slide.element_id,
        element_id: child.element_id,
        element_name: child.name,
        quiz_question_id: child.quiz_question_id,
        type: question?.type ?? null,
        title: question?.title ?? null,
        blank_ids:
          question?.type === "fill_blank"
            ? question.blanks.map((b) => b.blank_id)
            : null,
        ast_node_count: question ? countAstNodes(question.react_layout) : null,
        size: { width: child.size.width, height: child.size.height },
      });
    }
  }
  printSuccess({ count: entries.length, quiz_elements: entries }, output);
};

const countAstNodes = (
  node: { kind: string; children?: unknown[] } | null | undefined,
): number => {
  if (!node || typeof node !== "object") return 0;
  let total = 1;
  const children = (node as { children?: unknown[] }).children;
  if (Array.isArray(children)) {
    for (const child of children) {
      total += countAstNodes(child as { kind: string });
    }
  }
  return total;
};

export const handleQuizScoreSummaryInsert = async (
  args: ParsedArgs,
  output: OutputOptions,
): Promise<void> => {
  const slide = args.positionals[0];
  if (slide === undefined) {
    throw new AinobiCliError("USAGE", "Usage: ainobi quiz score-summary insert <slide> [--jsx-file ...]");
  }
  const jsxSource = readJsxSource(args, "quiz score-summary insert");
  const elementPatch = collectElementPatch(args);
  const reactLayout = readReactLayoutJson(args, "quiz score-summary insert");
  await withSceneTransaction(args, output, (sceneJson) => {
    const result = applyOperation(sceneJson, {
      op: "quiz.score_summary.insert",
      slide,
      jsx: jsxSource,
      react_layout: reactLayout,
      element: elementPatch,
    });
    return result.data;
  });
};

export const handleQuizScoreSummaryUpdate = async (
  args: ParsedArgs,
  output: OutputOptions,
): Promise<void> => {
  const slide = args.positionals[0];
  const elementRef = args.positionals[1];
  const jsxSource = readJsxSource(args, "quiz score-summary update");
  const reactLayout = readReactLayoutJson(args, "quiz score-summary update");
  const elementPatch = collectElementPatch(args);
  if (
    jsxSource === undefined &&
    reactLayout === undefined &&
    Object.keys(elementPatch).length === 0
  ) {
    throw new AinobiCliError(
      "USAGE",
      "Usage: ainobi quiz score-summary update [--jsx-file ... | --react-layout-file ...] [<slide> <element_ref> --position-x/y --size-w/h ...]",
    );
  }
  await withSceneTransaction(args, output, (sceneJson) => {
    const result = applyOperation(sceneJson, {
      op: "quiz.score_summary.update",
      ...(slide !== undefined ? { slide } : {}),
      ...(elementRef !== undefined ? { element: elementRef } : {}),
      jsx: jsxSource,
      react_layout: reactLayout,
      element_patch: elementPatch,
    });
    return result.data;
  });
};

export const handleQuizScoreSummaryGet = (args: ParsedArgs, output: OutputOptions): void => {
  const verbose = flagBool(args, "verbose", false);
  const { scene } = requireScene();
  const quiz = scene.quiz;
  if (!quiz?.score_summary?.react_layout) {
    throw new AinobiCliError(
      "NOT_FOUND",
      "scene.quiz.score_summary is not configured. Run `ainobi quiz score-summary insert <slide>` first.",
      {
        hint: "Do not use `scene update` with a quiz JSON blob or hand-edit db-courseware.scene.json.",
      },
    );
  }
  const layout = quiz.score_summary.react_layout;
  const interp = inspectScoreSummaryAstInterpSlots(layout);
  const hints: string[] = [];
  if (interp.missing_recommended.length > 0) {
    hints.push(
      `Show dynamic data: use interpolations such as {$${interp.missing_recommended.join("}, {$")}} in copy or component children; do not hard-code the full score.`,
    );
  }
  hints.push(
    "Self-closing <QuizGradeLabel /> / <QuizGradeDescription /> get {$grade_label} / {$grade_description} injected on write; at runtime they also fall back to grade_levels.",
  );
  hints.push(
    "Grades come from scene.quiz.grade_levels; the layout is stored in scene.quiz.score_summary.react_layout (a global singleton).",
  );

  const elements: Array<{
    slide_index: number;
    slide_id: string;
    element_id: string;
    element_name: string;
    size: { width: number; height: number };
  }> = [];
  for (let i = 0; i < scene.slide_elements.length; i += 1) {
    const slide = scene.slide_elements[i];
    for (const child of slide.children_elements) {
      if (child.element_type !== "quiz_score_summary") continue;
      elements.push({
        slide_index: i,
        slide_id: slide.element_id,
        element_id: child.element_id,
        element_name: child.name,
        size: { width: child.size.width, height: child.size.height },
      });
    }
  }

  printSuccess(
    {
      score_summary_configured: true,
      ast_node_count: countAstNodes(layout),
      interp_keys_present: interp.present_keys,
      valid_interp_keys: [...QUIZ_SCORE_SUMMARY_INTERP_KEYS],
      missing_recommended_interp: interp.missing_recommended,
      score_summary_elements: elements,
      hints,
      ...(verbose && !output.quiet ? { react_layout: layout } : {}),
    },
    output,
    hints.map((message) => ({ path: "quiz.score_summary.react_layout", message })),
  );
};

export const handleQuizValidate = (_args: ParsedArgs, output: OutputOptions): void => {
  const { scene } = requireScene();
  const issues = validateQuizForScene({
    quiz: scene.quiz,
    slide_elements: scene.slide_elements,
  });
  const sizingWarnings =
    scene.quiz != null ? collectQuizLayoutSizingWarnings(scene.quiz) : [];
  printSuccess(
    {
      valid: issues.length === 0,
      issue_count: issues.length,
      issues,
      layout_sizing_warning_count: sizingWarnings.length,
      layout_sizing_warnings: sizingWarnings,
    },
    output,
    sizingWarnings.map((w) => ({ path: w.path, message: w.message })),
  );
};
