// SPDX-License-Identifier: AGPL-3.0-only
import { matchPlainAtMentionsInText } from "./ai-asset-mentions.ts";
import type { CoursewareAssetItem } from "../../api/courseware.ts";

/** `@[template name](content_template:<uuid>)` — references the organization content template library */
export const CONTENT_TEMPLATE_MENTION_TOKEN_RE = /@\[([^\]]+)\]\(content_template:([^)]+)\)/g;

export type ReferencedContentTemplateItem = {
  id: string;
  name: string;
};

export function contentTemplateRefsAsMentionLibrary(
  registry: readonly ReferencedContentTemplateItem[],
): CoursewareAssetItem[] {
  return registry.map((item) => ({
    id: item.id,
    name: item.name,
    extension: "md" as const,
    // Distinguishes design templates: resolveAiPanelMentionSource tells them apart by mimeType
    url: "content_template:",
    mimeType: "application/x-ainobi-content-template",
    size: 0,
    createdAt: "",
  }));
}

export function formatContentTemplateMentionToken(
  item: Pick<ReferencedContentTemplateItem, "id" | "name">,
): string {
  const safeName = item.name.replace(/[[\]]/g, "_");
  return `@[${safeName}](content_template:${item.id})`;
}

export function formatContentTemplateMentionDisplayToken(
  item: Pick<ReferencedContentTemplateItem, "name">,
  options?: { trailingSpace?: boolean },
): string {
  const base = `@${item.name}`;
  return options?.trailingSpace === false ? base : `${base} `;
}

/**
 * The display token inserted into the input box (`@template name`), consistent with the asset library, so wire UUIDs don't inflate the text.
 */
export function formatContentTemplateMentionInsertToken(
  item: Pick<ReferencedContentTemplateItem, "id" | "name">,
  options?: { trailingSpace?: boolean },
): string {
  return formatContentTemplateMentionDisplayToken(item, options);
}

export function formatContentTemplateMentionsForDisplay(text: string): string {
  return text.replace(CONTENT_TEMPLATE_MENTION_TOKEN_RE, "@$1");
}

export function hasBracketContentTemplateMentionTokens(text: string): boolean {
  return text.includes("](content_template:");
}

export function parseReferencedContentTemplatesFromText(
  text: string,
  registry: readonly ReferencedContentTemplateItem[],
): ReferencedContentTemplateItem[] {
  if (registry.length === 0) return [];

  const byId = new Map(registry.map((item) => [item.id, item]));
  const byName = new Map(registry.map((item) => [item.name, item]));
  const seen = new Set<string>();
  const out: ReferencedContentTemplateItem[] = [];

  const push = (id: string): void => {
    if (!id || seen.has(id)) return;
    const item = byId.get(id);
    if (!item) return;
    seen.add(id);
    out.push(item);
  };

  for (const match of text.matchAll(CONTENT_TEMPLATE_MENTION_TOKEN_RE)) {
    push(match[2]?.trim() ?? "");
  }

  const mentionLibrary = contentTemplateRefsAsMentionLibrary(registry);
  const displayText = formatContentTemplateMentionsForDisplay(text);
  for (const span of matchPlainAtMentionsInText(displayText, mentionLibrary)) {
    if (span.id) {
      push(span.id);
      continue;
    }
    const name = span.name.trim();
    if (!name) continue;
    const item = byName.get(name);
    if (item) push(item.id);
  }

  return out;
}

export function applyContentTemplateMentionSelection(
  text: string,
  mentionStart: number,
  cursor: number,
  item: ReferencedContentTemplateItem,
): { text: string; cursor: number } {
  const token = formatContentTemplateMentionDisplayToken(item);
  const next = `${text.slice(0, mentionStart)}${token}${text.slice(cursor)}`;
  return { text: next, cursor: mentionStart + token.length };
}

export function toReferencedContentTemplateItem(args: {
  id: string;
  name: string;
}): ReferencedContentTemplateItem {
  return {
    id: args.id,
    name: args.name.trim() || args.id,
  };
}
