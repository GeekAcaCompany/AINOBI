// SPDX-License-Identifier: AGPL-3.0-only
import type { CoursewareAssetItem } from "../../api/courseware.ts";
import { formatAssetMentionsForDisplay } from "./ai-asset-mentions.ts";
import { formatCoursewareMentionsForDisplay } from "./ai-courseware-mentions.ts";
import { formatDesignTemplateMentionsForDisplay } from "./ai-design-template-mentions.ts";
import { formatContentTemplateMentionsForDisplay } from "./ai-content-template-mentions.ts";

/** `@[mark1:note](mark:uuid)` — like resource @, parseable and displayable as rich text */
export const MANUAL_MARK_TOKEN_RE = /@\[标记(\d+):([^\]]+)\]\(mark:([^)]+)\)/g;

export const SLIDE_LOGICAL_WIDTH = 1920;
export const SLIDE_LOGICAL_HEIGHT = 1080;

export type CoursewareManualMarkRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CoursewareManualMarkRegion = {
  markId: string;
  index: number;
  description: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
};

/** A mark already boxed, waiting for the user to fill in its note in the agent input area */
export type CoursewareManualMarkPending = {
  markId: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
};

/** Manual canvas marks attached to this send (coordinates in the element model's logical pixels) */
export type CoursewareManualMarkSession = {
  pageIndex: number;
  slideId: string;
  playheadMs: number;
  regions: CoursewareManualMarkRegion[];
};

export function formatManualMarkToken(index: number, description: string, markId: string): string {
  const safe = description.replace(/\]/g, "）");
  return `@[标记${index}:${safe}](mark:${markId})`;
}

export function formatManualMarksForDisplay(text: string): string {
  return text.replace(MANUAL_MARK_TOKEN_RE, (_, index: string, desc: string) => `标记${index}:${desc}`);
}

/** Remove manual mark tokens from the input box, keeping the user's free text */
export function stripManualMarkTokensFromText(text: string): string {
  return text
    .replace(MANUAL_MARK_TOKEN_RE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Remove the `markN:note` display labels from the input box (the same display form as resource @file name) */
export function stripManualMarkDisplayLabelsFromText(text: string): string {
  return text
    .replace(/\s*标记\d+:[^\n]+/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stripManualMarksFromChatInputText(text: string): string {
  return stripManualMarkDisplayLabelsFromText(stripManualMarkTokensFromText(text));
}

export function formatManualMarkDisplayLabel(index: number, description: string): string {
  return `标记${index}:${description}`;
}

export function buildChatInputWithManualMarks(
  baseText: string,
  regions: readonly CoursewareManualMarkRegion[],
): string {
  const user = stripManualMarksFromChatInputText(baseText);
  const labels = regions
    .filter((r) => r.description.trim())
    .map((r) => formatManualMarkDisplayLabel(r.index, r.description.trim()));
  if (labels.length === 0) return user;
  return user ? `${user}\n${labels.join(" ")}` : labels.join(" ");
}

export function buildManualMarkSession(
  pageIndex: number,
  slideId: string | null | undefined,
  playheadMs: number,
  regions: readonly CoursewareManualMarkRegion[],
): CoursewareManualMarkSession | null {
  const slide = slideId?.trim() ?? "";
  if (!slide || regions.length === 0) return null;
  return {
    pageIndex,
    slideId: slide,
    playheadMs: Math.max(0, Math.floor(playheadMs)),
    regions: [...regions],
  };
}

export function clampManualMarkRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  minSize = 8,
): CoursewareManualMarkRect | null {
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  const right = Math.max(x0, x1);
  const bottom = Math.max(y0, y1);
  const width = right - left;
  const height = bottom - top;
  if (width < minSize || height < minSize) return null;
  const x = Math.max(0, Math.min(left, SLIDE_LOGICAL_WIDTH));
  const y = Math.max(0, Math.min(top, SLIDE_LOGICAL_HEIGHT));
  const w = Math.max(minSize, Math.min(width, SLIDE_LOGICAL_WIDTH - x));
  const h = Math.max(minSize, Math.min(height, SLIDE_LOGICAL_HEIGHT - y));
  return { x, y, width: w, height: h };
}

export function displayToLogicalMarkRect(
  leftPx: number,
  topPx: number,
  widthPx: number,
  heightPx: number,
  displayScale: number,
): CoursewareManualMarkRect {
  const inv = displayScale > 0 ? 1 / displayScale : 1;
  return clampManualMarkRect(
    leftPx * inv,
    topPx * inv,
    (leftPx + widthPx) * inv,
    (topPx + heightPx) * inv,
  )!;
}

function roundLogical(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Merged into the agent's `editorContext` for this turn (not shown in the sidebar user bubble) */
export function buildManualMarksEditorContextSection(session: CoursewareManualMarkSession): string {
  const lines = [
    "[用户手动标记的编辑区域]",
    `当前页: ${session.pageIndex + 1} (slide_id: ${session.slideId})`,
    `时间轴进度(playhead): ${session.playheadMs} ms`,
    "矩形区域使用课件元素坐标系（逻辑像素，原点在画布左上角；与 element.position / element.size 一致）：",
  ];
  for (const r of session.regions) {
    lines.push(
      "",
      `标记${r.index}:`,
      `  position: { x: ${roundLogical(r.position.x)}, y: ${roundLogical(r.position.y)} }`,
      `  size: { width: ${roundLogical(r.size.width)}, height: ${roundLogical(r.size.height)} }`,
      `  需求: ${r.description}`,
    );
  }
  return lines.join("\n");
}

export type AiPanelMentionSource =
  | "asset"
  | "courseware"
  | "design_template"
  | "content_template";

export type AiPanelRichTextSegment =
  | { kind: "text"; value: string }
  | {
      kind: "assetMention";
      name: string;
      id: string;
      raw: string;
      mentionSource: AiPanelMentionSource;
    }
  | { kind: "manualMark"; index: number; description: string; markId: string; raw: string };

/** Input box / bubble: whether it contains wire tokens or the "markN:" display labels */
export function hasAiPanelBracketTokens(text: string): boolean {
  return (
    text.includes("](mark:") ||
    text.includes("](file:") ||
    text.includes("](asset:") ||
    text.includes("](courseware:") ||
    text.includes("](design_template:") ||
    text.includes("](content_template:") ||
    /标记\d+:/.test(text)
  );
}

/** Merge mention library entries → reference types (for the plain @ fallback path) */
export function resolveAiPanelMentionSource(
  item: Pick<CoursewareAssetItem, "extension" | "mimeType" | "url">,
): AiPanelMentionSource {
  if (item.mimeType === "application/json" && item.extension === "txt") {
    return "courseware";
  }
  if (item.mimeType === "application/x-ainobi-content-template") {
    return "content_template";
  }
  if (
    item.mimeType === "application/x-ainobi-design-template" ||
    (item.mimeType === "text/markdown" && item.extension === "md" && !item.url?.trim())
  ) {
    return "design_template";
  }
  return "asset";
}

function tokenKindToMentionSource(kind: string): AiPanelMentionSource {
  if (kind === "courseware") return "courseware";
  if (kind === "design_template") return "design_template";
  if (kind === "content_template") return "content_template";
  return "asset";
}

const AI_PANEL_TOKEN_RE =
  /@\[([^\]]+)\]\((file|asset|mark|courseware|design_template|content_template):([^)]+)\)/g;
const MANUAL_MARK_DISPLAY_RE = /标记(\d+):([^\n]+?)(?=\s+标记\d+:|$)/g;

function pushTextWithDisplayManualMarks(segments: AiPanelRichTextSegment[], chunk: string): void {
  if (!chunk) return;
  let last = 0;
  let matched = false;
  const re = new RegExp(MANUAL_MARK_DISPLAY_RE.source, "g");
  for (const match of chunk.matchAll(re)) {
    matched = true;
    const idx = match.index ?? 0;
    if (idx > last) segments.push({ kind: "text", value: chunk.slice(last, idx) });
    segments.push({
      kind: "manualMark",
      index: Number(match[1]),
      description: (match[2] ?? "").trim(),
      markId: "",
      raw: match[0] ?? "",
    });
    last = idx + (match[0]?.length ?? 0);
  }
  if (!matched) {
    segments.push({ kind: "text", value: chunk });
    return;
  }
  if (last < chunk.length) segments.push({ kind: "text", value: chunk.slice(last) });
}

/** Input box / user bubble: split resource @ and manual mark tokens into segments (for rich text display) */
export function splitAiPanelRichTextSegments(text: string): AiPanelRichTextSegment[] {
  const segments: AiPanelRichTextSegment[] = [];
  let last = 0;
  const re = new RegExp(AI_PANEL_TOKEN_RE.source, "g");
  for (const match of text.matchAll(re)) {
    const idx = match.index ?? 0;
    if (idx > last) pushTextWithDisplayManualMarks(segments, text.slice(last, idx));
    const bracket = match[1] ?? "";
    const kind = match[2];
    const id = (match[3] ?? "").trim();
    const raw = match[0] ?? "";
    if (kind === "mark") {
      const markMatch = /^标记(\d+):(.+)$/.exec(bracket);
      segments.push({
        kind: "manualMark",
        index: markMatch ? Number(markMatch[1]) : 0,
        description: markMatch?.[2] ?? bracket,
        markId: id,
        raw,
      });
    } else {
      segments.push({
        kind: "assetMention",
        name: bracket,
        id,
        raw,
        mentionSource: tokenKindToMentionSource(kind ?? ""),
      });
    }
    last = idx + raw.length;
  }
  if (last < text.length) pushTextWithDisplayManualMarks(segments, text.slice(last));
  if (segments.length === 0 && text) pushTextWithDisplayManualMarks(segments, text);
  return segments;
}

export function formatAiPanelInputForDisplay(text: string): string {
  return formatManualMarksForDisplay(
    formatContentTemplateMentionsForDisplay(
      formatDesignTemplateMentionsForDisplay(
        formatCoursewareMentionsForDisplay(formatAssetMentionsForDisplay(text)),
      ),
    ),
  );
}

export function parseManualMarkTokensFromText(text: string): CoursewareManualMarkRegion[] {
  const out: CoursewareManualMarkRegion[] = [];
  const re = new RegExp(MANUAL_MARK_TOKEN_RE.source, "g");
  for (const match of text.matchAll(re)) {
    const index = Number(match[1]);
    const description = (match[2] ?? "").trim();
    const markId = (match[3] ?? "").trim();
    if (!markId || !Number.isFinite(index)) continue;
    out.push({
      markId,
      index,
      description,
      position: { x: 0, y: 0 },
      size: { width: 0, height: 0 },
    });
  }
  return out;
}

export function parseManualMarkDisplayLabelsFromText(
  text: string,
): Array<{ index: number; description: string }> {
  const out: Array<{ index: number; description: string }> = [];
  const re = new RegExp(MANUAL_MARK_DISPLAY_RE.source, "g");
  for (const match of text.matchAll(re)) {
    const index = Number(match[1]);
    if (!Number.isFinite(index)) continue;
    out.push({ index, description: (match[2] ?? "").trim() });
  }
  return out;
}

export function manualMarkRegionsEqual(
  a: readonly CoursewareManualMarkRegion[],
  b: readonly CoursewareManualMarkRegion[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i]!;
    const right = b[i]!;
    if (
      left.markId !== right.markId ||
      left.index !== right.index ||
      left.description !== right.description ||
      left.position.x !== right.position.x ||
      left.position.y !== right.position.y ||
      left.size.width !== right.size.width ||
      left.size.height !== right.size.height
    ) {
      return false;
    }
  }
  return true;
}

/** Sync the canvas region list from the mark labels the input box still keeps (deleting a rich text label removes its box) */
export function syncManualMarkRegionsFromChatInput(
  text: string,
  regions: readonly CoursewareManualMarkRegion[],
): CoursewareManualMarkRegion[] {
  const tokenMarks = parseManualMarkTokensFromText(text);
  if (tokenMarks.length > 0) {
    const byId = new Map(tokenMarks.map((m) => [m.markId, m]));
    return regions
      .filter((r) => byId.has(r.markId))
      .map((r) => ({ ...r, description: byId.get(r.markId)!.description }));
  }
  const labelByIndex = new Map(
    parseManualMarkDisplayLabelsFromText(text).map((l) => [l.index, l.description]),
  );
  return regions
    .filter((r) => labelByIndex.has(r.index))
    .map((r) => ({ ...r, description: labelByIndex.get(r.index) ?? r.description }));
}
