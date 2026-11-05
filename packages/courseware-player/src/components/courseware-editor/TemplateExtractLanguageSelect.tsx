// SPDX-License-Identifier: AGPL-3.0-only
import { useI18nNew } from "../../hooks/useI18nNew.tsx";
import {
  TEMPLATE_EXTRACT_LANGUAGES,
  type TemplateExtractLanguage,
} from "../../lib/courseware/template-extract-language.ts";

const LANGUAGE_LABEL_KEYS = {
  auto: "coursewareEditor.templateExtract.languageAuto",
  zh: "coursewareEditor.templateExtract.languageZh",
  en: "coursewareEditor.templateExtract.languageEn",
  ja: "coursewareEditor.templateExtract.languageJa",
} as const;

export function TemplateExtractLanguageSelect({
  value,
  onChange,
}: {
  value: TemplateExtractLanguage;
  onChange: (language: TemplateExtractLanguage) => void;
}) {
  const { t } = useI18nNew();

  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
        {t("coursewareEditor.templateExtract.languageLabel")}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as TemplateExtractLanguage)}
        className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 outline-none focus:border-violet-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
      >
        {TEMPLATE_EXTRACT_LANGUAGES.map((lang) => (
          <option key={lang} value={lang}>
            {t(LANGUAGE_LABEL_KEYS[lang])}
          </option>
        ))}
      </select>
    </label>
  );
}
