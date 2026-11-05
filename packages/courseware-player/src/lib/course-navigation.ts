// SPDX-License-Identifier: AGPL-3.0-only
import { fetchCurrentCoursewarePreviewKey } from "../api/courseware_section_binding.ts";
import { isCoursewareApiConfigured } from "../api/courseware_agent.ts";
import type { CourseTreeNode, CourseSectionTreeNode } from "../schemas/course_tree.ts";
import { CourseSectionType } from "@ainobi/api-contracts/enums/course_section.ts";
import sessionManager from "../host/session-manager.ts";

export interface CourseSectionTarget {
  chapterId: string;
  sectionId: string;
}

export const findSectionTarget = (
  courseNode: CourseTreeNode | null,
  predicate: (sectionNode: CourseTreeNode["chapters"][number]["sections"][number]) => boolean
): CourseSectionTarget | null => {
  if (!courseNode) return null;

  for (const chapter of courseNode.chapters) {
    for (const sectionNode of chapter.sections) {
      if (!predicate(sectionNode)) continue;
      return {
        chapterId: chapter.chapter.chapter_id,
        sectionId: sectionNode.section.section_id,
      };
    }
  }

  return null;
};

export const findAccessibleSectionTarget = (
  courseNode: CourseTreeNode | null,
  chapterId?: string | null,
  sectionId?: string | null
): CourseSectionTarget | null => {
  if (!courseNode || !chapterId || !sectionId) return null;

  return findSectionTarget(
    courseNode,
    (sectionNode) =>
      sectionNode.section.can_access !== false &&
      sectionNode.section.section_id === sectionId &&
      sectionNode.section.chapter_id === chapterId
  );
};

export const findFirstAccessibleSectionTarget = (
  courseNode: CourseTreeNode | null
): CourseSectionTarget | null =>
  findSectionTarget(
    courseNode,
    (sectionNode) => sectionNode.section.can_access !== false
  );

export const findFirstAccessibleLiveSectionTarget = (
  courseNode: CourseTreeNode | null
): CourseSectionTarget | null =>
  findSectionTarget(
    courseNode,
    (sectionNode) =>
      sectionNode.section.can_access !== false &&
      sectionNode.section.section_type === CourseSectionType.Live &&
      sectionNode.section.live_classroom?.can_join_live === true
  );

export const findSectionNodeInTree = (
  courseNode: CourseTreeNode | null,
  chapterId: string,
  sectionId: string,
): CourseSectionTreeNode | null => {
  if (!courseNode) return null;

  for (const chapter of courseNode.chapters) {
    if (chapter.chapter.chapter_id !== chapterId) continue;
    for (const sectionNode of chapter.sections) {
      if (sectionNode.section.section_id === sectionId) {
        return sectionNode;
      }
    }
  }

  return null;
};

// Resolve "Continue Learning" target:
// 1. Try last_unfinished section if accessible
// 2. Fallback to first accessible section
export const resolveResumeSectionTarget = (
  courseNode: CourseTreeNode | null,
  lastChapterId?: string | null,
  lastSectionId?: string | null,
): CourseSectionTarget | null => {
  const resumeTarget = findAccessibleSectionTarget(courseNode, lastChapterId, lastSectionId);
  return resumeTarget ?? findFirstAccessibleSectionTarget(courseNode);
};

// ==================== URL Builders ====================

interface PlayerUrlParams {
  courseId: string;
  chapterId: string;
  sectionId: string;
  orgId?: string;
  fromPublic?: boolean;
  from?: string;
}

interface CoursewarePreviewUrlParams {
  /** Courseware key, the `courseware_id` query parameter of the preview page */
  coursewareId: string;
  courseId?: string;
  chapterId?: string;
  sectionId?: string;
  orgId?: string;
  fromPublic?: boolean;
  fromTrial?: boolean;
  from?: string;
}

export const buildCoursewarePreviewUrl = (params: CoursewarePreviewUrlParams): string => {
  const sp = new URLSearchParams({
    courseware_id: params.coursewareId,
  });
  if (params.courseId) sp.set("course_id", params.courseId);
  if (params.chapterId) sp.set("chapter_id", params.chapterId);
  if (params.sectionId) sp.set("section_id", params.sectionId);
  if (params.orgId) sp.set("org_id", params.orgId);
  if (params.fromPublic) sp.set("from_public", "1");
  if (params.fromTrial) sp.set("from_trial", "1");
  if (params.from) sp.set("from", params.from);
  return `/courseware-preview?${sp.toString()}`;
};

export const buildPlayerUrl = (params: PlayerUrlParams): string => {
  const sp = new URLSearchParams({
    course_id: params.courseId,
    chapter_id: params.chapterId,
    section_id: params.sectionId,
  });
  if (params.orgId) sp.set("org_id", params.orgId);
  if (params.fromPublic) sp.set("from_public", "1");
  if (params.from) sp.set("from", params.from);
  return `/player?${sp.toString()}`;
};

interface LiveClassroomUrlParams {
  orgId: string;
  courseId: string;
  chapterId: string;
  sectionId: string;
  from?: string;
}

export const buildLiveClassroomUrl = (params: LiveClassroomUrlParams): string => {
  const sp = new URLSearchParams({
    org_id: params.orgId,
    course_id: params.courseId,
    chapter_id: params.chapterId,
    section_id: params.sectionId,
  });
  if (params.from) sp.set("from", params.from);
  return `/live_classroom_join?${sp.toString()}`;
};

// Build URL based on section type: live → live_classroom_join, others → player
export const buildSectionUrl = (params: {
  sectionType: string;
  courseId: string;
  chapterId: string;
  sectionId: string;
  orgId: string;
  isLiveNow?: boolean;
  fromPublic?: boolean;
  from?: string;
}): string => {
  if (params.sectionType === CourseSectionType.Live && params.isLiveNow) {
    return buildLiveClassroomUrl(params);
  }
  return buildPlayerUrl(params);
};

export interface ResolveSectionNavigationParams {
  courseNode: CourseTreeNode | null;
  chapterId: string;
  sectionId: string;
  courseId: string;
  orgId: string;
  isLiveNow?: boolean;
  fromPublic?: boolean;
  fromTrial?: boolean;
  from?: string;
}

/**
 * Decide the navigation target by the section type and `has_courseware_bound`:
 * - live in progress → the live classroom
 * - AI with a bound courseware → courseware-preview (fetches the currently taught courseware key)
 * - everything else → the traditional player
 */
export const resolveSectionNavigationUrl = async (
  params: ResolveSectionNavigationParams,
): Promise<string> => {
  const sectionNode = findSectionNodeInTree(
    params.courseNode,
    params.chapterId,
    params.sectionId,
  );
  const section = sectionNode?.section;
  const sectionType = section?.section_type;

  if (sectionType === CourseSectionType.Live && params.isLiveNow) {
    return buildLiveClassroomUrl({
      orgId: params.orgId,
      courseId: params.courseId,
      chapterId: params.chapterId,
      sectionId: params.sectionId,
      from: params.from,
    });
  }

  if (
    sectionType === CourseSectionType.AI &&
    section?.has_courseware_bound
  ) {
    // A public course page can't fetch the bound courseware key when not logged in; fall back to the legacy player so it doesn't get stuck on auth.
    const canResolveBoundCourseware =
      !params.fromPublic || (await sessionManager.checkSession());
    if (canResolveBoundCourseware && isCoursewareApiConfigured()) {
      try {
        const previewKey = await fetchCurrentCoursewarePreviewKey({
          sectionId: params.sectionId,
          orgId: params.orgId,
          courseId: params.courseId,
        });
        if (previewKey) {
          return buildCoursewarePreviewUrl({
            coursewareId: previewKey,
            courseId: params.courseId,
            chapterId: params.chapterId,
            sectionId: params.sectionId,
            orgId: params.orgId,
            fromPublic: params.fromPublic,
            fromTrial: params.fromTrial,
            from: params.from,
          });
        }
      } catch {
        // When the binding lookup fails, fall back to the player, the same as an unbound section.
      }
    }
  }

  return buildPlayerUrl({
    courseId: params.courseId,
    chapterId: params.chapterId,
    sectionId: params.sectionId,
    orgId: params.orgId,
    fromPublic: params.fromPublic,
    from: params.from,
  });
};
