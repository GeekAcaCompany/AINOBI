// SPDX-License-Identifier: AGPL-3.0-only
import type { CourseSectionInfo } from "../schemas/course_section.ts";

type TranslateFunction = (
  key: any,
  variables?: Record<string, string | number>
) => string;

const PREVIOUS_SECTION_CONDITIONS = new Set([
  "after_previous_completed",
  "days_after_previous_completed",
]);

const formatUnlockDate = (
  unlockAt: string | Date | null | undefined
): string | null => {
  if (!unlockAt) return null;

  const date = new Date(unlockAt);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleDateString();
};

export const getCourseSectionLockedReason = (
  section: CourseSectionInfo,
  t: TranslateFunction
): string => {
  if (section.expired) {
    return t("course.access.expired");
  }

  const unlockDate = formatUnlockDate(section.unlock_at);
  if (unlockDate) {
    return t("course.access.unlocksOn", { date: unlockDate });
  }

  if (
    section.start_condition &&
    PREVIOUS_SECTION_CONDITIONS.has(section.start_condition)
  ) {
    return t("course.access.completePrevious");
  }

  return t("course.access.locked");
};
