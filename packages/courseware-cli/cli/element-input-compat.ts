// SPDX-License-Identifier: AGPL-3.0-only
import { EFFECT_VALUES, type Effect } from "@ainobi/courseware-core/enums/effects.ts";
import { AinobiCliError, type CliIssue } from "./errors.ts";

const EFFECT_SET = new Set<string>(EFFECT_VALUES);

const CAMEL_TO_SNAKE_EFFECT: Record<string, Effect> = {
  fadeIn: "fade_in",
  fadeOut: "fade_out",
  scaleIn: "scale_in",
  scaleOut: "scale_out",
  rotateIn: "rotate_in",
  rotateOut: "rotate_out",
  translateIn: "translate_in",
  translateOut: "translate_out",
  none: "none",
};

export type ElementTypeAliasResult = {
  elementType: string;
  requestedType: string;
  warnings: CliIssue[];
};

export const resolveElementTypeAlias = (requestedType: string): ElementTypeAliasResult => ({
  elementType: requestedType,
  requestedType,
  warnings: [],
});

const normalizeEffectValue = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  if (EFFECT_SET.has(value)) return value;
  const mapped = CAMEL_TO_SNAKE_EFFECT[value];
  if (mapped) return mapped;
  const lower = value.toLowerCase();
  if (EFFECT_SET.has(lower)) return lower;
  const camelKey = value.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  const fromCamel = CAMEL_TO_SNAKE_EFFECT[camelKey];
  return fromCamel ?? value;
};

const readNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const hoistRootTimelineFields = (record: Record<string, unknown>): void => {
  const rootStart = readNumber(record.start_at);
  const rootDuration = readNumber(record.duration);
  const rootEnd = readNumber(record.end_at);
  if (rootStart === undefined && rootDuration === undefined && rootEnd === undefined) return;

  const timeline = { ...(record.timeline as Record<string, unknown> | undefined) };
  if (rootStart !== undefined && timeline.start_at === undefined) {
    timeline.start_at = rootStart;
  }
  const start = readNumber(timeline.start_at) ?? 0;
  if (rootEnd !== undefined && timeline.end_at === undefined) {
    timeline.end_at = rootEnd;
  } else if (rootDuration !== undefined && timeline.end_at === undefined) {
    timeline.end_at = start + rootDuration;
  }
  record.timeline = timeline;
  delete record.start_at;
  delete record.duration;
  delete record.end_at;
};

const normalizeEffectsInRecord = (record: Record<string, unknown>): void => {
  if ("enter_effect" in record) record.enter_effect = normalizeEffectValue(record.enter_effect);
  if ("exit_effect" in record) record.exit_effect = normalizeEffectValue(record.exit_effect);
  const animations = record.animations;
  if (Array.isArray(animations)) {
    record.animations = animations.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const anim = { ...(item as Record<string, unknown>) };
      if ("effect" in anim) anim.effect = normalizeEffectValue(anim.effect);
      return anim;
    });
  }
};

/** Agent-friendly aliases: root timeline fields and camelCase effects. */
export const normalizeElementInputRecord = (record: Record<string, unknown>): Record<string, unknown> => {
  const next = { ...record };
  hoistRootTimelineFields(next);
  normalizeEffectsInRecord(next);
  return next;
};

type ChildRef = { element_id?: unknown; element_type?: unknown; name?: unknown };

/**
 * Resolve a non-numeric element ref: exact element_id first, then a unique exact `name`
 * (agents often address elements by the name they gave). Unknown refs list the slide's
 * current children so the agent can retry without another read (prod: 108 stale-id
 * NOT_FOUND errors).
 */
export const resolveChildRefByIdOrName = (children: readonly ChildRef[], ref: string): number => {
  const byId = children.findIndex((child) => child.element_id === ref);
  if (byId >= 0) return byId;
  const byName = children.flatMap((child, index) => (child.name === ref ? [index] : []));
  if (byName.length === 1) return byName[0]!;
  const listing = children
    .slice(0, 30)
    .map((child, index) => `${index}:${String(child.element_id)} (${String(child.element_type)}) "${String(child.name ?? "")}"`)
    .join("; ");
  const more = children.length > 30 ? `; … ${children.length - 30} more` : "";
  if (byName.length > 1) {
    throw new AinobiCliError("NOT_FOUND", `element name "${ref}" is ambiguous (${byName.length} matches: indexes ${byName.join(", ")}). Use the element_id.`, {
      hint: `Current elements on this slide: ${listing}${more}`,
    });
  }
  throw new AinobiCliError("NOT_FOUND", `element not found: "${ref}".`, {
    hint: children.length > 0
      ? `Current elements on this slide (index:element_id (type) "name"): ${listing}${more}. Ids change when elements are deleted and re-inserted.`
      : "This slide has no elements.",
  });
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Fill gaps agents leave in a merged element record before strict validation. Prod
 * top validation failures were partial keyframes (rotation_deg / size / position /
 * easing / opacity "is a required field", 76 calls), numeric `text` (22) and root
 * `width` / `height` (18). Each fix is reported back so the agent learns the shape.
 */
export const fillElementInputGaps = (
  record: Record<string, unknown>,
): { record: Record<string, unknown>; fixes: string[] } => {
  const shape = normalizeElementShapeInput(record);
  const timing = fillElementTimingGaps(shape.record);
  return { record: timing.record, fixes: [...shape.fixes, ...timing.fixes] };
};

/**
 * Phase 1 (before canvas centering): numeric `text`, root width/height → size. Commands
 * run this before `--center-x/-y` so centering uses the final box size.
 */
export const normalizeElementShapeInput = (
  record: Record<string, unknown>,
): { record: Record<string, unknown>; fixes: string[] } => {
  const next = { ...record };
  const fixes: string[] = [];

  if (typeof next.text === "number" || typeof next.text === "boolean") {
    next.text = String(next.text);
    fixes.push("text was a number; stored as a string");
  }

  for (const axis of ["width", "height"] as const) {
    if (!(axis in next)) continue;
    const value = next[axis];
    delete next[axis];
    if (typeof value === "number" && Number.isFinite(value)) {
      next.size = { ...(isPlainRecord(next.size) ? next.size : {}), [axis]: value };
      fixes.push(`root ${axis} moved to size.${axis}`);
    } else {
      fixes.push(`dropped non-numeric root ${axis}`);
    }
  }

  return { record: next, fixes };
};

/**
 * Phase 2 (after canvas centering): complete partial keyframes from the element's final
 * transform and shift element-relative keyframe / highlight times into the timeline.
 */
export const fillElementTimingGaps = (
  record: Record<string, unknown>,
): { record: Record<string, unknown>; fixes: string[] } => {
  const next = { ...record };
  const fixes: string[] = [];

  if (Array.isArray(next.keyframes)) {
    const style = isPlainRecord(next.style) ? next.style : {};
    const base = {
      position: isPlainRecord(next.position) ? next.position : { x: 0, y: 0 },
      size: isPlainRecord(next.size) ? next.size : { width: 0, height: 0 },
      rotation_deg: typeof style.rotation_deg === "number" ? style.rotation_deg : 0,
      opacity: typeof style.opacity === "number" ? style.opacity : 1,
      easing: "linear",
    };
    const filledFields = new Set<string>();
    next.keyframes = next.keyframes.map((frame) => {
      if (!isPlainRecord(frame)) return frame;
      const filled = { ...frame };
      for (const [key, fallback] of Object.entries(base)) {
        if (filled[key] === undefined || filled[key] === null) {
          filled[key] = isPlainRecord(fallback) ? { ...fallback } : fallback;
          filledFields.add(key);
        } else if (isPlainRecord(fallback) && isPlainRecord(filled[key])) {
          // Partial position/size (e.g. only x) keep the element's other axis.
          filled[key] = { ...fallback, ...(filled[key] as Record<string, unknown>) };
        }
      }
      return filled;
    });
    if (filledFields.size > 0) {
      fixes.push(
        `keyframes missing ${[...filledFields].sort().join(", ")} were filled from the element's current transform (easing: linear)`,
      );
    }
  }

  shiftRelativeTimesIntoTimeline(next, fixes);

  return { record: next, fixes };
};

/**
 * Keyframe `at` and highlight ranges are absolute scene times. Agents often write them
 * relative to the element start (0..duration) — prod: 32 "must be inside element timeline"
 * failures. Only when every time is outside the timeline but the whole set fits after
 * adding timeline.start_at do we shift it; anything else is left for validation to reject.
 */
const shiftRelativeTimesIntoTimeline = (next: Record<string, unknown>, fixes: string[]): void => {
  const timeline = isPlainRecord(next.timeline) ? next.timeline : null;
  const start = typeof timeline?.start_at === "number" ? timeline.start_at : null;
  const end = typeof timeline?.end_at === "number" ? timeline.end_at : null;
  if (start === null || end === null || start <= 0) return;
  const inside = (t: number): boolean => t >= start && t <= end;
  const fitsShifted = (t: number): boolean => inside(t + start);

  if (Array.isArray(next.keyframes)) {
    const times = next.keyframes.map((frame) => (isPlainRecord(frame) && typeof frame.at === "number" ? frame.at : null));
    if (times.length > 0 && times.every((t) => t !== null) && !times.every((t) => inside(t!)) && times.every((t) => fitsShifted(t!))) {
      next.keyframes = next.keyframes.map((frame) => ({ ...(frame as Record<string, unknown>), at: (frame as { at: number }).at + start }));
      fixes.push(`keyframe times looked element-relative; shifted by timeline.start_at=${start}ms (keyframes use absolute scene time)`);
    }
  }

  if (Array.isArray(next.highlight_segments)) {
    const segs = next.highlight_segments;
    const ok = segs.every((seg) => isPlainRecord(seg) && typeof seg.start_at === "number" && typeof seg.end_at === "number");
    if (ok && segs.length > 0) {
      const ranges = segs as Array<{ start_at: number; end_at: number }>;
      const allInside = ranges.every((r) => inside(r.start_at) && inside(r.end_at));
      const allFitShifted = ranges.every((r) => fitsShifted(r.start_at) && fitsShifted(r.end_at));
      if (!allInside && allFitShifted) {
        next.highlight_segments = ranges.map((r) => ({ ...r, start_at: r.start_at + start, end_at: r.end_at + start }));
        fixes.push(`highlight times looked element-relative; shifted by timeline.start_at=${start}ms (highlights use absolute scene time)`);
      }
    }
  }
};
