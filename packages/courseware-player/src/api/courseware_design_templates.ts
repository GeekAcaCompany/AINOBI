// SPDX-License-Identifier: AGPL-3.0-only
import { coursewareApi } from "../host/requester.ts";
import { isCoursewareApiConfigured } from "./courseware_agent.ts";
import type { TemplateExtractLanguage } from "../lib/courseware/template-extract-language.ts";

const COURSEWARE_AGENT_OPTS = { responseShape: "agent" as const };

export type DesignTemplateSourceType = "courseware" | "asset" | "manual" | "extracted";

export type DesignTemplateListItem = {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  sourceType: DesignTemplateSourceType;
  sourceMeta: Record<string, unknown> | null;
  contentPreview: string;
  createdAt: string;
  updatedAt: string;
};

export type DesignTemplateDetail = DesignTemplateListItem & {
  content: string;
};

export type ListDesignTemplatesResponse = {
  ok?: boolean;
  error?: string;
  items?: DesignTemplateListItem[];
  total?: number;
};

export type DesignTemplateMutationResponse = {
  ok?: boolean;
  error?: string;
  template?: DesignTemplateDetail;
};

export type ExtractDesignTemplateParams = {
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
    throw new Error("缺少 orgId，无法访问设计模板库");
  }
  return id;
}

export async function listDesignTemplates(params: {
  orgId: string;
  q?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: DesignTemplateListItem[]; total: number }> {
  if (!isCoursewareApiConfigured()) {
    return { items: [], total: 0 };
  }

  const orgId = requireOrgId(params.orgId);
  const json = (await coursewareApi.get(
    "/courseware/design-templates",
    {
      orgId,
      ...(params.q?.trim() ? { q: params.q.trim() } : {}),
      ...(params.page ? { page: params.page } : {}),
      ...(params.pageSize ? { pageSize: params.pageSize } : {}),
    },
    COURSEWARE_AGENT_OPTS,
  )) as ListDesignTemplatesResponse;

  if (json && typeof json === "object" && json.ok === false) {
    throw new Error(
      typeof json.error === "string" && json.error.trim()
        ? json.error.trim()
        : "Failed to load design templates",
    );
  }

  return {
    items: Array.isArray(json?.items) ? json.items : [],
    total: typeof json?.total === "number" ? json.total : 0,
  };
}

export async function getDesignTemplate(params: {
  orgId: string;
  id: string;
}): Promise<DesignTemplateDetail | null> {
  if (!isCoursewareApiConfigured()) {
    return null;
  }

  const orgId = requireOrgId(params.orgId);
  const id = params.id.trim();
  const json = (await coursewareApi.get(
    `/courseware/design-templates/${encodeURIComponent(id)}`,
    { orgId },
    COURSEWARE_AGENT_OPTS,
  )) as { ok?: boolean; error?: string; template?: DesignTemplateDetail };

  if (json && typeof json === "object" && json.ok === false) {
    throw new Error(
      typeof json.error === "string" && json.error.trim()
        ? json.error.trim()
        : "Failed to load design template",
    );
  }

  return json?.template ?? null;
}

export async function deleteDesignTemplate(params: {
  orgId: string;
  id: string;
}): Promise<void> {
  if (!isCoursewareApiConfigured()) {
    throw new Error("未配置课件助手服务地址（coursewareApi）");
  }

  const orgId = requireOrgId(params.orgId);
  const id = params.id.trim();
  const json = (await coursewareApi.delete(
    `/courseware/design-templates/${encodeURIComponent(id)}`,
    { orgId },
    COURSEWARE_AGENT_OPTS,
  )) as { ok?: boolean; error?: string };

  if (json && typeof json === "object" && json.ok === false) {
    throw new Error(
      typeof json.error === "string" && json.error.trim()
        ? json.error.trim()
        : "Failed to delete design template",
    );
  }
}

export async function extractDesignTemplate(
  params: ExtractDesignTemplateParams,
): Promise<DesignTemplateDetail> {
  if (!isCoursewareApiConfigured()) {
    throw new Error("未配置课件助手服务地址（coursewareApi）");
  }

  const orgId = requireOrgId(params.orgId);
  const json = (await coursewareApi.post(
    "/courseware/design-templates/extract",
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
  )) as DesignTemplateMutationResponse;

  if (!json?.template) {
    throw new Error(
      typeof json?.error === "string" && json.error.trim()
        ? json.error.trim()
        : "Failed to extract design template",
    );
  }

  return json.template;
}

export async function updateDesignTemplate(params: {
  orgId: string;
  id: string;
  name?: string;
  content?: string;
  description?: string | null;
}): Promise<DesignTemplateDetail> {
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
    `/courseware/design-templates/${encodeURIComponent(id)}`,
    body,
    COURSEWARE_AGENT_OPTS,
  )) as DesignTemplateMutationResponse;

  if (!json?.template) {
    throw new Error(
      typeof json?.error === "string" && json.error.trim()
        ? json.error.trim()
        : "Failed to update design template",
    );
  }

  return json.template;
}

export async function createDesignTemplate(params: {
  orgId: string;
  name: string;
  content: string;
  description?: string | null;
}): Promise<DesignTemplateDetail> {
  if (!isCoursewareApiConfigured()) {
    throw new Error("未配置课件助手服务地址（coursewareApi）");
  }

  const orgId = requireOrgId(params.orgId);
  const json = (await coursewareApi.post(
    "/courseware/design-templates",
    {
      orgId,
      name: params.name.trim(),
      content: params.content.trim(),
      description: params.description?.trim() || null,
      sourceType: "manual",
    },
    COURSEWARE_AGENT_OPTS,
  )) as DesignTemplateMutationResponse;

  if (!json?.template) {
    throw new Error(
      typeof json?.error === "string" && json.error.trim()
        ? json.error.trim()
        : "Failed to create design template",
    );
  }

  return json.template;
}
