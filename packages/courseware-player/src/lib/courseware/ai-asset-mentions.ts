// SPDX-License-Identifier: AGPL-3.0-only
import type { CoursewareAssetItem } from "../../api/courseware.ts";

/** `@[file name](file:<file_id>)` — parseable and displayable as `@file name` (compatible with the old `asset:` prefix) */
export const ASSET_MENTION_TOKEN_RE = /@\[([^\]]+)\]\((?:file|asset):([^)]+)\)/g;

export function formatAssetMentionToken(asset: Pick<CoursewareAssetItem, "id" | "name">): string {
  // `[` `]` would truncate `@[…](file:…)`; cleaned to stay as readable as possible
  const safe = asset.name.replace(/[[\]]/g, "_");
  return `@[${safe}](file:${asset.id})`;
}

export function formatAssetMentionsForDisplay(text: string): string {
  return text.replace(ASSET_MENTION_TOKEN_RE, "@$1");
}

/** Whether the text still contains the `@[…](file|asset:…)` bracket wire token (checked before normalizing to display names) */
export function hasBracketAssetMentionTokens(text: string): boolean {
  return text.includes("](file:") || text.includes("](asset:");
}

/** For the input box display: `@file name` (with an optional trailing space, so typing can continue) */
export function formatAssetMentionDisplayToken(
  asset: Pick<CoursewareAssetItem, "name">,
  options?: { trailingSpace?: boolean },
): string {
  // The display layer doesn't use wire brackets, keeping the original file name so parseMentionedAssetsFromText can resolve file_id by name
  const base = `@${asset.name}`;
  return options?.trailingSpace === false ? base : `${base} `;
}

export type AssetMentionTextSegment =
  | { kind: "text"; value: string }
  | { kind: "mention"; name: string; id: string; raw: string };

export type PlainAtMentionSpan = {
  start: number;
  end: number;
  name: string;
  id: string;
  raw: string;
};

/** End boundary of the resource name after `@`: whitespace, line end or common punctuation (so body text isn't glued into the file name) */
function isPlainAtMentionNameEnd(text: string, nameEnd: number): boolean {
  if (nameEnd >= text.length) return true;
  return /[\s.,;:!?)}\]'"，。；：！？）】」』、]/.test(text[nameEnd]!);
}

function sortAssetsByNameLengthDesc(
  library: readonly CoursewareAssetItem[],
): CoursewareAssetItem[] {
  return [...library].sort((a, b) => b.name.length - a.name.length);
}

/**
 * Locate mentions in text already displayed as `@file name` (file names may contain spaces; the longest asset library name matches first).
 */
export function matchPlainAtMentionsInText(
  text: string,
  library: readonly CoursewareAssetItem[],
): PlainAtMentionSpan[] {
  if (!text.includes("@") || library.length === 0) return [];

  const assetsByNameLength = sortAssetsByNameLengthDesc(library);
  const spans: PlainAtMentionSpan[] = [];
  let i = 0;

  while (i < text.length) {
    if (text[i] !== "@") {
      i += 1;
      continue;
    }
    const atStart = i;
    i += 1;

    let matched: { name: string; id: string; end: number } | null = null;
    for (const asset of assetsByNameLength) {
      const name = asset.name;
      if (!name || !text.startsWith(name, i)) continue;
      const end = i + name.length;
      if (!isPlainAtMentionNameEnd(text, end)) continue;
      matched = { name, id: asset.id, end };
      break;
    }

    if (matched) {
      const raw = text.slice(atStart, matched.end);
      spans.push({
        start: atStart,
        end: matched.end,
        name: matched.name,
        id: matched.id,
        raw,
      });
      i = matched.end;
      continue;
    }

    const rest = text.slice(i);
    const token = /^(\S+)/.exec(rest);
    if (token) {
      const name = token[1] ?? "";
      const end = i + name.length;
      spans.push({
        start: atStart,
        end,
        name,
        id: "",
        raw: text.slice(atStart, end),
      });
      i = end;
      continue;
    }

    i = atStart + 1;
  }

  return spans;
}

export function splitAssetMentionSegments(text: string): AssetMentionTextSegment[] {
  const segments: AssetMentionTextSegment[] = [];
  let last = 0;
  const re = new RegExp(ASSET_MENTION_TOKEN_RE.source, "g");
  for (const match of text.matchAll(re)) {
    const idx = match.index ?? 0;
    if (idx > last) segments.push({ kind: "text", value: text.slice(last, idx) });
    segments.push({
      kind: "mention",
      name: match[1] ?? "",
      id: match[2]?.trim() ?? "",
      raw: match[0] ?? "",
    });
    last = idx + match[0].length;
  }
  if (last < text.length) segments.push({ kind: "text", value: text.slice(last) });
  if (segments.length === 0 && text) segments.push({ kind: "text", value: text });
  return segments;
}

function splitPlainAtMentionSegmentsWithLibrary(
  text: string,
  library: readonly CoursewareAssetItem[],
): AssetMentionTextSegment[] {
  const spans = matchPlainAtMentionsInText(text, library);
  if (spans.length === 0) return [];

  const segments: AssetMentionTextSegment[] = [];
  let last = 0;
  for (const span of spans) {
    if (span.start > last) segments.push({ kind: "text", value: text.slice(last, span.start) });
    segments.push({
      kind: "mention",
      name: span.name,
      id: span.id,
      raw: span.raw,
    });
    last = span.end;
  }
  if (last < text.length) segments.push({ kind: "text", value: text.slice(last) });
  return segments;
}

/** Text already displayed as `@file name` (user bubbles etc.). */
export function splitPlainAtMentionSegments(
  text: string,
  library?: readonly CoursewareAssetItem[],
): AssetMentionTextSegment[] {
  if (library && library.length > 0 && text.includes("@")) {
    const withLibrary = splitPlainAtMentionSegmentsWithLibrary(text, library);
    if (withLibrary.length > 0) return withLibrary;
  }

  const segments: AssetMentionTextSegment[] = [];
  let last = 0;
  const re = /@(\S+)/g;
  for (const match of text.matchAll(re)) {
    const idx = match.index ?? 0;
    if (idx > last) segments.push({ kind: "text", value: text.slice(last, idx) });
    segments.push({
      kind: "mention",
      name: match[1] ?? "",
      id: "",
      raw: match[0] ?? "",
    });
    last = idx + match[0].length;
  }
  if (last < text.length) segments.push({ kind: "text", value: text.slice(last) });
  if (segments.length === 0 && text) segments.push({ kind: "text", value: text });
  return segments;
}

export function splitMentionSegmentsForDisplay(
  text: string,
  library?: readonly CoursewareAssetItem[],
): AssetMentionTextSegment[] {
  const normalized = formatAssetMentionsForDisplay(text);
  const tokenized = splitAssetMentionSegments(normalized);
  if (tokenized.some((s) => s.kind === "mention")) return tokenized;
  return splitPlainAtMentionSegments(normalized, library);
}

export function parseMentionedAssetsFromText(
  text: string,
  library: readonly CoursewareAssetItem[],
): CoursewareAssetItem[] {
  const byId = new Map(library.map((a) => [a.id, a]));
  const byName = new Map(library.map((a) => [a.name, a]));
  const seen = new Set<string>();
  const out: CoursewareAssetItem[] = [];

  for (const match of text.matchAll(ASSET_MENTION_TOKEN_RE)) {
    const id = match[2]?.trim();
    if (!id || seen.has(id)) continue;
    const asset = byId.get(id);
    if (!asset) continue;
    seen.add(id);
    out.push(asset);
  }

  for (const span of matchPlainAtMentionsInText(formatAssetMentionsForDisplay(text), library)) {
    if (span.id) {
      if (seen.has(span.id)) continue;
      const asset = byId.get(span.id);
      if (!asset) continue;
      seen.add(span.id);
      out.push(asset);
      continue;
    }
    const name = span.name.trim();
    if (!name) continue;
    const asset = byName.get(name);
    if (!asset || seen.has(asset.id)) continue;
    seen.add(asset.id);
    out.push(asset);
  }

  return out;
}

/** Resource ids already @-referenced in the input box (the @ fragment currently being edited can be excluded). */
export function getAlreadyMentionedAssetIdsInText(
  text: string,
  library: readonly CoursewareAssetItem[],
  excludeSpan?: { start: number; end: number },
): Set<string> {
  const byName = new Map(library.map((a) => [a.name, a]));
  const ids = new Set<string>();

  const inExcludedSpan = (start: number, end: number): boolean =>
    excludeSpan != null && start >= excludeSpan.start && end <= excludeSpan.end;

  for (const match of text.matchAll(ASSET_MENTION_TOKEN_RE)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (inExcludedSpan(start, end)) continue;
    const id = match[2]?.trim();
    if (id) ids.add(id);
  }

  const displayText = formatAssetMentionsForDisplay(text);
  for (const span of matchPlainAtMentionsInText(displayText, library)) {
    if (inExcludedSpan(span.start, span.end)) continue;
    if (span.id) {
      ids.add(span.id);
      continue;
    }
    const asset = byName.get(span.name.trim());
    if (asset) ids.add(asset.id);
  }

  return ids;
}

const BRACKET_MENTION_TOKEN_RE = /@\[([^\]]+)\]\((?:file|asset|mark|courseware):([^)]+)\)/g;

/** Whether the cursor is inside a complete `@[…](file:…)` / `@[…](mark:…)` token (end included) */
export function isCursorInsideBracketMentionToken(text: string, cursor: number): boolean {
  for (const match of text.matchAll(BRACKET_MENTION_TOKEN_RE)) {
    const start = match.index ?? 0;
    const end = start + (match[0]?.length ?? 0);
    if (cursor > start && cursor <= end) return true;
  }
  return false;
}

export function detectActiveAssetMention(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  if (isCursorInsideBracketMentionToken(text, cursor)) return null;

  const before = text.slice(0, cursor);
  const atIdx = before.lastIndexOf("@");
  if (atIdx < 0) return null;

  const sliceFromAt = before.slice(atIdx);
  if (/^@\[[^\]]*\]\((?:file|asset|mark|courseware):[^)]*\)/.test(sliceFromAt)) return null;

  const query = before.slice(atIdx + 1);
  if (/\s/.test(query)) return null;

  if (atIdx > 0) {
    const prev = before[atIdx - 1];
    if (prev && !/[\s([{>]/.test(prev)) return null;
  }

  return { start: atIdx, query };
}

export function filterAssetsForMentionQuery(
  assets: readonly CoursewareAssetItem[],
  query: string,
  limit = 20,
): CoursewareAssetItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...assets].slice(0, limit);

  const scored = assets
    .map((asset) => {
      const name = asset.name.toLowerCase();
      const ext = asset.extension.toLowerCase();
      let score = -1;
      if (name === q) score = 100;
      else if (name.startsWith(q)) score = 80;
      else if (name.includes(q)) score = 60;
      else if (ext.includes(q)) score = 40;
      else {
        let ni = 0;
        let ok = true;
        for (let qi = 0; qi < q.length; qi++) {
          const found = name.indexOf(q[qi]!, ni);
          if (found < 0) {
            ok = false;
            break;
          }
          ni = found + 1;
        }
        if (ok) score = 20;
      }
      return { asset, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || a.asset.name.localeCompare(b.asset.name));

  return scored.slice(0, limit).map((x) => x.asset);
}

export function applyAssetMentionSelection(
  text: string,
  mentionStart: number,
  cursor: number,
  asset: CoursewareAssetItem,
): { text: string; cursor: number } {
  const token = formatAssetMentionDisplayToken(asset);
  const next = `${text.slice(0, mentionStart)}${token}${text.slice(cursor)}`;
  return { text: next, cursor: mentionStart + token.length };
}

/** Compute the cursor's pixel coordinates inside the textarea (relative to the top left of the textarea content area). */
export function getTextareaCaretOffset(
  textarea: HTMLTextAreaElement,
  position: number,
): { top: number; left: number } {
  const style = window.getComputedStyle(textarea);
  const div = document.createElement("div");
  const properties = [
    "direction",
    "boxSizing",
    "width",
    "height",
    "overflowX",
    "overflowY",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "fontStyle",
    "fontVariant",
    "fontWeight",
    "fontStretch",
    "fontSize",
    "fontSizeAdjust",
    "lineHeight",
    "fontFamily",
    "textAlign",
    "textTransform",
    "textIndent",
    "letterSpacing",
    "wordSpacing",
    "tabSize",
    "MozTabSize",
  ] as const;

  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.whiteSpace = "pre-wrap";
  div.style.wordWrap = "break-word";
  const targetStyle = div.style as unknown as Record<string, string>;
  const sourceStyle = style as unknown as Record<string, string>;
  for (const prop of properties) {
    targetStyle[prop] = sourceStyle[prop] ?? "";
  }

  const rect = textarea.getBoundingClientRect();
  div.style.width = `${rect.width}px`;

  const value = textarea.value;
  div.textContent = value.slice(0, position);
  const span = document.createElement("span");
  span.textContent = value.slice(position) || ".";
  div.appendChild(span);

  document.body.appendChild(div);
  const spanRect = span.getBoundingClientRect();
  const divRect = div.getBoundingClientRect();
  document.body.removeChild(div);

  const top =
    spanRect.top -
    divRect.top -
    textarea.scrollTop +
    parseFloat(style.borderTopWidth || "0") +
    parseFloat(style.paddingTop || "0");
  const left =
    spanRect.left -
    divRect.left -
    textarea.scrollLeft +
    parseFloat(style.borderLeftWidth || "0") +
    parseFloat(style.paddingLeft || "0");

  return { top, left };
}

/** The cursor's coordinates in the viewport (for the fixed-positioned @ list). */
export function getTextareaCaretClientRect(
  textarea: HTMLTextAreaElement,
  position: number,
): { top: number; left: number } {
  const local = getTextareaCaretOffset(textarea, position);
  const taRect = textarea.getBoundingClientRect();
  const style = window.getComputedStyle(textarea);
  const borderTop = parseFloat(style.borderTopWidth || "0");
  const borderLeft = parseFloat(style.borderLeftWidth || "0");
  return {
    top: taRect.top + borderTop + local.top - textarea.scrollTop,
    left: taRect.left + borderLeft + local.left - textarea.scrollLeft,
  };
}
