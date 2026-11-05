// SPDX-License-Identifier: AGPL-3.0-only
export const TEMPLATE_EXTRACT_LANGUAGES = ["auto", "zh", "en", "ja"] as const;

export type TemplateExtractLanguage = (typeof TEMPLATE_EXTRACT_LANGUAGES)[number];

export function normalizeTemplateExtractLanguage(
  value: string | null | undefined,
): TemplateExtractLanguage {
  const raw = value?.trim().toLowerCase();
  if (raw === "zh" || raw === "en" || raw === "ja" || raw === "auto") {
    return raw;
  }
  return "auto";
}
