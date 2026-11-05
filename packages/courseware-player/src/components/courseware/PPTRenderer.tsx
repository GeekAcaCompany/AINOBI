// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileIcon,
  Loader2,
  Presentation,
} from "lucide-react";
import {
  buildPptSlideHtmlUrl,
  resolvePptSlideHtmlUrl,
  expandPptSlideRanges,
  type PPTElement,
} from "../../lib/courseware/index.ts";
import { useI18nNew } from "../../hooks/useI18nNew.tsx";

export interface PPTRendererProps {
  element: PPTElement;
  /** "thumbnail" is for keyframe / thumbnail cards, showing only a placeholder icon. */
  mode?: "stage" | "thumbnail";
  /**
   * Controlled current page: a 0-based index into `effectiveSlides`.
   * When not passed the component manages it itself (suited to preview/editor canvases).
   */
  index?: number;
  onIndexChange?: (index: number) => void;
  /**
   * When true (e.g. during preview playback): previous / next page and the page number aren't rendered at all.
   * (Setting only opacity-0 would still let `disabled:opacity-30` show the disabled "previous page" half visible.)
   */
  suppressNavReveal?: boolean;
  /**
   * Editor canvas: the iframe and container don't take the pointer, so events land on the outer StageElement for dragging;
   * the page buttons stay `pointer-events-auto`; the hover target is `group/ppt` on the parent {@link StageElement}.
   */
  editorCanvasDragThrough?: boolean;
  /** Lightweight mode: mounts only the current page iframe without preloading the next. Suited to minimap/thumbnail views. */
  lightweight?: boolean;
  /**
   * Preview playback: the timeline pauses through {@link onPlaybackLoadingChange} until the current page iframe finishes loading.
   */
  playbackGateActive?: boolean;
  onPlaybackLoadingChange?: (loading: boolean) => void;
}

type SlotIndex = 0 | 1;

type DualFrameState = {
  visible: SlotIndex;
  /** The `effectiveSlides` index of each slot; null means the slot mounts no iframe */
  slotSlideIdx: [number | null, number | null];
  slotLoaded: [boolean, boolean];
};

const initialDualState = (): DualFrameState => ({
  visible: 0,
  slotSlideIdx: [null, null],
  slotLoaded: [false, false],
});

/**
 * A new load wait is needed only when the slide a slot shows **changed** since the previous round;
 * when a slot keeps showing the same page, loaded is kept, so an iframe that didn't reload doesn't get loaded cleared and spin forever.
 */
const loadedAfterSlotSlideChange = (
  prevSlideIdx: number | null,
  nextSlideIdx: number | null,
  prevLoaded: boolean,
): boolean => {
  if (nextSlideIdx === null) return true;
  if (prevSlideIdx === nextSlideIdx) return prevLoaded;
  return false;
};

const LAYER_TRANSITION_CLASS = "transition-opacity duration-300 ease-in-out";
const NO_LAYER_TRANSITION_CLASS = "transition-none";

/**
 * Embedded PPT container: a two-iframe pool — the current page + a preloaded next page; when switching, an already ready next page swaps layers directly.
 * A visible iframe shows only loading until it finishes loading; layers fade in and out with opacity.
 */
export function PPTRenderer({
  element,
  mode = "stage",
  index,
  onIndexChange,
  suppressNavReveal = false,
  editorCanvasDragThrough = false,
  lightweight = false,
  playbackGateActive = false,
  onPlaybackLoadingChange,
}: PPTRendererProps) {
  const { t } = useI18nNew();
  const effectiveSlides = useMemo(
    () => expandPptSlideRanges(element.slide_ranges, element.slide_count),
    [element.slide_ranges, element.slide_count],
  );
  const total = effectiveSlides.length;

  const [internalIndex, setInternalIndex] = useState(0);
  const activeIndex = typeof index === "number" ? index : internalIndex;
  const safeIndex = Math.max(0, Math.min(total - 1, activeIndex));

  const [dual, setDual] = useState<DualFrameState>(initialDualState);
  const [singleLoaded, setSingleLoaded] = useState(false);
  const deckKeyRef = useRef(`${element.element_id}:${element.src.trim()}`);
  /**
   * On first entering page 1 of the current courseware (without having switched to another page), layers/iframes don't transition opacity, avoiding a fade-in on the first screen.
   * Returning to page 1 from another page keeps the transition. Reset when the courseware (element / src) changes.
   */
  const [everLeftFirstSlide, setEverLeftFirstSlide] = useState(false);

  /**
   * When the length of effectiveSlides changes (e.g. editing `slide_ranges` / `slide_count`),
   * the local index is clamped into the valid range to avoid an out-of-range blank screen.
   */
  useEffect(() => {
    if (typeof index === "number") return;
    setInternalIndex((prev) => {
      if (prev < 0) return 0;
      if (prev >= total) return Math.max(0, total - 1);
      return prev;
    });
  }, [index, total]);

  const goTo = (next: number): void => {
    const clamped = Math.max(0, Math.min(total - 1, next));
    if (typeof index === "number") {
      onIndexChange?.(clamped);
      return;
    }
    setInternalIndex(clamped);
    onIndexChange?.(clamped);
  };

  const src = element.src.trim();

  const nextSlideIdx = safeIndex + 1 < total ? safeIndex + 1 : null;
  const singleSlideNum = total > 0 ? effectiveSlides[safeIndex] : undefined;

  useEffect(() => {
    setEverLeftFirstSlide(false);
  }, [element.element_id, src]);

  useEffect(() => {
    if (safeIndex !== 0) setEverLeftFirstSlide(true);
  }, [safeIndex]);

  useEffect(() => {
    setSingleLoaded(false);
  }, [element.element_id, src, singleSlideNum]);

  useLayoutEffect(() => {
    if (lightweight) return;
    const deckKey = `${element.element_id}:${src}`;
    const deckChanged = deckKeyRef.current !== deckKey;
    if (deckChanged) {
      deckKeyRef.current = deckKey;
    }

    if (!src || total === 0) return;

    setDual((prev) => {
      const base = deckChanged ? initialDualState() : prev;
      const [aIdx, bIdx] = base.slotSlideIdx;
      const [aLoaded, bLoaded] = base.slotLoaded;

      if (aIdx === safeIndex) {
        const nextB = nextSlideIdx;
        if (bIdx === nextB) {
          return { visible: 0, slotSlideIdx: [aIdx, bIdx], slotLoaded: [aLoaded, bLoaded] };
        }
        return {
          visible: 0,
          slotSlideIdx: [aIdx, nextB],
          slotLoaded: [
            aLoaded,
            loadedAfterSlotSlideChange(bIdx, nextB, bLoaded),
          ],
        };
      }

      if (bIdx === safeIndex) {
        const nextA = nextSlideIdx;
        if (aIdx === nextA) {
          return { visible: 1, slotSlideIdx: [aIdx, bIdx], slotLoaded: [aLoaded, bLoaded] };
        }
        return {
          visible: 1,
          slotSlideIdx: [nextA, bIdx],
          slotLoaded: [
            loadedAfterSlotSlideChange(aIdx, nextA, aLoaded),
            bLoaded,
          ],
        };
      }

      return {
        visible: 0,
        slotSlideIdx: [safeIndex, nextSlideIdx],
        slotLoaded: [
          loadedAfterSlotSlideChange(aIdx, safeIndex, aLoaded),
          loadedAfterSlotSlideChange(bIdx, nextSlideIdx, bLoaded),
        ],
      };
    });
  }, [element.element_id, src, safeIndex, nextSlideIdx, total, lightweight]);

  const setSlotLoaded = (slot: SlotIndex, loaded: boolean): void => {
    setDual((p) => {
      const next: [boolean, boolean] = [...p.slotLoaded] as [boolean, boolean];
      next[slot] = loaded;
      if (next[0] === p.slotLoaded[0] && next[1] === p.slotLoaded[1]) return p;
      return { ...p, slotLoaded: next };
    });
  };

  const deckContentKey = `${element.element_id}:${src}`;
  const visibleSlideLoaded =
    !src || total === 0
      ? true
      : lightweight
        ? singleLoaded
        : dual.slotLoaded[dual.visible];

  useEffect(() => {
    if (!onPlaybackLoadingChange) return;
    if (!playbackGateActive) {
      onPlaybackLoadingChange(false);
      return;
    }
    onPlaybackLoadingChange(!visibleSlideLoaded);
  }, [
    playbackGateActive,
    visibleSlideLoaded,
    onPlaybackLoadingChange,
    deckContentKey,
    safeIndex,
  ]);

  if (mode === "thumbnail") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center rounded-md border border-slate-600/50 bg-slate-900/75 text-slate-200">
        <Presentation className="h-8 w-8" />
        <span className="mt-2 max-w-full truncate px-2 text-xs">
          {element.name || "PPT"}
        </span>
      </div>
    );
  }

  if (!src || total === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center rounded-md border border-dashed border-slate-600 bg-slate-900/70 px-3 text-center text-slate-300">
        <FileIcon className="h-8 w-8" />
        <span className="mt-2 text-xs">
          {!src ? t("coursewarePreview.ppt.noSource") : t("coursewarePreview.ppt.noPages")}
        </span>
      </div>
    );
  }

  const showNav = total > 1;
  /** Takes no click space when not hovered; in edit mode the group is on the canvas StageElement (`group/ppt`) */
  const navBtnReveal = editorCanvasDragThrough
    ? "!opacity-0 pointer-events-none transition-opacity duration-150 group-hover/ppt:!opacity-100 group-hover/ppt:pointer-events-auto group-focus-within/ppt:!opacity-100 group-focus-within/ppt:pointer-events-auto group-hover/ppt:disabled:!opacity-30 group-focus-within/ppt:disabled:!opacity-30"
    : "!opacity-0 pointer-events-none transition-opacity duration-150 group-hover:!opacity-100 group-hover:pointer-events-auto group-focus-within:!opacity-100 group-focus-within:pointer-events-auto group-hover:disabled:!opacity-30 group-focus-within:disabled:!opacity-30";
  const badgeReveal = editorCanvasDragThrough
    ? "opacity-0 transition-opacity duration-150 group-hover/ppt:opacity-100 group-focus-within/ppt:opacity-100"
    : "opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100";

  /** Opacity animation of layers and iframes is enabled only when page 1 isn't a first visit (when the parent in preview also has opacity+transform, the child transition relies on its own compositing layer). */
  const useSlideOpacityTransition = everLeftFirstSlide || safeIndex !== 0;
  const layerOpacityClass = useSlideOpacityTransition
    ? LAYER_TRANSITION_CLASS
    : NO_LAYER_TRANSITION_CLASS;
  const singleLayerClass = lightweight ? NO_LAYER_TRANSITION_CLASS : layerOpacityClass;

  const rootGroupClass = editorCanvasDragThrough ? "" : "group";
  const rootPointerClass = editorCanvasDragThrough ? "pointer-events-none" : "";

  return (
    <div
      className={`${rootGroupClass} relative h-full w-full overflow-hidden rounded-md bg-white isolate ${rootPointerClass}`.trim()}
      style={{ transform: "translateZ(0)" }}
    >
      <div className="relative z-0 h-full w-full bg-slate-50">
        {lightweight ? (
          (() => {
            if (singleSlideNum === undefined) return null;
            const url = resolvePptSlideHtmlUrl(element, singleSlideNum) || buildPptSlideHtmlUrl(src, singleSlideNum);
            if (!url) return null;
            return (
              <div
                className={`absolute inset-0 overflow-hidden bg-white ${singleLayerClass} ${
                  editorCanvasDragThrough
                    ? "z-2 pointer-events-none opacity-100"
                    : "z-2 pointer-events-auto opacity-100"
                }`}
                aria-hidden={false}
              >
                <iframe
                  key={`${deckContentKey}-single-${safeIndex}-${singleSlideNum}`}
                  title={`${element.name || element.element_id} · slide ${singleSlideNum}`}
                  src={url}
                  className={`h-full w-full border-0 bg-white ${singleLayerClass} ${
                    singleLoaded ? "opacity-100" : "opacity-0"
                  } ${editorCanvasDragThrough ? "pointer-events-none" : ""}`}
                  sandbox="allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-scripts"
                  referrerPolicy="no-referrer"
                  onLoad={() => setSingleLoaded(true)}
                />
                {!singleLoaded ? (
                  <div
                    className={`absolute inset-0 z-2 flex flex-col items-center justify-center gap-2 bg-slate-50 text-slate-500 ${editorCanvasDragThrough ? "pointer-events-none" : ""}`}
                    aria-busy="true"
                    aria-live="polite"
                  >
                    <Loader2 className="h-8 w-8 animate-spin text-slate-400" aria-hidden />
                    <span className="text-xs">{t("coursewarePreview.ppt.loadingSlide")}</span>
                  </div>
                ) : null}
              </div>
            );
          })()
        ) : (
          /*
            The slots' DOM order must stay fixed (always 0 → 1). Swapping the render order by "current page"
            would make React move nodes, and the browser's opacity transition often doesn't interpolate properly, so only some switches would fade.
            The current page sits above the preload layer with a higher z-index, cross-fading through opacity.
          */
          ([0, 1] as const).map((slot) => {
            const slideIdx = dual.slotSlideIdx[slot];
            if (slideIdx === null) return null;
            const slideNum = effectiveSlides[slideIdx];
            const url = resolvePptSlideHtmlUrl(element, slideNum) || buildPptSlideHtmlUrl(src, slideNum);
            if (!url) return null;
            const isVisible = dual.visible === slot;
            const loaded = dual.slotLoaded[slot];
            return (
              <div
                key={`slot-${slot}`}
                className={`absolute inset-0 overflow-hidden bg-white ${layerOpacityClass} ${
                  isVisible
                    ? editorCanvasDragThrough
                      ? "z-2 pointer-events-none opacity-100"
                      : "z-2 pointer-events-auto opacity-100"
                    : "z-1 pointer-events-none opacity-0"
                }`}
                aria-hidden={!isVisible}
              >
                <iframe
                  key={`${deckContentKey}-${slot}-${slideIdx}-${slideNum}`}
                  title={`${element.name || element.element_id} · slide ${slideNum}`}
                  src={url}
                  className={`h-full w-full border-0 bg-white ${layerOpacityClass} ${
                    loaded ? "opacity-100" : "opacity-0"
                  } ${editorCanvasDragThrough ? "pointer-events-none" : ""}`}
                  sandbox="allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-scripts"
                  referrerPolicy="no-referrer"
                  onLoad={() => setSlotLoaded(slot, true)}
                />
                {isVisible && !loaded ? (
                  <div
                    className={`absolute inset-0 z-2 flex flex-col items-center justify-center gap-2 bg-slate-50 text-slate-500 ${editorCanvasDragThrough ? "pointer-events-none" : ""}`}
                    aria-busy="true"
                    aria-live="polite"
                  >
                    <Loader2 className="h-8 w-8 animate-spin text-slate-400" aria-hidden />
                    <span className="text-xs">{t("coursewarePreview.ppt.loadingSlide")}</span>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
      {/* suppressNavReveal during playback: the whole block isn't mounted, so disabled:opacity-30 can't override opacity-0 and still show a gray button */}
      {showNav && !suppressNavReveal ? (
        <>
          <button
            type="button"
            aria-label={t("coursewarePreview.ppt.prevPage")}
            data-ppt-slide-nav=""
            disabled={safeIndex <= 0}
            onClick={(event) => {
              event.stopPropagation();
              goTo(safeIndex - 1);
            }}
            onPointerDown={(event) => event.stopPropagation()}
            className={`absolute left-2 top-1/2 z-10 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-slate-900/60 text-white shadow ring-1 ring-white/20 backdrop-blur hover:bg-slate-900/80 disabled:cursor-not-allowed disabled:opacity-30 ${navBtnReveal}`}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={t("coursewarePreview.ppt.nextPage")}
            data-ppt-slide-nav=""
            disabled={safeIndex >= total - 1}
            onClick={(event) => {
              event.stopPropagation();
              goTo(safeIndex + 1);
            }}
            onPointerDown={(event) => event.stopPropagation()}
            className={`absolute right-2 top-1/2 z-10 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-slate-900/60 text-white shadow ring-1 ring-white/20 backdrop-blur hover:bg-slate-900/80 disabled:cursor-not-allowed disabled:opacity-30 ${navBtnReveal}`}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <div
            className={`pointer-events-none absolute bottom-2 right-2 z-10 select-none rounded bg-slate-900/60 px-2 py-0.5 text-[11px] font-medium text-white shadow ring-1 ring-white/20 backdrop-blur ${badgeReveal}`}
            aria-hidden
          >
            {safeIndex + 1} / {total}
          </div>
        </>
      ) : null}
    </div>
  );
}

export default PPTRenderer;
