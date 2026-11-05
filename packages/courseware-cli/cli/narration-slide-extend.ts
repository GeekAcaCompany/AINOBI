// SPDX-License-Identifier: AGPL-3.0-only
/**
 * When narration audio is longer than the slide, bump existing visual elements'
 * timeline.end_at (recursively) so visuals do not exit before TTS finishes.
 *
 * Narration + vtuber tracks are skipped: each AI-teacher pair keeps its own
 * window so a later narration insert can stagger without stretching earlier
 * speech/avatar into the next segment.
 *
 * When the slide end is shortened (--fit-slide shorter than current slide),
 * clamp timelines, keyframes, animations, and highlights into the new end.
 */

const MIN_HIGHLIGHT_DURATION_MS = 500;
const TIMELINE_END_EPSILON_MS = 50;
/** Speech/avatar tracks must not be stretched when appending another narration. */
const SKIP_EXTEND_ELEMENT_TYPES = new Set(["narration", "vtuber"]);

const clampNum = (value: number, lo: number, hi: number): number => Math.min(Math.max(value, lo), hi);

export type ExtendChildrenEndOptions = {
  /**
   * Only extend elements whose end_at already reached this absolute time
   * (within epsilon). When omitted, every non-skipped element is extended.
   */
  onlyIfEndAtLeastMs?: number;
  skipElementTypes?: ReadonlySet<string>;
};

export const extendElementEndTimesDeep = (
  element: unknown,
  deltaMs: number,
  options: ExtendChildrenEndOptions = {},
): unknown => {
  if (deltaMs <= 0 || element === null || typeof element !== "object" || Array.isArray(element)) {
    return element;
  }
  const node = element as Record<string, unknown>;
  const skipTypes = options.skipElementTypes ?? SKIP_EXTEND_ELEMENT_TYPES;
  const elementType = typeof node.element_type === "string" ? node.element_type : "";
  if (skipTypes.has(elementType)) {
    return element;
  }

  const out: Record<string, unknown> = { ...node };
  const timeline = out.timeline;
  if (timeline && typeof timeline === "object" && !Array.isArray(timeline)) {
    const t = timeline as Record<string, unknown>;
    const endAt = t.end_at;
    const shouldExtend =
      typeof endAt === "number" &&
      Number.isFinite(endAt) &&
      (options.onlyIfEndAtLeastMs === undefined ||
        endAt >= options.onlyIfEndAtLeastMs - TIMELINE_END_EPSILON_MS);
    if (shouldExtend) {
      out.timeline = { ...t, end_at: endAt + deltaMs };
    }
  }
  const kids = out.children_elements;
  if (Array.isArray(kids)) {
    out.children_elements = kids.map((child) => extendElementEndTimesDeep(child, deltaMs, options));
  }
  return out;
};

export const extendSerializedChildrenEndByDelta = (
  children: unknown[],
  deltaMs: number,
  options: ExtendChildrenEndOptions = {},
): unknown[] =>
  deltaMs <= 0 ? children : children.map((child) => extendElementEndTimesDeep(child, deltaMs, options));

export const clampElementToMaxEndDeep = (element: unknown, maxEndMs: number): unknown => {
  if (element === null || typeof element !== "object" || Array.isArray(element)) {
    return element;
  }
  const node = element as Record<string, unknown>;
  const out: Record<string, unknown> = { ...node };
  const timeline = out.timeline;
  if (timeline && typeof timeline === "object" && !Array.isArray(timeline)) {
    const t = timeline as Record<string, unknown>;
    const startRaw = typeof t.start_at === "number" && Number.isFinite(t.start_at) ? t.start_at : 0;
    const endRaw = typeof t.end_at === "number" && Number.isFinite(t.end_at) ? t.end_at : maxEndMs;
    let newEnd = Math.min(endRaw, maxEndMs);
    let newStart = Math.min(startRaw, newEnd);
    newEnd = Math.max(newEnd, newStart);
    out.timeline = { ...t, start_at: newStart, end_at: newEnd };
  }

  const tLine = out.timeline as Record<string, unknown> | undefined;
  const elStart = typeof tLine?.start_at === "number" && Number.isFinite(tLine.start_at as number) ? (tLine.start_at as number) : 0;
  const elEnd = typeof tLine?.end_at === "number" && Number.isFinite(tLine.end_at as number) ? (tLine.end_at as number) : maxEndMs;

  if (Array.isArray(out.keyframes)) {
    out.keyframes = out.keyframes.map((kf) => {
      if (!kf || typeof kf !== "object" || Array.isArray(kf)) return kf;
      const k = kf as Record<string, unknown>;
      const at = k.at;
      if (typeof at !== "number" || !Number.isFinite(at)) return k;
      return { ...k, at: clampNum(at, elStart, elEnd) };
    });
  }

  if (Array.isArray(out.animations)) {
    out.animations = out.animations.map((anim) => {
      if (!anim || typeof anim !== "object" || Array.isArray(anim)) return anim;
      const a = anim as Record<string, unknown>;
      const s = typeof a.start_at === "number" && Number.isFinite(a.start_at) ? (a.start_at as number) : elStart;
      const e = typeof a.end_at === "number" && Number.isFinite(a.end_at) ? (a.end_at as number) : elEnd;
      let newE = clampNum(e, elStart, elEnd);
      let newS = clampNum(s, elStart, newE);
      newE = Math.max(newE, newS);
      return { ...a, start_at: newS, end_at: newE };
    });
  }

  if (Array.isArray(out.highlight_segments)) {
    out.highlight_segments = out.highlight_segments.map((hi) => {
      if (!hi || typeof hi !== "object" || Array.isArray(hi)) return hi;
      const h = hi as Record<string, unknown>;
      let hEnd = typeof h.end_at === "number" && Number.isFinite(h.end_at) ? (h.end_at as number) : elEnd;
      let hStart = typeof h.start_at === "number" && Number.isFinite(h.start_at) ? (h.start_at as number) : elStart;
      hEnd = clampNum(hEnd, elStart, elEnd);
      hStart = clampNum(hStart, elStart, hEnd);
      if (hEnd - hStart < MIN_HIGHLIGHT_DURATION_MS) {
        hEnd = Math.min(elEnd, hStart + MIN_HIGHLIGHT_DURATION_MS);
        hStart = Math.max(elStart, hEnd - MIN_HIGHLIGHT_DURATION_MS);
      }
      return { ...h, start_at: hStart, end_at: hEnd };
    });
  }

  const kids = out.children_elements;
  if (Array.isArray(kids)) {
    out.children_elements = kids.map((child) => clampElementToMaxEndDeep(child, maxEndMs));
  }
  return out;
};

export const clampSerializedChildrenToMaxEnd = (children: unknown[], maxEndMs: number): unknown[] =>
  children.map((child) => clampElementToMaxEndDeep(child, maxEndMs));
