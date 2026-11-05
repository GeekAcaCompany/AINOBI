// SPDX-License-Identifier: AGPL-3.0-only
import { Lock, LockOpen, Trash2 } from "lucide-react";
import { useI18nNew } from "@ainobi/courseware-player/hooks/useI18nNew";
import {
  EditorOverlapPickerMenu,
  type EditorOverlapPickTarget,
} from "./EditorOverlapPickerMenu.tsx";
import {
  type EditorThemeMode,
} from "@ainobi/courseware-player/lib/courseware-editor-theme";

export type EditorElementContextMenuAnchor = {
  elementId: string;
  x: number;
  y: number;
  overlapTargets?: EditorOverlapPickTarget[];
};

export type EditorElementContextMenuProps = {
  anchor: EditorElementContextMenuAnchor | null;
  locked: boolean;
  themeMode: EditorThemeMode;
  onClose: () => void;
  onPickOverlap?: (elementId: string) => void;
  onLock: () => void;
  onUnlock: () => void;
  onDelete: () => void;
};

export function EditorElementContextMenu({
  anchor,
  locked,
  themeMode,
  onClose,
  onPickOverlap,
  onLock,
  onUnlock,
  onDelete,
}: EditorElementContextMenuProps) {
  const { t } = useI18nNew();
  if (!anchor) return null;

  const overlapTargets =
    anchor.overlapTargets && anchor.overlapTargets.length > 0
      ? anchor.overlapTargets
      : [{ id: anchor.elementId, label: anchor.elementId }];

  const itemClass =
    "flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800";

  const footer = (
  <>
      {locked ? (
        <button type="button" role="menuitem" className={itemClass} onClick={onUnlock}>
          <LockOpen className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t("coursewareEditor.common.unlockElement")}
        </button>
      ) : (
        <button type="button" role="menuitem" className={itemClass} onClick={onLock}>
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t("coursewareEditor.common.lockElement")}
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        className={`${itemClass} text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10`}
        onClick={onDelete}
      >
        <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {t("coursewareEditor.common.delete")}
      </button>
    </>
  );

  return (
    <EditorOverlapPickerMenu
      anchor={{ x: anchor.x, y: anchor.y }}
      targets={overlapTargets}
      activeId={anchor.elementId}
      themeMode={themeMode}
      onClose={onClose}
      onPick={(id) => {
        onPickOverlap?.(id);
      }}
      footer={footer}
    />
  );
}
