// SPDX-License-Identifier: AGPL-3.0-only
import { type CSSProperties, type ReactNode } from "react";

import { useQuizFormContext } from "./QuizFormContext.tsx";
import { formatRecordingClock } from "./quiz-recording-format.ts";
import { QuizRecordingTimerScope } from "./QuizRecordingTimerScope.tsx";

export interface QuizRecordingTimerProps {
  /** Must match the paired {@link QuizShadowingControl} `name` (default `"recording"`). */
  name?: string;
  /** When true (default), hidden until recording starts on `name`. */
  hideWhenIdle?: boolean;
  className?: string;
  style?: CSSProperties;
  id?: string;
  children?: ReactNode;
}

const DEFAULT_FIELD = "recording";

/**
 * Live recording clock for shadowing / speech. Renders AST `children` when
 * provided (use `{$recording_elapsed}` / `{$recorded_duration}` in text).
 * With no children, shows `m:ss` from the host recorder.
 */
export const QuizRecordingTimer = ({
  name = DEFAULT_FIELD,
  hideWhenIdle = true,
  className,
  style,
  id,
  children,
}: QuizRecordingTimerProps) => {
  const ctx = useQuizFormContext();
  const recording = ctx?.recordingFieldName === name;
  const elapsedSec = ctx?.recordingElapsedSec ?? 0;
  const recordedSec = ctx?.recordedDurationSec ?? 0;
  const hasRecorded = Boolean(ctx?.recordedBlobUrl) && recordedSec > 0;

  if (hideWhenIdle && !recording) {
    return null;
  }

  const displaySec = recording ? elapsedSec : hasRecorded ? recordedSec : 0;
  const clock = formatRecordingClock(displaySec);

  return (
    <div
      id={id}
      className={className}
      style={style}
      data-quiz-slot="recording-timer"
      data-quiz-recording-field={name}
      data-quiz-recording={recording ? "true" : "false"}
      aria-live="polite"
    >
      <QuizRecordingTimerScope name={name}>{children ?? clock}</QuizRecordingTimerScope>
    </div>
  );
};
