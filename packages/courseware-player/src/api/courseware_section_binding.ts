// SPDX-License-Identifier: AGPL-3.0-only
import { coursewareApi } from "../host/requester.ts";
import { isCoursewareApiConfigured } from "./courseware_agent.ts";

const COURSEWARE_AGENT_OPTS = { responseShape: "agent" as const };

export interface CoursewareListItemSummary {
  id: string;
  orgId: string;
  key: string;
  title: string;
  coverUrl: string | null;
  isPublic: boolean;
  isShare: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CoursewareSectionBindingItem {
  bindingId: string;
  coursewareId: string;
  sectionId: string;
  courseId: string;
  orgId: string;
  chapterId: string | null;
  isCurrent: boolean;
  createdAt: string;
  courseware: CoursewareListItemSummary;
}

export interface CoursewareSectionBindingListResponse {
  ok?: boolean;
  error?: string;
  sectionId: string;
  orgId: string;
  courseId: string | null;
  data: CoursewareSectionBindingItem[];
}

export interface ListSectionBindingsParams {
  sectionId: string;
  orgId: string;
  courseId?: string;
  pageNumber?: number;
  pageSize?: number;
  order?: "asc" | "desc";
}

export async function listSectionBindings(
  params: ListSectionBindingsParams,
): Promise<CoursewareSectionBindingItem[]> {
  if (!isCoursewareApiConfigured()) {
    return [];
  }

  const json = (await coursewareApi.get(
    "/courseware/section-binding/list",
    {
      sectionId: params.sectionId,
      orgId: params.orgId,
      pageNumber: params.pageNumber ?? 1,
      pageSize: params.pageSize ?? 20,
      order: params.order ?? "desc",
      ...(params.courseId ? { courseId: params.courseId } : {}),
    },
    COURSEWARE_AGENT_OPTS,
  )) as CoursewareSectionBindingListResponse;

  if (json && typeof json === "object" && json.ok === false) {
    throw new Error(
      typeof json.error === "string" && json.error.trim()
        ? json.error.trim()
        : "Failed to load section courseware bindings",
    );
  }

  return Array.isArray(json?.data) ? json.data : [];
}

/** Get the preview key of the section's currently taught courseware (`courseware.key`, used for the `courseware_id` query parameter). */
export async function fetchCurrentCoursewarePreviewKey(params: {
  sectionId: string;
  orgId: string;
  courseId: string;
}): Promise<string | null> {
  const bindings = await listSectionBindings({
    sectionId: params.sectionId,
    orgId: params.orgId,
    courseId: params.courseId,
    pageNumber: 1,
    pageSize: 20,
    order: "desc",
  });

  if (bindings.length === 0) return null;

  const current =
    bindings.find((item) => item.isCurrent) ??
    bindings[0];

  const key = current.courseware?.key?.trim();
  return key || null;
}
