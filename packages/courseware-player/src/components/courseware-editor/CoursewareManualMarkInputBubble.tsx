// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState } from "react";
import { Check } from "lucide-react";
import { useI18nNew } from "../../hooks/useI18nNew.tsx";

type Props = {
  markIndex: number;
  onCancel: () => void;
  onConfirm: (description: string) => void;
};

export function CoursewareManualMarkInputBubble({ markIndex, onCancel, onConfirm }: Props) {
  const { t } = useI18nNew();
  const [value, setValue] = useState("");
  const submittedRef = useRef(false);

  const handleConfirm = () => {
    const text = value.trim();
    if (!text || submittedRef.current) return;
    submittedRef.current = true;
    onConfirm(text);
  };

  return (
    <div
      className="mb-2 rounded-lg border border-rose-300/40 dark:border-rose-500/35 bg-white/95 dark:bg-slate-900/95 p-2.5 shadow-lg ring-1 ring-rose-500/15"
      role="dialog"
      aria-label={t("coursewareEditor.manualMark.ariaDescription", { index: markIndex })}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-white">
          {t("coursewareEditor.manualMark.label", { index: markIndex })}
        </span>
        <span className="text-[10px] text-slate-400 dark:text-slate-500">
          {t("coursewareEditor.manualMark.hint")}
        </span>
      </div>
      <textarea
        className="mb-2 max-h-24 w-full resize-none rounded-md border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-600 focus:border-rose-500/50 focus:outline-none focus:ring-1 focus:ring-rose-500/30"
        rows={3}
        value={value}
        placeholder={t("coursewareEditor.manualMark.placeholder")}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
            return;
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleConfirm();
          }
        }}
      />
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          className="rounded px-2 py-1 text-[10px] text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200"
          onClick={onCancel}
        >
          {t("coursewareEditor.manualMark.deleteRegion")}
        </button>
        <button
          type="button"
          disabled={!value.trim()}
          className="inline-flex items-center gap-1 rounded bg-rose-600 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={handleConfirm}
        >
          <Check className="h-3 w-3" aria-hidden />
          {t("coursewareEditor.manualMark.confirmMark")}
        </button>
      </div>
    </div>
  );
}
