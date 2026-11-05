// SPDX-License-Identifier: AGPL-3.0-only
import { dataSource } from "../db/db.ts";
import { ensureDataSource } from "../db/ensure-data-source.ts";
import {
  CoursewareContentTemplate,
  type CoursewareContentTemplateSourceType,
} from "../models/courseware-content-templates.ts";
import {
  BUILT_IN_CONTENT_TEMPLATE_META_KEY,
  BUILT_IN_CONTENT_TEMPLATES,
  getBuiltInContentTemplateById,
  getBuiltInContentTemplateByKey,
  isBuiltInContentTemplateId,
  readBuiltInKeyFromSourceMeta,
  type BuiltInContentTemplateDef,
  type BuiltInContentTemplateKey,
} from "./built-in-content-templates.ts";

export { assertOrgIdAccess, assertOrgIdManageAccess } from "./courseware-design-templates-service.ts";

export const CONTENT_TEMPLATE_CONTENT_MAX_CHARS = 32_768;
export const CONTENT_TEMPLATE_CONTENT_INJECT_MAX_CHARS = 8_000;

const BUILT_IN_TIMESTAMP = "2026-01-01T00:00:00.000Z";

export type ContentTemplateDto = {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  content: string;
  sourceType: CoursewareContentTemplateSourceType;
  sourceMeta: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  /** Built into the system (stable id); no DB row while the organization hasn't edited it */
  isBuiltIn: boolean;
  /** The organization has written an override row for the built-in template */
  isOrgOverride: boolean;
};

export type ContentTemplateListItemDto = Omit<ContentTemplateDto, "content"> & {
  contentPreview: string;
};

export type DeleteContentTemplateResult =
  | { ok: true; kind: "deleted" }
  | { ok: true; kind: "reset_builtin" }
  | { ok: false; kind: "not_found" }
  | { ok: false; kind: "builtin_protected" };

function toIso(d: Date): string {
  return d.toISOString();
}

function previewContent(content: string, max = 240): string {
  const trimmed = content.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

function withFlags(
  dto: Omit<ContentTemplateDto, "isBuiltIn" | "isOrgOverride">,
  flags: { isBuiltIn: boolean; isOrgOverride: boolean },
): ContentTemplateDto {
  return { ...dto, ...flags };
}

export function templateToDto(
  entity: CoursewareContentTemplate,
  flags: { isBuiltIn?: boolean; isOrgOverride?: boolean } = {},
): ContentTemplateDto {
  return withFlags(
    {
      id: entity.id,
      orgId: entity.orgId,
      name: entity.name,
      description: entity.description,
      content: entity.content,
      sourceType: entity.sourceType,
      sourceMeta: entity.sourceMeta,
      createdAt: toIso(entity.createdAt),
      updatedAt: toIso(entity.updatedAt),
    },
    {
      isBuiltIn: flags.isBuiltIn ?? false,
      isOrgOverride: flags.isOrgOverride ?? false,
    },
  );
}

export function templateToListItem(
  entity: CoursewareContentTemplate,
  flags: { isBuiltIn?: boolean; isOrgOverride?: boolean } = {},
): ContentTemplateListItemDto {
  const { content: _content, ...rest } = templateToDto(entity, flags);
  return {
    ...rest,
    contentPreview: previewContent(entity.content),
  };
}

function builtInToDto(
  def: BuiltInContentTemplateDef,
  orgId: string,
  override: CoursewareContentTemplate | null,
): ContentTemplateDto {
  if (override) {
    return withFlags(
      {
        id: def.id,
        orgId,
        name: override.name,
        description: override.description,
        content: override.content,
        sourceType: override.sourceType,
        sourceMeta: {
          ...(override.sourceMeta ?? {}),
          [BUILT_IN_CONTENT_TEMPLATE_META_KEY]: def.key,
        },
        createdAt: toIso(override.createdAt),
        updatedAt: toIso(override.updatedAt),
      },
      { isBuiltIn: true, isOrgOverride: true },
    );
  }

  return withFlags(
    {
      id: def.id,
      orgId,
      name: def.name,
      description: def.description,
      content: def.content,
      sourceType: "manual",
      sourceMeta: { [BUILT_IN_CONTENT_TEMPLATE_META_KEY]: def.key },
      createdAt: BUILT_IN_TIMESTAMP,
      updatedAt: BUILT_IN_TIMESTAMP,
    },
    { isBuiltIn: true, isOrgOverride: false },
  );
}

function builtInToListItem(
  def: BuiltInContentTemplateDef,
  orgId: string,
  override: CoursewareContentTemplate | null,
): ContentTemplateListItemDto {
  const { content, ...rest } = builtInToDto(def, orgId, override);
  return {
    ...rest,
    contentPreview: previewContent(content),
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
  if (trimmed.length > CONTENT_TEMPLATE_CONTENT_MAX_CHARS) {
    throw new Error(
      `Template content must be at most ${CONTENT_TEMPLATE_CONTENT_MAX_CHARS} characters.`,
    );
  }
  return trimmed;
}

async function findOrgOverrideByKey(
  orgId: string,
  key: BuiltInContentTemplateKey,
): Promise<CoursewareContentTemplate | null> {
  await ensureDataSource();
  const repo = dataSource.getRepository(CoursewareContentTemplate);
  return (
    (await repo
      .createQueryBuilder("t")
      .where("t.org_id = :orgId", { orgId: orgId.trim() })
      .andWhere(`t.source_meta->>'${BUILT_IN_CONTENT_TEMPLATE_META_KEY}' = :key`, { key })
      .getOne()) ?? null
  );
}

async function loadOrgOverrideMap(
  orgId: string,
): Promise<Map<BuiltInContentTemplateKey, CoursewareContentTemplate>> {
  await ensureDataSource();
  const repo = dataSource.getRepository(CoursewareContentTemplate);
  const entities = await repo.find({ where: { orgId: orgId.trim() } });
  const map = new Map<BuiltInContentTemplateKey, CoursewareContentTemplate>();
  for (const entity of entities) {
    const key = readBuiltInKeyFromSourceMeta(entity.sourceMeta);
    if (key) map.set(key, entity);
  }
  return map;
}

function matchesQuery(
  item: Pick<ContentTemplateListItemDto, "name" | "description" | "contentPreview">,
  q: string,
): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    item.name.toLowerCase().includes(needle) ||
    (item.description ?? "").toLowerCase().includes(needle) ||
    item.contentPreview.toLowerCase().includes(needle)
  );
}

export async function listContentTemplates(params: {
  orgId: string;
  q?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: ContentTemplateListItemDto[]; total: number }> {
  await ensureDataSource();
  const repo = dataSource.getRepository(CoursewareContentTemplate);
  const orgId = params.orgId.trim();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 50));
  const q = params.q?.trim();

  const entities = await repo.find({
    where: orgId ? { orgId } : undefined,
    order: { updatedAt: "DESC", name: "ASC" },
  });

  const overrideByKey = new Map<BuiltInContentTemplateKey, CoursewareContentTemplate>();
  const customs: CoursewareContentTemplate[] = [];
  for (const entity of entities) {
    const key = readBuiltInKeyFromSourceMeta(entity.sourceMeta);
    if (key) {
      overrideByKey.set(key, entity);
    } else {
      customs.push(entity);
    }
  }

  const builtInItems = BUILT_IN_CONTENT_TEMPLATES.map((def) =>
    builtInToListItem(def, orgId, overrideByKey.get(def.key) ?? null),
  );
  const customItems = customs.map((entity) => templateToListItem(entity));

  let merged = [...builtInItems, ...customItems];
  if (q) {
    merged = merged.filter((item) => matchesQuery(item, q));
  }

  const total = merged.length;
  const start = (page - 1) * pageSize;
  return {
    items: merged.slice(start, start + pageSize),
    total,
  };
}

/** Query only the entity rows in the organization library (no built-in virtual rows). */
export async function getContentTemplateEntityById(
  id: string,
  orgId: string,
): Promise<CoursewareContentTemplate | null> {
  await ensureDataSource();
  const repo = dataSource.getRepository(CoursewareContentTemplate);
  return repo.findOne({ where: { id: id.trim(), orgId: orgId.trim() } });
}

/** @deprecated Use resolveContentTemplateDto; the alias stays so old callers don't break */
export async function getContentTemplateById(
  id: string,
  orgId: string,
): Promise<CoursewareContentTemplate | null> {
  return getContentTemplateEntityById(id, orgId);
}

export async function resolveContentTemplateDto(
  id: string,
  orgId: string,
): Promise<ContentTemplateDto | null> {
  const trimmedId = id.trim();
  const trimmedOrg = orgId.trim();
  const builtIn = getBuiltInContentTemplateById(trimmedId);
  if (builtIn) {
    const override = await findOrgOverrideByKey(trimmedOrg, builtIn.key);
    return builtInToDto(builtIn, trimmedOrg, override);
  }

  const entity = await getContentTemplateEntityById(trimmedId, trimmedOrg);
  if (!entity) return null;
  return templateToDto(entity);
}

/**
 * For chat injection: resolve by referenced id (built-in id → override or default body).
 * The return order matches the request ids after deduplication.
 */
export async function getContentTemplatesByIds(
  orgId: string,
  ids: readonly string[],
): Promise<Array<Pick<ContentTemplateDto, "id" | "name" | "content">>> {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return [];

  const trimmedOrg = orgId.trim();
  const overrideMap = await loadOrgOverrideMap(trimmedOrg);
  const customIds = unique.filter((id) => !isBuiltInContentTemplateId(id));

  await ensureDataSource();
  const repo = dataSource.getRepository(CoursewareContentTemplate);
  const customEntities =
    customIds.length > 0
      ? await repo.find({
          where: customIds.map((id) => ({ id, orgId: trimmedOrg })),
        })
      : [];
  const customById = new Map(customEntities.map((e) => [e.id, e]));

  const out: Array<Pick<ContentTemplateDto, "id" | "name" | "content">> = [];
  for (const id of unique) {
    const builtIn = getBuiltInContentTemplateById(id);
    if (builtIn) {
      const dto = builtInToDto(builtIn, trimmedOrg, overrideMap.get(builtIn.key) ?? null);
      out.push({ id: dto.id, name: dto.name, content: dto.content });
      continue;
    }
    const entity = customById.get(id);
    if (entity) {
      out.push({ id: entity.id, name: entity.name, content: entity.content });
    }
  }
  return out;
}

export async function createContentTemplate(params: {
  orgId: string;
  name: string;
  content: string;
  description?: string | null;
  sourceType?: CoursewareContentTemplateSourceType;
  sourceMeta?: Record<string, unknown> | null;
  createdBy?: string | null;
}): Promise<ContentTemplateDto> {
  await ensureDataSource();
  const repo = dataSource.getRepository(CoursewareContentTemplate);
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

export async function updateContentTemplate(params: {
  id: string;
  orgId: string;
  name?: string;
  content?: string;
  description?: string | null;
  sourceType?: CoursewareContentTemplateSourceType;
  sourceMeta?: Record<string, unknown> | null;
  updatedBy?: string | null;
}): Promise<ContentTemplateDto | null> {
  const trimmedId = params.id.trim();
  const trimmedOrg = params.orgId.trim();
  const builtIn = getBuiltInContentTemplateById(trimmedId);

  if (builtIn) {
    await ensureDataSource();
    const repo = dataSource.getRepository(CoursewareContentTemplate);
    let entity = await findOrgOverrideByKey(trimmedOrg, builtIn.key);

    if (!entity) {
      entity = repo.create({
        orgId: trimmedOrg,
        name: validateName(params.name ?? builtIn.name),
        content: validateContent(params.content ?? builtIn.content),
        description:
          params.description !== undefined
            ? params.description?.trim() || null
            : builtIn.description,
        sourceType: params.sourceType ?? "manual",
        sourceMeta: {
          [BUILT_IN_CONTENT_TEMPLATE_META_KEY]: builtIn.key,
          ...(params.sourceMeta ?? {}),
        },
        createdBy: params.updatedBy ?? null,
        updatedBy: params.updatedBy ?? null,
      });
    } else {
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
      entity.sourceMeta = {
        ...(entity.sourceMeta ?? {}),
        ...(params.sourceMeta ?? {}),
        [BUILT_IN_CONTENT_TEMPLATE_META_KEY]: builtIn.key,
      };
      if (params.updatedBy !== undefined) {
        entity.updatedBy = params.updatedBy;
      }
    }

    const saved = await repo.save(entity);
    return builtInToDto(builtIn, trimmedOrg, saved);
  }

  await ensureDataSource();
  const repo = dataSource.getRepository(CoursewareContentTemplate);
  const entity = await getContentTemplateEntityById(trimmedId, trimmedOrg);
  if (!entity) return null;

  // Forbid turning a custom template into a "fake built-in override" to grab the slot
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

export async function deleteContentTemplate(
  id: string,
  orgId: string,
): Promise<DeleteContentTemplateResult> {
  const trimmedId = id.trim();
  const trimmedOrg = orgId.trim();
  const builtIn = getBuiltInContentTemplateById(trimmedId);

  if (builtIn) {
    const override = await findOrgOverrideByKey(trimmedOrg, builtIn.key);
    if (!override) {
      return { ok: false, kind: "builtin_protected" };
    }
    await ensureDataSource();
    const repo = dataSource.getRepository(CoursewareContentTemplate);
    await repo.delete({ id: override.id, orgId: trimmedOrg });
    return { ok: true, kind: "reset_builtin" };
  }

  await ensureDataSource();
  const repo = dataSource.getRepository(CoursewareContentTemplate);
  const result = await repo.delete({ id: trimmedId, orgId: trimmedOrg });
  if ((result.affected ?? 0) > 0) {
    return { ok: true, kind: "deleted" };
  }
  return { ok: false, kind: "not_found" };
}

export function truncateContentTemplateContentForInject(content: string): {
  text: string;
  truncated: boolean;
} {
  const trimmed = content.trim();
  if (trimmed.length <= CONTENT_TEMPLATE_CONTENT_INJECT_MAX_CHARS) {
    return { text: trimmed, truncated: false };
  }
  return {
    text: `${trimmed.slice(0, CONTENT_TEMPLATE_CONTENT_INJECT_MAX_CHARS)}\n\n…(template truncated for context limit)`,
    truncated: true,
  };
}

export function buildReferencedContentTemplatesEditorSection(
  templates: readonly Pick<ContentTemplateDto, "id" | "name" | "content">[],
): string {
  if (templates.length === 0) return "";

  const lines = [
    "[User @ Referenced Content Templates]",
    "Follow these content templates (built-in or org) as authoritative outline/structure constraints unless the user overrides. Apply learning goals, page outline, pacing, quiz checkpoints, and narration rhythm — not visual style.",
  ];

  for (const template of templates) {
    const { text, truncated } = truncateContentTemplateContentForInject(template.content);
    lines.push("", `### Template: ${template.name} (id: ${template.id})`);
    if (truncated) {
      lines.push(
        `(Note: template body was truncated to ${CONTENT_TEMPLATE_CONTENT_INJECT_MAX_CHARS} chars for context.)`,
      );
    }
    lines.push(text);
  }

  return lines.join("\n");
}

export {
  getBuiltInContentTemplateById,
  getBuiltInContentTemplateByKey,
  isBuiltInContentTemplateId,
  BUILT_IN_CONTENT_TEMPLATES,
};
