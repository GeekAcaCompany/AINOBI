// SPDX-License-Identifier: AGPL-3.0-only
import type { EntityManager } from "typeorm";

import { CoursewareOrgAccessError, normalizeOrgId } from "../auth/ainobi-org-access.ts";
import { dataSource } from "../db/db.ts";
import { CoursewareCourseBinding } from "../models/courseware-course-binding.ts";
import { CoursewareSectionBinding } from "../models/courseware-section-binding.ts";
import { assertBindingOrgInvariant } from "./courseware-section-binding-service.ts";

export type EnsureCoursewareCourseBindingInput = {
  coursewareId: string;
  courseId: string;
  orgId: string;
  createdBy?: string | null;
};

/** Idempotently write a courseware–course binding (skipped when it exists). The binding org must equal the courseware org (single-org invariant). */
export async function ensureCoursewareCourseBinding(
  input: EnsureCoursewareCourseBindingInput,
  manager: EntityManager = dataSource.manager,
): Promise<CoursewareCourseBinding> {
  const coursewareId = input.coursewareId.trim();
  const courseId = input.courseId.trim();
  const orgId = input.orgId.trim();
  if (!coursewareId || !courseId || !orgId) {
    throw new Error("coursewareId, courseId and orgId are required for binding");
  }

  // Check the invariant inside the transaction before writing; called within a transaction it reuses the outer one (the manager passed by clone/save).
  return await manager.transaction(async (tx) => {
    await assertBindingOrgInvariant(tx, coursewareId, orgId);

    const repo = tx.getRepository(CoursewareCourseBinding);
    // The unique constraint is (courseware_id, course_id), without org: an existing row with a different org is refused explicitly,
    // rather than implicitly reusing another organization's binding row.
    const existing = await repo.findOne({ where: { coursewareId, courseId } });
    if (existing) {
      if (normalizeOrgId(existing.orgId) !== normalizeOrgId(orgId)) {
        throw new CoursewareOrgAccessError(
          `existing course binding for courseware ${coursewareId} belongs to org ${existing.orgId}; ` +
            `refusing to rebind it under org ${orgId}`,
        );
      }
      return existing;
    }

    return await repo.save(
      repo.create({
        coursewareId,
        courseId,
        orgId,
        createdBy: input.createdBy?.trim() || null,
      }),
    );
  });
}

/** Unbind a courseware from a course (the courseware itself isn't deleted). */
/**
 * Unbinding a courseware from a course = removing every reference to it within this course: the course binding row +
 * every section binding row (cleaned in the same transaction), so no half-unbound state pointing at dead references is left.
 */
export async function unbindCoursewareFromCourse(
  coursewareId: string,
  courseId: string,
  orgId: string,
): Promise<boolean> {
  const cwId = coursewareId.trim();
  const cId = courseId.trim();
  const oId = orgId.trim();
  if (!cwId || !cId || !oId) {
    return false;
  }

  return await dataSource.transaction(async (manager) => {
    // A courseware may hang under a course only through section bindings (no course binding row): any delete hit
    // counts as a successful unbind, otherwise the handler would report a 404 for a state change that took effect
    const sectionResult = await manager
      .getRepository(CoursewareSectionBinding)
      .delete({
        coursewareId: cwId,
        courseId: cId,
        orgId: oId,
      });
    const courseResult = await manager
      .getRepository(CoursewareCourseBinding)
      .delete({
        coursewareId: cwId,
        courseId: cId,
        orgId: oId,
      });
    return (
      (courseResult.affected ?? 0) > 0 || (sectionResult.affected ?? 0) > 0
    );
  });
}
