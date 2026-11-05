// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, type CSSProperties } from "react";

import { useQuizFormContext } from "./QuizFormContext.tsx";
import { formatRecordingClock } from "./quiz-recording-format.ts";
import { useI18nNew } from "../../../hooks/useI18nNew.tsx";

export interface QuizRecordingPlaybackProps {
  /** Must match the paired {@link QuizShadowingControl} `name` (default `"recording"`). */
  name?: string;
  className?: string;
  style?: CSSProperties;
  id?: string;
}

const DEFAULT_FIELD = "recording";

/**
 * Plays back the learner's latest recording for shadowing / speech questions.
 * Pair with {@link QuizShadowingControl}; renders nothing until a take exists.
 */
export const QuizRecordingPlayback = ({
  name = DEFAULT_FIELD,
  className,
  style,
  id,
}: QuizRecordingPlaybackProps) => {
  const { t } = useI18nNew();
  const ctx = useQuizFormContext();
  const recording = ctx?.recordingFieldName === name;
  const url = ctx?.recordedBlobUrl;
  const knownDurationSec = ctx?.recordedDurationSec ?? 0;
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!url || !el) return;

    // Only prime once per blob URL. `canplay` repeats during play/seek and must not reset the playhead.
    const onLoadedMetadata = () => {
      try {
        if (el.currentTime > 0.01) el.currentTime = 0;
      } catch {
        /* not seekable yet */
      }
    };

    el.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
    el.preload = "auto";
    el.load();

    return () => {
      el.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
  }, [url]);

  if (!ctx || !url || recording) return null;

  const durationLabel =
    knownDurationSec > 0 ? formatRecordingClock(knownDurationSec) : "0:00";

  return (
    <div
      id={id}
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        width: "100%",
        maxWidth: 420,
        ...style,
      }}
      data-quiz-slot="recording-playback"
      data-quiz-recording-field={name}
    >
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "#6b6b65",
        }}
      >
        {t("coursewarePreview.quiz.recordingPlayback", { duration: durationLabel })}
      </span>
      <audio
        ref={audioRef}
        controls
        preload="auto"
        src={url}
        style={{
          width: "100%",
          height: 40,
        }}
        data-quiz-action="play-recording"
      />
    </div>
  );
};
