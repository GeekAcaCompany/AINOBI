// SPDX-License-Identifier: AGPL-3.0-only
import coursewareAssetsApi from "@ainobi/courseware-player/api/courseware_assets";

export const measureQuizAudioDurationMs = (url: string): Promise<number> =>
  new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(0);
      return;
    }
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = url;
    let settled = false;
    const finish = (ms: number): void => {
      if (settled) return;
      settled = true;
      resolve(Math.max(0, ms));
    };
    audio.onloadedmetadata = () => {
      const seconds = Number.isFinite(audio.duration) ? audio.duration : 0;
      finish(seconds * 1000);
    };
    audio.onerror = () => finish(0);
    setTimeout(() => finish(0), 8000);
  });

/** The same TTS pipeline as avatar narration: generate the read-aloud audio of question content and return a playable URL and duration. */
export async function generateQuizQuestionContentTts(params: {
  coursewareId: string;
  text: string;
  ttsId: string;
  teacherId: string;
  speechRate: number;
}): Promise<{ audio_url: string; duration_ms: number }> {
  const { tts_url: ttsUrl } = await coursewareAssetsApi.synthesizeAiTeacherTts({
    coursewareId: params.coursewareId,
    text: params.text,
    format: "mp3",
    aiTeacherId: params.teacherId,
    speechRate: params.speechRate,
  });
  const signedByOriginal = await coursewareAssetsApi.batchPresignUrls(params.coursewareId, [ttsUrl]);
  const playableUrl = signedByOriginal[ttsUrl] ?? ttsUrl;
  const durationMs = await measureQuizAudioDurationMs(playableUrl);
  return {
    audio_url: playableUrl,
    duration_ms: Math.max(200, Math.round(durationMs || 1500)),
  };
}
