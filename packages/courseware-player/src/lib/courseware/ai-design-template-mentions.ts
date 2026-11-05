// SPDX-License-Identifier: AGPL-3.0-only
import { matchPlainAtMentionsInText } from "./ai-asset-mentions.ts";
import type { CoursewareAssetItem } from "../../api/courseware.ts";

/** `@[template name](design_template:<uuid>)` — references the organization design template library */
export const DESIGN_TEMPLATE_MENTION_TOKEN_RE = /@\[([^\]]+)\]\(design_template:([^)]+)\)/g;

export type ReferencedDesignTemplateItem = {
  id: string;
  name: string;
};

export function designTemplateRefsAsMentionLibrary(
  registry: readonly ReferencedDesignTemplateItem[],
): CoursewareAssetItem[] {
  return registry.map((item) => ({
    id: item.id,
    name: item.name,
    extension: "md" as const,
    url: "design_template:",
    mimeType: "application/x-ainobi-design-template",
    size: 0,
    createdAt: "",
  }));
}

export function formatDesignTemplateMentionToken(
  item: Pick<ReferencedDesignTemplateItem, "id" | "name">,
): string {
  const safeName = item.name.replace(/[[\]]/g, "_");
  return `@[${safeName}](design_template:${item.id})`;
}

export function formatDesignTemplateMentionDisplayToken(
  item: Pick<ReferencedDesignTemplateItem, "name">,
  options?: { trailingSpace?: boolean },
): string {
  const base = `@${item.name}`;
  return options?.trailingSpace === false ? base : `${base} `;
}

/**
 * The display token inserted into the input box (`@template name`), consistent with the asset library, so wire UUIDs don't inflate the text.
 */
export function formatDesignTemplateMentionInsertToken(
  item: Pick<ReferencedDesignTemplateItem, "id" | "name">,
  options?: { trailingSpace?: boolean },
): string {
  return formatDesignTemplateMentionDisplayToken(item, options);
}

export function formatDesignTemplateMentionsForDisplay(text: string): string {
  return text.replace(DESIGN_TEMPLATE_MENTION_TOKEN_RE, "@$1");
}

export function hasBracketDesignTemplateMentionTokens(text: string): boolean {
  return text.includes("](design_template:");
}

export function parseReferencedDesignTemplatesFromText(
  text: string,
  registry: readonly ReferencedDesignTemplateItem[],
): ReferencedDesignTemplateItem[] {
  if (registry.length === 0) return [];

  const byId = new Map(registry.map((item) => [item.id, item]));
  const byName = new Map(registry.map((item) => [item.name, item]));
  const seen = new Set<string>();
  const out: ReferencedDesignTemplateItem[] = [];

  const push = (id: string): void => {
    if (!id || seen.has(id)) return;
    const item = byId.get(id);
    if (!item) return;
    seen.add(id);
    out.push(item);
  };

  for (const match of text.matchAll(DESIGN_TEMPLATE_MENTION_TOKEN_RE)) {
    push(match[2]?.trim() ?? "");
  }

  const mentionLibrary = designTemplateRefsAsMentionLibrary(registry);
  const displayText = formatDesignTemplateMentionsForDisplay(text);
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

export function applyDesignTemplateMentionSelection(
  text: string,
  mentionStart: number,
  cursor: number,
  item: ReferencedDesignTemplateItem,
): { text: string; cursor: number } {
  const token = formatDesignTemplateMentionDisplayToken(item);
  const next = `${text.slice(0, mentionStart)}${token}${text.slice(cursor)}`;
  return { text: next, cursor: mentionStart + token.length };
}

export function toReferencedDesignTemplateItem(args: {
  id: string;
  name: string;
}): ReferencedDesignTemplateItem {
  return {
    id: args.id,
    name: args.name.trim() || args.id,
  };
}
