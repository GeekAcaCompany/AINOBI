// SPDX-License-Identifier: AGPL-3.0-only
/**
 * QuizRenderer
 * ============
 *
 * Recursive renderer for the validated quiz AST stored on
 * `scene.quiz.questions[].react_layout`. Performs:
 *
 *  - tag whitelist enforcement (re-runs against `isQuizTag` at render time),
 *  - style sanitization via {@link normalizeQuizAstStyle},
 *  - interpolation substitution (`{$title}`, `{$score}`, …),
 *  - dispatch to the functional Quiz components which talk to
 *    {@link QuizFormContext} for state.
 *
 * **There is no runtime JSX parsing, eval, Babel, or dangerouslySetInnerHTML.**
 * AST validation already ran in the CLI (and we re-validate before rendering);
 * unknown tags or props are silently dropped here for forward compatibility.
 */

import { createElement, Fragment, type CSSProperties, type ReactNode } from "react";
import { useI18nNew } from "../../../hooks/useI18nNew.tsx";

import {
  isQuizFunctionalTag,
  isQuizHtmlTag,
  type QuizAstNode,
  type QuizAstPropValue,
  type QuizFunctionalTag,
  type QuizHtmlTag,
  type QuizInterpKey,
} from "@ainobi/courseware-core/quiz-ast.ts";
import type { QuizQuestion } from "@ainobi/courseware-core/quiz.ts";

import {
  QuizContainer,
  type QuizContainerHostHooks,
  type QuizContainerRecordingState,
  type QuizContainerSelectionState,
} from "./QuizContainer.tsx";
import type { QuizRuntimeState } from "./QuizFormContext.tsx";
import { QuizContinueButton } from "./QuizContinueButton.tsx";
import { QuizExplanation } from "./QuizExplanation.tsx";
import { QuizFeedback } from "./QuizFeedback.tsx";
import { QuizInput } from "./QuizInput.tsx";
import { QuizMedia } from "./QuizMedia.tsx";
import { QuizOption } from "./QuizOption.tsx";
import { QuizOptionGroup } from "./QuizOptionGroup.tsx";
import { QuizReferenceAudio } from "./QuizReferenceAudio.tsx";
import { QuizRecordingPlayback } from "./QuizRecordingPlayback.tsx";
import { QuizRecordingTimer } from "./QuizRecordingTimer.tsx";
import { useQuizRecordingTimerScope } from "./QuizRecordingTimerScope.tsx";
import { formatRecordingClock } from "./quiz-recording-format.ts";
import { QuizResubmitButton } from "./QuizResubmitButton.tsx";
import { QuizScore } from "./QuizScore.tsx";
import { QuizShadowingControlAst } from "./QuizShadowingControlAst.tsx";
import { QuizSkipButton } from "./QuizSkipButton.tsx";
import { QuizSubmitButton } from "./QuizSubmitButton.tsx";
import { QuizTextarea } from "./QuizTextarea.tsx";
import { QuizTitle } from "./QuizTitle.tsx";
import { normalizeQuizAstStyle } from "./quiz-style-allowlist.ts";
import { useQuizFormContext } from "./QuizFormContext.tsx";

/**
 * The renderer must dispatch by string tag → component. Each quiz component
 * declares its own strict `Props` interface (required `value`, `name`, `src`,
 * …), but here the props come from the validated AST as a JSON object whose
 * shape is enforced by `validateQuizAst` (which is what gates which props
 * each tag actually receives at runtime).
 *
 * From the renderer's static perspective we therefore cannot match every
 * component's exact Props signature, so we deliberately type the dispatch
 * table as `ComponentType<any>` — this is the same trade-off React itself
 * uses for `createElement(tag, props)` lookups. The AST validator is the
 * source of truth for prop correctness.
 */
type QuizDispatchComponent = React.ComponentType<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const FUNCTIONAL_COMPONENTS: Record<
  Exclude<QuizFunctionalTag, "QuizContainer" | "QuizShadowingControl">,
  QuizDispatchComponent
> = {
  QuizTitle,
  QuizMedia,
  QuizOptionGroup,
  QuizOption,
  QuizInput,
  QuizTextarea,
  QuizSubmitButton,
  QuizSkipButton,
  QuizResubmitButton,
  QuizContinueButton,
  QuizExplanation,
  QuizFeedback,
  QuizScore,
  QuizReferenceAudio,
  QuizRecordingTimer,
  QuizRecordingPlayback,
};

/** Inline component that reads context to evaluate `{$key}` interpolations. */
const QuizInterp = ({ keyName }: { keyName: QuizInterpKey }) => {
  const ctx = useQuizFormContext();
  const timerScope = useQuizRecordingTimerScope();
  if (!ctx) return null;
  const q = ctx.question;
  const fieldName = timerScope ?? "recording";
  const recording = ctx.recordingFieldName === fieldName;
  switch (keyName) {
    case "title":
      return <>{q.title}</>;
    case "explanation":
      return <>{q.explanation ?? ""}</>;
    case "reference_text":
      return <>{q.type === "speech" ? q.reference_text : ""}</>;
    case "score":
      return <>{ctx.earnedScore != null ? `${ctx.earnedScore}/${ctx.totalScore}` : `${ctx.totalScore}`}</>;
    case "earned_score":
      return <>{ctx.earnedScore ?? 0}</>;
    case "total_score":
      return <>{ctx.totalScore}</>;
    case "question_number": {
      const idx = ctx.question.question_id;
      return <>{idx}</>;
    }
    case "question_count":
      return <>{ctx.optionIds.length || ctx.blankIds.length || 1}</>;
    case "type":
      return <>{q.type}</>;
    case "recording_elapsed":
      return (
        <>
          {recording
            ? formatRecordingClock(ctx.recordingElapsedSec)
            : formatRecordingClock(0)}
        </>
      );
    case "recording_elapsed_sec":
      return <>{recording ? Math.floor(ctx.recordingElapsedSec) : 0}</>;
    case "recorded_duration":
      return <>{formatRecordingClock(ctx.recordedDurationSec)}</>;
    case "recorded_duration_sec":
      return <>{Math.floor(ctx.recordedDurationSec)}</>;
    default:
      return null;
  }
};

/**
 * Layout-editor instrumentation flag. When true, every rendered AST node is
 * wrapped in a `display: contents` span carrying `data-quiz-ast-path`, so the
 * editor can resolve clicks and measure highlight rects WITHOUT perturbing the
 * production flex/grid layout (a `display: contents` box generates no layout
 * box of its own). Selection visuals and click handling live in the stage
 * overlay via event delegation — the renderer stays a pure projection.
 */
export type QuizRendererEditorMode = boolean;

/** A box that does not participate in layout; purely an addressing anchor. */
const CONTENTS_STYLE: CSSProperties = { display: "contents" };

const joinChildPath = (parentPath: string, index: number): string => {
  const seg = `children[${index}]`;
  return parentPath ? `${parentPath}.${seg}` : seg;
};

const wrapEditorShell = (
  path: string,
  node: ReactNode,
  editorMode: QuizRendererEditorMode | undefined,
): ReactNode => {
  if (!editorMode) return node;
  return (
    <span data-quiz-ast-path={path} style={CONTENTS_STYLE}>
      {node}
    </span>
  );
};

const renderChildren = (
  children: QuizAstNode[],
  parentPath: string,
  editorMode?: QuizRendererEditorMode,
): ReactNode =>
  children.map((child, index) => (
    <Fragment key={index}>{renderNode(child, joinChildPath(parentPath, index), editorMode)}</Fragment>
  ));

const propsForRender = (
  raw: Record<string, QuizAstPropValue>,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "style" || key === "recordingStyle") {
      out[key] = normalizeQuizAstStyle(value);
      continue;
    }
    out[key] = value;
  }
  return out;
};

const renderHtmlTag = (
  tag: QuizHtmlTag,
  props: Record<string, QuizAstPropValue>,
  children: QuizAstNode[],
  path: string,
  editorMode?: QuizRendererEditorMode,
): ReactNode => {
  const reactProps = propsForRender(props);
  if (tag === "img") {
    return wrapEditorShell(path, createElement(tag, reactProps), editorMode);
  }
  if (tag === "hr" || tag === "br") {
    return wrapEditorShell(path, createElement(tag, reactProps), editorMode);
  }
  return wrapEditorShell(
    path,
    createElement(tag, reactProps, renderChildren(children, path, editorMode)),
    editorMode,
  );
};

const renderFunctionalTag = (
  tag: Exclude<QuizFunctionalTag, "QuizContainer" | "QuizShadowingControl">,
  props: Record<string, QuizAstPropValue>,
  children: QuizAstNode[],
  path: string,
  editorMode?: QuizRendererEditorMode,
): ReactNode => {
  const Component = FUNCTIONAL_COMPONENTS[tag];
  if (!Component) return null;
  return wrapEditorShell(
    path,
    createElement(
      Component,
      propsForRender(props),
      renderChildren(children, path, editorMode),
    ),
    editorMode,
  );
};

const renderShadowingControl = (
  node: Extract<QuizAstNode, { kind: "element" }> & { tag: "QuizShadowingControl" },
  path: string,
  editorMode?: QuizRendererEditorMode,
): ReactNode =>
  wrapEditorShell(
    path,
    <QuizShadowingControlAst
      node={node}
      renderChildren={(branchChildren) => renderChildren(branchChildren, path, editorMode)}
    />,
    editorMode,
  );

const renderNode = (
  node: QuizAstNode,
  path: string,
  editorMode?: QuizRendererEditorMode,
): ReactNode => {
  if (node.kind === "text") {
    return wrapEditorShell(path, node.text, editorMode);
  }
  if (node.kind === "interp") {
    return wrapEditorShell(path, <QuizInterp keyName={node.key} />, editorMode);
  }
  if (node.kind === "stateBranch") {
    // Conditional branches render nothing inline; surfaced separately in editor.
    return null;
  }
  if (node.kind !== "element") return null;
  if (node.tag === "QuizContainer") {
    return renderChildren(node.children, path, editorMode);
  }
  if (node.tag === "QuizShadowingControl") {
    return renderShadowingControl(
      node as Extract<QuizAstNode, { kind: "element" }> & { tag: "QuizShadowingControl" },
      path,
      editorMode,
    );
  }
  if (isQuizFunctionalTag(node.tag)) {
    return renderFunctionalTag(
      node.tag as Exclude<QuizFunctionalTag, "QuizContainer" | "QuizShadowingControl">,
      node.props,
      node.children,
      path,
      editorMode,
    );
  }
  if (isQuizHtmlTag(node.tag)) {
    return renderHtmlTag(node.tag, node.props, node.children, path, editorMode);
  }
  return null;
};

export interface QuizRendererProps extends QuizContainerHostHooks {
  question: QuizQuestion;
  /**
   * Host-controlled quiz runtime state. When supplied, the inner
   * `QuizContainer` becomes a controlled component (submission, score,
   * feedback, advance gate are all driven by the host).
   */
  state?: QuizRuntimeState;
  /** Host-owned choice / blank values (preview reload sync). */
  selection?: QuizContainerSelectionState;
  /** Choice toggle callback paired with `selection`. */
  onToggleOption?: (optionId: string) => void;
  /** Host recorder state for shadowing / speech. */
  recording?: QuizContainerRecordingState;
  /** Override the container's props inferred from the AST root. */
  containerClassName?: string;
  containerStyle?: React.CSSProperties;
  /** Layout editor: selectable AST nodes with `data-quiz-ast-path`. */
  editorMode?: QuizRendererEditorMode;
}

/**
 * Render a quiz question's `react_layout`, wrapped in {@link QuizContainer}.
 *
 * The root AST node must be `<QuizContainer>` (enforced by the AST validator).
 * Its `style={...}` and `padding`/`gap` props are merged into the host
 * `QuizContainer` element so authors can size the layout from JSX.
 */
export const QuizRenderer = ({
  question,
  state,
  selection,
  onToggleOption,
  recording,
  containerClassName,
  containerStyle,
  editorMode,
  ...hostHooks
}: QuizRendererProps) => {
  const { t } = useI18nNew();
  const root = question.react_layout;
  if (!root || root.kind !== "element" || root.tag !== "QuizContainer") {
    return (
      <div data-quiz-slot="invalid-ast" role="alert">
        {t("coursewarePreview.quiz.invalidLayout")}
      </div>
    );
  }
  const padding =
    typeof root.props.padding === "number" || typeof root.props.padding === "string"
      ? (root.props.padding as number | string)
      : undefined;
  const gap =
    typeof root.props.gap === "number" || typeof root.props.gap === "string"
      ? (root.props.gap as number | string)
      : undefined;
  const className = [
    containerClassName,
    typeof root.props.className === "string" ? root.props.className : undefined,
  ]
    .filter(Boolean)
    .join(" ")
    .trim() || undefined;
  const style = {
    ...normalizeQuizAstStyle(root.props.style),
    ...containerStyle,
  };

  return (
    <QuizContainer
      question={question}
      state={state}
      selection={selection}
      onToggleOption={onToggleOption}
      recording={recording}
      padding={padding}
      gap={gap}
      className={className}
      style={style}
      editorReveal={Boolean(editorMode)}
      {...hostHooks}
    >
      {renderChildren(root.children, "", editorMode)}
    </QuizContainer>
  );
};
