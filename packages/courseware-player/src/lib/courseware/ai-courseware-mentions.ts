// SPDX-License-Identifier: AGPL-3.0-only
import { buildCoursewareSceneJsonUrl } from "./build-courseware-scene-json-url.ts";
import { matchPlainAtMentionsInText } from "./ai-asset-mentions.ts";
import type { CoursewareAssetItem } from "../../api/courseware.ts";
import {
  designTemplateRefsAsMentionLibrary,
  type ReferencedDesignTemplateItem,
} from "./ai-design-template-mentions.ts";
import {
  contentTemplateRefsAsMentionLibrary,
  type ReferencedContentTemplateItem,
} from "./ai-content-template-mentions.ts";

/** `@[courseware title](courseware:<key>)` — references another courseware in the courseware library */
export const COURSEWARE_MENTION_TOKEN_RE = /@\[([^\]]+)\]\(courseware:([^)]+)\)/g;

export type ReferencedCoursewareItem = {
  id: string;
  key: string;
  title: string;
  jsonUrl: string;
  courseId?: string;
  courseTitle?: string;
};

/** For plain `@title` matching; shares matchPlainAtMentionsInText with asset library mentions */
export function coursewareRefsAsMentionLibrary(
  registry: readonly ReferencedCoursewareItem[],
): CoursewareAssetItem[] {
  return registry.map((cw) => ({
    id: cw.key,
    name: cw.title,
    extension: "txt" as const,
    url: cw.jsonUrl,
    mimeType: "application/json",
    size: 0,
    createdAt: "",
  }));
}

/** @ highlighting in the input box / bubbles: asset library files + chosen courseware references + design/content templates (titles may contain spaces). */
export function mergeMentionLibrariesForDisplay(
  assets: readonly CoursewareAssetItem[],
  coursewareRefs: readonly ReferencedCoursewareItem[],
  designTemplateRefs: readonly ReferencedDesignTemplateItem[] = [],
  contentTemplateRefs: readonly ReferencedContentTemplateItem[] = [],
): CoursewareAssetItem[] {
  let merged =
    coursewareRefs.length === 0 ? [...assets] : [...assets, ...coursewareRefsAsMentionLibrary(coursewareRefs)];
  if (designTemplateRefs.length > 0) {
    merged = [...merged, ...designTemplateRefsAsMentionLibrary(designTemplateRefs)];
  }
  if (contentTemplateRefs.length > 0) {
    merged = [...merged, ...contentTemplateRefsAsMentionLibrary(contentTemplateRefs)];
  }
  return merged;
}

function registryAsPlainMentionLibrary(
  registry: readonly ReferencedCoursewareItem[],
): CoursewareAssetItem[] {
  return coursewareRefsAsMentionLibrary(registry);
}

export function formatCoursewareMentionToken(
  item: Pick<ReferencedCoursewareItem, "key" | "title">,
): string {
  const safeTitle = item.title.replace(/[[\]]/g, "_");
  return `@[${safeTitle}](courseware:${item.key})`;
}

export function formatCoursewareMentionDisplayToken(
  item: Pick<ReferencedCoursewareItem, "title">,
  options?: { trailingSpace?: boolean },
): string {
  // The display layer doesn't use wire brackets, keeping the original title so it can be resolved by name
  const base = `@${item.title}`;
  return options?.trailingSpace === false ? base : `${base} `;
}

/**
 * The display token inserted into the input box (`@title`, consistent with the asset library, so wire UUIDs don't inflate the cursor space).
 * Titles may contain spaces; on send the registry resolves them back by name.
 */
export function formatCoursewareMentionInsertToken(
  item: Pick<ReferencedCoursewareItem, "key" | "title">,
  options?: { trailingSpace?: boolean },
): string {
  return formatCoursewareMentionDisplayToken(item, options);
}

export function formatCoursewareMentionsForDisplay(text: string): string {
  return text.replace(COURSEWARE_MENTION_TOKEN_RE, "@$1");
}

export function hasBracketCoursewareMentionTokens(text: string): boolean {
  return text.includes("](courseware:");
}

export function parseReferencedCoursewareFromText(
  text: string,
  registry: readonly ReferencedCoursewareItem[],
): ReferencedCoursewareItem[] {
  if (registry.length === 0) return [];

  const byKey = new Map(registry.map((item) => [item.key, item]));
  const byTitle = new Map(registry.map((item) => [item.title, item]));
  const seen = new Set<string>();
  const out: ReferencedCoursewareItem[] = [];

  const push = (key: string): void => {
    if (!key || seen.has(key)) return;
    const item = byKey.get(key);
    if (!item) return;
    seen.add(key);
    out.push(item);
  };

  for (const match of text.matchAll(COURSEWARE_MENTION_TOKEN_RE)) {
    push(match[2]?.trim() ?? "");
  }

  const mentionLibrary = registryAsPlainMentionLibrary(registry);
  const displayText = formatCoursewareMentionsForDisplay(text);
  for (const span of matchPlainAtMentionsInText(displayText, mentionLibrary)) {
    if (span.id) {
      push(span.id);
      continue;
    }
    const name = span.name.trim();
    if (!name) continue;
    const item = byTitle.get(name);
    if (item) push(item.key);
  }

  return out;
}

export function getAlreadyMentionedCoursewareKeysInText(
  text: string,
  registry: readonly ReferencedCoursewareItem[],
  excludeSpan?: { start: number; end: number },
): Set<string> {
  const keys = new Set<string>();
  for (const item of parseReferencedCoursewareFromText(text, registry)) {
    keys.add(item.key);
  }
  if (!excludeSpan) return keys;

  const inExcludedSpan = (start: number, end: number): boolean =>
    start >= excludeSpan.start && end <= excludeSpan.end;

  const filtered = new Set<string>();
  for (const match of text.matchAll(COURSEWARE_MENTION_TOKEN_RE)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (inExcludedSpan(start, end)) continue;
    const key = match[2]?.trim();
    if (key) filtered.add(key);
  }

  const mentionLibrary = registryAsPlainMentionLibrary(registry);
  const displayText = formatCoursewareMentionsForDisplay(text);
  for (const span of matchPlainAtMentionsInText(displayText, mentionLibrary)) {
    if (inExcludedSpan(span.start, span.end)) continue;
    if (span.id) filtered.add(span.id);
    else {
      const item = registry.find((cw) => cw.title === span.name.trim());
      if (item) filtered.add(item.key);
    }
  }
  return filtered;
}

export function applyCoursewareMentionSelection(
  text: string,
  mentionStart: number,
  cursor: number,
  item: ReferencedCoursewareItem,
): { text: string; cursor: number } {
  const token = formatCoursewareMentionDisplayToken(item);
  const next = `${text.slice(0, mentionStart)}${token}${text.slice(cursor)}`;
  return { text: next, cursor: mentionStart + token.length };
}

export function toReferencedCoursewareItem(args: {
  id: string;
  key: string;
  title: string | null | undefined;
  courseId?: string;
  courseTitle?: string;
}): ReferencedCoursewareItem {
  const title = args.title?.trim() || args.key;
  return {
    id: args.id,
    key: args.key,
    title,
    jsonUrl: buildCoursewareSceneJsonUrl(args.key),
    ...(args.courseId ? { courseId: args.courseId } : {}),
    ...(args.courseTitle ? { courseTitle: args.courseTitle } : {}),
  };
}
