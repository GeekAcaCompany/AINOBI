// SPDX-License-Identifier: AGPL-3.0-only
import { ILike } from "typeorm";

import { dataSource } from "../db/db.ts";
import { ensureDataSource } from "../db/ensure-data-source.ts";
import {
  assertOrgIdAccess,
  assertOrgIdManageAccess,
} from "../auth/ainobi-org-access.ts";
import {
  CoursewareDesignTemplate,
  type CoursewareDesignTemplateSourceType,
} from "../models/courseware-design-templates.ts";

export { assertOrgIdAccess, assertOrgIdManageAccess };

export const DESIGN_TEMPLATE_CONTENT_MAX_CHARS = 32_768;
export const DESIGN_TEMPLATE_CONTENT_INJECT_MAX_CHARS = 8_000;

export type DesignTemplateDto = {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  content: string;
  sourceType: CoursewareDesignTemplateSourceType;
  sourceMeta: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type DesignTemplateListItemDto = Omit<DesignTemplateDto, "content"> & {
  contentPreview: string;
};

function toIso(d: Date): string {
  return d.toISOString();
}

function previewContent(content: string, max = 240): string {
  const trimmed = content.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

export function templateToDto(entity: CoursewareDesignTemplate): DesignTemplateDto {
  return {
    id: entity.id,
    orgId: entity.orgId,
    name: entity.name,
    description: entity.description,
    content: entity.content,
    sourceType: entity.sourceType,
    sourceMeta: entity.sourceMeta,
    createdAt: toIso(entity.createdAt),
    updatedAt: toIso(entity.updatedAt),
  };
}

export function templateToListItem(entity: CoursewareDesignTemplate): DesignTemplateListItemDto {
  const { content: _content, ...rest } = templateToDto(entity);
  return {
    ...rest,
    contentPreview: previewContent(entity.content),
  };
}

function validateName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Template name is required.");
  }
  if (trimmed.length > 128) {
    throw new Error("Template name must be at most 128 characters.");
  }
  return trimmed;
}

function validateContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("Template content is required.");
  }
  if (trimmed.length > DESIGN_TEMPLATE_CONTENT_MAX_CHARS) {
    throw new Error(
      `Template content must be at most ${DESIGN_TEMPLATE_CONTENT_MAX_CHARS} characters.`,
    );
  }
  return trimmed;
}

export async function listDesignTemplates(params: {
  orgId: string;
  q?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: DesignTemplateListItemDto[]; total: number }> {
  await ensureDataSource();
  const repo = dataSource.getRepository(CoursewareDesignTemplate);
  const orgId = params.orgId.trim();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 50));
  const q = params.q?.trim();

  const where = q
    ? [{ orgId, name: ILike(`%${q}%`) }, { orgId, description: ILike(`%${q}%`) }]
    : { orgId };

  const [entities, total] = await repo.findAndCount({
    where,
    order: { updatedAt: "DESC", name: "ASC" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  return {
    items: entities.map(templateToListItem),
    total,
  };
}

export async function getDesignTemplateById(
  id: string,
  orgId: string,
): Promise<CoursewareDesignTemplate | null> {
  await ensureDataSource();
  const repo = dataSource.getRepository(CoursewareDesignTemplate);
  return repo.findOne({ where: { id: id.trim(), orgId: orgId.trim() } });
}

export async function getDesignTemplatesByIds(
  orgId: string,
  ids: readonly string[],
): Promise<CoursewareDesignTemplate[]> {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return [];
  await ensureDataSource();
  const repo = dataSource.getRepository(CoursewareDesignTemplate);
  return repo.find({
    where: unique.map((id) => ({ id, orgId: orgId.trim() })),
    order: { name: "ASC" },
  });
}

export async function createDesignTemplate(params: {
  orgId: string;
  name: string;
  content: string;
  description?: string | null;
  sourceType?: CoursewareDesignTemplateSourceType;
  sourceMeta?: Record<string, unknown> | null;
  createdBy?: string | null;
}): Promise<DesignTemplateDto> {
  await ensureDataSource();
  const repo = dataSource.getRepository(CoursewareDesignTemplate);
  const entity = repo.create({
    orgId: params.orgId.trim(),
    name: validateName(params.name),
    content: validateContent(params.content),
    description: params.description?.trim() || null,
    sourceType: params.sourceType ?? "manual",
    sourceMeta: params.sourceMeta ?? null,
    createdBy: params.createdBy ?? null,
    updatedBy: params.createdBy ?? null,
  });
  const saved = await repo.save(entity);
  return templateToDto(saved);
}

export async function updateDesignTemplate(params: {
  id: string;
  orgId: string;
  name?: string;
  content?: string;
  description?: string | null;
  sourceType?: CoursewareDesignTemplateSourceType;
  sourceMeta?: Record<string, unknown> | null;
  updatedBy?: string | null;
}): Promise<DesignTemplateDto | null> {
  await ensureDataSource();
  const repo = dataSource.getRepository(CoursewareDesignTemplate);
  const entity = await getDesignTemplateById(params.id, params.orgId);
  if (!entity) return null;

  if (params.name !== undefined) {
    entity.name = validateName(params.name);
  }
  if (params.content !== undefined) {
    entity.content = validateContent(params.content);
  }
  if (params.description !== undefined) {
    entity.description = params.description?.trim() || null;
  }
  if (params.sourceType !== undefined) {
    entity.sourceType = params.sourceType;
  }
  if (params.sourceMeta !== undefined) {
    entity.sourceMeta = params.sourceMeta;
  }
  if (params.updatedBy !== undefined) {
    entity.updatedBy = params.updatedBy;
  }

  const saved = await repo.save(entity);
  return templateToDto(saved);
}

export async function deleteDesignTemplate(id: string, orgId: string): Promise<boolean> {
  await ensureDataSource();
  const repo = dataSource.getRepository(CoursewareDesignTemplate);
  const result = await repo.delete({ id: id.trim(), orgId: orgId.trim() });
  return (result.affected ?? 0) > 0;
}

export function truncateDesignTemplateContentForInject(content: string): {
  text: string;
  truncated: boolean;
} {
  const trimmed = content.trim();
  if (trimmed.length <= DESIGN_TEMPLATE_CONTENT_INJECT_MAX_CHARS) {
    return { text: trimmed, truncated: false };
  }
  return {
    text: `${trimmed.slice(0, DESIGN_TEMPLATE_CONTENT_INJECT_MAX_CHARS)}\n\n…(template truncated for context limit)`,
    truncated: true,
  };
}

export function buildReferencedDesignTemplatesEditorSection(
  templates: readonly Pick<CoursewareDesignTemplate, "id" | "name" | "content">[],
): string {
  if (templates.length === 0) return "";

  const lines = [
    "[User @ Referenced Design Templates]",
    "Follow these org design templates as authoritative style guides unless the user overrides.",
  ];

  for (const template of templates) {
    const { text, truncated } = truncateDesignTemplateContentForInject(template.content);
    lines.push("", `### Template: ${template.name} (id: ${template.id})`);
    if (truncated) {
      lines.push(
        `(Note: template body was truncated to ${DESIGN_TEMPLATE_CONTENT_INJECT_MAX_CHARS} chars for context.)`,
      );
    }
    lines.push(text);
  }

  return lines.join("\n");
}
