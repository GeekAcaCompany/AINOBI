// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";

import type {
  QuizQuestion,
  QuizShadowingQuestion,
  QuizSpeechQuestion,
} from "@ainobi/courseware-core/quiz.ts";

import { useQuizFormContext } from "./QuizFormContext.tsx";

export interface QuizReferenceAudioProps {
  src: string;
  loop?: boolean;
  className?: string;
  style?: CSSProperties;
  id?: string;
}

const resolveReferenceAudioSrc = (srcProp: string, question: QuizQuestion | undefined): string => {
  const fromProp = srcProp.trim();
  if (fromProp) return fromProp;
  if (question?.type === "shadowing" || question?.type === "speech") {
    return (
      question as QuizShadowingQuestion | QuizSpeechQuestion
    ).reference_audio_url.trim();
  }
  return "";
};

/**
 * Reference audio for scoring shadowing / voice questions (hidden from learners).
 * The AST may keep `<QuizReferenceAudio>` to stay in sync with `reference_audio_url`, but it isn't rendered at runtime.
 * Without a question context and with only `src` (layout preview etc.) the control can still show.
 */
export const QuizReferenceAudio = ({
  src,
  loop,
  className,
  style,
  id,
}: QuizReferenceAudioProps) => {
  const ctx = useQuizFormContext();
  // Shadowing / voice: the reference audio is only for AI scoring and isn't shown to learners
  if (ctx?.question?.type === "shadowing" || ctx?.question?.type === "speech") {
    return null;
  }
  const resolvedSrc = resolveReferenceAudioSrc(src, ctx?.question);
  if (!resolvedSrc) return null;

  return (
    <audio
      id={id}
      className={className}
      style={style}
      src={resolvedSrc}
      loop={loop}
      controls
      data-quiz-slot="reference-audio"
    />
  );
};
