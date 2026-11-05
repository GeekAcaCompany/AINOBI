// SPDX-License-Identifier: AGPL-3.0-only
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { HexColorPicker } from "react-colorful";
import { Pipette } from "lucide-react";

import { useI18nNew } from "@ainobi/courseware-player/hooks/useI18nNew";
import {
  OFFICE_STANDARD_COLORS,
  OFFICE_THEME_COLOR_ROWS,
} from "../../lib/courseware-editor-color-palette.ts";
import {
  COURSEWARE_EDITOR_RECENT_COLORS_EVENT,
  pushCoursewareEditorRecentColor,
  readCoursewareEditorRecentColors,
} from "../../lib/courseware-editor-recent-colors.ts";
import { normalizeColorToHex } from "@ainobi/courseware-core/css-color.ts";

import "./CoursewareColorPicker.css";

const HEX_INPUT_PATTERN = /^#?[0-9a-fA-F]{0,6}$/;
/** Kept consistent with the width of the CSS `.courseware-color-picker__popover`. */
const POPOVER_WIDTH = 248;

export type CoursewareColorPickerChangeOptions = {
  /** false = live preview while dragging hue/saturation, not written to the undo stack */
  recordHistory?: boolean;
};

type CoursewareColorPickerProps = {
  value: string;
  onChange: (hex: string, options?: CoursewareColorPickerChangeOptions) => void;
  /** Dragging starts on the "more colors" palette (pointer down) — used to capture the scene snapshot before the drag */
  onInteractiveGestureStart?: () => void;
  /** Palette dragging ends (pointer up) — used to write the pre-drag snapshot to the undo stack in one go */
  onInteractiveGestureEnd?: (hex: string) => void;
  /** The display color of the picker when value is transparent / unparseable (never written automatically). */
  fallbackColor?: string;
  className?: string;
  disabled?: boolean;
  /** Narrow spots such as the toolbar: only the swatch button, with HEX edited in the popover. */
  variant?: "default" | "compact";
  /** Allows choosing "transparent"; with transparent the swatch shows a checkerboard instead of fallbackColor. */
  supportsTransparent?: boolean;
  /**
   * The trigger swatch shows this image's thumbnail instead (for the "background" entry when a background image is set).
   * It can still be clicked to open the palette, and choosing any color returns to the color state (clearing the image is handled on the `onChange` side).
   */
  swatchImageUrl?: string;
};

function isTransparentColor(value: string | undefined): boolean {
  const trimmed = value?.trim().toLowerCase() ?? "";
  return !trimmed || trimmed === "transparent";
}

function formatHexDraft(hex: string): string {
  const normalized = normalizeColorToHex(hex, "#000000");
  return normalized.toUpperCase();
}

function isLightSwatch(hex: string): boolean {
  const parsed = normalizeColorToHex(hex, "#000000");
  const r = Number.parseInt(parsed.slice(1, 3), 16);
  const g = Number.parseInt(parsed.slice(3, 5), 16);
  const b = Number.parseInt(parsed.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 210;
}

function PaletteSwatch({
  color,
  selected,
  onSelect,
}: {
  color: string;
  selected: boolean;
  onSelect: (hex: string) => void;
}) {
  const normalized = normalizeColorToHex(color, "#000000");
  return (
    <button
      type="button"
      className={`courseware-color-picker__palette-swatch${selected ? " is-selected" : ""}${
        isLightSwatch(normalized) ? " is-light" : ""
      }`}
      style={{ backgroundColor: normalized }}
      aria-label={normalized}
      aria-pressed={selected}
      onClick={() => onSelect(normalized)}
    />
  );
}

function PaletteSection({
  title,
  colors,
  columns,
  selectedHex,
  onSelect,
}: {
  title: string;
  colors: readonly string[];
  columns: number;
  selectedHex: string;
  onSelect: (hex: string) => void;
}) {
  if (colors.length === 0) return null;
  return (
    <div className="courseware-color-picker__palette-section">
      <div className="courseware-color-picker__palette-title">{title}</div>
      <div
        className="courseware-color-picker__palette-grid"
        style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
      >
        {colors.map((color, index) => (
          <PaletteSwatch
            key={`${title}-${index}-${color}`}
            color={color}
            selected={normalizeColorToHex(color, "#000000") === selectedHex}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

export function CoursewareColorPicker({
  value,
  onChange,
  onInteractiveGestureStart,
  onInteractiveGestureEnd,
  fallbackColor = "#000000",
  className = "",
  disabled = false,
  variant = "default",
  supportsTransparent = false,
  swatchImageUrl,
}: CoursewareColorPickerProps) {
  const { t } = useI18nNew();
  const compact = variant === "compact";
  const pickerId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const [popoverTheme, setPopoverTheme] = useState<string | null>(null);
  const transparent = supportsTransparent && isTransparentColor(value);
  const resolvedHex = transparent
    ? normalizeColorToHex(fallbackColor, "#000000")
    : normalizeColorToHex(value, fallbackColor);
  const [hexDraft, setHexDraft] = useState(() => formatHexDraft(resolvedHex));
  const [recentColors, setRecentColors] = useState(() => readCoursewareEditorRecentColors());
  const isInteractiveGestureRef = useRef(false);
  const interactivePreviewHexRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      setHexDraft(formatHexDraft(resolvedHex));
    }
  }, [open, resolvedHex]);

  useEffect(() => {
    const syncRecent = (): void => {
      setRecentColors(readCoursewareEditorRecentColors());
    };
    window.addEventListener(COURSEWARE_EDITOR_RECENT_COLORS_EVENT, syncRecent);
    return () => window.removeEventListener(COURSEWARE_EDITOR_RECENT_COLORS_EVENT, syncRecent);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // The popover renders into body through a portal, so overflow containers (the toolbar's horizontal scrollbar / the property panel's scroll area) don't clip it.
  useLayoutEffect(() => {
    if (!open) {
      setPopoverPos(null);
      return;
    }
    const anchor = controlsRef.current;
    setPopoverTheme(
      anchor?.closest("[data-courseware-editor-theme]")?.getAttribute("data-courseware-editor-theme") ?? null,
    );
    const update = (): void => {
      if (!anchor || typeof window === "undefined") return;
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(POPOVER_WIDTH, window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      setPopoverPos({ top: Math.round(rect.bottom + 8), left: Math.round(left) });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  const previewHex = useCallback(
    (raw: string): void => {
      const next = normalizeColorToHex(raw, resolvedHex);
      setHexDraft(formatHexDraft(next));
      interactivePreviewHexRef.current = next;
      onChange(next, { recordHistory: false });
    },
    [onChange, resolvedHex],
  );

  const commitHex = useCallback(
    (raw: string, options?: { close?: boolean }): void => {
      const next = normalizeColorToHex(raw, resolvedHex);
      setHexDraft(formatHexDraft(next));
      onChange(next, { recordHistory: true });
      setRecentColors(pushCoursewareEditorRecentColor(next));
      if (options?.close) {
        setOpen(false);
      }
    },
    [onChange, resolvedHex],
  );

  useEffect(() => {
    if (!open) return;
    const finishInteractiveGesture = (): void => {
      if (!isInteractiveGestureRef.current) return;
      isInteractiveGestureRef.current = false;
      const finalHex = interactivePreviewHexRef.current;
      interactivePreviewHexRef.current = null;
      if (!finalHex) return;
      if (onInteractiveGestureEnd) {
        onInteractiveGestureEnd(finalHex);
      } else {
        onChange(finalHex, { recordHistory: true });
      }
      setRecentColors(pushCoursewareEditorRecentColor(finalHex));
    };
    window.addEventListener("pointerup", finishInteractiveGesture);
    window.addEventListener("pointercancel", finishInteractiveGesture);
    return () => {
      window.removeEventListener("pointerup", finishInteractiveGesture);
      window.removeEventListener("pointercancel", finishInteractiveGesture);
    };
  }, [onChange, onInteractiveGestureEnd, open]);

  const handleHexInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const raw = event.target.value.trim();
    if (!HEX_INPUT_PATTERN.test(raw)) return;
    const withHash = raw.startsWith("#") ? raw : `#${raw}`;
    setHexDraft(withHash.toUpperCase());
    if (/^#[0-9a-fA-F]{6}$/.test(withHash)) {
      commitHex(withHash);
    }
  };

  const handleHexInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitHex(hexDraft, { close: true });
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setHexDraft(formatHexDraft(resolvedHex));
      setOpen(false);
    }
  };

  const handleEyedropper = async (): Promise<void> => {
    const EyeDropperCtor = (window as Window & { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } })
      .EyeDropper;
    if (!EyeDropperCtor) return;
    try {
      const dropper = new EyeDropperCtor();
      const result = await dropper.open();
      commitHex(result.sRGBHex);
    } catch {
      // user cancelled
    }
  };

  const supportsEyedropper = typeof window !== "undefined" && "EyeDropper" in window;
  const themeColors = OFFICE_THEME_COLOR_ROWS.flat();

  return (
    <div ref={rootRef} className={`courseware-color-picker ${className}`.trim()}>
      <div ref={controlsRef} className="courseware-color-picker__controls">
        <button
          type="button"
          disabled={disabled}
          aria-expanded={open}
          aria-controls={pickerId}
          aria-label={t("coursewareEditor.colorPicker.openPicker")}
          className={`courseware-color-picker__swatch${
            transparent && !swatchImageUrl ? " is-transparent" : ""
          }`}
          style={
            swatchImageUrl
              ? {
                  backgroundImage: `url(${JSON.stringify(swatchImageUrl)})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  backgroundRepeat: "no-repeat",
                }
              : transparent
                ? undefined
                : { backgroundColor: resolvedHex }
          }
          onClick={() => {
            if (disabled) return;
            setOpen((prev) => !prev);
          }}
        />
        {!compact ? (
          <input
            type="text"
            disabled={disabled}
            value={hexDraft}
            onChange={handleHexInputChange}
            onBlur={() => commitHex(hexDraft)}
            onKeyDown={handleHexInputKeyDown}
            onFocus={() => setOpen(true)}
            className="courseware-color-picker__hex"
            spellCheck={false}
            autoComplete="off"
            aria-label={t("coursewareEditor.colorPicker.hexValue")}
          />
        ) : null}
        {!compact && supportsEyedropper ? (
          <button
            type="button"
            disabled={disabled}
            className="courseware-color-picker__eyedropper"
            aria-label={t("coursewareEditor.colorPicker.eyedropper")}
            onClick={() => void handleEyedropper()}
          >
            <Pipette className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {open && !disabled && popoverPos && typeof document !== "undefined"
        ? createPortal(
        <div
          ref={popoverRef}
          data-courseware-color-popover
          data-courseware-editor-theme={popoverTheme ?? undefined}
          id={pickerId}
          className="courseware-color-picker__popover courseware-color-picker__popover--portal"
          role="dialog"
          aria-label={t("coursewareEditor.colorPicker.dialogLabel")}
          style={{ position: "fixed", top: popoverPos.top, left: popoverPos.left, right: "auto", marginTop: 0 }}
        >
          {supportsTransparent ? (
            <div className="courseware-color-picker__palette-section">
              <div className="courseware-color-picker__palette-title">
                {t("coursewareEditor.colorPicker.transparent")}
              </div>
              <button
                type="button"
                className={`courseware-color-picker__palette-swatch courseware-color-picker__transparent-swatch${
                  transparent ? " is-selected" : ""
                }`}
                aria-label={t("coursewareEditor.colorPicker.transparent")}
                aria-pressed={transparent}
                onClick={() => {
                  onChange("transparent");
                  setOpen(false);
                }}
              />
            </div>
          ) : null}
          <PaletteSection
            title={t("coursewareEditor.colorPicker.recent")}
            colors={recentColors}
            columns={10}
            selectedHex={transparent ? "" : resolvedHex}
            onSelect={(hex) => commitHex(hex)}
          />
          <PaletteSection
            title={t("coursewareEditor.colorPicker.theme")}
            colors={themeColors}
            columns={10}
            selectedHex={transparent ? "" : resolvedHex}
            onSelect={(hex) => commitHex(hex)}
          />
          <PaletteSection
            title={t("coursewareEditor.colorPicker.standard")}
            colors={OFFICE_STANDARD_COLORS}
            columns={10}
            selectedHex={transparent ? "" : resolvedHex}
            onSelect={(hex) => commitHex(hex)}
          />

          <div className="courseware-color-picker__divider" />
          <div className="courseware-color-picker__palette-title">{t("coursewareEditor.colorPicker.custom")}</div>

          <div
            onPointerDown={() => {
              isInteractiveGestureRef.current = true;
              onInteractiveGestureStart?.();
            }}
          >
            <HexColorPicker
              color={resolvedHex}
              onChange={(hex) => {
                if (isInteractiveGestureRef.current) {
                  previewHex(hex);
                  return;
                }
                commitHex(hex);
              }}
            />
          </div>

          {compact ? (
            <>
              <input
                type="text"
                disabled={disabled}
                value={hexDraft}
                onChange={handleHexInputChange}
                onBlur={() => commitHex(hexDraft)}
                onKeyDown={handleHexInputKeyDown}
                className="courseware-color-picker__hex courseware-color-picker__hex--popover"
                spellCheck={false}
                autoComplete="off"
                aria-label={t("coursewareEditor.colorPicker.hexValue")}
              />
              <div className="courseware-color-picker__popover-actions">
                {supportsEyedropper ? (
                  <button
                    type="button"
                    disabled={disabled}
                    className="courseware-color-picker__eyedropper"
                    aria-label={t("coursewareEditor.colorPicker.eyedropper")}
                    onClick={() => void handleEyedropper()}
                  >
                    <Pipette className="h-3.5 w-3.5" />
                  </button>
                ) : null}
                <div className="courseware-color-picker__format">HEX</div>
              </div>
            </>
          ) : (
            <div className="courseware-color-picker__format courseware-color-picker__format--center">HEX</div>
          )}
        </div>,
        document.body,
      )
        : null}
    </div>
  );
}
