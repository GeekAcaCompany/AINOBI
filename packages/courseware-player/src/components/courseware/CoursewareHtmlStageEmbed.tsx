// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import coursewareAssetsApi from "../../api/courseware_assets.ts";
import { extractCoursewareAssetFilePath } from "../../api/courseware.ts";
import { rewriteHtmlSlideAssets } from "../../lib/courseware/html-asset-rewrite.ts";
import {
  invalidateHtmlSourceAutofitCache,
  invalidateHtmlSourceAutofitCacheForCourseware,
  peekHtmlSourceAutofitMemoryCache,
  readHtmlSourceAutofitCache,
  resolveHtmlSourceAutofitCacheKey,
  runDedupedHtmlSourceAutofitFetch,
  storeHtmlSourceAutofitCache,
  type FetchHtmlSourceResult,
} from "../../lib/courseware/html-source-autofit-cache.ts";

export {
  invalidateHtmlSourceAutofitCache,
  invalidateHtmlSourceAutofitCacheAsync,
  invalidateHtmlSourceAutofitCacheForCourseware,
  invalidateHtmlSourceAutofitCacheForCoursewareAsync,
  resolveHtmlSourceAutofitCacheKey,
  type FetchHtmlSourceResult,
} from "../../lib/courseware/html-source-autofit-cache.ts";

/** Written by the editor's main canvas; read by the minimap / slide thumbnails. Previews don't use this table. */
const editorStageHtmlBaselineByElementId = new Map<string, number>();

/** Temporary baseline for thumbnails before the stage has rendered the element. */
const fitThumbHtmlBaselineByElementId = new Map<string, number>();

/** The main stage and thumbnails share the content measurement of the same HTML element, so previews stay consistent. */
const htmlEmbedContentSizeByKey = new Map<string, { width: number; height: number }>();

export const HTML_CONTENT_ZOOM_MIN = 1;
export const HTML_CONTENT_ZOOM_MAX = 2.5;
export const HTML_CONTENT_ZOOM_STEP = 0.05;
export const HTML_CONTENT_ZOOM_DEFAULT = 1;

export function resolveHtmlContentZoom(value: number | undefined | null): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return HTML_CONTENT_ZOOM_DEFAULT;
  return Math.min(HTML_CONTENT_ZOOM_MAX, Math.max(HTML_CONTENT_ZOOM_MIN, n));
}

/**
 * Virtual-viewport ("DPI") layout: shrink the iframe layout viewport by `contentZoom`,
 * magnify with CSS scale, then paint the logical box onto the element frame.
 * `paintScale` always fills the element box — never shrinks due to overflow measurements.
 */
export function resolveHtmlEmbedViewportPaint(input: {
  widthLogical: number;
  heightLogical: number;
  targetWidthPx: number;
  targetHeightPx: number;
  contentZoom?: number;
  contentSize?: { width: number; height: number } | null;
}): {
  viewportW: number;
  viewportH: number;
  boxLayoutW: number;
  boxLayoutH: number;
  dpiScale: number;
  paintScale: number;
  offsetX: number;
  offsetY: number;
} {
  const dpiScale = resolveHtmlContentZoom(input.contentZoom);
  const boxLayoutW = Math.max(1, Math.round(input.widthLogical));
  const boxLayoutH = Math.max(1, Math.round(input.heightLogical));
  const viewportW = Math.max(1, Math.round(boxLayoutW / dpiScale));
  const viewportH = Math.max(1, Math.round(boxLayoutH / dpiScale));

  const paintScale = Math.max(
    input.targetWidthPx / boxLayoutW,
    input.targetHeightPx / boxLayoutH,
    1e-4,
  );

  return {
    viewportW,
    viewportH,
    boxLayoutW,
    boxLayoutH,
    dpiScale,
    paintScale,
    offsetX: 0,
    offsetY: 0,
  };
}

export const HTML_AUTOFIT_MESSAGE_TYPE = "ainobi:html-autofit-size";

export function htmlEmbedContentSizeCacheKey(
  elementId: string,
  src: string,
  contentZoom?: number,
): string {
  return `${elementId}\0${src.trim()}\0${resolveHtmlContentZoom(contentZoom)}`;
}

export function peekEditorStageHtmlBaseline(elementId: string): number | undefined {
  return editorStageHtmlBaselineByElementId.get(elementId);
}

export function publishEditorStageHtmlBaseline(elementId: string, proposed: number): number {
  const existing = editorStageHtmlBaselineByElementId.get(elementId);
  if (existing != null) return existing;
  const baseline = Math.max(proposed, 1e-4);
  editorStageHtmlBaselineByElementId.set(elementId, baseline);
  return baseline;
}

function resolveFitThumbHtmlBaseline(
  elementId: string,
  proposed: number,
  preferStage = true,
): number {
  if (preferStage) {
    const fromStage = editorStageHtmlBaselineByElementId.get(elementId);
    if (fromStage != null) return fromStage;
  }
  const existing = fitThumbHtmlBaselineByElementId.get(elementId);
  if (existing != null) return existing;
  const baseline = Math.max(proposed, 1e-4);
  fitThumbHtmlBaselineByElementId.set(elementId, baseline);
  return baseline;
}

export type CoursewareHtmlStageEmbedProps = {
  elementId: string;
  title: string;
  src: string;
  /** Slide logical width / height of the HTML box (same units as `Scene` coordinates). */
  widthLogical: number;
  heightLogical: number;
  /** Current editor / preview canvas scale (pixels per logical slide unit). */
  scale: number;
  /**
   * When set, scale the painted box to fit inside these CSS pixels (contain).
   * Used by editor slide thumbnails / minimap.
   */
  targetSizePx?: { width: number; height: number };
  /**
   * Main-canvas scale while fitting into {@link targetSizePx}. Seeds fit baseline when the
   * editor stage has not published one yet.
   */
  layoutScale?: number;
  /** When true, the CSS zoom follows the canvas scale; editor thumbnails should keep false and only scale the outer container. */
  syncCanvasZoom?: boolean;
  /**
   * Whether thumbnails reuse the main stage iframe layout baseline. The minimap uses false, so the layout matches the thumbnail frame's scale and content isn't too small.
   */
  preferStageLayoutBaseline?: boolean;
  /** Preview page stage: uses its own baseline, not shared with the editor session. */
  previewStage?: boolean;
  /** Preview playback: pause the timeline until the iframe finishes loading. */
  playbackGateActive?: boolean;
  onPlaybackLoadingChange?: (loading: boolean) => void;
  /** Shown while a remote HTML asset is being proxied / fetched for srcDoc. */
  loadingLabel?: string;
  /** Title when remote HTML could not be loaded (proxy + direct fetch both failed). */
  loadFailedTitle?: string;
  /** User-controlled scale of embedded HTML content inside the element box (1 = default). */
  contentZoom?: number;
};

/** Contain-fit scale + iframe layout scale for editor thumbnails / minimap. */
export function resolveHtmlEmbedFitLayout(input: {
  widthLogical: number;
  heightLogical: number;
  targetWidthPx: number;
  targetHeightPx: number;
  /** Frozen iframe layout scale (first main-canvas scale for this embed). */
  layoutBaselineScale: number;
  /** Current main-canvas scale; multiplies CSS zoom when {@link syncCanvasZoom} is true. */
  layoutScale?: number;
  syncCanvasZoom?: boolean;
}): {
  fitScale: number;
  layoutBaselineScale: number;
  layoutScale: number;
  wTarget: number;
  hTarget: number;
  layoutW: number;
  layoutH: number;
  zoomMul: number;
} {
  const { widthLogical, heightLogical, targetWidthPx, targetHeightPx, layoutBaselineScale } = input;
  const fitScale = Math.max(
    1e-4,
    Math.min(targetWidthPx / widthLogical, targetHeightPx / heightLogical),
  );
  const s0 = Math.max(layoutBaselineScale, 1e-4);
  const currentScale = input.syncCanvasZoom
    ? Math.max(input.layoutScale ?? layoutBaselineScale, 1e-4)
    : s0;
  const wTarget = widthLogical * fitScale;
  const hTarget = heightLogical * fitScale;
  const layoutW = Math.max(1, Math.round(widthLogical * s0));
  const layoutH = Math.max(1, Math.round(heightLogical * s0));
  const baseZoomMul = Math.max(wTarget / layoutW, hTarget / layoutH);
  const zoomMul = baseZoomMul * (currentScale / s0);
  return {
    fitScale,
    layoutBaselineScale: s0,
    layoutScale: currentScale,
    wTarget,
    hTarget,
    layoutW,
    layoutH,
    zoomMul,
  };
}

export function resolveHtmlEmbedContentFitLayout(input: {
  layoutW: number;
  layoutH: number;
  targetWidthPx: number;
  targetHeightPx: number;
  fallbackZoomMul: number;
  contentSize?: { width: number; height: number } | null;
}): {
  layoutW: number;
  layoutH: number;
  zoomMul: number;
  offsetX: number;
  offsetY: number;
  contentFitActive: boolean;
} {
  const baseLayoutW = Math.max(1, input.layoutW);
  const baseLayoutH = Math.max(1, input.layoutH);
  const rawContentW = input.contentSize?.width ?? 0;
  const rawContentH = input.contentSize?.height ?? 0;
  const contentW = Number.isFinite(rawContentW) ? Math.ceil(rawContentW) : 0;
  const contentH = Number.isFinite(rawContentH) ? Math.ceil(rawContentH) : 0;

  const noContent = contentW <= 0 || contentH <= 0;
  if (noContent) {
    return {
      layoutW: baseLayoutW,
      layoutH: baseLayoutH,
      zoomMul: input.fallbackZoomMul,
      offsetX: 0,
      offsetY: 0,
      contentFitActive: false,
    };
  }

  const contentOverflows =
    contentW > baseLayoutW + 1 || contentH > baseLayoutH + 1;
  if (!contentOverflows) {
    return {
      layoutW: baseLayoutW,
      layoutH: baseLayoutH,
      zoomMul: input.fallbackZoomMul,
      offsetX: 0,
      offsetY: 0,
      contentFitActive: false,
    };
  }

  /** Only expand the iframe viewport — never shrink below the element box (shrinking reflows responsive HTML into a narrow column). */
  const layoutW = Math.max(baseLayoutW, contentW);
  const layoutH = Math.max(baseLayoutH, contentH);
  const zoomMul = Math.max(
    1e-4,
    Math.min(input.targetWidthPx / layoutW, input.targetHeightPx / layoutH),
  );
  const paintedW = layoutW * zoomMul;
  const paintedH = layoutH * zoomMul;
  return {
    layoutW,
    layoutH,
    zoomMul,
    offsetX: Math.max(0, (input.targetWidthPx - paintedW) / 2),
    offsetY: Math.max(0, (input.targetHeightPx - paintedH) / 2),
    contentFitActive: true,
  };
}

/**
 * Main editor / preview stage and slide thumbnails: iframe layout is always the element's
 * logical box (slide coordinates). CSS scale maps that viewport onto the painted target box.
 */
export function resolveHtmlEmbedStageLayout(input: {
  widthLogical: number;
  heightLogical: number;
  targetWidthPx: number;
  targetHeightPx: number;
}): {
  layoutW: number;
  layoutH: number;
  targetW: number;
  targetH: number;
  zoomMul: number;
} {
  const layoutW = Math.max(1, Math.round(input.widthLogical));
  const layoutH = Math.max(1, Math.round(input.heightLogical));
  const targetW = input.targetWidthPx;
  const targetH = input.targetHeightPx;
  const zoomMul = Math.max(targetW / layoutW, targetH / layoutH, 1e-4);
  return { layoutW, layoutH, targetW, targetH, zoomMul };
}

export function decodeInlineHtmlDataUrl(src: string): string | null {
  const trimmed = src.trim();
  if (!trimmed.toLowerCase().startsWith("data:text/html")) return null;
  const commaIndex = trimmed.indexOf(",");
  if (commaIndex < 0) return null;
  const meta = trimmed.slice(0, commaIndex).toLowerCase();
  const payload = trimmed.slice(commaIndex + 1);
  try {
    if (meta.includes(";base64")) {
      return globalThis.atob(payload);
    }
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}

function looksLikeHtmlMarkup(text: string): boolean {
  const sample = text.trim().slice(0, 512).toLowerCase();
  return (
    sample.includes("<html") ||
    sample.includes("<!doctype") ||
    sample.includes("<body") ||
    sample.includes("<div")
  );
}

function resolveEmbedCoursewareId(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("courseware_id")?.trim() || null;
}

function resolveEmbedSectionId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get("section_id")?.trim() || undefined;
}

async function fetchHtmlSourceForAutofitUncached(
  src: string,
  coursewareId?: string | null,
): Promise<FetchHtmlSourceResult> {
  const trimmed = src.trim();
  if (!trimmed || !isRemoteHtmlSrc(trimmed)) {
    return { ok: false, error: "Unsupported HTML source URL." };
  }

  const errors: string[] = [];
  const cwId = coursewareId?.trim() || resolveEmbedCoursewareId();
  const assetKey = extractCoursewareAssetFilePath(trimmed);
  if (cwId && assetKey) {
    try {
      const proxied = await coursewareAssetsApi.readAssetText(cwId, trimmed, {
        sectionId: resolveEmbedSectionId(),
      });
      if (looksLikeHtmlMarkup(proxied)) {
        return { ok: true, html: proxied };
      }
      errors.push("Server proxy returned non-HTML content.");
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  } else if (!cwId) {
    errors.push("Missing courseware_id — cannot use server HTML proxy.");
  } else if (!assetKey) {
    errors.push("URL is not a registered courseware asset path.");
  }

  try {
    const response = await fetch(trimmed, { credentials: "omit", cache: "force-cache" });
    if (!response.ok) {
      errors.push(`Direct fetch failed (HTTP ${response.status}).`);
    } else {
      const text = await response.text();
      if (looksLikeHtmlMarkup(text)) {
        return { ok: true, html: text };
      }
      errors.push("Direct fetch returned non-HTML content.");
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const detail = errors.filter(Boolean).join(" ");
  return {
    ok: false,
    error: detail || "Failed to load HTML.",
  };
}

/** Fetch remote HTML for same-origin srcDoc embed (server proxy, then direct GET). */
export async function fetchHtmlSourceForAutofit(
  src: string,
  coursewareId?: string | null,
): Promise<FetchHtmlSourceResult> {
  const cacheKey = resolveHtmlSourceAutofitCacheKey(src, coursewareId);
  if (!cacheKey) {
    return { ok: false, error: "Unsupported HTML source URL." };
  }

  const memoryHit = peekHtmlSourceAutofitMemoryCache(cacheKey);
  if (memoryHit) return memoryHit;

  return runDedupedHtmlSourceAutofitFetch(cacheKey, async () => {
    const persisted = await readHtmlSourceAutofitCache(cacheKey);
    if (persisted) return persisted;

    const result = await fetchHtmlSourceForAutofitUncached(src, coursewareId);
    if (result.ok) {
      storeHtmlSourceAutofitCache(cacheKey, result);
    }
    return result;
  });
}

export function isRemoteHtmlSrc(src: string): boolean {
  const trimmed = src.trim().toLowerCase();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
}

export function resolveBaseHrefFromUrl(src: string): string {
  try {
    const url = new URL(src);
    const path = url.pathname;
    const slash = path.lastIndexOf("/");
    if (slash >= 0) {
      url.pathname = `${path.slice(0, slash + 1)}`;
    }
    return url.toString();
  } catch {
    return src;
  }
}

export function injectBaseTag(html: string, baseHref: string): string {
  const escaped = baseHref.replace(/"/g, "&quot;");
  const tag = `<base href="${escaped}">`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}${tag}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (match) => `${match}<head>${tag}</head>`);
  }
  return `<head>${tag}</head>${html}`;
}

export function measureHtmlDocumentContentSize(doc: Document): { width: number; height: number } {
  const html = doc.documentElement;
  const body = doc.body;
  if (!html || !body) return { width: 0, height: 0 };

  const scrollX = doc.defaultView?.scrollX ?? 0;
  const scrollY = doc.defaultView?.scrollY ?? 0;

  let maxRight = 0;
  let maxBottom = 0;
  const measureNode = (node: Element): void => {
    if (!(node instanceof HTMLElement)) return;
    const rect = node.getBoundingClientRect();
    if (!Number.isFinite(rect.right) || !Number.isFinite(rect.bottom)) return;
    if (rect.width < 1 && rect.height < 1) return;
    maxRight = Math.max(maxRight, rect.right + scrollX);
    maxBottom = Math.max(maxBottom, rect.bottom + scrollY);
  };

  for (const child of Array.from(body.children)) {
    measureNode(child);
  }
  for (const node of body.querySelectorAll("*")) {
    measureNode(node);
  }

  const scrollW = Math.max(html.scrollWidth, body.scrollWidth, html.clientWidth, body.clientWidth);
  const scrollH = Math.max(
    html.scrollHeight,
    body.scrollHeight,
    html.clientHeight,
    body.clientHeight,
  );
  const viewportW = Math.max(html.clientWidth, body.clientWidth);
  const viewportH = Math.max(html.clientHeight, body.clientHeight);

  if (maxRight <= 0 || maxBottom <= 0) {
    return {
      width: Math.ceil(Math.min(scrollW, viewportW || scrollW)),
      height: Math.ceil(Math.min(scrollH, viewportH || scrollH)),
    };
  }

  return {
    width: Math.ceil(Math.min(maxRight, scrollW, viewportW || scrollW)),
    height: Math.ceil(Math.min(maxBottom, scrollH, viewportH || scrollH)),
  };
}

export function injectHtmlAutofitReporter(html: string, elementId: string, nonce: string): string {
  const script = `
<script>
(() => {
  const TYPE = ${JSON.stringify(HTML_AUTOFIT_MESSAGE_TYPE)};
  const ELEMENT_ID = ${JSON.stringify(elementId)};
  const NONCE = ${JSON.stringify(nonce)};
  const measure = () => {
    const doc = document;
    const html = doc.documentElement;
    const body = doc.body;
    if (!html || !body) return;
    let maxRight = 0;
    let maxBottom = 0;
    const measureNode = (node) => {
      if (!(node instanceof HTMLElement)) return;
      const rect = node.getBoundingClientRect();
      if (!Number.isFinite(rect.right) || !Number.isFinite(rect.bottom)) return;
      if (rect.width < 1 && rect.height < 1) return;
      maxRight = Math.max(maxRight, rect.right + window.scrollX);
      maxBottom = Math.max(maxBottom, rect.bottom + window.scrollY);
    };
    for (const child of Array.from(body.children)) measureNode(child);
    for (const node of body.querySelectorAll("*")) measureNode(node);
    const scrollW = Math.max(html.scrollWidth, body.scrollWidth, html.clientWidth, body.clientWidth);
    const scrollH = Math.max(html.scrollHeight, body.scrollHeight, html.clientHeight, body.clientHeight);
    const viewportW = Math.max(html.clientWidth, body.clientWidth);
    const viewportH = Math.max(html.clientHeight, body.clientHeight);
    const width = maxRight > 0
      ? Math.ceil(Math.min(maxRight, scrollW, viewportW || scrollW))
      : Math.ceil(Math.min(scrollW, viewportW || scrollW));
    const height = maxBottom > 0
      ? Math.ceil(Math.min(maxBottom, scrollH, viewportH || scrollH))
      : Math.ceil(Math.min(scrollH, viewportH || scrollH));
    parent.postMessage({
      type: TYPE,
      elementId: ELEMENT_ID,
      nonce: NONCE,
      width,
      height,
    }, "*");
  };
  let raf = 0;
  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(measure);
  };
  window.addEventListener("load", schedule);
  window.addEventListener("resize", schedule);
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(schedule).observe(document.documentElement);
    if (document.body) new ResizeObserver(schedule).observe(document.body);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", schedule);
  }
  schedule();
})();
</script>`;
  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, `${script}</body>`);
  }
  return `${html}${script}`;
}

/**
 * Broken image/media fallback: a 404+nosniff response is blocked by the browser's ORB (net::ERR_BLOCKED_BY_ORB)
 * and leaves a broken image icon. onerror in the capture phase hides the failed media element, leaving the rest of the slide unaffected.
 * (Reference rewriting already switched assets that "exist" to signed loading; this catches references to objects that "never existed".)
 */
export function injectBrokenAssetSuppressor(html: string, nonce: string): string {
  const script = `<script nonce="${nonce}">(function(){document.addEventListener("error",function(e){var t=e.target;if(t&&(t.tagName==="IMG"||t.tagName==="SOURCE"||t.tagName==="AUDIO"||t.tagName==="VIDEO"||t.tagName==="TRACK")){if(t.style)t.style.display="none";}},true);})();</script>`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/(<head[^>]*>)/i, `$1${script}`);
  }
  return `${script}${html}`;
}

export function prepareHtmlForEmbed(
  html: string,
  sourceUrl: string | null,
  elementId: string,
  nonce: string,
): string {
  const withBase = sourceUrl ? injectBaseTag(html, resolveBaseHrefFromUrl(sourceUrl)) : html;
  const withSuppressor = injectBrokenAssetSuppressor(withBase, nonce);
  return injectHtmlAutofitReporter(withSuppressor, elementId, nonce);
}

/** HTML embed on the courseware stage (editor main canvas, preview, thumbnails). */
export function CoursewareHtmlStageEmbed({
  elementId,
  title,
  src,
  widthLogical,
  heightLogical,
  scale,
  targetSizePx,
  layoutScale: _layoutScale,
  syncCanvasZoom: _syncCanvasZoom = false,
  preferStageLayoutBaseline: _preferStageLayoutBaseline = true,
  previewStage: _previewStage = false,
  playbackGateActive = false,
  onPlaybackLoadingChange,
  loadingLabel = "Loading HTML…",
  loadFailedTitle = "Failed to load HTML",
  contentZoom,
}: CoursewareHtmlStageEmbedProps): ReactElement {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  /** Once the same src has loaded, no loading token is sent again (avoids getting stuck when an effect rerun doesn't fire load). */
  const iframeReadySrcRef = useRef<string | null>(null);
  const elementIdRef = useRef(elementId);
  const autofitNonceRef = useRef(
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  );
  const trimmedSrc = src.trim();
  const resolvedContentZoom = resolveHtmlContentZoom(contentZoom);
  const contentSizeCacheKey = htmlEmbedContentSizeCacheKey(
    elementId,
    trimmedSrc,
    resolvedContentZoom,
  );
  const [contentSize, setContentSize] = useState<{ width: number; height: number } | null>(
    () => htmlEmbedContentSizeByKey.get(contentSizeCacheKey) ?? null,
  );
  const [fetchedRemoteHtml, setFetchedRemoteHtml] = useState<string | null>(null);
  const [remoteLoadError, setRemoteLoadError] = useState<string | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(false);

  if (elementIdRef.current !== elementId) {
    elementIdRef.current = elementId;
    autofitNonceRef.current = `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2)}`;
  }

  const inlineHtml = useMemo(() => decodeInlineHtmlDataUrl(trimmedSrc), [trimmedSrc]);
  const remoteSrc = !inlineHtml && isRemoteHtmlSrc(trimmedSrc) ? trimmedSrc : null;

  useEffect(() => {
    setContentSize(htmlEmbedContentSizeByKey.get(contentSizeCacheKey) ?? null);
  }, [contentSizeCacheKey]);

  useEffect(() => {
    setFetchedRemoteHtml(null);
    setRemoteLoadError(null);
    setRemoteLoading(false);
    iframeReadySrcRef.current = null;

    if (!remoteSrc) return;

    let cancelled = false;
    setRemoteLoading(true);
    void fetchHtmlSourceForAutofit(remoteSrc).then(async (result) => {
      if (cancelled) return;
      setRemoteLoading(false);
      if (result.ok) {
        // After example-public went private, references inside slide html (relative paths / absolute aliyun URLs)
        // can't be loaded bare any more: presign them in bulk and rewrite to absolute signed URLs (rendered as-is on failure).
        const rewritten = await rewriteHtmlSlideAssets(result.html, remoteSrc, {
          coursewareId: resolveEmbedCoursewareId(),
          presign: (keys) => coursewareAssetsApi.batchPresignUrls(resolveEmbedCoursewareId() ?? undefined, keys),
        });
        if (cancelled) return;
        setFetchedRemoteHtml(rewritten);
        setRemoteLoadError(null);
      } else {
        setFetchedRemoteHtml(null);
        setRemoteLoadError(result.error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [remoteSrc]);

  const srcDoc = useMemo(() => {
    const html = inlineHtml ?? fetchedRemoteHtml;
    if (!html) return undefined;
    return prepareHtmlForEmbed(
      html,
      remoteSrc,
      elementId,
      autofitNonceRef.current,
    );
  }, [elementId, fetchedRemoteHtml, inlineHtml, remoteSrc]);

  const fitTarget = targetSizePx != null;
  const targetW = fitTarget ? targetSizePx.width : widthLogical * scale;
  const targetH = fitTarget ? targetSizePx.height : heightLogical * scale;
  const viewportPaint = resolveHtmlEmbedViewportPaint({
    widthLogical,
    heightLogical,
    targetWidthPx: targetW,
    targetHeightPx: targetH,
    contentZoom: resolvedContentZoom,
    contentSize,
  });
  const { viewportW, viewportH, dpiScale, paintScale, offsetX, offsetY } = viewportPaint;

  const applyMeasuredContentSize = (size: { width: number; height: number }): void => {
    if (size.width <= 0 || size.height <= 0) return;
    setContentSize((prev) => {
      if (
        prev &&
        Math.abs(prev.width - size.width) < 1 &&
        Math.abs(prev.height - size.height) < 1
      ) {
        return prev;
      }
      htmlEmbedContentSizeByKey.set(contentSizeCacheKey, size);
      return size;
    });
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as {
        type?: unknown;
        elementId?: unknown;
        nonce?: unknown;
        width?: unknown;
        height?: unknown;
      };
      if (!data || data.type !== HTML_AUTOFIT_MESSAGE_TYPE) return;
      if (data.elementId !== elementId || data.nonce !== autofitNonceRef.current) return;
      const width = typeof data.width === "number" ? data.width : Number(data.width);
      const height = typeof data.height === "number" ? data.height : Number(data.height);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return;
      }
      applyMeasuredContentSize({ width, height });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [elementId]);

  useEffect(() => {
    if (!srcDoc) return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    const measureFromParent = (): void => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) return;
        applyMeasuredContentSize(measureHtmlDocumentContentSize(doc));
      } catch {
        /* ignore */
      }
    };

    const onLoad = (): void => {
      measureFromParent();
      window.setTimeout(measureFromParent, 120);
      window.setTimeout(measureFromParent, 480);
    };

    iframe.addEventListener("load", onLoad);
    if (iframe.contentDocument?.readyState === "complete") {
      onLoad();
    }
    return () => iframe.removeEventListener("load", onLoad);
  }, [srcDoc, elementId]);

  useEffect(() => {
    if (!onPlaybackLoadingChange) return;
    if (!playbackGateActive) {
      onPlaybackLoadingChange(false);
      return;
    }
    if (remoteSrc && remoteLoadError) {
      onPlaybackLoadingChange(false);
      return;
    }
    if (remoteSrc && (remoteLoading || !srcDoc)) {
      onPlaybackLoadingChange(true);
      return () => {
        onPlaybackLoadingChange(false);
      };
    }
    const iframe = iframeRef.current;
    if (!iframe) {
      onPlaybackLoadingChange(true);
      return;
    }
    const clear = (): void => onPlaybackLoadingChange(false);
    const markLoading = (): void => onPlaybackLoadingChange(true);
    if (trimmedSrc && iframeReadySrcRef.current === trimmedSrc) {
      clear();
      return () => {
        onPlaybackLoadingChange(false);
      };
    }
    try {
      const doc = iframe.contentDocument;
      if (doc?.readyState === "complete") {
        iframeReadySrcRef.current = trimmedSrc;
        clear();
        return () => {
          onPlaybackLoadingChange(false);
        };
      }
    } catch {
      /* cross-origin: fall through to load listeners */
    }
    const onReady = (): void => {
      iframeReadySrcRef.current = trimmedSrc;
      clear();
    };
    markLoading();
    iframe.addEventListener("load", onReady);
    iframe.addEventListener("error", onReady);
    return () => {
      iframe.removeEventListener("load", onReady);
      iframe.removeEventListener("error", onReady);
      onPlaybackLoadingChange(false);
    };
  }, [playbackGateActive, trimmedSrc, onPlaybackLoadingChange, srcDoc, remoteSrc, remoteLoading, remoteLoadError]);

  if (remoteSrc && remoteLoading) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center text-slate-500 dark:text-slate-400">
        <Loader2 className="h-7 w-7 animate-spin opacity-70" aria-hidden />
        <span className="text-xs">{loadingLabel}</span>
      </div>
    );
  }

  if (remoteSrc && remoteLoadError) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-rose-400/70 bg-rose-50/80 px-3 py-4 text-center dark:border-rose-500/50 dark:bg-rose-950/30">
        <AlertCircle className="h-8 w-8 text-rose-500 dark:text-rose-400" aria-hidden />
        <span className="text-xs font-medium text-rose-700 dark:text-rose-300">{loadFailedTitle}</span>
        <p className="max-h-[40%] overflow-auto text-[10px] leading-snug text-rose-600/90 dark:text-rose-200/80">
          {remoteLoadError}
        </p>
      </div>
    );
  }

  const iframeSrc = undefined;
  const iframeSandbox = srcDoc
    ? "allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-scripts allow-same-origin"
    : "allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-scripts";

  return (
    <div className="h-full w-full overflow-hidden isolate">
      <div
        style={{
          width: viewportPaint.boxLayoutW,
          height: viewportPaint.boxLayoutH,
          transform: `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${paintScale})`,
          transformOrigin: "top left",
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
        }}
      >
        <div
          style={{
            width: viewportW,
            height: viewportH,
            transform: `scale(${dpiScale})`,
            transformOrigin: "top left",
            overflow: "hidden",
          }}
        >
          <iframe
            ref={iframeRef}
            title={title}
            src={iframeSrc}
            srcDoc={srcDoc}
            className="border-0 bg-transparent"
            style={{
              display: "block",
              width: viewportW,
              height: viewportH,
              backgroundColor: "transparent",
            }}
            sandbox={iframeSandbox}
            referrerPolicy="no-referrer"
            loading={playbackGateActive ? "eager" : "lazy"}
          />
        </div>
      </div>
    </div>
  );
}
