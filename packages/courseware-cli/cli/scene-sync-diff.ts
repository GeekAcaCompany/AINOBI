// SPDX-License-Identifier: AGPL-3.0-only
import { createJsonPatch, type JsonPatchOperation } from "./json-patch.ts";

export const SCENE_SYNC_DIFF_REPORT_FILENAME = "scene-sync-diff-report.json";
export const DEFAULT_SCENE_SYNC_DIFF_PAGE_SIZE = 40;
const MAX_VALUE_CHARS = 200;

export type SceneSyncDiffReport = {
  version: 1;
  generated_at: string;
  before_label: "cli_session";
  after_label: "database";
  total_changes: number;
  page_size: number;
  total_pages: number;
  lines: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const unescapePointer = (segment: string): string =>
  segment.replace(/~1/g, "/").replace(/~0/g, "~");

const getAtPath = (root: unknown, pointer: string): unknown => {
  if (!pointer || pointer === "/") return root;
  const segments = pointer.split("/").filter(Boolean).map(unescapePointer);
  let current: unknown = root;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
};

const formatPatchValue = (value: unknown): string => {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "string") {
    if (value.length <= MAX_VALUE_CHARS) return JSON.stringify(value);
    return `${JSON.stringify(`${value.slice(0, MAX_VALUE_CHARS)}…`)} (${value.length} chars)`;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const serialized = JSON.stringify(value);
  if (serialized.length <= MAX_VALUE_CHARS) return serialized;
  return `${serialized.slice(0, MAX_VALUE_CHARS)}… (${serialized.length} chars)`;
};

const fieldTailFromPath = (segments: string[]): string => {
  let lastChildren = -1;
  for (let i = 0; i < segments.length; i += 1) {
    if (segments[i] === "children_elements") lastChildren = i;
  }
  if (lastChildren >= 0 && lastChildren < segments.length - 1) {
    const tail = segments.slice(lastChildren + 2).join(".");
    return tail || (segments[segments.length - 1] ?? "");
  }
  if (segments[0] === "slide_elements" && segments.length >= 2) {
    const tail = segments.slice(2).join(".");
    return tail || (segments[segments.length - 1] ?? "");
  }
  return segments.join(".");
};

const resolvePathLabel = (scene: unknown, path: string): string => {
  const segments = path.split("/").filter(Boolean).map(unescapePointer);
  let slideLabel = "";
  let elementLabel = "";
  let currentPath = "";

  for (let i = 0; i < segments.length; i += 1) {
    currentPath = currentPath ? `${currentPath}/${segments[i]}` : `/${segments[i]}`;
    const node = getAtPath(scene, currentPath);
    if (segments[i - 1] === "slide_elements" && /^\d+$/.test(segments[i])) {
      const slideIndex = Number(segments[i]);
      if (isRecord(node)) {
        const slideName = asString(node.name) ?? `slide_${slideIndex + 1}`;
        slideLabel = `Slide ${slideIndex + 1} "${slideName}"`;
      }
    }
    if (isRecord(node) && typeof node.element_id === "string") {
      const name = asString(node.name) ?? node.element_id;
      elementLabel = `${name} (${node.element_id})`;
    }
  }

  const field = fieldTailFromPath(segments);
  if (slideLabel && elementLabel && field) return `${slideLabel} / ${elementLabel} · ${field}`;
  if (slideLabel && field) return `${slideLabel} · ${field}`;
  if (elementLabel && field) return `${elementLabel} · ${field}`;
  return path || "(root)";
};

const formatOperationLine = (
  op: JsonPatchOperation,
  beforeScene: unknown,
  afterScene: unknown,
): string => {
  const label = resolvePathLabel(afterScene, op.path) || resolvePathLabel(beforeScene, op.path);
  const oldValue =
    op.op === "replace" || op.op === "remove"
      ? op.old_value ?? getAtPath(beforeScene, op.path)
      : undefined;

  if (op.op === "replace") {
    return `${label}: ${formatPatchValue(oldValue)} → ${formatPatchValue(op.value)}`;
  }
  if (op.op === "add") {
    return `${label}: (added) ${formatPatchValue(op.value)}`;
  }
  return `${label}: (removed) ${formatPatchValue(oldValue)}`;
};

const reportHeaderLines = (report: SceneSyncDiffReport, page: number): string[] => [
  "[Courseware scene diff · local CLI session → current database version]",
  "These changes came from the editor or an external save; the database version has been loaded automatically. Treat it as the source of truth — do not overwrite these positions/font sizes from earlier conversation memory.",
  `${report.total_changes} change(s), page ${page}/${report.total_pages} (${report.page_size} per page).`,
  page < report.total_pages
    ? `More changes: \`ainobi inspect scene-sync --page ${page + 1}\` (use --page-size to change the page size).`
    : "This is the last page.",
  "",
];

const reportFooterLines = (): string[] => [
  "",
  "For narrow edits, update only the fields the user asked for; do not restore layout from the old values on the left of \"→\".",
];

/** Build a paginated full-scene diff report (RFC6902-style patch, element_id-aware arrays). */
export const buildSceneDiffReport = (
  beforeScene: unknown,
  afterScene: unknown,
  options?: { pageSize?: number; generatedAt?: string },
): SceneSyncDiffReport => {
  const pageSize = Math.max(1, options?.pageSize ?? DEFAULT_SCENE_SYNC_DIFF_PAGE_SIZE);
  const operations = createJsonPatch(beforeScene, afterScene);
  const lines = operations.map((op) => formatOperationLine(op, beforeScene, afterScene));
  const totalChanges = lines.length;
  const totalPages = totalChanges === 0 ? 1 : Math.ceil(totalChanges / pageSize);

  return {
    version: 1,
    generated_at: options?.generatedAt ?? new Date().toISOString(),
    before_label: "cli_session",
    after_label: "database",
    total_changes: totalChanges,
    page_size: pageSize,
    total_pages: totalPages,
    lines,
  };
};

/** Format one page of a diff report for agent system context or CLI output. */
export const formatSceneDiffReportPage = (report: SceneSyncDiffReport, page: number): string => {
  const safePage = Math.min(Math.max(1, Math.floor(page)), report.total_pages);
  const start = (safePage - 1) * report.page_size;
  const slice = report.lines.slice(start, start + report.page_size);

  if (report.total_changes === 0) {
    return [
      "[Courseware scene diff · local CLI session → current database version]",
      "The local session and the database scene fingerprints differ, but the JSON Patch produced no listable field-level changes (rare).",
      "Still treat `ainobi element get` as the source of truth for current element state.",
      "",
      "For narrow edits, update only the fields the user asked for; do not restore layout from conversation memory.",
    ].join("\n");
  }

  const numbered = slice.map((line, index) => `${start + index + 1}. ${line}`);
  return [...reportHeaderLines(report, safePage), ...numbered, ...reportFooterLines()].join("\n");
};

/** First page summary for host system prompt injection. */
export const summarizeSceneDiff = (beforeScene: unknown, afterScene: unknown): string =>
  formatSceneDiffReportPage(buildSceneDiffReport(beforeScene, afterScene), 1);
