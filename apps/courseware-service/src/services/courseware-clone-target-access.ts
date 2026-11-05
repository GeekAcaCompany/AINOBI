// SPDX-License-Identifier: AGPL-3.0-only
import type { AinobiAuthorizedSession } from "../auth/ainobi-user-session.ts";
import { assertOrgIdManageAccess } from "./courseware-design-templates-service.ts";

/**
 * Clone target IDs may point to backend rows that were just created inside the
 * caller's still-open transaction (for example course clone). Those rows are
 * not visible to this service over a separate HTTP request yet, so target
 * scope validation here is limited to authenticated target-org access.
 *
 * The caller that creates the target course/chapter/section is responsible for
 * guaranteeing the IDs are real and internally consistent before invoking
 * courseware clone.
 */
export async function assertCloneTargetCourseAccess(params: {
  session: AinobiAuthorizedSession;
  targetOrgId: string;
  targetCourseId: string;
}): Promise<void> {
  void params.targetCourseId;
  await assertOrgIdManageAccess(params.session, params.targetOrgId);
}

export async function assertCloneTargetSectionAccess(params: {
  session: AinobiAuthorizedSession;
  targetOrgId: string;
  targetCourseId: string;
  targetChapterId: string;
  targetSectionId: string;
}): Promise<void> {
  void params.targetCourseId;
  void params.targetChapterId;
  void params.targetSectionId;
  await assertOrgIdManageAccess(params.session, params.targetOrgId);
}
