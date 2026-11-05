// SPDX-License-Identifier: AGPL-3.0-only
import { In, QueryFailedError, type EntityManager } from "typeorm";

import {
  CoursewareOrgAccessError,
  type CoursewareActorContext,
} from "../auth/ainobi-org-access.ts";
import { deleteOssObject } from "@ainobi/courseware-cli/cli/assets.ts";
import { dataSource } from "../db/db.ts";
import { ensureDataSource } from "../db/ensure-data-source.ts";
import { CoursewareAsset } from "../models/courseware-assets.ts";
import { CoursewareQuizAnswerRecording } from "../models/courseware-quiz-answer-recordings.ts";
import { CoursewareTtsStorageRef } from "../models/courseware-tts-storage-refs.ts";
import { CoursewareDeleted } from "../models/courseware-deleted.ts";
import { CoursewareCourseBinding } from "../models/courseware-course-binding.ts";
import { CoursewareSectionBinding } from "../models/courseware-section-binding.ts";
import { Courseware, CoursewareVersion } from "../models/courseware.ts";
import { normalizeSceneJsonForPersistence } from "@ainobi/courseware-cli/cli/scene-persistence-normalize.ts";
import { normalizeCoursewareAssetUrlForPersistence } from "@ainobi/courseware-cli/cli/asset-url-persistence.ts";
import { refreshCoursewareCoverUrlForResponse } from "./courseware-object-url-response.ts";
import { clearAllAgentHistoryForCourseware } from "./conversation-service.ts";
import { recordCoursewareAuditLog } from "./courseware-audit-log-service.ts";
import { ensureCoursewareCourseBinding } from "./courseware-course-binding-service.ts";
import {
  decrementCoursewareObjectStorage,
  markAssetRefundClaimComplete,
} from "./courseware-asset-org-storage.ts";
import { isOrgStorageIntegrationEnabled } from "./ainobi-org-storage.ts";

export type CoursewareVersionSummary = {
  id: string;
  revision: number;
  createdAt: string;
};

export type CoursewareCurrentDto = {
  key: string;
  orgId: string | null;
  title: string | null;
  coverUrl: string | null;
  isPublic: boolean;
  isShare: boolean;
  /** Computed for the current session on GET detail: whether managed_list grants management rights over the courseware's org. */
  canManage?: boolean;
  content: Record<string, unknown>;
  updatedAt: string;
  versions: CoursewareVersionSummary[];
  versionPolicy: {
    maxSnapshots: number;
    lastSnapshotAt: string | null;
  };
};

export type CoursewareListItemDto = {
  id: string;
  orgId: string | null;
  key: string;
  title: string | null;
  coverUrl: string | null;
  isPublic: boolean;
  isShare: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** true when either a course-level or a section-level binding exists (the binding badge of console's content management page) */
  isBound: boolean;
  /** Distinct number of bound courses (distinct course_id of course-level ∪ section-level).
   *  Filled by the org list; not computed for the section binding list (may be omitted). */
  boundCourseCount?: number;
  /** Number of scenes (pages); null when content is empty or has no scenes array */
  sceneCount: number | null;
};

export type ListCoursewareForOrgInput = {
  /**
   * Organization, required: the result always converges to this one organization.
   * The caller must have run assertOrgIdAccess on it first — this function doesn't authorize by itself.
   */
  orgId: string;
  /** Optional extra filter: return only coursewares bound to this course (doesn't relax the org constraint) */
  courseId?: string;
  pageNumber?: number;
  pageSize?: number;
  title?: string;
  order?: "asc" | "desc";
  /** Sort field (created_at by default). console's content management page defaults to "recently edited" = updated_at; title = by title. */
  orderBy?: "created_at" | "updated_at" | "title";
  /**
   * Binding status filter (the three tabs of console's AI content page): bound = either a course-level or a section-level binding exists.
   * The default all doesn't filter.
   */
  bindingStatus?: "all" | "bound" | "unbound";
  /**
   * Whether to compute the org-wide bindingStats (needed for console's three tab counts). Default true;
   * pure id/title consumers (such as MCP courseware_list) can turn it off to save an aggregate query.
   */
  withBindingStats?: boolean;
};

/**
 * Target organization of the courseware list: the caller must pass it explicitly (the organization selected in the page / management UI).
 * Never falls back to the session's current_org, so cross-organization management doesn't list the wrong library.
 */
export function pickCoursewareListOrgId(requestedOrgId: string | undefined): string {
  const requested = requestedOrgId?.trim();
  if (!requested) {
    throw new Error(
      "Organization context is required to list courseware (pass orgId; login current_org_id is not used).",
    );
  }
  return requested;
}

export type ListCoursewareForOrgResult = {
  data: CoursewareListItemDto[];
  pagination: {
    pageNumber: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  /** Binding status counts (org-wide, independent of the current filter) — for console's three tab counts.
   *  Callers with withBindingStats=false (MCP) don't get this field. */
  bindingStats?: {
    all: number;
    bound: number;
    unbound: number;
  };
};

/**
 * SQL for the "bound" decision (references the outer alias cw.id): either a course-level (courseware_course_binding)
 * or a section-level (courseware_section_binding) binding counts as bound. The same-org invariant of both
 * is guaranteed by assertBindingOrgMatchesCourseware.
 */
export const COURSEWARE_BOUND_EXISTS_SQL =
  "(EXISTS (SELECT 1 FROM courseware_course_binding cb WHERE cb.courseware_id = cw.id) " +
  "OR EXISTS (SELECT 1 FROM courseware_section_binding sb WHERE sb.courseware_id = cw.id))";

/** Distinct number of bound courses: distinct course_id of course-level ∪ section-level. */
export const COURSEWARE_BOUND_COURSE_COUNT_SQL =
  "(SELECT COUNT(DISTINCT u.course_id) FROM (" +
  "SELECT cb.course_id FROM courseware_course_binding cb WHERE cb.courseware_id = cw.id " +
  "UNION " +
  "SELECT sb.course_id FROM courseware_section_binding sb WHERE sb.courseware_id = cw.id" +
  ") u)";

/** Number of scenes (pages): the length when content->'scenes' is an array, otherwise NULL. */
export const COURSEWARE_SCENE_COUNT_SQL =
  "CASE WHEN cw.content IS NULL THEN NULL " +
  "WHEN jsonb_typeof(cw.content -> 'scenes') = 'array' " +
  "THEN jsonb_array_length(cw.content -> 'scenes') ELSE NULL END";

/** Raw row of getRawAndEntities → extra fields of the list item (pure function, easy to unit test). */
export function resolveCoursewareExtrasFromRaw(raw: {
  cw_id?: unknown;
  bound_course_count?: unknown;
  scene_count?: unknown;
}): { isBound: boolean; boundCourseCount: number; sceneCount: number | null } {
  const boundCourseCount = Number(raw.bound_course_count ?? 0);
  return {
    isBound: boundCourseCount > 0,
    boundCourseCount,
    sceneCount:
      raw.scene_count === null || raw.scene_count === undefined
        ? null
        : Number(raw.scene_count),
  };
}

/** Binding three-tab counts (pure function): unbound is floored at 0 so count drift never shows negatives. */
export function deriveBindingStats(
  allCount: number,
  boundCount: number,
): { all: number; bound: number; unbound: number } {
  return {
    all: allCount,
    bound: boundCount,
    unbound: Math.max(allCount - boundCount, 0),
  };
}

async function getOrgBindingStats(
  orgId: string,
): Promise<{ all: number; bound: number; unbound: number }> {
  const repo = dataSource.getRepository(Courseware);
  const raw = await repo.query(
    `SELECT COUNT(*) AS all_count, ` +
      `COUNT(*) FILTER (WHERE ${COURSEWARE_BOUND_EXISTS_SQL}) AS bound_count ` +
      `FROM courseware cw WHERE cw.org_id = $1 AND cw.is_deleted = false`,
    [orgId],
  );
  const allCount = Number(raw?.[0]?.all_count ?? 0);
  const boundCount = Number(raw?.[0]?.bound_count ?? 0);
  return deriveBindingStats(allCount, boundCount);
}

function coursewareToListItem(
  cw: Courseware,
  extras: {
    isBound: boolean;
    boundCourseCount: number;
    sceneCount: number | null;
  },
): CoursewareListItemDto {
  return {
    ...coursewareListItemBase(cw),
    isBound: extras.isBound,
    boundCourseCount: extras.boundCourseCount,
    sceneCount: extras.sceneCount,
  };
}

/** Single mapping point of the 11 common fields (shared by the org list and the section binding list, converged in R4#3). */
export function coursewareListItemBase(cw: Courseware): Omit<
  CoursewareListItemDto,
  "isBound" | "boundCourseCount" | "sceneCount"
> {
  return {
    id: cw.id,
    orgId: cw.orgId,
    key: cw.key,
    title: cw.title,
    coverUrl: refreshCoursewareCoverUrlForResponse(cw.coverUrl),
    isPublic: Boolean(cw.isPublic),
    isShare: Boolean(cw.isShare),
    createdBy: cw.createdBy,
    updatedBy: cw.updatedBy,
    createdAt: cw.createdAt.toISOString(),
    updatedAt: cw.updatedAt.toISOString(),
  };
}

/**
 * List coursewares (without the content jsonb), by created_at descending by default.
 * The org predicate is always present, and courseId is just an extra filter on it — the old implementation chose one of the two,
 * so the courseId path had no org predicate at all and any logged-in user could enumerate another organization's coursewares.
 * Authorization is on the handler side (assertOrgIdAccess); this function only narrows the results to the authorized org.
 */
export async function listCoursewareForOrg(
  input: ListCoursewareForOrgInput,
): Promise<ListCoursewareForOrgResult> {
  const pageNumber = input.pageNumber ?? 1;
  const pageSize = input.pageSize ?? 20;
  const order = input.order ?? "desc";
  const courseId = input.courseId?.trim();
  const orgId = input.orgId?.trim();
  // Title sorting uses LOWER(): case-insensitive (same rule as the list search's ILIKE).
  // TypeORM replaces the alias property inside the expression as a whole (LOWER("cw"."title")), so it works like a bare column name.
  const orderField =
    input.orderBy === "updated_at"
      ? "cw.updatedAt"
      : input.orderBy === "title"
        ? "LOWER(cw.title)"
        : "cw.createdAt";
  const bindingStatus = input.bindingStatus ?? "all";

  if (!orgId) {
    throw new Error('"orgId" is required.');
  }

  const repo = dataSource.getRepository(Courseware);
  const qb = repo.createQueryBuilder("cw");

  // Filtering by cw.orgId covers the courseId branch too: the single-org invariant
  // (assertBindingOrgMatchesCourseware) guarantees bind.org_id === cw.org_id.
  qb.where("cw.orgId = :orgId", { orgId });
  // Soft-deleted coursewares (marked along with their course when it is deleted) don't appear in the AI content list
  qb.andWhere("cw.isDeleted = false");

  if (courseId) {
    // Same rule as binding_status: both course-level and section-level bindings count as "bound to the course"
    // (a courseware bound to course X through a section binding must be found by ?courseId=X too).
    qb.andWhere(
      "(EXISTS (SELECT 1 FROM courseware_course_binding cb " +
        "WHERE cb.courseware_id = cw.id AND cb.course_id = :bindCourseId) " +
      "OR EXISTS (SELECT 1 FROM courseware_section_binding sb " +
        "WHERE sb.courseware_id = cw.id AND sb.course_id = :bindCourseId))",
      { bindCourseId: courseId },
    );
  }

  const title = input.title?.trim();
  if (title) {
    const escaped = title.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    qb.andWhere("cw.title ILIKE :pat ESCAPE '\\'", { pat: `%${escaped}%` });
  }

  if (bindingStatus === "bound") {
    qb.andWhere(COURSEWARE_BOUND_EXISTS_SQL);
  } else if (bindingStatus === "unbound") {
    qb.andWhere(`NOT ${COURSEWARE_BOUND_EXISTS_SQL}`);
  }

  const total = await qb.getCount();
  const skip = (pageNumber - 1) * pageSize;
  // getRawAndEntities: scene_count / bound_course_count are aggregate subquery columns
  // that can't go into the entity — raw and entities are in the same order, so they are paired by index.
  // Explicitly narrow the selected columns: exclude the content jsonb (the list DTO doesn't use it; transferring/hydrating the whole column is waste).
  const pageQb = qb
    .clone()
    .select([
      "cw.id",
      "cw.orgId",
      "cw.key",
      "cw.title",
      "cw.coverUrl",
      "cw.isPublic",
      "cw.isShare",
      "cw.createdBy",
      "cw.updatedBy",
      "cw.createdAt",
      "cw.updatedAt",
    ])
    .orderBy(orderField, order === "asc" ? "ASC" : "DESC")
    // With tied createdAt (seed/migration data has day-granular timestamps; course copies bulk-insert in one transaction) Postgres
    // returns an unstable order — the courseware list order would change on every load. id is the stable tiebreaker.
    .addOrderBy("cw.id", "ASC")
    .skip(skip)
    .take(pageSize)
    .addSelect(COURSEWARE_BOUND_COURSE_COUNT_SQL, "bound_course_count")
    .addSelect(COURSEWARE_SCENE_COUNT_SQL, "scene_count");
  const { entities: rows, raw: rawRows } = await pageQb.getRawAndEntities();

  const rawByEntityId = new Map<
    string,
    ReturnType<typeof resolveCoursewareExtrasFromRaw>
  >();
  for (const raw of rawRows) {
    if (raw?.cw_id == null) continue;
    rawByEntityId.set(String(raw.cw_id), resolveCoursewareExtrasFromRaw(raw));
  }

  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const bindingStats = input.withBindingStats === false
    ? undefined
    : await getOrgBindingStats(orgId);
  return {
    data: rows.map((cw) => {
      const extras = rawByEntityId.get(cw.id) ?? {
        isBound: false,
        boundCourseCount: 0,
        sceneCount: null,
      };
      return coursewareToListItem(cw, {
        isBound: extras.isBound,
        boundCourseCount: extras.boundCourseCount,
        sceneCount: extras.sceneCount,
      });
    }),
    pagination: {
      pageNumber,
      pageSize,
      totalCount: total,
      totalPages,
      hasNextPage: pageNumber * pageSize < total,
      hasPreviousPage: pageNumber > 1,
    },
    // The contract field is optional: with aggregation off, no fake all-zero counts are returned (callers couldn't tell them apart from
    // a truly empty organization); it is simply omitted
    ...(bindingStats ? { bindingStats } : {}),
  };
}

/** Extract the object key from a cover URL (anchored on the courseware_covers/ prefix, same rule as cover-http). */
function coverObjectKeyFromUrlForSave(coverUrl: string): string | null {
  const idx = coverUrl.indexOf("courseware_covers/");
  if (idx < 0) return null;
  const key = coverUrl
    .slice(idx)
    .split("?")[0]
    .split("#")[0]
    .trim();
  return key || null;
}

/**
 * Content md5 of a cover object key (the file name without extension). Cover objects are named by coursewareCoverObjectKey
 * after the content md5 (clones keep the source md5), so the key name is a content-addressed identifier and can serve as
 * the (org, md5) primary key of CoursewareAssetRefundClaim. Keys not shaped like an md5 (shouldn't exist)
 * return null, and the caller must refuse the refund rather than bypass the claim.
 */
export function coverObjectMd5FromKey(key: string): string | null {
  const base = key.split("/").pop() ?? "";
  const stem = base.replace(/\.[A-Za-z0-9]+$/, "");
  return /^[0-9a-f]{32}$/i.test(stem) ? stem.toLowerCase() : null;
}

/**
 * Restore the size marker consumed by the claim transaction (pre-flight failure path): written back only while the pointer and the empty size state
 * still match this commit, so a concurrent writer's new state isn't overwritten. A NULL pointer needs the IS NULL branch.
 */
async function restoreCoverRefundMarker(
  coursewareId: string,
  committedCoverUrl: string | null,
  size: number,
): Promise<void> {
  try {
    const query = dataSource
      .getRepository(Courseware)
      .createQueryBuilder()
      .update(Courseware)
      .set({ coverFileSize: size })
      .where("id = :id AND cover_file_size IS NULL", { id: coursewareId });
    if (committedCoverUrl === null) {
      query.andWhere("cover_url IS NULL");
    } else {
      query.andWhere("cover_url = :coverUrl", { coverUrl: committedCoverUrl });
    }
    await query.execute();
  } catch (error) {
    console.error(
      `[cover-refund] marker restore failed — manual reconciliation needed ` +
        `coursewareId=${coursewareId} size=${size} ` +
        `error=${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Revoke a refund claim that was never issued (pre-flight failure path), so later attempts can claim again. */
async function deleteCoverRefundClaim(
  orgId: string | null,
  contentMd5: string,
): Promise<void> {
  if (!orgId) return;
  try {
    const { CoursewareAssetRefundClaim } = await import(
      "../models/courseware-asset-refund-claims.ts"
    );
    await dataSource
      .getRepository(CoursewareAssetRefundClaim)
      .delete({ orgId, contentMd5 });
  } catch (error) {
    console.warn(
      `[cover-refund] claim revert failed orgId=${orgId} md5=${contentMd5}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Ownership decision for courseware_covers/ object keys: both namespaces require "this prefix maps only to this row"
 * before it can be trusted — the physical bucket path folds by lower(identifier), while the identifier's unique index is case-sensitive,
 * so any fold race makes two rows share the same physical prefix:
 * - row id namespace: uuids are canonical lowercase and globally unique, but another row's business key may fold equal to this row's
 *   id (legacy rows whose key = another row's uuid) — with rowIdContested=true it isn't trusted either
 *   (codex P0: the mirror race on the ID side);
 * - business key namespace: trusted only with keyAliasOwned=true (no key-key / key-vs-id fold
 *   race).
 * The upload entry (cover-http) builds the object key straight from the id-or-key field the client passes, and the editor /
 * console actually pass the business key, so existing covers live under the key namespace. The race
 * criterion comes from hasCaseCollidingCoursewareKey (the caller must read it inside the 4202 fold lock).
 * Write permission was already checked by the route layer against the resolved row, so no cross-organization oracle is introduced.
 */
function coverKeyOwnedByCourseware(
  key: string,
  orgId: string | null | undefined,
  coursewareId: string | null | undefined,
  coursewareKey: string | null | undefined,
  keyAliasOwned: boolean,
  rowIdContested: boolean,
): boolean {
  if (!orgId || !coursewareId) return false;
  const lowered = key.toLowerCase();
  const orgPrefix = `courseware_covers/${orgId.toLowerCase()}/`;
  if (
    !rowIdContested &&
    lowered.startsWith(`${orgPrefix}${coursewareId.toLowerCase()}/`)
  ) {
    return true;
  }
  if (!keyAliasOwned || !coursewareKey) return false;
  return lowered.startsWith(`${orgPrefix}${coursewareKey.toLowerCase()}/`);
}

/**
 * Identifier fold race criterion: whether in the same org **another row's** identifier (business key or uuid id)
 * folds case-insensitively equal to the given value. Pass the row key → decides whether the key alias can be trusted (key-key /
 * key-vs-id race); pass the row id → decides whether the row id namespace is taken by another row's key (the ID-side
 * mirror race, codex P0). With a race the physical prefix is shared by two rows, and neither side may be trusted.
 *
 * Concurrency contract: the caller must hold the COURSEWARE_KEY_FOLD_LOCK_CLASS fold lock before reading the criterion,
 * mutually exclusive with the create path — otherwise a "no conflict" the criterion read would be voided at once by a concurrently created fold sibling
 * (codex P1).
 */
export async function hasCaseCollidingCoursewareKey(
  manager: EntityManager,
  orgId: string,
  key: string,
  excludeCoursewareId: string,
): Promise<boolean> {
  const lowered = key.trim().toLowerCase();
  if (!orgId || !lowered) return false;
  const row = await manager
    .getRepository(Courseware)
    .createQueryBuilder("cw")
    .select("1")
    .where("cw.orgId = :orgId", { orgId })
    .andWhere("cw.id <> :excludeCoursewareId", { excludeCoursewareId })
    .andWhere("(LOWER(cw.key) = :lowered OR LOWER(cw.id::text) = :lowered)", {
      lowered,
    })
    .limit(1)
    .getRawOne();
  return Boolean(row);
}

/**
 * Normalize the cover reference of a save input: a storage key may be stored as a bare key only when it belongs to this courseware.
 *
 * At response time a bare key is signed into a private bucket read URL — without the ownership check, any caller who knows (or guesses) someone else's
 * cover object key could point their own courseware at it and use the signing exit to read objects across organizations/coursewares
 * (Codex P0: signing oracle). The check rule comes from the same source as cover-http's ownership decision:
 * both namespaces require no fold race — the row id namespace requires rowIdContested=false (not trusted when another row's
 * business key folds equal to this row's id), and the business key namespace is trusted only when the caller has verified
 * there is no fold-conflicting sibling row (keyAliasOwned=true). Non-storage URLs (external links etc.) go through
 * the unified persistence normalization; a reference carrying a courseware_covers/ key that doesn't belong to this courseware is refused
 * directly — it can't fall back to normalizeCoursewareAssetUrlForPersistence, which would fold a signed URL of the private bucket host
 * into a bare key too, merely moving the oracle from the front door to the back door. At creation there is no
 * coursewareId yet, and a cover can only be attached through the cover upload flow after creation, so a create payload carrying
 * a courseware_covers/ reference is always refused (the clone service takes its own path: clear first, then copy).
 */
export function coverUrlForSave(
  coverUrl: string,
  orgId: string | null | undefined,
  coursewareId: string | null | undefined,
  coursewareKey: string | null | undefined,
  keyAliasOwned: boolean,
  rowIdContested: boolean,
): string {
  const key = coverObjectKeyFromUrlForSave(coverUrl);
  if (!key) {
    return normalizeCoursewareAssetUrlForPersistence(coverUrl);
  }
  if (
    !coursewareId ||
    !coverKeyOwnedByCourseware(
      key,
      orgId,
      coursewareId,
      coursewareKey,
      keyAliasOwned,
      rowIdContested,
    )
  ) {
    throw new Error(
      "cover reference must point at this courseware's courseware_covers/ objects (covers attach after creation via the cover upload flow)",
    );
  }
  return key;
}

function maxSnapshots(): number {
  const n = Number(process.env.COURSEWARE_VERSION_MAX ?? 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10;
}

async function nextRevision(manager: EntityManager, coursewareId: string): Promise<number> {
  const row = await manager
    .createQueryBuilder(CoursewareVersion, "v")
    .select("MAX(v.revision)", "max")
    .where("v.coursewareId = :coursewareId", { coursewareId })
    .getRawOne<{ max: string | null }>();
  const max = row?.max != null ? Number(row.max) : 0;
  return (Number.isFinite(max) ? max : 0) + 1;
}

async function pruneOldVersions(manager: EntityManager, coursewareId: string, keep: number): Promise<void> {
  const rows = await manager.find(CoursewareVersion, {
    where: { coursewareId },
    order: { createdAt: "DESC" },
  });
  const toRemove = rows.slice(keep);
  if (toRemove.length) {
    await manager.remove(toRemove);
  }
}

async function appendCoursewareVersion(
  manager: EntityManager,
  coursewareId: string,
  content: Record<string, unknown>,
  cap: number,
): Promise<void> {
  const revision = await nextRevision(manager, coursewareId);
  await manager.save(
    manager.create(CoursewareVersion, {
      coursewareId,
      revision,
      content,
    }),
  );
  await pruneOldVersions(manager, coursewareId, cap);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read a courseware entity by primary key or business key (chat preload, conversation binding, etc.).
 * The frontend may use the URL's courseware_id as the persistence key; when it doesn't match the `id` column, it falls back to looking up by `key`.
 */
export async function getCoursewareEntityById(idOrKey: string): Promise<Courseware | null> {
  const t = idOrKey.trim();
  if (!t) {
    return null;
  }
  await ensureDataSource();
  const repo = dataSource.getRepository(Courseware);
  if (UUID_RE.test(t)) {
    const byId = await repo.findOne({ where: { id: t } });
    if (byId) {
      return byId;
    }
  }
  return repo.findOne({ where: { key: t } });
}

/**
 * Read the current courseware JSON and version metadata by business key.
 */
export async function getCoursewareByKey(key: string): Promise<CoursewareCurrentDto | null> {
  const normalized = key.trim();
  if (!normalized) {
    return null;
  }

  const repo = dataSource.getRepository(Courseware);
  const cw = await repo.findOne({ where: { key: normalized } });
  if (!cw) {
    return null;
  }

  const vRepo = dataSource.getRepository(CoursewareVersion);
  const versions = await vRepo.find({
    where: { coursewareId: cw.id },
    order: { createdAt: "DESC" },
    take: maxSnapshots(),
    select: ["id", "revision", "createdAt"],
  });

  const last = versions[0] ?? null;

  return {
    key: cw.key,
    orgId: cw.orgId,
    title: cw.title,
    coverUrl: refreshCoursewareCoverUrlForResponse(cw.coverUrl),
    isPublic: Boolean(cw.isPublic),
    isShare: Boolean(cw.isShare),
    content: cw.content,
    updatedAt: cw.updatedAt.toISOString(),
    versions: versions.map((v) => ({
      id: v.id,
      revision: v.revision,
      createdAt: v.createdAt.toISOString(),
    })),
    versionPolicy: {
      maxSnapshots: maxSnapshots(),
      lastSnapshotAt: last ? last.createdAt.toISOString() : null,
    },
  };
}

/**
 * List historical versions; by default without the large content field, with includeContent the full snapshots are returned.
 */
export async function listCoursewareVersions(
  key: string,
  includeContent = false,
): Promise<
  | {
      key: string;
      versions: Array<
        CoursewareVersionSummary & { content?: Record<string, unknown> }
      >;
    }
  | null
> {
  const normalized = key.trim();
  if (!normalized) {
    return null;
  }

  const cw = await dataSource.getRepository(Courseware).findOne({ where: { key: normalized } });
  if (!cw) {
    return null;
  }

  const vRepo = dataSource.getRepository(CoursewareVersion);
  const base = {
    where: { coursewareId: cw.id },
    order: { createdAt: "DESC" as const },
    take: maxSnapshots(),
  };
  const versions = includeContent
    ? await vRepo.find(base)
    : await vRepo.find({ ...base, select: ["id", "revision", "createdAt"] });

  return {
    key: cw.key,
    versions: versions.map((v) => ({
      id: v.id,
      revision: v.revision,
      createdAt: v.createdAt.toISOString(),
      ...(includeContent ? { content: v.content } : {}),
    })),
  };
}

export type CoursewareSharingDto = {
  key: string;
  isPublic: boolean;
  isShare: boolean;
  updatedAt: string;
};

export type UpdateCoursewareSharingInput = {
  key: string;
  isPublic: boolean;
  isShare: boolean;
  actor: CoursewareActorContext;
};

type SaveCoursewareBase = {
  title?: string | null;
  coverUrl?: string | null;
  /** The caller's session token (for organization storage operations such as cover refunds); may be omitted (anonymous save). */
  accessToken?: string | null;
  content: Record<string, unknown>;
  actor?: CoursewareActorContext;
  /** When given, writes a courseware–course binding (repeatable, idempotent) */
  courseId?: string;
};

/**
 * The save intent must be declared explicitly by the caller and may not be inferred from "whether some field has a value" — the historical bug was exactly
 * that the handler decided create/update outside the transaction and saveCourseware decided again inside it, and the two could disagree:
 * authorization targeted row A while the write landed on row B (or created a row in any organization through body orgId).
 *
 * The field differences between the three modes are deliberate; don't relax them for the sake of "uniformity":
 * - update has no orgId: the courseware org is fixed at creation and can't be rewritten (see assertBindingOrgMatchesCourseware).
 * - update's baseUpdatedAt is required: so the blind-write form "update a row without a client base time" can't be constructed.
 * - upsert is only for the agent host flush: the disk scene is authoritative, with no client base time to compare.
 */
export type SaveCoursewareInput =
  | (SaveCoursewareBase & {
      mode: "update";
      /** Read/write target: the resolved row primary key */
      coursewareId: string;
      /** Lock word: the row's own key (not the raw ?key= of the request, which may be another row's id) */
      coursewareKey: string;
      /** The server `updated_at` the client last synced to; overwriting is refused when the DB has a newer update */
      baseUpdatedAt: string;
    })
  | (SaveCoursewareBase & {
      mode: "create";
      /** Business key to occupy (globally unique) */
      key: string;
      /** Written to `courseware.org_id`; the caller must have checked permission on that org, never falling back to the login current_org_id */
      orgId: string;
    })
  | (SaveCoursewareBase & {
      mode: "upsert";
      key: string;
      orgId?: string;
    });

/** Courseware not found (thrown when the update target was deleted concurrently); the message contains "not found" so the existing 404 mapping keeps working. */
export class CoursewareNotFoundError extends Error {
  readonly status = 404;

  constructor(idOrKey: string) {
    super(`courseware not found: ${idOrKey}`);
    this.name = "CoursewareNotFoundError";
  }
}

/** Business key already taken (concurrent row creation, or the key collides with another row's primary key). */
export class CoursewareKeyConflictError extends Error {
  readonly status = 409;
  readonly key: string;

  constructor(key: string, message?: string) {
    super(message ?? `courseware key already exists: ${key}`);
    this.name = "CoursewareKeyConflictError";
    this.key = key;
  }
}

/**
 * Advisory lock class number for courseware saves. The two-int4 form (class, objid) naturally lives in a different key space from
 * the single-bigint advisory locks elsewhere in the repo (such as quiz's pg_advisory_xact_lock(hashtext(...))),
 * so they never block each other.
 */
const COURSEWARE_SAVE_LOCK_CLASS = 4201;

/**
 * Advisory lock class number of the business key fold namespace (the same two-int4 form as 4201).
 * Physical cover object paths land by lower(key), while the key unique index is case-sensitive — creating a new row and
 * the save/upload side's "fold uniqueness criterion" must be mutually exclusive at the granularity of the folded (org, key), otherwise
 * sibling rows differing only in case could be created concurrently and the "exclusive" the criterion read would be void right after commit
 * (codex P1).
 */
export const COURSEWARE_KEY_FOLD_LOCK_CLASS = 4202;

/** Object string of the fold lock: (orgId, lower(key)). */
export const coursewareKeyFoldLockPayload = (
  orgId: string,
  key: string,
): string => `${orgId.trim().toLowerCase()}:${key.trim().toLowerCase()}`;

/** Return the constraint name on a unique constraint violation, otherwise null. */
function uniqueViolationConstraint(error: unknown): string | null {
  if (!(error instanceof QueryFailedError)) {
    return null;
  }
  const driver = error.driverError as { code?: string; constraint?: string } | undefined;
  if (driver?.code !== "23505") {
    return null;
  }
  return typeof driver.constraint === "string" ? driver.constraint : "";
}

/** PUT optimistic lock: the server version is newer than the client base time */
export class CoursewareVersionConflictError extends Error {
  readonly serverUpdatedAt: string;
  readonly baseUpdatedAt: string;

  constructor(serverUpdatedAt: string, baseUpdatedAt: string) {
    super("courseware version conflict: a newer version exists on the server");
    this.name = "CoursewareVersionConflictError";
    this.serverUpdatedAt = serverUpdatedAt;
    this.baseUpdatedAt = baseUpdatedAt;
  }
}

export function assertCoursewareVersionNotStale(
  cw: Pick<Courseware, "updatedAt">,
  baseUpdatedAt: string,
): void {
  const baseMs = Date.parse(baseUpdatedAt);
  if (Number.isNaN(baseMs)) {
    throw new Error("invalid baseUpdatedAt");
  }
  const serverMs = cw.updatedAt.getTime();
  if (serverMs > baseMs) {
    throw new CoursewareVersionConflictError(cw.updatedAt.toISOString(), baseUpdatedAt);
  }
}

function applyCoursewareActorFields(
  cw: Courseware,
  actor: CoursewareActorContext | undefined,
  isCreate: boolean,
): void {
  if (!actor) {
    return;
  }
  if (isCreate && !cw.createdBy) {
    cw.createdBy = actor.userId;
  }
  cw.updatedBy = actor.userId;
}

/**
 * Save a courseware: update the current content and append a version snapshot on every save (keeping the latest N).
 *
 * Concurrency model — a single advisory lock domain whose lock word is always the courseware's business key:
 * the key is the only identity present in all three modes (in create/upsert the row may not exist yet, so there is no id to lock),
 * and it is never reassigned after creation, so it is the row's lifelong stable lock word. update mode locks the key and reads/writes by id,
 * both pointing at the same row. **Don't split it into two lock domains "update locks id, create locks key"**: upsert also changes rows,
 * so the agent flush (key domain) and a browser PUT (id domain) changing the same row wouldn't block each other, lost updates would come back,
 * and both running appendCoursewareVersion would hit UQ_courseware_version_courseware_revision.
 *
 * Deadlocks: each transaction takes only one such lock, in a fixed order (advisory first, then row locks), so there is no cycle.
 * New branches must not take a second courseware advisory lock in the same transaction.
 */
export async function saveCourseware(input: SaveCoursewareInput): Promise<CoursewareCurrentDto> {
  // Lock word: update takes the resolved row's own key, create/upsert the key to occupy
  const lockKey = (input.mode === "update" ? input.coursewareKey : input.key).trim();
  if (!lockKey) {
    throw new Error("courseware key is required");
  }

  const content = normalizeSceneJsonForPersistence(input.content) as Record<string, unknown>;

  const cap = maxSnapshots();
  let savedCoursewareId: string | null = null;
  let coverRefundOwed: { key: string; size: number } | null = null;
  let savedKey: string | null = null;
  let savedOrgId: string | null = null;
  /** The cover pointer committed this time when the update payload carries coverUrl (bare key or null), for refund revalidation. */
  let committedCoverUrl: string | null | undefined;
  let wasCreate = false;

  try {
    // READ COMMITTED must be pinned explicitly: "lock first, then read" relies on each statement taking a fresh snapshot to see the
    // updated_at the previous lock holder committed; under REPEATABLE READ the snapshot is taken by the first statement (the lock itself),
    // so it would still read the old value from before the lock and the optimistic lock check would be silently bypassed.
    await dataSource.transaction("READ COMMITTED", async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [
        COURSEWARE_SAVE_LOCK_CLASS,
        lockKey,
      ]);

      let cw: Courseware | null;
      if (input.mode === "update") {
        // Read/write by primary key: the row resolved during auth and the row finally written are the same one by type
        cw = await manager.findOne(Courseware, { where: { id: input.coursewareId } });
        if (!cw) {
          throw new CoursewareNotFoundError(input.coursewareId);
        }
        assertCoursewareVersionNotStale(cw, input.baseUpdatedAt);
      } else {
        cw = await manager.findOne(Courseware, { where: { key: lockKey } });
        if (cw && input.mode === "create") {
          // "Key already taken when creating the row" is an explicit 409, instead of blindly writing someone else's row
          throw new CoursewareKeyConflictError(lockKey);
        }
      }

      if (!cw) {
        if (input.mode === "update") {
          // Unreachable: the update branch already threw CoursewareNotFoundError for !cw above.
          // This only narrows the union to the two variants with an orgId.
          throw new CoursewareNotFoundError(input.coursewareId);
        }
        wasCreate = true;
        const createOrgId = input.orgId?.trim();
        if (!createOrgId) {
          throw new Error("orgId is required when creating courseware");
        }
        // The fold lock (4202) is shared with the key alias criterion on the save/upload side: sibling rows differing only in case
        // are serialized here, so the criterion's "no conflict" conclusion stays valid against concurrent creation (codex P1).
        await manager.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [
          COURSEWARE_KEY_FOLD_LOCK_CLASS,
          coursewareKeyFoldLockPayload(createOrgId, lockKey),
        ]);
        // Forbid a new key colliding with another row's primary key: getCoursewareEntityById resolves by id first, so such a "shadow row"
        // would make auth and read/write point at two different rows (the root cause of this fix); this cuts off that namespace conflict at the entry.
        if (
          UUID_RE.test(lockKey) &&
          (await manager.findOne(Courseware, { where: { id: lockKey } }))
        ) {
          throw new CoursewareKeyConflictError(
            lockKey,
            `courseware key collides with an existing courseware id: ${lockKey}`,
          );
        }
        cw = manager.create(Courseware, {
          key: lockKey,
          orgId: createOrgId,
          title: input.title ?? null,
          // Persist the bare object key when the cover reference is ours
          // (client-echoed presigned URLs must never persist a signature);
          // non-storage URLs keep their normalized form. Ownership-checked —
          // see coverUrlForSave. No coursewareId yet: cover keys are rejected.
          coverUrl: input.coverUrl
            ? coverUrlForSave(input.coverUrl, createOrgId, undefined, undefined, false, false)
            : null,
          isPublic: false,
          isShare: false,
          content,
        });
        applyCoursewareActorFields(cw, input.actor, true);
        await manager.save(cw);
        await appendCoursewareVersion(manager, cw.id, content, cap);
      } else {
        cw.title = input.title !== undefined ? input.title : cw.title;
        // Cover pointer changed through the save API: a charged cover
        // (coverFileSize > 0) whose URL is being replaced/cleared owes a
        // refund. The refund runs AFTER the transaction (HTTP in a DB tx
        // would roll back badly on later failures); the size is cleared only
        // after the refund actually landed — a failed/absent-token refund
        // RETAINS the size as reconciliation state instead of discarding it.
        coverRefundOwed = null;
        // Same normalization as create: signatures never reach the column, and
        // change/refund detection compares stable forms — a client echoing back
        // a freshly presigned URL for the SAME object must not look like a
        // cover change (it would spuriously refund a charged cover).
        // Persistence form is the bare object key when extractable (the column
        // holds keys; signatures never reach it); non-storage URLs keep their
        // normalized form. Ownership-checked — see coverUrlForSave.
        // Fold race criteria of the two namespaces (physical path lower(identifier) vs the case-sensitive unique
        // index): key alias races (key-key / key-vs-id) and the mirror race of the id namespace taken by another row's key
        // (codex P0) — with either race the prefix isn't trusted. See
        // hasCaseCollidingCoursewareKey / coverKeyOwnedByCourseware. Queried only when the payload
        // carries coverUrl, and the criterion must be read inside the 4202 fold lock (mutually exclusive with the create path).
        let keyAliasOwned = false;
        let rowIdContested = false;
        if (input.coverUrl !== undefined && cw.key) {
          await manager.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [
            COURSEWARE_KEY_FOLD_LOCK_CLASS,
            coursewareKeyFoldLockPayload(cw.orgId ?? "", cw.key),
          ]);
          keyAliasOwned = !(await hasCaseCollidingCoursewareKey(
            manager,
            cw.orgId ?? "",
            cw.key,
            cw.id,
          ));
          rowIdContested = await hasCaseCollidingCoursewareKey(
            manager,
            cw.orgId ?? "",
            cw.id,
            cw.id,
          );
        }
        const normalizedCoverUrl =
          input.coverUrl !== undefined
            ? input.coverUrl
              ? coverUrlForSave(
                  input.coverUrl,
                  cw.orgId,
                  cw.id,
                  cw.key,
                  keyAliasOwned,
                  rowIdContested,
                )
              : null
            : undefined;
        if (normalizedCoverUrl !== undefined && normalizedCoverUrl !== cw.coverUrl) {
          const prevKey = cw.coverUrl
            ? coverObjectKeyFromUrlForSave(cw.coverUrl)
            : null;
          const owned =
            prevKey &&
            coverKeyOwnedByCourseware(
              prevKey,
              cw.orgId,
              cw.id,
              cw.key,
              keyAliasOwned,
              rowIdContested,
            )
              ? prevKey
              : null;
          if (owned && (cw.coverFileSize ?? 0) > 0) {
            coverRefundOwed = { key: owned, size: Number(cw.coverFileSize) };
          }
        }
        if (normalizedCoverUrl !== undefined) {
          cw.coverUrl = normalizedCoverUrl;
          // The cover pointer stored by this commit: the refund protocol revalidates state with it inside the cover lock
          // (a refund is allowed only while the pointer/size still match this commit; see the refund block after the transaction).
          committedCoverUrl = normalizedCoverUrl;
        }
        cw.content = content;
        applyCoursewareActorFields(cw, input.actor, false);
        await manager.save(cw);
        await appendCoursewareVersion(manager, cw.id, content, cap);
      }

      // The identifiers of the written row are assigned first (codex P1): the cover refund outside the transaction depends on them; assigning them after the refund
      // would make decrement receive a null org and no-op — leaking quota and leaving the old object dangling,
      // with the row no longer pointing at the old key, so later saves couldn't recover it.
      savedCoursewareId = cw.id;
      savedKey = cw.key;
      savedOrgId = cw.orgId;

      if (input.courseId?.trim()) {
        // The binding org comes only from the DB: the org is fixed at creation and never claim-backfilled from input (single-org invariant).
        // A courseware without an org (only possible for legacy rows) is refused explicitly instead of silently skipping the binding and returning 200.
        if (!cw.orgId) {
          throw new CoursewareOrgAccessError(
            `courseware ${cw.id} has no organization and cannot be bound; ` +
              `organization is assigned when the courseware is created`,
          );
        }
        await ensureCoursewareCourseBinding(
          {
            coursewareId: cw.id,
            courseId: input.courseId.trim(),
            orgId: cw.orgId,
            createdBy: input.actor?.userId ?? null,
          },
          manager,
        );
      }
    });
  } catch (error) {
    // Fallback: the pre-check inside the lock is the main mechanism; this only covers row creation races outside the lock (e.g. clone).
    // Must be translated **outside** the transaction — manager.save inside dataSource.transaction gets no SAVEPOINT
    // (TypeORM emits one only when transactionDepth > 0), so a 23505 would kill the whole transaction.
    if (input.mode !== "update" && uniqueViolationConstraint(error) === "UQ_courseware_key") {
      throw new CoursewareKeyConflictError(lockKey);
    }
    throw error;
  }

  // The refund for the replaced cover runs only after the transaction commits (outside tx). The protocol (codex P0 + 3×P1):
  // ① Short claim transaction (inside the cover lock): revalidate state (pointer/size must match this commit) →
  //    persistent claim (CoursewareAssetRefundClaim, org+md5 PK, OR IGNORE — a refund for the same
  //    content is issued only once globally, same as the assets flow) → conditionally consume the size marker.
  //    The claim + marker clear commit before decrement is sent — no later failure can ever refund the retained
  //    size twice (consumers such as courseware deletion are blocked by the claim).
  // ② decrement: pre-flight not satisfied (accounting disabled / no token) → treated as never sent:
  //    restore the marker and revoke the claim, keeping the original "retain the size for a retry" semantics; failure after sending
  //    (unknown whether it landed) → the marker isn't restored, CRITICAL leaves it for manual reconciliation, and the claim stays as the
  //    double-refund gate.
  // ③ Success → mark the claim complete → delete the old object.
  // Residual window (claim committed, process crashes before decrement) = that size leaks once, the inherent cost of
  // the "claim first, debit later" order (decrement has no server-side idempotency key).
  // Both are assigned inside the transaction callback; TypeScript does not track writes made
  // in closures, so re-read them with their declared types.
  const coverRefundPending = coverRefundOwed as { key: string; size: number } | null;
  const refundCoursewareId = savedCoursewareId as string | null;
  if (coverRefundPending && refundCoursewareId && committedCoverUrl !== undefined) {
    const refundMd5 = coverObjectMd5FromKey(coverRefundPending.key);
    let claimed = false;
    if (!refundMd5) {
      console.error(
        `[cover-refund] object key is not content-addressed — refusing refund, ` +
          `manual reconciliation needed orgId=${savedOrgId} coursewareId=${refundCoursewareId} ` +
          `objectKey=${coverRefundPending.key} size=${coverRefundPending.size}`,
      );
    } else {
      try {
        await dataSource.transaction(async (refundManager) => {
          await refundManager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
            `courseware-cover:${refundCoursewareId}`,
          ]);
          const row = await refundManager.findOne(Courseware, {
            where: { id: refundCoursewareId },
            select: { coverUrl: true, coverFileSize: true },
          });
          if (
            !row ||
            row.coverUrl !== committedCoverUrl ||
            Number(row.coverFileSize ?? 0) !== coverRefundPending.size
          ) {
            // The pointer/size were changed by a concurrent writer (e.g. a new upload already billed) — the marker belongs to the later one;
            // this protocol exits without refunding or deleting.
            return;
          }
          const { CoursewareAssetRefundClaim } = await import(
            "../models/courseware-asset-refund-claims.ts"
          );
          const claimResult = await refundManager
            .createQueryBuilder()
            .insert()
            .into(CoursewareAssetRefundClaim)
            .values({ orgId: savedOrgId!, contentMd5: refundMd5 })
            .orIgnore("(org_id, content_md5)")
            .execute();
          claimed = (claimResult.raw as unknown[]).length > 0;
          if (!claimed) {
            // The refund for the same (org, md5) was already claimed by an earlier attempt — wherever that attempt stopped,
            // a repeated debit is blocked by the claim; keeping the marker does no harm.
            console.info(
              `[cover-refund] refund already claimed for this content orgId=${savedOrgId} ` +
                `md5=${refundMd5} coursewareId=${refundCoursewareId}`,
            );
            return;
          }
          const clearQuery = refundManager
            .createQueryBuilder()
            .update(Courseware)
            .set({ coverFileSize: null })
            .where("id = :id AND cover_file_size = :size", {
              id: refundCoursewareId,
              size: coverRefundPending.size,
            });
          if (committedCoverUrl === null) {
            clearQuery.andWhere("cover_url IS NULL");
          } else {
            clearQuery.andWhere("cover_url = :coverUrl", {
              coverUrl: committedCoverUrl,
            });
          }
          const cleared = await clearQuery.execute();
          if ((cleared.affected ?? 0) === 0) {
            // Shouldn't happen inside the lock (state revalidation passed); if it does, some writer ignores the lock order —
            // revoke the claim for a retry and don't delete the object.
            claimed = false;
            await refundManager
              .createQueryBuilder()
              .delete()
              .from(CoursewareAssetRefundClaim)
              .where("org_id = :orgId AND content_md5 = :md5", {
                orgId: savedOrgId,
                md5: refundMd5,
              })
              .execute();
            console.error(
              `[cover-refund] conditional size clear matched 0 rows after claim — ` +
                `claim reverted, manual reconciliation needed orgId=${savedOrgId} ` +
                `coursewareId=${refundCoursewareId} objectKey=${coverRefundPending.key} ` +
                `size=${coverRefundPending.size}`,
            );
          }
        });
      } catch (claimError) {
        // The claim transaction failed: no claim was stored (or it was undone by the rollback), the size marker stays,
        // and no decrement is sent — safe to retry.
        claimed = false;
        console.error(
          `[cover-refund] claim transaction failed — refund not issued (retryable) ` +
            `orgId=${savedOrgId} coursewareId=${refundCoursewareId} ` +
            `objectKey=${coverRefundPending.key} size=${coverRefundPending.size} ` +
            `error=${claimError instanceof Error ? claimError.message : String(claimError)}`,
        );
      }
    }
    if (claimed && refundMd5) {
      const storageEnabled = isOrgStorageIntegrationEnabled(savedOrgId);
      const tokenUsable = !!input.accessToken?.trim();
      if (!storageEnabled || !tokenUsable) {
        // decrement definitely won't be sent: restore the marker + revoke the claim, back to the original "retain the size for a
        // retry" semantics (the normal path in local/test environments with accounting disabled).
        await restoreCoverRefundMarker(
          refundCoursewareId,
          committedCoverUrl,
          coverRefundPending.size,
        );
        await deleteCoverRefundClaim(savedOrgId, refundMd5);
      } else {
        const refunded = await decrementCoursewareObjectStorage(
          input.accessToken,
          savedOrgId,
          coverRefundPending.size,
          `courseware-cover-save-replaced:${refundCoursewareId}`,
        );
        if (refunded) {
          await markAssetRefundClaimComplete(savedOrgId!, refundMd5);
          await deleteOssObject(coverRefundPending.key).catch(() => {});
        } else {
          // Sent but failed (unknown whether it landed): don't restore the marker (prevents double refunds), don't delete the object;
          // the claim stays as the gate for later debits, and CRITICAL leaves it for manual reconciliation.
          console.error(
            `[cover-refund] decrement issued but not confirmed — claim retained as ` +
              `double-refund gate, manual reconciliation needed orgId=${savedOrgId} ` +
              `coursewareId=${refundCoursewareId} objectKey=${coverRefundPending.key} ` +
              `size=${coverRefundPending.size}`,
          );
        }
      }
    }
  }

  if (input.actor && savedCoursewareId) {
    await recordCoursewareAuditLog({
      action: wasCreate ? "courseware.create" : "courseware.save",
      actor: input.actor,
      orgId: savedOrgId ?? input.actor.orgId,
      coursewareId: savedCoursewareId,
      detail: {
        key: savedKey ?? lockKey,
        ...(input.courseId?.trim() ? { courseId: input.courseId.trim() } : {}),
      },
    });
  }

  // Reread by the written row's own key: the update target may have been resolved by id,
  // in which case its key differs from the request's ?key=, and using the latter would falsely report "record missing after save"
  const dto = await getCoursewareByKey(savedKey ?? lockKey);
  if (!dto) {
    throw new Error("saveCourseware failed: record missing after save");
  }
  return dto;
}

/**
 * Update only the courseware's share visibility (no content write, no version snapshot appended).
 */
export async function updateCoursewareSharing(
  input: UpdateCoursewareSharingInput,
): Promise<CoursewareSharingDto> {
  const normalizedKey = input.key.trim();
  if (!normalizedKey) {
    throw new Error("courseware key is required");
  }

  let savedId: string | null = null;
  let savedOrgId: string | null = null;
  let updatedAt: Date | null = null;

  await dataSource.transaction(async (manager) => {
    const cw = await manager.findOne(Courseware, { where: { key: normalizedKey } });
    if (!cw) {
      throw new Error("courseware not found");
    }

    cw.isPublic = input.isPublic;
    cw.isShare = input.isShare;
    applyCoursewareActorFields(cw, input.actor, false);
    const saved = await manager.save(cw);
    savedId = saved.id;
    savedOrgId = saved.orgId;
    updatedAt = saved.updatedAt;
  });

  if (savedId && updatedAt) {
    await recordCoursewareAuditLog({
      action: "courseware.sharing",
      actor: input.actor,
      orgId: savedOrgId ?? input.actor.orgId,
      coursewareId: savedId,
      detail: {
        key: normalizedKey,
        isPublic: input.isPublic,
        isShare: input.isShare,
      },
    });
  }

  return {
    key: normalizedKey,
    isPublic: input.isPublic,
    isShare: input.isShare,
    updatedAt: updatedAt!.toISOString(),
  };
}

export type RollbackCoursewareInput = {
  key: string;
  /** Use the version primary key first */
  versionId?: string;
  /** or use the revision number */
  revision?: number;
  actor?: CoursewareActorContext;
};

/**
 * Restore the current courseware content to the given historical snapshot (no new version row is added automatically; the next save creates a snapshot).
 */
export async function rollbackCourseware(input: RollbackCoursewareInput): Promise<CoursewareCurrentDto> {
  const normalizedKey = input.key.trim();
  if (!normalizedKey) {
    throw new Error("courseware key is required");
  }
  if (!input.versionId && input.revision == null) {
    throw new Error("versionId or revision is required");
  }

  let rolledBackId: string | null = null;
  let rolledBackOrgId: string | null = null;

  await dataSource.transaction(async (manager) => {
    const cw = await manager.findOne(Courseware, { where: { key: normalizedKey } });
    if (!cw) {
      throw new Error("courseware not found");
    }

    let version: CoursewareVersion | null = null;
    if (input.versionId) {
      version = await manager.findOne(CoursewareVersion, {
        where: { id: input.versionId, coursewareId: cw.id },
      });
    } else if (input.revision != null) {
      version = await manager.findOne(CoursewareVersion, {
        where: { coursewareId: cw.id, revision: input.revision },
      });
    }

    if (!version) {
      throw new Error("version not found");
    }

    cw.content = version.content;
    applyCoursewareActorFields(cw, input.actor, false);
    await manager.save(cw);
    rolledBackId = cw.id;
    rolledBackOrgId = cw.orgId;
  });

  if (input.actor && rolledBackId) {
    await recordCoursewareAuditLog({
      action: "courseware.rollback",
      actor: input.actor,
      orgId: rolledBackOrgId ?? input.actor.orgId,
      coursewareId: rolledBackId,
      detail: {
        key: normalizedKey,
        versionId: input.versionId ?? null,
        revision: input.revision ?? null,
      },
    });
  }

  const dto = await getCoursewareByKey(normalizedKey);
  if (!dto) {
    throw new Error("rollbackCourseware failed");
  }
  return dto;
}

export type DeleteCoursewareResult = {
  coursewareId: string;
  key: string;
  deletedAssets: number;
  deletedConversations: number;
  deletedTranscriptLines: number;
};

/**
 * Delete a courseware: asset rows, agent conversations and transcripts, versions and course bindings are deleted along with courseware by cascade.
 * After assets are deleted, storage quota is returned to the organization (the same rule as deleting a single asset: skipped while the organization still references it elsewhere).
 */
export async function deleteCourseware(
  idOrKey: string,
  actor?: CoursewareActorContext,
  accessToken?: string | null,
): Promise<DeleteCoursewareResult> {
  const cw = await getCoursewareEntityById(idOrKey);
  if (!cw) {
    throw new Error("courseware not found");
  }

  const agentClear = await clearAllAgentHistoryForCourseware(cw.id, actor);

  let deletedAssets = 0;
  // Rows are collected INSIDE the deletion transaction via DELETE ...
  // RETURNING: an upload committing between a pre-transaction snapshot and
  // the broad DELETE would otherwise lose its confirmed charge forever.
  // The courseware advisory lock also serializes against asset finalize —
  // an upload that passed its access check just before deletion cannot
  // insert its charged row after the DELETE ran.
  type DeletedAssetRow = {
    file_id: string;
    org_id: string | null;
    content_md5: string;
    file_size: number;
  };
  type DeletedRecordingRow = {
    recording_id: string;
    org_id: string;
    file_size: number;
    storage_accounted: boolean;
    file_path: string;
  };
  let assetsToDelete: DeletedAssetRow[] = [];
  let recordingsToDelete: DeletedRecordingRow[] = [];
  let assetRefundsOwed: Array<{
    orgId: string;
    contentMd5: string;
    sizeBytes: number;
  }> = [];
  await dataSource.transaction(async (manager) => {
    await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `courseware-row:${cw.id}`,
    ]);
    // Revalidate under the lock: a concurrent delete of the same courseware
    // may have committed while this request waited — proceeding with the
    // stale cw would double-refund its cover (the second DELETE set is
    // empty but the cover path uses the stale size).
    const stillThere = await manager
      .createQueryBuilder()
      .select("1")
      .from(Courseware, "c")
      .where("c.id = :id", { id: cw.id })
      .limit(1)
      .getRawMany();
    if (stillThere.length === 0) {
      deletedAssets = 0;
      return;
    }
    await manager.save(
      manager.create(CoursewareDeleted, {
        id: cw.id,
        orgId: cw.orgId,
        key: cw.key,
        title: cw.title,
        coverUrl: cw.coverUrl,
        content: cw.content,
        createdBy: cw.createdBy,
        updatedBy: cw.updatedBy,
        createdAt: cw.createdAt,
        updatedAt: cw.updatedAt,
        deletedBy: actor?.userId ?? null,
      }),
    );

    const assetDelete = await manager
      .createQueryBuilder()
      .delete()
      .from(CoursewareAsset)
      .where("courseware_id = :coursewareId", { coursewareId: cw.id })
      .returning(["file_id", "org_id", "content_md5", "file_size"])
      .execute();
    // Deleting a courseware unbinds it: clean up the course/section binding rows (same transaction), otherwise the course side
    // references a dead courseware and the list binding counts show ghost rows. Record the affected sections before the delete,
    // and recompute the backend has_courseware_bound flag after it (atomic in the same transaction).
    const boundSections = (await manager.query(
      `SELECT DISTINCT section_id::text AS section_id
         FROM courseware_section_binding WHERE courseware_id = $1::uuid`,
      [cw.id],
    )) as Array<{ section_id: string }>;
    await manager
      .createQueryBuilder()
      .delete()
      .from(CoursewareSectionBinding)
      .where("courseware_id = :coursewareId", { coursewareId: cw.id })
      .execute();
    if (boundSections.length > 0) {
      await manager.query(
        `UPDATE course_section cs
           SET has_courseware_bound = EXISTS (
                 SELECT 1 FROM courseware_section_binding b
                 WHERE b.section_id = cs.section_id
               ),
               updated_at = NOW()
         WHERE cs.section_id = ANY($1::uuid[])`,
        [boundSections.map((r) => r.section_id)],
      );
    }
    await manager
      .createQueryBuilder()
      .delete()
      .from(CoursewareCourseBinding)
      .where("courseware_id = :coursewareId", { coursewareId: cw.id })
      .execute();
    assetsToDelete = assetDelete.raw as DeletedAssetRow[];
    deletedAssets = assetsToDelete.length;

    // Decide last-reference refunds INSIDE this transaction: per (org, md5)
    // advisory lock + remaining-count + durable claim. A same-content upload
    // serializes behind these locks — if it lands after the commit it charges
    // its own bytes while the owed refund below still returns the old ones
    // (no double charge, no skipped refund).
    assetRefundsOwed = [];
    // Acquire the (org, md5) advisory locks in a GLOBAL order (sorted keys):
    // two coursewares sharing several assets could otherwise deadlock when
    // their DELETE ... RETURNING rows arrive in opposite orders.
    const uniqueContentKeys = new Map<string, { orgId: string; md5: string }>();
    for (const row of assetsToDelete) {
      const orgId = cw.orgId ?? row.org_id;
      if (!orgId) continue;
      const key = `${orgId}:${row.content_md5}`;
      if (!uniqueContentKeys.has(key)) {
        uniqueContentKeys.set(key, { orgId, md5: row.content_md5 });
      }
    }
    const sortedContentKeys = [...uniqueContentKeys.keys()].sort();
    for (const key of sortedContentKeys) {
      const { orgId, md5 } = uniqueContentKeys.get(key)!;
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `courseware-asset:${orgId}:${md5}`,
      ]);
      const remaining = await manager
        .createQueryBuilder()
        .select("1")
        .from(CoursewareAsset, "a")
        .where("a.org_id = :orgId AND a.content_md5 = :md5", {
          orgId,
          md5,
        })
        .limit(1)
        .getRawMany();
      if (remaining.length > 0) continue;
      const { CoursewareAssetRefundClaim } = await import(
        "../models/courseware-asset-refund-claims.ts"
      );
      const claimResult = await manager
        .createQueryBuilder()
        .insert()
        .into(CoursewareAssetRefundClaim)
        .values({ orgId, contentMd5: md5 })
        .orIgnore("(org_id, content_md5)")
        .returning("org_id")
        .execute();
      let owed = (claimResult.raw as unknown[]).length > 0;
      if (!owed) {
        // Existing claim: owed only when its refund never completed.
        const existing = await manager.findOne(CoursewareAssetRefundClaim, {
          where: { orgId, contentMd5: md5 },
        });
        owed = existing ? !existing.refunded : false;
      }
      if (owed) {
        // Size from any of this content's deleted rows (all rows of one
        // (org, md5) carry the same bytes).
        const sizeRow = assetsToDelete.find(
          (r) => (cw.orgId ?? r.org_id) === orgId && r.content_md5 === md5,
        );
        assetRefundsOwed.push({
          orgId,
          contentMd5: md5,
          sizeBytes: Number(sizeRow?.file_size ?? 0),
        });
      }
    }
    const recordingDelete = await manager
      .createQueryBuilder()
      .delete()
      .from(CoursewareQuizAnswerRecording)
      .where("courseware_id = :coursewareId", { coursewareId: cw.id })
      .returning(["recording_id", "org_id", "file_size", "storage_accounted", "file_path"])
      .execute();
    recordingsToDelete = recordingDelete.raw as DeletedRecordingRow[];
    await manager.delete(Courseware, { id: cw.id });
  });

  // Post-commit: return storage quota per asset (skip when the org still has
  // another reference to the same content). Best-effort per row — a failure
  // logs and continues so one flaky storage call can't resurrect the courseware.
  // Asset refunds were DECIDED inside the deletion transaction (see
  // assetRefundsOwed): a same-content upload landing between the commit and
  // this loop charges its own bytes and must not suppress the old refund.
  for (const owed of assetRefundsOwed) {
    const refunded = await decrementCoursewareObjectStorage(
      accessToken,
      owed.orgId,
      owed.sizeBytes,
      `courseware-asset:${owed.contentMd5}`,
    );
    if (refunded) {
      await markAssetRefundClaimComplete(owed.orgId, owed.contentMd5);
    }
  }
  // Quiz-answer recordings are per-recording unique objects — hand the bytes
  // straight back. Only rows whose charge was lock+confirmed (storageAccounted)
  // are refunded; rows created before the accounting rollout were never added
  // and must not subtract anything.
  for (const recording of recordingsToDelete) {
    // Recording keys are unique per recordingId and the row is gone: delete
    // the object so upload-delete cycles cannot accumulate orphaned audio.
    await deleteOssObject(recording.file_path).catch(() => {});
    if (!recording.storage_accounted) {
      continue;
    }
    await decrementCoursewareObjectStorage(
      accessToken,
      recording.org_id ?? cw.orgId,
      Number(recording.file_size ?? 0),
      `quiz-recording:${recording.recording_id}`,
    );
  }
  // TTS narration charged to this courseware: refund the per-org refs and
  // delete the objects — but only refs no OTHER courseware still owns (the
  // same content-addressed object can serve several coursewares).
  try {
    const ttsRefs = await dataSource
      .getRepository(CoursewareTtsStorageRef)
      .find({ where: { coursewareId: cw.id } });
    for (const ref of ttsRefs) {
      const otherOwners = await dataSource
        .getRepository(CoursewareTtsStorageRef)
        .count({
          where: { objectKey: ref.objectKey },
        });
      const refunded = await decrementCoursewareObjectStorage(
        accessToken,
        ref.orgId,
        Number(ref.sizeBytes ?? 0),
        `tts:${ref.objectKey}`,
      );
      if (refunded) {
        // Remove the ref ONLY after its refund landed — the row is the sole
        // record of the still-charged bytes; dropping it on a transient
        // failure makes the quota permanently undiscoverable.
        await dataSource
          .getRepository(CoursewareTtsStorageRef)
          .remove(ref)
          .catch(() => {});
      }
      if (otherOwners <= 1) {
        await deleteOssObject(ref.objectKey).catch(() => {});
      }
    }
  } catch (ttsError) {
    console.warn(
      `[org-storage] tts refund pass failed coursewareId=${cw.id}: ` +
        `${ttsError instanceof Error ? ttsError.message : String(ttsError)}`,
    );
  }

  // The courseware cover counted toward the org quota when it was uploaded
  // (cover_file_size); legacy rows without a recorded size are skipped.
  if (cw.coverFileSize && cw.coverFileSize > 0) {
    await decrementCoursewareObjectStorage(
      accessToken,
      cw.orgId,
      Number(cw.coverFileSize),
      `courseware-cover:${cw.id}`,
    );
  }

  if (actor) {
    await recordCoursewareAuditLog({
      action: "courseware.delete",
      actor,
      orgId: cw.orgId ?? actor.orgId,
      coursewareId: cw.id,
      detail: {
        key: cw.key,
        archived: true,
        deletedAssets,
        deletedConversations: agentClear.deletedConversations,
        deletedTranscriptLines: agentClear.deletedTranscriptLines,
      },
    });
  }

  return {
    coursewareId: cw.id,
    key: cw.key,
    deletedAssets,
    deletedConversations: agentClear.deletedConversations,
    deletedTranscriptLines: agentClear.deletedTranscriptLines,
  };
}
