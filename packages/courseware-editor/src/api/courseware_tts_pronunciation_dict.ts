// SPDX-License-Identifier: AGPL-3.0-only
import { coursewareApi } from "@ainobi/courseware-player/host/requester";
import { isCoursewareApiConfigured } from "@ainobi/courseware-player/api/courseware_agent";

const COURSEWARE_AGENT_OPTS = { responseShape: "agent" as const };

export type PronunciationDictLanguage = "ja" | "zh";

export type PronunciationDictEntry = {
  id: string;
  orgId: string;
  sourceText: string;
  language: PronunciationDictLanguage;
  pronunciation: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type ListResponse = {
  ok?: boolean;
  error?: string;
  items?: PronunciationDictEntry[];
  total?: number;
};

type EntryResponse = {
  ok?: boolean;
  error?: string;
  entry?: PronunciationDictEntry;
};

type ConvertResponse = {
  ok?: boolean;
  error?: string;
  pronunciation?: string;
  language?: PronunciationDictLanguage;
};

function requireOrgId(orgId: string | undefined | null): string {
  const id = orgId?.trim();
  if (!id) {
    throw new Error("缺少 orgId，无法访问发音字典");
  }
  return id;
}

function throwIfFailed(json: { ok?: boolean; error?: string } | null | undefined, fallback: string): void {
  if (json && typeof json === "object" && json.ok === false) {
    throw new Error(
      typeof json.error === "string" && json.error.trim() ? json.error.trim() : fallback,
    );
  }
}

export async function listPronunciationDictEntries(params: {
  orgId: string;
  q?: string;
  language?: PronunciationDictLanguage;
  enabled?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<{ items: PronunciationDictEntry[]; total: number }> {
  if (!isCoursewareApiConfigured()) {
    return { items: [], total: 0 };
  }

  const orgId = requireOrgId(params.orgId);
  const json = (await coursewareApi.get(
    "/courseware/tts/pronunciation-dict",
    {
      orgId,
      ...(params.q?.trim() ? { q: params.q.trim() } : {}),
      ...(params.language ? { language: params.language } : {}),
      ...(typeof params.enabled === "boolean" ? { enabled: String(params.enabled) } : {}),
      ...(params.page ? { page: params.page } : {}),
      ...(params.pageSize ? { pageSize: params.pageSize } : {}),
    },
    COURSEWARE_AGENT_OPTS,
  )) as ListResponse;

  throwIfFailed(json, "Failed to load pronunciation dictionary");

  return {
    items: Array.isArray(json?.items) ? json.items : [],
    total: typeof json?.total === "number" ? json.total : 0,
  };
}

export async function createPronunciationDictEntry(params: {
  orgId: string;
  sourceText: string;
  language: PronunciationDictLanguage;
  pronunciation?: string | null;
  enabled?: boolean;
  autoConvert?: boolean;
}): Promise<PronunciationDictEntry> {
  if (!isCoursewareApiConfigured()) {
    throw new Error("未配置课件助手服务地址（coursewareApi）");
  }

  const orgId = requireOrgId(params.orgId);
  const json = (await coursewareApi.post(
    "/courseware/tts/pronunciation-dict",
    {
      orgId,
      sourceText: params.sourceText.trim(),
      language: params.language,
      ...(params.pronunciation?.trim()
        ? { pronunciation: params.pronunciation.trim() }
        : {}),
      ...(typeof params.enabled === "boolean" ? { enabled: params.enabled } : {}),
      ...(typeof params.autoConvert === "boolean"
        ? { autoConvert: params.autoConvert }
        : { autoConvert: !params.pronunciation?.trim() }),
    },
    COURSEWARE_AGENT_OPTS,
  )) as EntryResponse;

  throwIfFailed(json, "Failed to create pronunciation dictionary entry");
  if (!json?.entry) {
    throw new Error("Failed to create pronunciation dictionary entry");
  }
  return json.entry;
}

export async function updatePronunciationDictEntry(params: {
  orgId: string;
  id: string;
  sourceText?: string;
  language?: PronunciationDictLanguage;
  pronunciation?: string;
  enabled?: boolean;
  autoConvert?: boolean;
}): Promise<PronunciationDictEntry> {
  if (!isCoursewareApiConfigured()) {
    throw new Error("未配置课件助手服务地址（coursewareApi）");
  }

  const orgId = requireOrgId(params.orgId);
  const id = params.id.trim();
  const body: Record<string, unknown> = { orgId };
  if (params.sourceText !== undefined) body.sourceText = params.sourceText.trim();
  if (params.language !== undefined) body.language = params.language;
  if (params.pronunciation !== undefined) body.pronunciation = params.pronunciation.trim();
  if (typeof params.enabled === "boolean") body.enabled = params.enabled;
  if (typeof params.autoConvert === "boolean") body.autoConvert = params.autoConvert;

  const json = (await coursewareApi.put(
    `/courseware/tts/pronunciation-dict/${encodeURIComponent(id)}`,
    body,
    COURSEWARE_AGENT_OPTS,
  )) as EntryResponse;

  throwIfFailed(json, "Failed to update pronunciation dictionary entry");
  if (!json?.entry) {
    throw new Error("Failed to update pronunciation dictionary entry");
  }
  return json.entry;
}

export async function deletePronunciationDictEntry(params: {
  orgId: string;
  id: string;
}): Promise<void> {
  if (!isCoursewareApiConfigured()) {
    throw new Error("未配置课件助手服务地址（coursewareApi）");
  }

  const orgId = requireOrgId(params.orgId);
  const id = params.id.trim();
  const json = (await coursewareApi.delete(
    `/courseware/tts/pronunciation-dict/${encodeURIComponent(id)}`,
    { orgId },
    COURSEWARE_AGENT_OPTS,
  )) as { ok?: boolean; error?: string };

  throwIfFailed(json, "Failed to delete pronunciation dictionary entry");
}

export async function convertPronunciationPreview(params: {
  orgId: string;
  text: string;
  language: PronunciationDictLanguage;
}): Promise<{ pronunciation: string; language: PronunciationDictLanguage }> {
  if (!isCoursewareApiConfigured()) {
    throw new Error("未配置课件助手服务地址（coursewareApi）");
  }

  const orgId = requireOrgId(params.orgId);
  const json = (await coursewareApi.post(
    "/courseware/tts/pronunciation-dict/convert",
    {
      orgId,
      text: params.text.trim(),
      language: params.language,
    },
    COURSEWARE_AGENT_OPTS,
  )) as ConvertResponse;

  throwIfFailed(json, "Failed to convert pronunciation");
  if (!json?.pronunciation?.trim()) {
    throw new Error("Failed to convert pronunciation");
  }
  return {
    pronunciation: json.pronunciation.trim(),
    language: json.language ?? params.language,
  };
}
