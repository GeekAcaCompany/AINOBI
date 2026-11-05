// SPDX-License-Identifier: AGPL-3.0-only
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  SUPPORTED_LANGUAGES,
  translate,
  type SupportedLanguage,
  type TranslationKey,
} from "../lib/i18n/index.ts";
import {
  resolveInitialUiLanguage,
  detectBrowserLanguage,
  clearStoredUiLanguage,
  writeStoredUiLanguage,
} from "../lib/i18n/ui-language-preference.ts";

export type NewTranslationKey = TranslationKey;

interface I18nNewContextValue {
  language: SupportedLanguage;
  availableLanguages: readonly SupportedLanguage[];
  setLanguage: (language: SupportedLanguage) => void;
  resetLanguageToSystem: () => void;
  t: (key: NewTranslationKey, variables?: Record<string, string | number>) => string;
}

const I18nNewContext = createContext<I18nNewContextValue | null>(null);

function translateNew(
  language: SupportedLanguage,
  key: NewTranslationKey,
  variables?: Record<string, string | number>
) {
  return translate(language, key, variables);
}

export function I18nNewProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<SupportedLanguage>(
    () => resolveInitialUiLanguage(),
  );

  const setLanguage = useCallback((next: SupportedLanguage) => {
    writeStoredUiLanguage(next);
    setLanguageState(next);
  }, []);

  const resetLanguageToSystem = useCallback(() => {
    clearStoredUiLanguage();
    setLanguageState(detectBrowserLanguage());
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = language;
    }
  }, [language]);

  const t = useCallback(
    (key: NewTranslationKey, variables?: Record<string, string | number>) => {
      return translateNew(language, key, variables);
    },
    [language]
  );

  const value = useMemo<I18nNewContextValue>(
    () => ({
      language,
      availableLanguages: SUPPORTED_LANGUAGES,
      setLanguage,
      resetLanguageToSystem,
      t,
    }),
    [language, setLanguage, resetLanguageToSystem, t]
  );

  return <I18nNewContext.Provider value={value}>{children}</I18nNewContext.Provider>;
}

/**
 * Hook to use new translation files (zh_new.json, en_new.json, ja_new.json)
 *
 * Priority: I18nNewProvider context > stored preference > browser language.
 */
export function useI18nNew() {
  const newContext = useContext(I18nNewContext);
  const language = newContext?.language ?? resolveInitialUiLanguage();
  const setLanguage = newContext?.setLanguage ?? (() => {});
  const resetLanguageToSystem = newContext?.resetLanguageToSystem ?? (() => {});
  const availableLanguages = newContext?.availableLanguages ?? SUPPORTED_LANGUAGES;

  const t = useCallback(
    (key: NewTranslationKey, variables?: Record<string, string | number>) => {
      return translateNew(language, key, variables);
    },
    [language]
  );

  const fallbackValue = useMemo(
    () => ({ language, availableLanguages, setLanguage, resetLanguageToSystem, t }),
    [language, availableLanguages, setLanguage, resetLanguageToSystem, t]
  );

  return newContext ?? fallbackValue;
}
