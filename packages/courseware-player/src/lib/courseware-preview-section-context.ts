// SPDX-License-Identifier: AGPL-3.0-only
export type CoursewarePreviewSectionContext = {
  courseId: string;
  chapterId: string;
  sectionId: string;
  orgId: string | null;
  fromPublic: boolean;
  fromTrial: boolean;
  from: string | null;
};

const parsePreviewQueryBoolean = (value: string | null): boolean => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
};

/** Read course_id from the URL (the "current course" tab of the courseware library needs only this, without chapter/section). */
export const readCoursewareEditorCourseIdFromUrl = (): string | null => {
  if (typeof window === "undefined") return null;
  const courseId = new URLSearchParams(window.location.search).get("course_id")?.trim();
  return courseId || null;
};

/** Read the course section context from the URL query parameters (shared by the preview / editor iframe). */
export const readCoursewarePreviewSectionContext = (): CoursewarePreviewSectionContext | null => {
  if (typeof window === "undefined") return null;
  const search = new URLSearchParams(window.location.search);
  const courseId = search.get("course_id")?.trim() || "";
  const chapterId = search.get("chapter_id")?.trim() || "";
  const sectionId = search.get("section_id")?.trim() || "";
  if (!courseId || !chapterId || !sectionId) return null;
  return {
    courseId,
    chapterId,
    sectionId,
    orgId: search.get("org_id")?.trim() || null,
    fromPublic: parsePreviewQueryBoolean(search.get("from_public")),
    fromTrial: parsePreviewQueryBoolean(search.get("from_trial")),
    from: search.get("from")?.trim() || null,
  };
};

/** Write the section context into the preview / editor URL query parameters. */
export const appendCoursewarePreviewSectionContextToSearchParams = (
  params: URLSearchParams,
  context: CoursewarePreviewSectionContext,
): void => {
  params.set("course_id", context.courseId);
  params.set("chapter_id", context.chapterId);
  params.set("section_id", context.sectionId);
  if (context.orgId?.trim()) {
    params.set("org_id", context.orgId.trim());
  }
  if (context.fromPublic) {
    params.set("from_public", "1");
  }
  if (context.fromTrial) {
    params.set("from_trial", "1");
  }
  if (context.from?.trim()) {
    params.set("from", context.from.trim());
  }
};
