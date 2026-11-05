// SPDX-License-Identifier: AGPL-3.0-only
import { ILike } from "typeorm";

import { dataSource } from "../db/db.ts";
import { ensureDataSource } from "../db/ensure-data-source.ts";
import {
  assertOrgIdAccess,
  assertOrgIdManageAccess,
} from "../auth/ainobi-org-access.ts";
import {
  CoursewareTtsPronunciationDict,
  type CoursewareTtsPronunciationDictLanguage,
} from "../models/courseware-tts-pronunciation-dict.ts";
import {
  applyPronunciationDict,
  normalizePronunciationMark,
  shouldApplyPronunciationDict,
  type PronunciationDictEntry,
} from "./tts-pronunciation-apply.ts";
import { convertTextToPronunciation } from "./tts-pronunciation-convert.ts";

export { assertOrgIdAccess, assertOrgIdManageAccess };

export type PronunciationDictDto = {
  id: string;
  orgId: string;
  sourceText: string;
  language: CoursewareTtsPronunciationDictLanguage;
  pronunciation: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

const SOURCE_TEXT_MAX = 256;
const PRONUNCIATION_MAX = 512;

function toIso(d: Date): string {
  return d.toISOString();
}

export function entryToDto(entity: CoursewareTtsPronunciationDict): PronunciationDictDto {
  return {
    id: entity.id,
    orgId: entity.orgId,
    sourceText: entity.sourceText,
    language: entity.language,
    pronunciation: entity.pronunciation,
    enabled: entity.enabled,
    createdAt: toIso(entity.createdAt),
    updatedAt: toIso(entity.updatedAt),
  };
}

function validateSourceText(sourceText: string): string {
  const trimmed = sourceText.trim();
  if (!trimmed) {
    throw new Error("sourceText is required.");
  }
  if (trimmed.length > SOURCE_TEXT_MAX) {
    throw new Error(`sourceText must be at most ${SOURCE_TEXT_MAX} characters.`);
  }
  return trimmed;
}

function validatePronunciation(pronunciation: string): string {
  const trimmed = normalizePronunciationMark(pronunciation);
  if (!trimmed) {
    throw new Error("pronunciation is required.");
  }
  if (trimmed.length > PRONUNCIATION_MAX) {
    throw new Error(`pronunciation must be at most ${PRONUNCIATION_MAX} characters.`);
  }
  return trimmed;
}

function validateLanguage(language: string): CoursewareTtsPronunciationDictLanguage {
  const lang = language.trim().toLowerCase();
  if (lang !== "ja" && lang !== "zh") {
    throw new Error('language must be "ja" or "zh".');
  }
  return lang;
}

export async function listPronunciationDictEntries(params: {
  orgId: string;
  q?: string;
  language?: CoursewareTtsPronunciationDictLanguage;
  enabled?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<{ items: PronunciationDictDto[]; total: number }> {
  await ensureDataSource();
  const repo = dataSource.getRepository(CoursewareTtsPronunciationDict);
  const orgId = params.orgId.trim();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 100));
  const q = params.q?.trim();

  const base: Record<string, unknown> = { orgId };
  if (params.language) base.language = params.language;
  if (typeof params.enabled === "boolean") base.enabled = params.enabled;

  const where = q
    ? [
        { ...base, sourceText: ILike(`%${q}%`) },
        { ...base, pronunciation: ILike(`%${q}%`) },
      ]
    : base;

  const [entities, total] = await repo.findAndCount({
    where: where as never,
    order: { updatedAt: "DESC", sourceText: "ASC" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  return {
    items: entities.map(entryToDto),
    total,
  };
}

export async function listEnabledPronunciationDictEntries(
  orgId: string,
): Promise<PronunciationDictEntry[]> {
  await ensureDataSource();
  const repo = dataSource.getRepository(CoursewareTtsPronunciationDict);
  const entities = await repo.find({
    where: { orgId: orgId.trim(), enabled: true },
    order: { sourceText: "ASC" },
  });
  return entities.map((e) => ({
    sourceText: e.sourceText,
    language: e.language,
    pronunciation: e.pronunciation,
    enabled: e.enabled,
  }));
}

export async function getPronunciationDictEntryById(
  id: string,
  orgId: string,
): Promise<CoursewareTtsPronunciationDict | null> {
  await ensureDataSource();
  const repo = dataSource.getRepository(CoursewareTtsPronunciationDict);
  return repo.findOne({ where: { id: id.trim(), orgId: orgId.trim() } });
}

export async function createPronunciationDictEntry(params: {
  orgId: string;
  sourceText: string;
  language: string;
  pronunciation?: string | null;
  enabled?: boolean;
  autoConvert?: boolean;
  createdBy?: string | null;
}): Promise<PronunciationDictDto> {
  await ensureDataSource();
  const repo = dataSource.getRepository(CoursewareTtsPronunciationDict);
  const language = validateLanguage(params.language);
  const sourceText = validateSourceText(params.sourceText);
  let pronunciation = params.pronunciation?.trim() ?? "";
  if (!pronunciation || params.autoConvert) {
    pronunciation = await convertTextToPronunciation(sourceText, language);
  }
  pronunciation = validatePronunciation(pronunciation);

  const entity = repo.create({
    orgId: params.orgId.trim(),
    sourceText,
    language,
    pronunciation,
    enabled: true,
    createdBy: params.createdBy ?? null,
    updatedBy: params.createdBy ?? null,
  });
  try {
    const saved = await repo.save(entity);
    return entryToDto(saved);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error(`Dictionary entry already exists for "${sourceText}".`);
    }
    throw error;
  }
}

export async function updatePronunciationDictEntry(params: {
  id: string;
  orgId: string;
  sourceText?: string;
  language?: string;
  pronunciation?: string;
  enabled?: boolean;
  autoConvert?: boolean;
  updatedBy?: string | null;
}): Promise<PronunciationDictDto | null> {
  await ensureDataSource();
  const repo = dataSource.getRepository(CoursewareTtsPronunciationDict);
  const entity = await getPronunciationDictEntryById(params.id, params.orgId);
  if (!entity) return null;

  if (params.sourceText !== undefined) {
    entity.sourceText = validateSourceText(params.sourceText);
  }
  if (params.language !== undefined) {
    entity.language = validateLanguage(params.language);
  }
  if (params.enabled !== undefined) {
    entity.enabled = params.enabled;
  }

  if (params.autoConvert) {
    entity.pronunciation = validatePronunciation(
      await convertTextToPronunciation(entity.sourceText, entity.language),
    );
  } else if (params.pronunciation !== undefined) {
    entity.pronunciation = validatePronunciation(params.pronunciation);
  }

  if (params.updatedBy !== undefined) {
    entity.updatedBy = params.updatedBy;
  }

  try {
    const saved = await repo.save(entity);
    return entryToDto(saved);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error(`Dictionary entry already exists for "${entity.sourceText}".`);
    }
    throw error;
  }
}

export async function deletePronunciationDictEntry(
  id: string,
  orgId: string,
): Promise<boolean> {
  await ensureDataSource();
  const repo = dataSource.getRepository(CoursewareTtsPronunciationDict);
  const result = await repo.delete({ id: id.trim(), orgId: orgId.trim() });
  return (result.affected ?? 0) > 0;
}

export async function convertPronunciationPreview(params: {
  text: string;
  language: string;
}): Promise<{ pronunciation: string; language: CoursewareTtsPronunciationDictLanguage }> {
  const language = validateLanguage(params.language);
  const text = validateSourceText(params.text);
  const pronunciation = validatePronunciation(
    await convertTextToPronunciation(text, language),
  );
  return { pronunciation, language };
}

/**
 * Load org dictionary and apply provider-specific rewrites.
 * - Japanese: keyword → kana replacement
 * - Chinese: inline pinyin markers (the compatibility path; the main MiniMax synthesis path uses tone)
 * Fish Audio / unknown providers return text unchanged.
 * Billing should use the pre-rewrite text.
 */
export async function applyOrgPronunciationDictToText(params: {
  orgId: string;
  text: string;
  provider: string | null | undefined;
}): Promise<string> {
  if (!shouldApplyPronunciationDict(params.provider)) {
    return params.text;
  }
  const orgId = params.orgId?.trim();
  if (!orgId || !params.text) {
    return params.text;
  }
  try {
    const entries = await listEnabledPronunciationDictEntries(orgId);
    if (entries.length === 0) return params.text;
    return applyPronunciationDict(params.text, entries);
  } catch (error) {
    console.warn(
      "[tts-pronunciation-dict] apply failed, using original text:",
      error instanceof Error ? error.message : String(error),
    );
    return params.text;
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  if (code === "23505") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /unique|duplicate/i.test(message);
}
