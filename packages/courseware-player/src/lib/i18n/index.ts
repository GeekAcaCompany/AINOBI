// SPDX-License-Identifier: AGPL-3.0-only
import enBase from "./languages/en_new.json";
import jaBase from "./languages/ja_new.json";
import zhBase from "./languages/zh_new.json";
import coursewareRoutesEn from "./messages/coursewareRoutes.en.json";
import coursewareRoutesJa from "./messages/coursewareRoutes.ja.json";
import coursewareRoutesZh from "./messages/coursewareRoutes.zh.json";

export const SUPPORTED_LANGUAGES = ["zh", "en", "ja"] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const defaultLanguage: SupportedLanguage = "en";

const zhTranslations = { ...zhBase, ...coursewareRoutesZh };
const enTranslations = { ...enBase, ...coursewareRoutesEn };
const jaTranslations = { ...jaBase, ...coursewareRoutesJa };

export type TranslationDictionary = typeof zhTranslations;
export type TranslationKey = keyof TranslationDictionary;

export const translations = {
  zh: zhTranslations,
  en: enTranslations,
  ja: jaTranslations,
} satisfies Record<SupportedLanguage, TranslationDictionary>;

function format(template: string, variables?: Record<string, string | number>) {
  if (!variables) {
    return template;
  }

  return Object.entries(variables).reduce((result, [key, value]) => {
    return result.replaceAll(`{${key}}`, String(value));
  }, template);
}

export function translate(
  language: SupportedLanguage,
  key: TranslationKey,
  variables?: Record<string, string | number>
) {
  const dictionary = translations[language] ?? translations[defaultLanguage];
  const fallbackDictionary = translations[defaultLanguage];

  const template = dictionary[key] ?? fallbackDictionary[key] ?? key;
  return format(template, variables);
}
