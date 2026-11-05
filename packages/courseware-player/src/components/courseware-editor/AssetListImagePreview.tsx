// SPDX-License-Identifier: AGPL-3.0-only
import { memo, useCallback, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FileText, Image as ImageIcon } from "lucide-react";
import type { CoursewareAssetItem } from "../../api/courseware.ts";
import { isCoursewareImageAsset } from "./CoursewareAssetLibraryPicker.tsx";
import {
  COURSEWARE_EDITOR_THEME_ATTR,
  type EditorThemeMode,
} from "../../lib/courseware-editor-theme.ts";

const PREVIEW_GAP_PX = 10;
const PREVIEW_VIEWPORT_PAD = 8;
const PREVIEW_EST_W = 220;
const PREVIEW_EST_H = 200;

export type AssetImageHoverPreviewCoords = {
  top: number;
  left: number;
  transform: string;
};

/** The hover preview prefers the left of the anchor (falling to the right when it doesn't fit) */
export function computeAssetImageHoverPreviewCoords(
  anchorRect: DOMRect,
): AssetImageHoverPreviewCoords {
  const pad = PREVIEW_VIEWPORT_PAD;
  const gap = PREVIEW_GAP_PX;
  const top = Math.min(
    window.innerHeight - pad - PREVIEW_EST_H / 2,
    Math.max(pad + PREVIEW_EST_H / 2, anchorRect.top + anchorRect.height / 2),
  );
  const preferLeft = anchorRect.left - gap - PREVIEW_EST_W >= pad;
  if (preferLeft) {
    return {
      top,
      left: anchorRect.left - gap,
      transform: "translate(-100%, -50%)",
    };
  }
  return {
    top,
    left: anchorRect.right + gap,
    transform: "translateY(-50%)",
  };
}

export function isImageExtension(extension: string | null | undefined): boolean {
  return ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "tiff"].includes(
    (extension ?? "").toLowerCase(),
  );
}

export const AssetRowThumbnail = memo(function AssetRowThumbnail({
  url,
  isImage,
  sizeClassName = "h-8 w-8",
  iconClassName = "h-3.5 w-3.5 text-[#89BFFA]",
}: {
  url?: string | null;
  isImage: boolean;
  sizeClassName?: string;
  iconClassName?: string;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [url]);

  if (isImage && url && !broken) {
    return (
      <img
        src={url}
        alt=""
        className={`${sizeClassName} shrink-0 rounded object-cover`}
        draggable={false}
        loading="lazy"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <div
      className={`flex ${sizeClassName} shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800`}
    >
      {isImage ? (
        <ImageIcon className={iconClassName} aria-hidden />
      ) : (
        <FileText className={iconClassName} aria-hidden />
      )}
    </div>
  );
});

export const AssetImageHoverPreviewPortal = memo(function AssetImageHoverPreviewPortal({
  url,
  name,
  coords,
  themeMode,
}: {
  url: string;
  name: string;
  coords: AssetImageHoverPreviewCoords;
  themeMode: EditorThemeMode;
}) {
  if (typeof document === "undefined" || !url) return null;
  return createPortal(
    <div
      {...{ [COURSEWARE_EDITOR_THEME_ATTR]: themeMode }}
      role="presentation"
      className="pointer-events-none fixed z-[13000] w-[min(220px,calc(100vw-16px))] rounded-lg border border-slate-300 bg-white p-1.5 shadow-2xl dark:border-slate-600 dark:bg-slate-900"
      style={{ top: coords.top, left: coords.left, transform: coords.transform }}
    >
      <img
        src={url}
        alt=""
        className="mx-auto block max-h-44 w-auto max-w-full rounded object-contain"
        draggable={false}
        loading="lazy"
      />
      <p className="mt-1 truncate px-0.5 text-center text-[10px] text-slate-600 dark:text-slate-400">
        {name}
      </p>
    </div>,
    document.body,
  );
});

/**
 * Image preview on list item hover: left first (right when there isn't enough space).
 */
export function useAssetImageHoverPreview(themeMode: EditorThemeMode): {
  preview: ReactNode;
  bindRow: (args: {
    id: string;
    name: string;
    url?: string | null;
    isImage: boolean;
  }) => {
    onMouseEnter: (e: MouseEvent<HTMLElement>) => void;
    onMouseLeave: () => void;
  };
  clearPreview: () => void;
} {
  const [preview, setPreview] = useState<{
    id: string;
    name: string;
    url: string;
    coords: AssetImageHoverPreviewCoords;
  } | null>(null);

  const clearPreview = useCallback(() => setPreview(null), []);

  const bindRow = useCallback(
    (args: { id: string; name: string; url?: string | null; isImage: boolean }) => ({
      onMouseEnter: (e: MouseEvent<HTMLElement>) => {
        if (!args.isImage || !args.url?.trim()) {
          setPreview(null);
          return;
        }
        setPreview({
          id: args.id,
          name: args.name,
          url: args.url,
          coords: computeAssetImageHoverPreviewCoords(e.currentTarget.getBoundingClientRect()),
        });
      },
      onMouseLeave: () => setPreview(null),
    }),
    [],
  );

  const node =
    preview != null ? (
      <AssetImageHoverPreviewPortal
        url={preview.url}
        name={preview.name}
        coords={preview.coords}
        themeMode={themeMode}
      />
    ) : null;

  return { preview: node, bindRow, clearPreview };
}

export function assetItemIsImage(
  asset: Pick<CoursewareAssetItem, "extension" | "mimeType">,
): boolean {
  return isCoursewareImageAsset(asset as CoursewareAssetItem);
}
