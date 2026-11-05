// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shrinks CLI JSON responses for aggregate views (`slide get --with-children`,
 * `element list --verbose`) so huge inline strings (SVG source, data URLs,
 * long transcripts) do not dominate agent context. Full payloads remain
 * available via `element get <slide> <ref>`.
 */

export const DEFAULT_LARGE_STRING_THRESHOLD = 4096;
export const DEFAULT_LARGE_STRING_PREVIEW = 320;

export type CompactLargeStringsOptions = {
  /** When true, returns `value` unchanged (same reference). */
  full?: boolean;
  threshold?: number;
  previewChars?: number;
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Deep-walk JSON-like data. Long strings become a small descriptor object.
 */
export const compactLargeStrings = (
  value: unknown,
  options: CompactLargeStringsOptions = {},
): unknown => {
  const {
    full = false,
    threshold = DEFAULT_LARGE_STRING_THRESHOLD,
    previewChars = DEFAULT_LARGE_STRING_PREVIEW,
  } = options;
  if (full) return value;

  const walk = (v: unknown, path: string): unknown => {
    if (typeof v === "string") {
      if (v.length <= threshold) return v;
      return {
        _truncated: true,
        path: path || "(root)",
        length: v.length,
        unit: "utf16_code_units" as const,
        preview: v.slice(0, previewChars),
        hint: "Omitted in aggregate output. Run `ainobi element get <slide_index|slide_id> <element_id>` for the full field.",
      };
    }
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map((item, i) => walk(item, `${path}[${i}]`));
    if (!isPlainObject(v)) return v;
    const out: Record<string, unknown> = {};
    for (const [k, child] of Object.entries(v)) {
      const childPath = path ? `${path}.${k}` : k;
      out[k] = walk(child, childPath);
    }
    return out;
  };

  return walk(value, "");
};
