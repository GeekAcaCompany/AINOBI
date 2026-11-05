// SPDX-License-Identifier: AGPL-3.0-only
/** "Recently used" MRU of AI panel @ / the template library (localStorage). */

export type AiMentionRecentKind =
  | "asset"
  | "courseware"
  | "design_template"
  | "content_template";

export type AiMentionRecentEntry = {
  kind: AiMentionRecentKind;
  id: string;
  name: string;
  /** Resource extension; may be omitted for coursewares/templates */
  extension?: string;
  /** Reference courseware key (kind=courseware) */
  key?: string;
  touchedAt: number;
};

const MAX_RECENTS = 12;

function resourceBucketKey(coursewareId: string): string {
  return `courseware-editor-ai-mention-recents:resource:${coursewareId.trim()}`;
}

function templateBucketKey(orgId: string): string {
  return `courseware-editor-ai-mention-recents:template:${orgId.trim()}`;
}

function readBucket(storageKey: string): AiMentionRecentEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (row): row is AiMentionRecentEntry =>
          !!row &&
          typeof row === "object" &&
          typeof (row as AiMentionRecentEntry).kind === "string" &&
          typeof (row as AiMentionRecentEntry).id === "string" &&
          typeof (row as AiMentionRecentEntry).name === "string",
      )
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

function writeBucket(storageKey: string, entries: readonly AiMentionRecentEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(entries.slice(0, MAX_RECENTS)));
  } catch {
    // ignore quota / private mode
  }
}

function pushRecent(
  storageKey: string,
  entry: Omit<AiMentionRecentEntry, "touchedAt">,
): AiMentionRecentEntry[] {
  const next: AiMentionRecentEntry = { ...entry, touchedAt: Date.now() };
  const prev = readBucket(storageKey).filter(
    (row) => !(row.kind === next.kind && row.id === next.id),
  );
  const list = [next, ...prev].slice(0, MAX_RECENTS);
  writeBucket(storageKey, list);
  return list;
}

export function readResourceMentionRecents(coursewareId: string | null | undefined): AiMentionRecentEntry[] {
  const id = coursewareId?.trim();
  if (!id) return [];
  return readBucket(resourceBucketKey(id)).filter(
    (row) => row.kind === "asset" || row.kind === "courseware",
  );
}

export function readTemplateMentionRecents(orgId: string | null | undefined): AiMentionRecentEntry[] {
  const id = orgId?.trim();
  if (!id) return [];
  return readBucket(templateBucketKey(id)).filter(
    (row) => row.kind === "design_template" || row.kind === "content_template",
  );
}

export function recordAssetMentionRecent(
  coursewareId: string | null | undefined,
  asset: { id: string; name: string; extension?: string },
): void {
  const cw = coursewareId?.trim();
  if (!cw || !asset.id.trim()) return;
  pushRecent(resourceBucketKey(cw), {
    kind: "asset",
    id: asset.id.trim(),
    name: asset.name.trim() || asset.id,
    extension: asset.extension,
  });
}

export function recordCoursewareMentionRecent(
  coursewareId: string | null | undefined,
  item: { id: string; key: string; title: string },
): void {
  const cw = coursewareId?.trim();
  if (!cw || !item.key.trim()) return;
  pushRecent(resourceBucketKey(cw), {
    kind: "courseware",
    id: item.id.trim() || item.key.trim(),
    key: item.key.trim(),
    name: item.title.trim() || item.key,
  });
}

export function recordDesignTemplateMentionRecent(
  orgId: string | null | undefined,
  item: { id: string; name: string },
): void {
  const org = orgId?.trim();
  if (!org || !item.id.trim()) return;
  pushRecent(templateBucketKey(org), {
    kind: "design_template",
    id: item.id.trim(),
    name: item.name.trim() || item.id,
  });
}

export function recordContentTemplateMentionRecent(
  orgId: string | null | undefined,
  item: { id: string; name: string },
): void {
  const org = orgId?.trim();
  if (!org || !item.id.trim()) return;
  pushRecent(templateBucketKey(org), {
    kind: "content_template",
    id: item.id.trim(),
    name: item.name.trim() || item.id,
  });
}

function removeTemplateMentionRecent(
  orgId: string | null | undefined,
  kind: "design_template" | "content_template",
  templateId: string,
): void {
  const org = orgId?.trim();
  const id = templateId.trim();
  if (!org || !id) return;
  const storageKey = templateBucketKey(org);
  const next = readBucket(storageKey).filter((row) => !(row.kind === kind && row.id === id));
  writeBucket(storageKey, next);
}

export function removeDesignTemplateMentionRecent(
  orgId: string | null | undefined,
  templateId: string,
): void {
  removeTemplateMentionRecent(orgId, "design_template", templateId);
}

export function removeContentTemplateMentionRecent(
  orgId: string | null | undefined,
  templateId: string,
): void {
  removeTemplateMentionRecent(orgId, "content_template", templateId);
}

export function filterMentionRecents(
  entries: readonly AiMentionRecentEntry[],
  query: string,
): AiMentionRecentEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...entries];
  return entries.filter(
    (row) =>
      row.name.toLowerCase().includes(q) ||
      (row.extension ?? "").toLowerCase().includes(q) ||
      (row.key ?? "").toLowerCase().includes(q) ||
      row.kind.includes(q),
  );
}
