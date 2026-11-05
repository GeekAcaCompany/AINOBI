// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useI18nNew } from "@ainobi/courseware-player/hooks/useI18nNew";
import {
  COURSEWARE_EDITOR_THEME_ATTR,
  type EditorThemeMode,
} from "@ainobi/courseware-player/lib/courseware-editor-theme";

export type EditorOverlapPickTarget = {
  id: string;
  label: string;
  detail?: string;
};

export type EditorOverlapPickerAnchor = {
  x: number;
  y: number;
};

export type EditorOverlapPickerMenuProps = {
  anchor: EditorOverlapPickerAnchor | null;
  targets: EditorOverlapPickTarget[];
  activeId?: string | null;
  themeMode: EditorThemeMode;
  onClose: () => void;
  onPick: (id: string) => void;
  footer?: React.ReactNode;
};

const MENU_MIN_W = 200;
const MENU_MAX_H = 280;
const GAP = 6;

export function EditorOverlapPickerMenu({
  anchor,
  targets,
  activeId,
  themeMode,
  onClose,
  onPick,
  footer,
}: EditorOverlapPickerMenuProps) {
  const { t } = useI18nNew();
  const [layout, setLayout] = useState<{ top: number; left: number } | null>(null);
  const showPicker = targets.length > 1;

  useLayoutEffect(() => {
    if (!anchor || typeof window === "undefined") {
      setLayout(null);
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const estimatedHeight = Math.min(
      MENU_MAX_H + (footer ? 120 : 0),
      showPicker ? 80 + targets.length * 32 + (footer ? 120 : 0) : 120,
    );
    let left = anchor.x;
    let top = anchor.y;
    if (left + MENU_MIN_W > vw - GAP) left = vw - MENU_MIN_W - GAP;
    if (left < GAP) left = GAP;
    if (top + estimatedHeight > vh - GAP) top = anchor.y - estimatedHeight;
    if (top < GAP) top = GAP;
    setLayout({ top, left });
  }, [anchor, footer, showPicker, targets.length]);

  useEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anchor, onClose]);

  if (typeof document === "undefined" || !anchor || !layout) return null;

  const itemClass =
    "flex w-full items-start gap-2 rounded px-2.5 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800";
  const activeItemClass = `${itemClass} bg-blue-50 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200`;

  return createPortal(
    <div
      className={themeMode === "dark" ? "dark" : undefined}
      {...{ [COURSEWARE_EDITOR_THEME_ATTR]: themeMode }}
    >
      <div
        className="fixed inset-0 z-100"
        aria-hidden
        onMouseDown={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        role="menu"
        className="fixed z-101 min-w-[200px] max-w-[min(320px,92vw)] rounded-lg border border-slate-200 bg-white py-1 shadow-xl ring-1 ring-slate-200/80 dark:border-slate-600 dark:bg-slate-900 dark:ring-black/30"
        style={{ top: layout.top, left: layout.left }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {showPicker ? (
          <>
            <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t("coursewareEditor.common.overlappingLayers")}
            </div>
            <div className="max-h-[280px] overflow-y-auto px-1 pb-1">
              {targets.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  role="menuitem"
                  className={target.id === activeId ? activeItemClass : itemClass}
                  onClick={() => onPick(target.id)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{target.label}</span>
                    {target.detail ? (
                      <span className="block truncate text-[10px] text-slate-500 dark:text-slate-400">
                        {target.detail}
                      </span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
            {footer ? <div className="my-1 border-t border-slate-200 dark:border-slate-700" /> : null}
          </>
        ) : null}
        {footer}
      </div>
    </div>,
    document.body,
  );
}
