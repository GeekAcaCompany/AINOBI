// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Recursive renderer for `scene.quiz.score_summary.react_layout`.
 */

import { createElement, Fragment, type CSSProperties, type ReactNode } from "react";

import type { QuizAstPropValue } from "@ainobi/courseware-core/quiz-ast.ts";
import {
  isQuizHtmlTag,
  isQuizScoreSummaryFunctionalTag,
  isQuizScoreSummaryInterpKey,
  type QuizScoreSummaryAstNode,
  type QuizScoreSummaryFunctionalTag,
  type QuizScoreSummaryInterpKey,
} from "@ainobi/courseware-core/quiz-score-summary-ast.ts";
import type { QuizHtmlTag } from "@ainobi/courseware-core/quiz-ast.ts";
import type { QuizAggregateScoreSnapshot } from "@ainobi/courseware-core/quiz-score-summary.ts";
import { normalizeQuizAstStyle } from "../quiz/quiz-style-allowlist.ts";

import { QuizGradeDescription } from "./QuizGradeDescription.tsx";
import { QuizGradeLabel } from "./QuizGradeLabel.tsx";
import { QuizScoreSummaryContainer } from "./QuizScoreSummaryContainer.tsx";
import { QuizTotalScore } from "./QuizTotalScore.tsx";
import { useRequiredQuizScoreSummaryContext } from "./QuizScoreSummaryContext.tsx";

const FUNCTIONAL_COMPONENTS: Record<
  Exclude<QuizScoreSummaryFunctionalTag, "QuizScoreSummaryContainer">,
  React.ComponentType<Record<string, unknown>>
> = {
  QuizTotalScore,
  QuizGradeLabel,
  QuizGradeDescription,
};

const ScoreSummaryInterp = ({ keyName }: { keyName: QuizScoreSummaryInterpKey }) => {
  const { snapshot } = useRequiredQuizScoreSummaryContext();
  switch (keyName) {
    case "earned_score":
      return <>{snapshot.earnedScore}</>;
    case "total_score":
      return <>{snapshot.totalScore}</>;
    case "score":
      return (
        <>
          {snapshot.earnedScore}/{snapshot.totalScore}
        </>
      );
    case "grade_label":
      return <>{snapshot.gradeLevel?.label ?? ""}</>;
    case "grade_description":
      return <>{snapshot.gradeLevel?.description ?? ""}</>;
    case "question_count":
      return <>{snapshot.questionCount}</>;
    case "answered_count":
      return <>{snapshot.answeredCount}</>;
    default:
      return null;
  }
};

const renderChildren = (children: QuizScoreSummaryAstNode[]): ReactNode =>
  children.map((child, index) => <Fragment key={index}>{renderNode(child)}</Fragment>);

const propsForRender = (raw: Record<string, QuizAstPropValue>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "style") {
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
  children: QuizScoreSummaryAstNode[],
): ReactNode => {
  const reactProps = propsForRender(props);
  if (tag === "img" || tag === "hr" || tag === "br") {
    return createElement(tag, reactProps);
  }
  return createElement(tag, reactProps, renderChildren(children));
};

const renderFunctionalTag = (
  tag: Exclude<QuizScoreSummaryFunctionalTag, "QuizScoreSummaryContainer">,
  props: Record<string, QuizAstPropValue>,
  children: QuizScoreSummaryAstNode[],
): ReactNode => {
  const Component = FUNCTIONAL_COMPONENTS[tag];
  if (!Component) return null;
  return createElement(Component, propsForRender(props), renderChildren(children));
};

const renderNode = (node: QuizScoreSummaryAstNode): ReactNode => {
  if (node.kind === "text") return node.text;
  if (node.kind === "interp") {
    if (!isQuizScoreSummaryInterpKey(node.key)) return null;
    return <ScoreSummaryInterp keyName={node.key} />;
  }
  if (node.kind !== "element") return null;
  if (node.tag === "QuizScoreSummaryContainer") {
    return renderChildren(node.children);
  }
  if (isQuizScoreSummaryFunctionalTag(node.tag)) {
    return renderFunctionalTag(
      node.tag as Exclude<QuizScoreSummaryFunctionalTag, "QuizScoreSummaryContainer">,
      node.props,
      node.children,
    );
  }
  if (isQuizHtmlTag(node.tag)) {
    return renderHtmlTag(node.tag, node.props, node.children);
  }
  return null;
};

export interface QuizScoreSummaryRendererProps {
  reactLayout: QuizScoreSummaryAstNode;
  snapshot: QuizAggregateScoreSnapshot;
  containerClassName?: string;
  containerStyle?: CSSProperties;
}

export const QuizScoreSummaryRenderer = ({
  reactLayout,
  snapshot,
  containerClassName,
  containerStyle,
}: QuizScoreSummaryRendererProps) => {
  const root = reactLayout;
  if (!root || root.kind !== "element" || root.tag !== "QuizScoreSummaryContainer") {
    return null;
  }
  const rootProps = propsForRender(root.props);
  const padding = rootProps.padding as number | string | undefined;
  const gap = rootProps.gap as number | string | undefined;
  const rootStyle = normalizeQuizAstStyle(rootProps.style);
  return (
    <QuizScoreSummaryContainer
      snapshot={snapshot}
      padding={padding}
      gap={gap}
      className={containerClassName}
      style={{ ...rootStyle, ...containerStyle }}
      id={typeof rootProps.id === "string" ? rootProps.id : undefined}
    >
      {renderChildren(root.children)}
    </QuizScoreSummaryContainer>
  );
};
