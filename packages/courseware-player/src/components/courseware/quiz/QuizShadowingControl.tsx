// SPDX-License-Identifier: AGPL-3.0-only
import { useState, type CSSProperties, type ReactNode } from "react";

import { useQuizFormContext } from "./QuizFormContext.tsx";
import {
  mergeQuizPrimaryButtonStyle,
  mergeQuizRecordingActiveStyle,
  resolveQuizPrimaryButtonVisualState,
} from "./quiz-button-appearance.ts";

export interface QuizShadowingControlProps {
  /** Host recording field id (defaults to `"recording"`). */
  name?: string;
  className?: string;
  /** Idle / not-recording appearance from AST. */
  style?: CSSProperties;
  /** While recording, merged on top of `style` (author-defined active look). */
  recordingStyle?: CSSProperties;
  id?: string;
  children?: ReactNode;
}

const DEFAULT_FIELD = "recording";

/**
 * Recording toggle for shadowing / speech questions. Calls the host
 * `onToggleRecord` hook (preview / player) to start/stop MediaRecorder.
 *
 * Renders only AST `children`. Set `recordingStyle={{…}}` in JSX for the
 * active-recording look (e.g. red background); no platform CSS required.
 */
export const QuizShadowingControl = ({
  name = DEFAULT_FIELD,
  className,
  style,
  recordingStyle,
  id,
  children,
}: QuizShadowingControlProps) => {
  const ctx = useQuizFormContext();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const submitted = ctx?.submitted ?? false;
  const recording = ctx?.recordingFieldName === name;
  const disabled = !ctx || submitted || !ctx.onToggleRecord;
  const visualState = resolveQuizPrimaryButtonVisualState({
    disabled,
    submitting: false,
    hovered: hovered && !disabled,
    pressed: pressed && !disabled,
  });
  const buttonStyle = recording
    ? mergeQuizRecordingActiveStyle(style, recordingStyle)
    : mergeQuizPrimaryButtonStyle(style, visualState);

  return (
    <div
      id={id}
      className={className}
      data-quiz-slot="shadowing-control"
      data-quiz-recording={recording ? "true" : "false"}
      data-quiz-submitted={submitted ? "true" : "false"}
    >
      <button
        type="button"
        style={buttonStyle}
        disabled={disabled}
        data-quiz-action={recording ? "stop-recording" : "start-recording"}
        data-quiz-state={recording ? "recording" : visualState}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => {
          setHovered(false);
          setPressed(false);
        }}
        onMouseDown={() => {
          if (!disabled) setPressed(true);
        }}
        onMouseUp={() => setPressed(false)}
        onClick={() => {
          if (!ctx?.onToggleRecord || disabled) return;
          ctx.onToggleRecord(name);
        }}
      >
        {children}
      </button>
    </div>
  );
};
