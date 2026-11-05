// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Platform TTS catalog row (global voice pool under /organization/{org}/tts/*).
 */
export type PlatformTtsVoice = {
  tts_id: string;
  tts_name: string;
  tts_provider: string;
  tts_model: string;
  tts_voice: string;
  tts_language?: string | null;
  tts_speed?: number | null;
  tts_volume?: number | null;
  tts_pitch?: number | null;
  tts_status?: string | null;
};

export const normalizeTtsVoice = (raw: unknown): PlatformTtsVoice | null => {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const ttsId = typeof row.tts_id === "string" ? row.tts_id.trim() : "";
  const ttsName = typeof row.tts_name === "string" ? row.tts_name.trim() : "";
  const ttsProvider =
    typeof row.tts_provider === "string" ? row.tts_provider.trim().toLowerCase() : "";
  const ttsModel = typeof row.tts_model === "string" ? row.tts_model.trim() : "";
  const ttsVoice = typeof row.tts_voice === "string" ? row.tts_voice.trim() : "";
  if (!ttsId || !ttsName || !ttsProvider || !ttsModel || !ttsVoice) return null;
  return {
    tts_id: ttsId,
    tts_name: ttsName,
    tts_provider: ttsProvider,
    tts_model: ttsModel,
    tts_voice: ttsVoice,
    ...(typeof row.tts_language === "string" ? { tts_language: row.tts_language.trim() } : {}),
    ...(typeof row.tts_speed === "number" && Number.isFinite(row.tts_speed)
      ? { tts_speed: row.tts_speed }
      : {}),
    ...(typeof row.tts_volume === "number" && Number.isFinite(row.tts_volume)
      ? { tts_volume: row.tts_volume }
      : {}),
    ...(typeof row.tts_pitch === "number" && Number.isFinite(row.tts_pitch)
      ? { tts_pitch: row.tts_pitch }
      : {}),
    ...(typeof row.tts_status === "string" ? { tts_status: row.tts_status.trim() } : {}),
  };
};

export const normalizeTtsVoiceList = (raw: unknown): PlatformTtsVoice[] => {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const voice = normalizeTtsVoice(item);
    return voice ? [voice] : [];
  });
};

export const findTtsVoiceById = (
  voices: readonly PlatformTtsVoice[],
  ttsId: string,
): PlatformTtsVoice | undefined => {
  const id = ttsId.trim();
  if (!id) return undefined;
  return voices.find((voice) => voice.tts_id === id);
};
