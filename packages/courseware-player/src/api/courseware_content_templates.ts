// SPDX-License-Identifier: AGPL-3.0-only
import { coursewareApi } from "../host/requester.ts";
import { isCoursewareApiConfigured } from "./courseware_agent.ts";
import type { TemplateExtractLanguage } from "../lib/courseware/template-extract-language.ts";

const COURSEWARE_AGENT_OPTS = { responseShape: "agent" as const };

export type ContentTemplateSourceType = "courseware" | "asset" | "manual" | "extracted";

export type ContentTemplateListItem = {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  sourceType: ContentTemplateSourceType;
  sourceMeta: Record<string, unknown> | null;
  contentPreview: string;
  createdAt: string;
  updatedAt: string;
  /** Built-in system template (stable id) */
  isBuiltIn?: boolean;
  /** The organization has edited this built-in template */
  isOrgOverride?: boolean;
};

export type ContentTemplateDetail = ContentTemplateListItem & {
  content: string;
};

export type ListContentTemplatesResponse = {
  ok?: boolean;
  error?: string;
  items?: ContentTemplateListItem[];
  total?: number;
};

export type ContentTemplateMutationResponse = {
  ok?: boolean;
  error?: string;
  template?: ContentTemplateDetail;
};

export type ExtractContentTemplateParams = {
  orgId: string;
  name: string;
  sourceType: "courseware" | "asset";
  coursewareId?: string;
  assetId?: string;
  description?: string | null;
  language?: TemplateExtractLanguage;
};

function requireOrgId(orgId: string | undefined | null): string {
  const id = orgId?.trim();
  if (!id) {
    throw new Error("缺少 orgId，无法访问内容模板库");
  }
  return id;
}

export async function listContentTemplates(params: {
  orgId: string;
  q?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: ContentTemplateListItem[]; total: number }> {
  if (!isCoursewareApiConfigured()) {
    return { items: [], total: 0 };
  }

  const orgId = requireOrgId(params.orgId);
  const json = (await coursewareApi.get(
    "/courseware/content-templates",
    {
      orgId,
      ...(params.q?.trim() ? { q: params.q.trim() } : {}),
      ...(params.page ? { page: params.page } : {}),
      ...(params.pageSize ? { pageSize: params.pageSize } : {}),
    },
    COURSEWARE_AGENT_OPTS,
  )) as ListContentTemplatesResponse;

  if (json && typeof json === "object" && json.ok === false) {
    throw new Error(
      typeof json.error === "string" && json.error.trim()
        ? json.error.trim()
        : "Failed to load content templates",
    );
  }

  return {
    items: Array.isArray(json?.items) ? json.items : [],
    total: typeof json?.total === "number" ? json.total : 0,
  };
}

export async function getContentTemplate(params: {
  orgId: string;
  id: string;
}): Promise<ContentTemplateDetail | null> {
  if (!isCoursewareApiConfigured()) {
    return null;
  }

  const orgId = requireOrgId(params.orgId);
  const id = params.id.trim();
  const json = (await coursewareApi.get(
    `/courseware/content-templates/${encodeURIComponent(id)}`,
    { orgId },
    COURSEWARE_AGENT_OPTS,
  )) as { ok?: boolean; error?: string; template?: ContentTemplateDetail };

  if (json && typeof json === "object" && json.ok === false) {
    throw new Error(
      typeof json.error === "string" && json.error.trim()
        ? json.error.trim()
        : "Failed to load content template",
    );
  }

  return json?.template ?? null;
}

export async function deleteContentTemplate(params: {
  orgId: string;
  id: string;
}): Promise<{ resetBuiltIn?: boolean }> {
  if (!isCoursewareApiConfigured()) {
    throw new Error("未配置课件助手服务地址（coursewareApi）");
  }

  const orgId = requireOrgId(params.orgId);
  const id = params.id.trim();
  const json = (await coursewareApi.delete(
    `/courseware/content-templates/${encodeURIComponent(id)}`,
    { orgId },
    COURSEWARE_AGENT_OPTS,
  )) as { ok?: boolean; error?: string; resetBuiltIn?: boolean };

  if (json && typeof json === "object" && json.ok === false) {
    throw new Error(
      typeof json.error === "string" && json.error.trim()
        ? json.error.trim()
        : "Failed to delete content template",
    );
  }

  return { resetBuiltIn: json?.resetBuiltIn === true };
}

export async function extractContentTemplate(
  params: ExtractContentTemplateParams,
): Promise<ContentTemplateDetail> {
  if (!isCoursewareApiConfigured()) {
    throw new Error("未配置课件助手服务地址（coursewareApi）");
  }

  const orgId = requireOrgId(params.orgId);
  const json = (await coursewareApi.post(
    "/courseware/content-templates/extract",
    {
      orgId,
      name: params.name.trim(),
      sourceType: params.sourceType,
      ...(params.coursewareId?.trim() ? { coursewareId: params.coursewareId.trim() } : {}),
      ...(params.assetId?.trim() ? { assetId: params.assetId.trim() } : {}),
      ...(params.description?.trim() ? { description: params.description.trim() } : {}),
      ...(params.language ? { language: params.language } : {}),
    },
    COURSEWARE_AGENT_OPTS,
  )) as ContentTemplateMutationResponse;

  if (!json?.template) {
    throw new Error(
      typeof json?.error === "string" && json.error.trim()
        ? json.error.trim()
        : "Failed to extract content template",
    );
  }

  return json.template;
}

export async function updateContentTemplate(params: {
  orgId: string;
  id: string;
  name?: string;
  content?: string;
  description?: string | null;
}): Promise<ContentTemplateDetail> {
  if (!isCoursewareApiConfigured()) {
    throw new Error("未配置课件助手服务地址（coursewareApi）");
  }

  const orgId = requireOrgId(params.orgId);
  const id = params.id.trim();
  const body: Record<string, unknown> = { orgId };
  if (params.name !== undefined) {
    body.name = params.name.trim();
  }
  if (params.content !== undefined) {
    body.content = params.content.trim();
  }
  if (params.description !== undefined) {
    body.description = params.description?.trim() || null;
  }

  const json = (await coursewareApi.put(
    `/courseware/content-templates/${encodeURIComponent(id)}`,
    body,
    COURSEWARE_AGENT_OPTS,
  )) as ContentTemplateMutationResponse;

  if (!json?.template) {
    throw new Error(
      typeof json?.error === "string" && json.error.trim()
        ? json.error.trim()
        : "Failed to update content template",
    );
  }

  return json.template;
}

export async function createContentTemplate(params: {
  orgId: string;
  name: string;
  content: string;
  description?: string | null;
}): Promise<ContentTemplateDetail> {
  if (!isCoursewareApiConfigured()) {
    throw new Error("未配置课件助手服务地址（coursewareApi）");
  }

  const orgId = requireOrgId(params.orgId);
  const json = (await coursewareApi.post(
    "/courseware/content-templates",
    {
      orgId,
      name: params.name.trim(),
      content: params.content.trim(),
      description: params.description?.trim() || null,
      sourceType: "manual",
    },
    COURSEWARE_AGENT_OPTS,
  )) as ContentTemplateMutationResponse;

  if (!json?.template) {
    throw new Error(
      typeof json?.error === "string" && json.error.trim()
        ? json.error.trim()
        : "Failed to create content template",
    );
  }

  return json.template;
}
