// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useId, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useI18nNew } from "../../hooks/useI18nNew.tsx";
import {
  COURSEWARE_EDITOR_THEME_ATTR,
  type EditorThemeMode,
} from "../../lib/courseware-editor-theme.ts";

const BUBBLE_W = 220;
const ESTIMATED_H = 104;
const GAP = 8;

export type DeletePageConfirmBubbleProps = {
  open: boolean;
  /** Passed from `getBoundingClientRect()` when delete is clicked */
  anchorRect: DOMRect | null;
  /** Same as the editor root; must be passed explicitly when portaled to body to enable the dark: variants */
  themeMode: EditorThemeMode;
  onConfirm: () => void;  
  onCancel: () => void;
  /** Main text, defaults to the delete current page prompt */
  message?: string;
};

export function DeletePageConfirmBubble({
  open,
  anchorRect,
  themeMode,
  onConfirm,
  onCancel,
  message,
}: DeletePageConfirmBubbleProps) {
  const { t } = useI18nNew();
  const titleId = useId();
  const [layout, setLayout] = useState<{ top: number; left: number; width: number } | null>(null);
  const displayMessage = message ?? t("coursewareEditor.confirm.deleteSlide");

  useLayoutEffect(() => {
    if (!open || !anchorRect || typeof window === "undefined") {
      setLayout(null);
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = BUBBLE_W;
    const left = Math.min(Math.max(GAP, anchorRect.right - width), vw - width - GAP);
    let top = anchorRect.bottom + GAP;
    if (top + ESTIMATED_H > vh - GAP) {
      top = anchorRect.top - ESTIMATED_H - GAP;
    }
    if (top < GAP) top = GAP;
    setLayout({ top, left, width });
  }, [open, anchorRect]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (typeof document === "undefined" || !open || !layout) return null;

  return createPortal(
    <div
      className={themeMode === "dark" ? "dark" : undefined}
      {...{ [COURSEWARE_EDITOR_THEME_ATTR]: themeMode }}
    >
      <div
        className="fixed inset-0 z-100 bg-black/20 dark:bg-black/50"
        aria-hidden
        onMouseDown={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed z-101 rounded-lg border border-slate-200 bg-white p-3 shadow-xl ring-1 ring-slate-200/80 dark:border-slate-600 dark:bg-slate-900 dark:ring-black/30"
        style={{ top: layout.top, left: layout.left, width: layout.width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <p id={titleId} className="text-xs leading-relaxed text-slate-700 dark:text-slate-200">
          {displayMessage}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:bg-slate-700"
            onClick={onCancel}
          >
            {t("coursewareEditor.common.cancel")}
          </button>
          <button
            type="button"
            className="rounded-md bg-rose-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-rose-500"
            onClick={onConfirm}
          >
            {t("coursewareEditor.common.delete")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
