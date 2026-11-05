// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Recommended TTS style presets — the agent-facing subset of the platform's
 * style catalog (configs/tts_styles.json in the backend). Mirrors the backend
 * RECOMMENDED_TTS_STYLES; the full persona catalog is human-facing only.
 */

export type TtsStylePreset = {
  style_key: string;
  label: string;
  prompt: string;
};

export const RECOMMENDED_TTS_STYLE_PRESETS: readonly TtsStylePreset[] = [
  { style_key: "friendly_teacher", label: "亲切教学", prompt: "Speak like a warm, friendly teacher; clear, encouraging and patient." },
  { style_key: "authoritative_professor", label: "权威讲解", prompt: "Speak like an authoritative, knowledgeable professor; measured, confident and precise." },
  { style_key: "lively_narrator", label: "活泼讲解", prompt: "Lively, upbeat and energetic delivery, like an enthusiastic presenter." },
  { style_key: "calm_storyteller", label: "沉稳叙事", prompt: "Calm, gentle storytelling delivery; soothing and steady." },
  { style_key: "professional_anchor", label: "专业播音", prompt: "Professional news-anchor clarity; neutral, composed and well-paced." },
  { style_key: "playful_host", label: "趣味主持", prompt: "Playful, humorous delivery with variety-show energy." },
  { style_key: "serious_formal", label: "严肃正式", prompt: "Serious, formal announcement tone; firm and deliberate." },
  { style_key: "soft_gentle", label: "轻柔平和", prompt: "Soft, gentle and soothing delivery; relaxed and unhurried." },
];

export const DEFAULT_TTS_STYLE_PRESET = RECOMMENDED_TTS_STYLE_PRESETS[0];

/** Recommended preset key -> prompt; null for unknown (non-recommended) keys. */
export const resolveRecommendedTtsStylePrompt = (
  key: string | null | undefined,
): string | null => {
  const trimmed = key?.trim();
  if (!trimmed) return null;
  return (
    RECOMMENDED_TTS_STYLE_PRESETS.find((preset) => preset.style_key === trimmed)
      ?.prompt ?? null
  );
};

/**
 * Dual-purpose resolution (mirrors the backend get_style_prompt): a
 * recommended preset key resolves to its prompt; any other non-empty value is
 * treated as a custom free-text style prompt (whitespace-collapsed, 200 cap).
 */
export const resolveTtsStylePrompt = (
  keyOrText: string | null | undefined,
): string | null => {
  const trimmed = keyOrText?.trim();
  if (!trimmed) return null;
  return (
    resolveRecommendedTtsStylePrompt(trimmed) ??
    trimmed.replace(/\s+/g, " ").slice(0, 200)
  );
};
