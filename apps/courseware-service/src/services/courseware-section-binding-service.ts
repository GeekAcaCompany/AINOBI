// SPDX-License-Identifier: AGPL-3.0-only
import type { EntityManager } from "typeorm";

import {
  assertBindingOrgMatchesCourseware,
  CoursewareOrgAccessError,
  normalizeOrgId,
} from "../auth/ainobi-org-access.ts";
import { dataSource } from "../db/db.ts";
import { Courseware } from "../models/courseware.ts";
import { CoursewareSectionBinding } from "../models/courseware-section-binding.ts";
import {
  coursewareListItemBase,
  type CoursewareListItemDto,
} from "./courseware-service.ts";

export type EnsureCoursewareSectionBindingInput = {
  coursewareId: string;
  sectionId: string;
  courseId: string;
  orgId: string;
  chapterId?: string | null;
  isCurrent?: boolean;
  createdBy?: string | null;
};

/**
 * Single-org invariant guard (runs inside the transaction): the binding org must equal the courseware's own org; a courseware without an
 * org refuses binding (the org is set only at creation, never inferred from bindings or claim-backfilled). The courseware must be loaded with
 * the caller's transaction manager — the clone flow's target courseware was just created in the same transaction and
 * isn't committed yet, so the global manager can't read it.
 */
export async function assertBindingOrgInvariant(
  tx: EntityManager,
  coursewareId: string,
  orgId: string,
): Promise<void> {
  const courseware = await tx.getRepository(Courseware).findOne({
    where: { id: coursewareId },
    select: ["id", "orgId"],
  });
  if (!courseware) {
    throw new Error(`courseware not found: ${coursewareId}`);
  }
  assertBindingOrgMatchesCourseware(courseware, orgId);
}

export type CoursewareSectionBindingItemDto = {
  bindingId: string;
  coursewareId: string;
  sectionId: string;
  courseId: string;
  orgId: string;
  chapterId: string | null;
  isCurrent: boolean;
  createdAt: string;
  courseware: CoursewareListItemDto;
};

export type ListCoursewareForSectionInput = {
  sectionId: string;
  orgId: string;
  courseId?: string;
  pageNumber?: number;
  pageSize?: number;
  order?: "asc" | "desc";
};

export type ListCoursewareForSectionResult = {
  sectionId: string;
  orgId: string;
  courseId: string | null;
  data: CoursewareSectionBindingItemDto[];
  pagination: {
    pageNumber: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
};

function coursewareToListItem(cw: Courseware): CoursewareListItemDto {
  // Reuses the common field mapping of the org list (coursewareListItemBase in courseware-service,
  // converged in R4#3); every row of this list is itself a binding → isBound is always true;
  // sceneCount comes from the loaded content (null without content).
  const scenes = (cw.content as { scenes?: unknown[] } | null | undefined)?.scenes;
  return {
    ...coursewareListItemBase(cw),
    isBound: true,
    sceneCount: Array.isArray(scenes) ? scenes.length : null,
  };
}

function bindingToItem(binding: CoursewareSectionBinding, courseware: Courseware): CoursewareSectionBindingItemDto {
  return {
    bindingId: binding.id,
    coursewareId: binding.coursewareId,
    sectionId: binding.sectionId,
    courseId: binding.courseId,
    orgId: binding.orgId,
    chapterId: binding.chapterId,
    isCurrent: Boolean(binding.isCurrent),
    createdAt: binding.createdAt.toISOString(),
    courseware: coursewareToListItem(courseware),
  };
}

/** Idempotently write a courseware–section binding (skipped when it exists; optionally set as currently taught). */
/**
 * Sync the backend course_section.has_courseware_bound flag.
 *
 * The two services share a database (the same education Postgres): the authoritative binding record is this service's
 * courseware_section_binding table, while course detail / the learning side read the boolean flag on the backend's
 * course_section. After bind/unbind the column is updated directly in the same database,
 * skipping an HTTP round trip (the sync method from the early separate-database era is no longer needed).
 */
export async function syncSectionCoursewareBoundFlag(
  sectionId: string,
  manager: EntityManager = dataSource.manager,
): Promise<void> {
  const trimmed = sectionId.trim();
  if (!trimmed) return;
  // Computing and updating must happen atomically in one statement (EXISTS takes the committed snapshot at execution time),
  // so concurrent bind/unbind can't overwrite each other's flag with stale counts.
  await manager.query(
    `UPDATE course_section
     SET has_courseware_bound = EXISTS (
           SELECT 1 FROM courseware_section_binding
           WHERE section_id = $1::uuid
         ),
         updated_at = NOW()
     WHERE section_id = $1::uuid`,
    [trimmed],
  );
}

export async function ensureCoursewareSectionBinding(
  input: EnsureCoursewareSectionBindingInput,
  manager: EntityManager = dataSource.manager,
): Promise<CoursewareSectionBinding> {
  const coursewareId = input.coursewareId.trim();
  const sectionId = input.sectionId.trim();
  const courseId = input.courseId.trim();
  const orgId = input.orgId.trim();
  if (!coursewareId || !sectionId || !courseId || !orgId) {
    throw new Error("coursewareId, sectionId, courseId and orgId are required for section binding");
  }

  const chapterId = input.chapterId?.trim() || null;

  const binding = await manager.transaction(async (tx) => {
    await assertBindingOrgInvariant(tx, coursewareId, orgId);

    // P0: check section ownership — the backend course_section row must exist with org/course
    // matching the input, otherwise knowing a foreign section_id would be enough to bind across organizations and rewrite its flag.
    // The course clone flow has the backend commit the structure rows first and then call this service (Steps 15/16 of the backend course clone),
    // so the rows here are always visible and no exemption is needed.
    const sectionRows = (await tx.query(
      `SELECT org_id::text AS org_id, course_id::text AS course_id
         FROM course_section WHERE section_id = $1::uuid`,
      [sectionId],
    )) as Array<{ org_id: string; course_id: string }>;
    if (!sectionRows.length) {
      throw new CoursewareOrgAccessError(
        `course section ${sectionId} not found in course_section`,
      );
    }
    const sectionOrg = normalizeOrgId(sectionRows[0].org_id);
    if (sectionOrg !== normalizeOrgId(orgId)) {
      throw new CoursewareOrgAccessError(
        `course section ${sectionId} belongs to org ${sectionOrg}; ` +
          `refusing to bind it under org ${orgId}`,
      );
    }
    // uuid::text always outputs lowercase: uppercase UUID input is normalized to lowercase before comparing
    if (sectionRows[0].course_id !== courseId.toLowerCase()) {
      throw new CoursewareOrgAccessError(
        `course section ${sectionId} belongs to course ${sectionRows[0].course_id}; ` +
          `refusing to bind it under course ${courseId}`,
      );
    }

    const bindingRepo = tx.getRepository(CoursewareSectionBinding);
    // The unique constraint is (courseware_id, section_id), without org: fetch the row by that key first and refuse explicitly when the org
    // differs, so another organization's binding row is never implicitly rewritten and no obscure unique constraint conflict is hit.
    let binding = await bindingRepo.findOne({ where: { coursewareId, sectionId } });
    if (binding && normalizeOrgId(binding.orgId) !== normalizeOrgId(orgId)) {
      throw new CoursewareOrgAccessError(
        `existing section binding for courseware ${coursewareId} belongs to org ${binding.orgId}; ` +
          `refusing to rebind it under org ${orgId}`,
      );
    }

    if (!binding) {
      binding = await bindingRepo.save(
        bindingRepo.create({
          coursewareId,
          sectionId,
          courseId,
          orgId,
          chapterId,
          isCurrent: false,
          createdBy: input.createdBy?.trim() || null,
        }),
      );
    } else if (chapterId && binding.chapterId !== chapterId) {
      binding.chapterId = chapterId;
      binding = await bindingRepo.save(binding);
    }

    if (input.isCurrent) {
      await setCurrentCoursewareForSection(
        { coursewareId, sectionId, orgId },
        tx,
        false,
      );
      binding = (await bindingRepo.findOne({ where: { coursewareId, sectionId } })) ?? binding;
    }

    // The flag and the binding share a transaction: success/failure is atomic, so callers never get a false success
    await syncSectionCoursewareBoundFlag(sectionId, tx);

    return binding;
  });

  return binding;
}

/** Set a courseware as the currently taught one of a section (is_current of the section's other bindings is cleared). */
export async function setCurrentCoursewareForSection(
  input: { coursewareId: string; sectionId: string; orgId: string },
  manager: EntityManager = dataSource.manager,
  syncFlag = true,
): Promise<CoursewareSectionBinding> {
  const coursewareId = input.coursewareId.trim();
  const sectionId = input.sectionId.trim();
  const orgId = input.orgId.trim();
  if (!coursewareId || !sectionId || !orgId) {
    throw new Error("coursewareId, sectionId and orgId are required");
  }

  const saved = await manager.transaction(async (tx) => {
    await assertBindingOrgInvariant(tx, coursewareId, orgId);

    const repo = tx.getRepository(CoursewareSectionBinding);
    const binding = await repo.findOne({ where: { coursewareId, sectionId, orgId } });
    if (!binding) {
      throw new Error("section binding not found");
    }

    // The clear must have the same scope as the unique index UQ_courseware_section_binding_current (section_id
    // alone, partial where is_current = true): only one current courseware per section globally.
    // An orgId filter would miss other organizations' current rows, and the later save would hit the unique constraint and 500.
    // Under the single-org invariant the binding rows of a section always share the org, so the two are equivalent anyway — don't add an org filter.
    await repo.update({ sectionId, isCurrent: true }, { isCurrent: false });
    binding.isCurrent = true;
    return await repo.save(binding);
  });
  if (syncFlag) {
    try {
      // After the transaction commits, sync the backend flag (the ensure transaction passes syncFlag=false)
      await syncSectionCoursewareBoundFlag(sectionId);
    } catch (error) {
      console.warn("sync has_courseware_bound failed for section", sectionId, ":", error);
    }
  }
  return saved;
}

/** Unbind a courseware from a section. */
export async function unbindCoursewareFromSection(
  coursewareId: string,
  sectionId: string,
  orgId: string,
): Promise<boolean> {
  const cwId = coursewareId.trim();
  const secId = sectionId.trim();
  const oId = orgId.trim();
  if (!cwId || !secId || !oId) {
    return false;
  }

  const result = await dataSource.getRepository(CoursewareSectionBinding).delete({
    coursewareId: cwId,
    sectionId: secId,
    orgId: oId,
  });
  const unbound = (result.affected ?? 0) > 0;
  if (unbound) {
    try {
      // After unbinding, recompute the backend flag from the section's remaining bindings (other coursewares may still be bound)
      await syncSectionCoursewareBoundFlag(secId);
    } catch (error) {
      console.warn("sync has_courseware_bound failed for section", secId, ":", error);
    }
  }
  return unbound;
}

/** Check whether the courseware is bound to the given section (and optionally course/org). */
export async function findCoursewareSectionBinding(params: {
  coursewareId: string;
  sectionId: string;
  courseId: string;
  orgId: string;
}): Promise<CoursewareSectionBinding | null> {
  const coursewareId = params.coursewareId.trim();
  const sectionId = params.sectionId.trim();
  const courseId = params.courseId.trim();
  const orgId = params.orgId.trim();
  if (!coursewareId || !sectionId || !courseId || !orgId) {
    return null;
  }
  return dataSource.getRepository(CoursewareSectionBinding).findOne({
    where: { coursewareId, sectionId, courseId, orgId },
  });
}

/** Whether the courseware is bound to some section under the given organization. */
export async function isCoursewareBoundInOrg(
  coursewareId: string,
  orgId: string,
): Promise<boolean> {
  const cwId = coursewareId.trim();
  const oId = orgId.trim();
  if (!cwId || !oId) {
    return false;
  }

  const count = await dataSource.getRepository(CoursewareSectionBinding).count({
    where: { coursewareId: cwId, orgId: oId },
  });
  return count > 0;
}

/**
 * Resolve editor/URL courseware id-or-key to the courseware primary key.
 * Returns null when neither id nor key matches (do not treat raw as uuid FK).
 */
export async function resolveCoursewarePrimaryId(
  coursewareIdOrKey: string,
): Promise<string | null> {
  const raw = coursewareIdOrKey.trim();
  if (!raw) {
    return null;
  }

  const cwRepo = dataSource.getRepository(Courseware);
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (UUID_RE.test(raw)) {
    const byId = await cwRepo.findOne({ where: { id: raw }, select: ["id"] });
    if (byId?.id) {
      return byId.id;
    }
  }

  const byKey = await cwRepo.findOne({ where: { key: raw }, select: ["id"] });
  return byKey?.id ?? null;
}

/**
 * Reverse lookup of lesson bindings by coursewareId (or business key).
 * - preferredSectionId: used first if the courseware really has a binding to this section (the editor URL wins)
 * - otherwise is_current first, then createdAt DESC
 */
export async function findLatestSectionBindingForCourseware(
  coursewareIdOrKey: string,
  preferredSectionId?: string | null,
): Promise<CoursewareSectionBinding | null> {
  const cwId = await resolveCoursewarePrimaryId(coursewareIdOrKey);
  if (!cwId) {
    return null;
  }

  const repo = dataSource.getRepository(CoursewareSectionBinding);
  const preferred = preferredSectionId?.trim();
  if (preferred) {
    const matched = await repo.findOne({
      where: { coursewareId: cwId, sectionId: preferred },
    });
    if (matched) {
      return matched;
    }
  }

  const current = await repo.findOne({
    where: { coursewareId: cwId, isCurrent: true },
    order: { createdAt: "DESC" },
  });
  if (current) {
    return current;
  }

  return repo.findOne({
    where: { coursewareId: cwId },
    order: { createdAt: "DESC" },
  });
}

/**
 * Fetch the exact binding row of (courseware, section) (unique key UQ_courseware_section_binding_pair).
 * Used by step ④ of the courseware read gate to check "the sectionId the student declared really is bound to this courseware".
 */
export async function findSectionBindingForCoursewareSection(
  coursewareId: string,
  sectionId: string,
): Promise<CoursewareSectionBinding | null> {
  const cwId = coursewareId.trim();
  const secId = sectionId.trim();
  if (!cwId || !secId) {
    return null;
  }
  return dataSource.getRepository(CoursewareSectionBinding).findOne({
    where: { coursewareId: cwId, sectionId: secId },
  });
}

/**
 * List every section binding of a courseware (across courses, single query). The bind dialog fetches them all
 * at once on open to echo the checkboxes; coursewareId accepts the primary key id or the business key (same as /courseware
 * ?key=). Organization isolation: only that org's binding rows are returned.
 */
export async function listSectionBindingsForCourseware(input: {
  coursewareId: string;
  orgId: string;
}): Promise<{
  coursewareId: string;
  orgId: string;
  data: {
    bindingId: string;
    courseId: string;
    sectionId: string;
    chapterId: string | null;
    isCurrent: boolean;
    createdAt: string;
  }[];
}> {
  const orgId = input.orgId.trim();
  const resolved = await resolveCoursewarePrimaryId(input.coursewareId);
  if (!orgId || !resolved) {
    return { coursewareId: input.coursewareId.trim(), orgId, data: [] };
  }
  const repo = dataSource.getRepository(CoursewareSectionBinding);
  const rows = await repo.find({
    where: { coursewareId: resolved, orgId },
    order: { createdAt: "DESC" },
  });
  return {
    coursewareId: resolved,
    orgId,
    data: rows.map((b) => ({
      bindingId: b.id,
      courseId: b.courseId,
      sectionId: b.sectionId,
      chapterId: b.chapterId,
      isCurrent: Boolean(b.isCurrent),
      createdAt: b.createdAt.toISOString(),
    })),
  };
}

/** List the coursewares bound to a section (with binding metadata and courseware summaries). */
export async function listCoursewareForSection(
  input: ListCoursewareForSectionInput,
): Promise<ListCoursewareForSectionResult> {
  const sectionId = input.sectionId.trim();
  const orgId = input.orgId.trim();
  const courseId = input.courseId?.trim() || null;
  if (!sectionId || !orgId) {
    throw new Error('Both "sectionId" and "orgId" are required.');
  }

  const pageNumber = input.pageNumber ?? 1;
  const pageSize = input.pageSize ?? 20;
  const order = input.order ?? "desc";

  const bindingRepo = dataSource.getRepository(CoursewareSectionBinding);
  const where = {
    sectionId,
    orgId,
    ...(courseId ? { courseId } : {}),
  };
  const skip = (pageNumber - 1) * pageSize;
  const [bindings, total] = await bindingRepo.findAndCount({
    where,
    relations: ["courseware"],
    order: {
      isCurrent: "DESC",
      createdAt: order === "asc" ? "ASC" : "DESC",
      // With tied createdAt (seed/migration data sharing a timestamp) the order is unstable — the clone traversal of a course copy
      // follows this list, so instability would shuffle the cloned course's courseware order. id is the stable tiebreaker.
      id: "ASC",
    },
    skip,
    take: pageSize,
  });

  const data = bindings.map((binding) => bindingToItem(binding, binding.courseware));

  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  return {
    sectionId,
    orgId,
    courseId,
    data,
    pagination: {
      pageNumber,
      pageSize,
      totalCount: total,
      totalPages,
      hasNextPage: pageNumber * pageSize < total,
      hasPreviousPage: pageNumber > 1,
    },
  };
}
