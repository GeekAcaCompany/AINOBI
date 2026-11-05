// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookType,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  RotateCw,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import {
  convertPronunciationPreview,
  createPronunciationDictEntry,
  deletePronunciationDictEntry,
  listPronunciationDictEntries,
  updatePronunciationDictEntry,
  type PronunciationDictEntry,
  type PronunciationDictLanguage,
} from "../../api/courseware_tts_pronunciation_dict.ts";
import coursewareAssetsApi from "@ainobi/courseware-player/api/courseware_assets";
import { useI18nNew } from "@ainobi/courseware-player/hooks/useI18nNew";

type Props = {
  open: boolean;
  orgId: string | null;
  /** Aligned with the current language of the narration voice model (only zh / ja take effect) */
  defaultLanguage?: PronunciationDictLanguage;
  /** Selectable languages; both Chinese and Japanese by default. Fish Audio passes only ["ja"] */
  allowedLanguages?: PronunciationDictLanguage[];
  coursewareId: string;
  aiTeacherId: string | null;
  ttsId?: string | null;
  speechRate?: number;
  onClose: () => void;
};

type DraftForm = {
  id: string | null;
  sourceText: string;
  language: PronunciationDictLanguage;
  pronunciation: string;
};

const PAGE_SIZE = 20;

const emptyForm = (language: PronunciationDictLanguage = "zh"): DraftForm => ({
  id: null,
  sourceText: "",
  language,
  pronunciation: "",
});

export function NarrationPronunciationDictModal({
  open,
  orgId,
  defaultLanguage = "zh",
  allowedLanguages = ["zh", "ja"],
  coursewareId,
  aiTeacherId,
  ttsId = "",
  speechRate = 1,
  onClose,
}: Props) {
  const { t } = useI18nNew();
  const languageOptions: PronunciationDictLanguage[] =
    allowedLanguages.length > 0 ? allowedLanguages : ["zh", "ja"];
  const resolvedDefaultLanguage: PronunciationDictLanguage = languageOptions.includes(
    defaultLanguage,
  )
    ? defaultLanguage
    : (languageOptions[0] ?? "zh");
  const safeTtsId = typeof ttsId === "string" ? ttsId.trim() : "";
  const [items, setItems] = useState<PronunciationDictEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [form, setForm] = useState<DraftForm>(() => emptyForm(resolvedDefaultLanguage));
  const [error, setError] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const stopPreviewAudio = useCallback(() => {
    const audio = previewAudioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    previewAudioRef.current = null;
  }, []);

  const reload = useCallback(
    async (pageToLoad: number) => {
      if (!orgId?.trim()) {
        setItems([]);
        setTotal(0);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await listPronunciationDictEntries({
          orgId,
          page: pageToLoad,
          pageSize: PAGE_SIZE,
        });
        setItems(result.items);
        setTotal(result.total);
        // Fall back when the current page exceeds the total pages (may happen after a delete)
        const maxPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE) || 1);
        if (pageToLoad > maxPage) {
          setPage(maxPage);
        }
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : t("coursewareEditor.narration.pronDict.loadFailed");
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [orgId, t],
  );

  useEffect(() => {
    if (!open) {
      stopPreviewAudio();
      return;
    }
    setForm(emptyForm(resolvedDefaultLanguage));
    setPage(1);
  }, [open, resolvedDefaultLanguage, stopPreviewAudio]);

  useEffect(() => {
    if (!open) return;
    void reload(page);
  }, [open, page, reload]);

  if (!open) return null;

  const startEdit = (entry: PronunciationDictEntry) => {
    setForm({
      id: entry.id,
      sourceText: entry.sourceText,
      language: entry.language,
      pronunciation: entry.pronunciation,
    });
  };

  const resetForm = () => setForm(emptyForm(resolvedDefaultLanguage));

  const handleConvert = async () => {
    if (!orgId?.trim() || !form.sourceText.trim()) return;
    setConverting(true);
    try {
      const result = await convertPronunciationPreview({
        orgId,
        text: form.sourceText,
        language: form.language,
      });
      setForm((prev) => ({ ...prev, pronunciation: result.pronunciation }));
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("coursewareEditor.narration.pronDict.convertFailed"),
      );
    } finally {
      setConverting(false);
    }
  };

  const handlePreview = async () => {
    const sourceText = form.sourceText.trim();
    if (!sourceText) {
      toast.error(t("coursewareEditor.narration.pronDict.sourceRequired"));
      return;
    }
    if (!aiTeacherId?.trim() || !safeTtsId) {
      toast.error(t("coursewareEditor.narration.pronDict.previewNeedVoice"));
      return;
    }
    setPreviewing(true);
    try {
      let pronunciation = form.pronunciation.trim();
      // Convert automatically only when the reading is empty (including when it was cleared after the source/language changed); hand edits by the user aren't overwritten
      if (!pronunciation) {
        if (!orgId?.trim()) {
          toast.error(t("coursewareEditor.narration.pronDict.needOrg"));
          return;
        }
        const converted = await convertPronunciationPreview({
          orgId,
          text: sourceText,
          language: form.language,
        });
        pronunciation = (converted.pronunciation ?? "").trim();
        setForm((prev) => ({ ...prev, pronunciation }));
      }
      if (!pronunciation) {
        toast.error(t("coursewareEditor.narration.pronDict.convertFailed"));
        return;
      }

      const ttsResult = await coursewareAssetsApi.synthesizeAiTeacherTts({
        coursewareId,
        text: sourceText,
        aiTeacherId: aiTeacherId.trim(),
        ttsId: safeTtsId,
        speechRate,
        format: "mp3",
        pronunciationOverride: {
          sourceText,
          language: form.language,
          pronunciation,
        },
      });
      const signed = await coursewareAssetsApi.batchPresignUrls(coursewareId, [
        ttsResult.tts_url,
      ]);
      const playableUrl = signed[ttsResult.tts_url] ?? ttsResult.tts_url;
      stopPreviewAudio();
      const audio = new Audio(playableUrl);
      previewAudioRef.current = audio;
      await audio.play();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("coursewareEditor.narration.pronDict.previewFailed"),
      );
    } finally {
      setPreviewing(false);
    }
  };

  const handleSave = async () => {
    if (!orgId?.trim()) return;
    if (!form.sourceText.trim()) {
      toast.error(t("coursewareEditor.narration.pronDict.sourceRequired"));
      return;
    }
    setSaving(true);
    try {
      if (form.id) {
        await updatePronunciationDictEntry({
          orgId,
          id: form.id,
          sourceText: form.sourceText,
          language: form.language,
          pronunciation: form.pronunciation || undefined,
          autoConvert: !form.pronunciation.trim(),
        });
        toast.success(t("coursewareEditor.narration.pronDict.updated"));
        resetForm();
        await reload(page);
      } else {
        await createPronunciationDictEntry({
          orgId,
          sourceText: form.sourceText,
          language: form.language,
          pronunciation: form.pronunciation || null,
          enabled: true,
          autoConvert: !form.pronunciation.trim(),
        });
        toast.success(t("coursewareEditor.narration.pronDict.created"));
        resetForm();
        if (page === 1) {
          await reload(1);
        } else {
          setPage(1);
        }
      }
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("coursewareEditor.narration.pronDict.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (entry: PronunciationDictEntry) => {
    if (!orgId?.trim()) return;
    try {
      await updatePronunciationDictEntry({
        orgId,
        id: entry.id,
        enabled: !entry.enabled,
      });
      await reload(page);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("coursewareEditor.narration.pronDict.saveFailed"),
      );
    }
  };

  const handleDelete = async (entry: PronunciationDictEntry) => {
    if (!orgId?.trim()) return;
    if (!window.confirm(t("coursewareEditor.narration.pronDict.deleteConfirm"))) {
      return;
    }
    try {
      await deletePronunciationDictEntry({ orgId, id: entry.id });
      if (form.id === entry.id) resetForm();
      toast.success(t("coursewareEditor.narration.pronDict.deleted"));
      const nextTotal = Math.max(0, total - 1);
      const maxPage = Math.max(1, Math.ceil(nextTotal / PAGE_SIZE) || 1);
      if (page > maxPage) {
        setPage(maxPage);
      } else {
        await reload(page);
      }
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("coursewareEditor.narration.pronDict.deleteFailed"),
      );
    }
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/45 dark:bg-slate-950/80 p-6">
      <div className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <BookType className="h-4 w-4 text-violet-700 dark:text-violet-300" />
              {t("coursewareEditor.narration.pronDict.title")}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {t("coursewareEditor.narration.pronDict.hint")}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void reload(page)}
              className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              title={t("coursewareEditor.narration.pronDict.reload")}
              aria-label={t("coursewareEditor.narration.pronDict.reload")}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCw className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200"
              aria-label={t("coursewareEditor.common.close")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto px-4 py-3">
          {!orgId?.trim() ? (
            <p className="text-xs text-slate-500">
              {t("coursewareEditor.narration.pronDict.needOrg")}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-[11px] text-slate-500">
                  {t("coursewareEditor.narration.pronDict.sourceText")}
                  <input
                    value={form.sourceText}
                    onChange={(e) => {
                      const sourceText = e.target.value;
                      setForm((prev) =>
                        prev.sourceText === sourceText
                          ? prev
                          : { ...prev, sourceText, pronunciation: "" },
                      );
                    }}
                    className="rounded bg-white dark:bg-slate-950 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none ring-1 ring-slate-300 dark:ring-slate-700"
                    placeholder={t("coursewareEditor.narration.pronDict.sourcePlaceholder")}
                  />
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-slate-500">
                  {t("coursewareEditor.narration.pronDict.language")}
                  <select
                    value={form.language}
                    onChange={(e) => {
                      const language = e.target.value as PronunciationDictLanguage;
                      setForm((prev) =>
                        prev.language === language
                          ? prev
                          : { ...prev, language, pronunciation: "" },
                      );
                    }}
                    className="rounded bg-white dark:bg-slate-950 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none ring-1 ring-slate-300 dark:ring-slate-700"
                  >
                    {languageOptions.includes("zh") ? (
                      <option value="zh">
                        {t("coursewareEditor.narration.pronDict.langZh")}
                      </option>
                    ) : null}
                    {languageOptions.includes("ja") ? (
                      <option value="ja">
                        {t("coursewareEditor.narration.pronDict.langJa")}
                      </option>
                    ) : null}
                  </select>
                </label>
                <div className="flex flex-col gap-1 text-[11px] text-slate-500 sm:col-span-2">
                  <label htmlFor="pron-dict-pronunciation">
                    {t("coursewareEditor.narration.pronDict.pronunciation")}
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="pron-dict-pronunciation"
                      value={form.pronunciation}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          pronunciation: e.target.value,
                        }))
                      }
                      className="min-w-0 flex-1 rounded bg-white dark:bg-slate-950 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none ring-1 ring-slate-300 dark:ring-slate-700"
                      placeholder={t(
                        "coursewareEditor.narration.pronDict.pronunciationPlaceholder",
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => void handleConvert()}
                      disabled={converting || previewing || !form.sourceText.trim()}
                      className="shrink-0 rounded border border-blue-300 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-800 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-200"
                    >
                      {converting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        t("coursewareEditor.narration.pronDict.autoConvert")
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handlePreview()}
                      disabled={
                        previewing ||
                        converting ||
                        !form.sourceText.trim() ||
                        !safeTtsId
                      }
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-violet-300 bg-violet-50 px-2.5 py-1.5 text-xs font-medium text-violet-800 hover:bg-violet-100 disabled:opacity-50 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-200"
                      title={t("coursewareEditor.narration.pronDict.tryListenHint")}
                    >
                      {previewing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Volume2 className="h-3.5 w-3.5" />
                      )}
                      {t("coursewareEditor.narration.pronDict.tryListen")}
                    </button>
                  </div>
                  <p className="text-[10px] leading-relaxed text-slate-400 dark:text-slate-500">
                    {t("coursewareEditor.narration.pronDict.tryListenHint")}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                {form.id ? (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="rounded px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {t("coursewareEditor.narration.pronDict.cancelEdit")}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="inline-flex items-center gap-1 rounded bg-blue-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  {form.id
                    ? t("coursewareEditor.narration.pronDict.saveEdit")
                    : t("coursewareEditor.narration.pronDict.add")}
                </button>
              </div>

              {error ? (
                <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
              ) : null}

              <div className="overflow-hidden rounded border border-slate-200 dark:border-slate-700">
                <div className="max-h-64 overflow-y-auto">
                  {items.length === 0 && !loading ? (
                    <p className="px-2 py-6 text-center text-[11px] text-slate-400">
                      {t("coursewareEditor.narration.pronDict.empty")}
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-200 dark:divide-slate-700">
                      {items.map((entry) => (
                        <li
                          key={entry.id}
                          className="flex items-center gap-2 px-2 py-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        >
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            onClick={() => startEdit(entry)}
                          >
                            <div className="truncate font-medium text-slate-800 dark:text-slate-100">
                              {entry.sourceText}
                              <span className="ml-1 font-normal text-slate-400">
                                [{entry.language}]
                              </span>
                            </div>
                            <div className="truncate font-mono text-[11px] text-slate-500">
                              {entry.pronunciation}
                            </div>
                          </button>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={entry.enabled}
                            aria-label={
                              entry.enabled
                                ? t("coursewareEditor.narration.pronDict.on")
                                : t("coursewareEditor.narration.pronDict.off")
                            }
                            onClick={() => void handleToggle(entry)}
                            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                              entry.enabled
                                ? "bg-blue-500"
                                : "bg-slate-300 dark:bg-slate-600"
                            }`}
                          >
                            <span
                              className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                                entry.enabled ? "translate-x-5" : "translate-x-0.5"
                              }`}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(entry)}
                            className="shrink-0 rounded p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                            aria-label={t("coursewareEditor.narration.pronDict.delete")}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {total > 0 ? (
                  <div className="flex items-center justify-between gap-2 border-t border-slate-200 dark:border-slate-700 px-2 py-1.5">
                    <span className="text-[11px] text-slate-500">
                      {t("coursewareEditor.narration.pronDict.pageHint", {
                        page,
                        total: totalPages,
                        count: total,
                      })}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={page <= 1 || loading}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        className="inline-flex items-center gap-0.5 rounded px-1.5 py-1 text-[11px] text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
                        aria-label={t("coursewareEditor.narration.pronDict.prevPage")}
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                        {t("coursewareEditor.narration.pronDict.prevPage")}
                      </button>
                      <button
                        type="button"
                        disabled={page >= totalPages || loading}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        className="inline-flex items-center gap-0.5 rounded px-1.5 py-1 text-[11px] text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
                        aria-label={t("coursewareEditor.narration.pronDict.nextPage")}
                      >
                        {t("coursewareEditor.narration.pronDict.nextPage")}
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
