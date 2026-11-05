// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TTS style catalog (pure functions).
 *
 * Recommended presets (defined in code, tone words only) + free-text styles (the field has two uses: a preset key or
 * the raw prompt text). The original 848-entry persona catalog is retired (PR #970), replaced by free text.
 */

/** Default style key of agent / MCP narration */
export const DEFAULT_TTS_STYLE_KEY = "friendly_teacher";

/** Recommended tone presets (multilingual-safe, short prompts, stable keys) */
export const RECOMMENDED_TTS_STYLES: ReadonlyArray<{
  style_key: string;
  label: string;
  label_en: string;
  label_ja: string;
  prompt: string;
}> = [
  {
    style_key: "friendly_teacher",
    label: "亲切教学",
    label_en: "Friendly Teacher",
    label_ja: "親しみやすい先生",
    prompt: "Speak like a warm, friendly teacher; clear, encouraging and patient.",
  },
  {
    style_key: "authoritative_professor",
    label: "权威讲解",
    label_en: "Authoritative Professor",
    label_ja: "権威ある解説",
    prompt:
      "Speak like an authoritative, knowledgeable professor; measured, confident and precise.",
  },
  {
    style_key: "lively_narrator",
    label: "活泼讲解",
    label_en: "Lively Narrator",
    label_ja: "活発な解説",
    prompt: "Lively, upbeat and energetic delivery, like an enthusiastic presenter.",
  },
  {
    style_key: "calm_storyteller",
    label: "沉稳叙事",
    label_en: "Calm Storyteller",
    label_ja: "落ち着いた語り",
    prompt: "Calm, gentle storytelling delivery; soothing and steady.",
  },
  {
    style_key: "professional_anchor",
    label: "专业播音",
    label_en: "Professional Anchor",
    label_ja: "プロのアナウンス",
    prompt: "Professional news-anchor clarity; neutral, composed and well-paced.",
  },
  {
    style_key: "playful_host",
    label: "趣味主持",
    label_en: "Playful Host",
    label_ja: "楽しい司会",
    prompt: "Playful, humorous delivery with variety-show energy.",
  },
  {
    style_key: "serious_formal",
    label: "严肃正式",
    label_en: "Serious Formal",
    label_ja: "厳粛・フォーマル",
    prompt: "Serious, formal announcement tone; firm and deliberate.",
  },
  {
    style_key: "soft_gentle",
    label: "轻柔平和",
    label_en: "Soft Gentle",
    label_ja: "ソフトで穏やか",
    prompt: "Soft, gentle and soothing delivery; relaxed and unhurried.",
  },
];

/** Length cap of free-text style prompts (after whitespace collapsing) */
export const MAX_TTS_STYLE_LENGTH = 200;

function normalizeCustomStyle(text: string): string {
  // " ".join(text.split()): collapse any whitespace + trim both ends
  return text.trim().split(/\s+/).join(" ").slice(0, MAX_TTS_STYLE_LENGTH);
}

/** Whether it's a known style key (one of the recommended presets) */
export function isKnownStyleKey(styleKey: string | null | undefined): boolean {
  const key = (styleKey ?? "").trim();
  if (!key) {
    return false;
  }
  return RECOMMENDED_TTS_STYLES.some((preset) => preset.style_key === key);
}

/**
 * Style value → prompt text. The field has two uses: a recommended preset key or free text
 * (unknown values are treated as raw prompt text — a product decision); empty values fall back to the default preset
 * (the default key itself resolves to null, avoiding layering a prompt onto agent narration).
 */
export function getStylePrompt(styleKey: string | null | undefined): string | null {
  let key = (styleKey ?? "").trim();
  if (!key) {
    key = DEFAULT_TTS_STYLE_KEY;
  }
  for (const preset of RECOMMENDED_TTS_STYLES) {
    if (preset.style_key === key) {
      return preset.prompt;
    }
  }
  if (key === DEFAULT_TTS_STYLE_KEY) {
    return null;
  }
  // Unknown value → free-text style prompt
  return normalizeCustomStyle(key);
}
