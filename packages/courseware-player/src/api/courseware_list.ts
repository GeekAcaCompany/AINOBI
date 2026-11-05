// SPDX-License-Identifier: AGPL-3.0-only
import { coursewareApi } from "../host/requester.ts";
import { isCoursewareApiConfigured } from "./courseware_agent.ts";

const COURSEWARE_AGENT_OPTS = { responseShape: "agent" as const };

export type CoursewareLibraryListItem = {
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
};

export type ListCoursewareLibraryParams = {
  /** Required: the courseware's organization (never fall back to the login current_org). */
  orgId: string;
  /** Optional: return only coursewares bound to this course. */
  courseId?: string;
  pageNumber?: number;
  pageSize?: number;
  title?: string;
  order?: "asc" | "desc";
};

export type ListCoursewareLibraryResponse = {
  ok?: boolean;
  error?: string;
  data: CoursewareLibraryListItem[];
  pagination?: {
    pageNumber: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
};

export async function listCoursewareLibrary(
  params: ListCoursewareLibraryParams,
): Promise<ListCoursewareLibraryResponse> {
  if (!isCoursewareApiConfigured()) {
    return { data: [] };
  }

  const orgId = params.orgId?.trim();
  if (!orgId) {
    throw new Error('Missing "orgId": courseware library must be scoped by organization.');
  }
  const courseId = params.courseId?.trim();

  const json = (await coursewareApi.get(
    "/courseware/list",
    {
      pageNumber: params.pageNumber ?? 1,
      pageSize: params.pageSize ?? 100,
      order: params.order ?? "desc",
      orgId,
      ...(courseId ? { courseId } : {}),
      ...(params.title?.trim() ? { title: params.title.trim() } : {}),
    },
    COURSEWARE_AGENT_OPTS,
  )) as ListCoursewareLibraryResponse;

  if (json && typeof json === "object" && json.ok === false) {
    throw new Error(
      typeof json.error === "string" && json.error.trim()
        ? json.error.trim()
        : "Failed to load courseware library",
    );
  }

  return {
    ...json,
    data: Array.isArray(json?.data) ? json.data : [],
  };
}

export type DeleteCoursewareParams = {
  key?: string;
  coursewareId?: string;
};

export type DeleteCoursewareResponse = {
  ok?: boolean;
  error?: string;
};

/** `DELETE /courseware?key=` or `?coursewareId=` — delete a courseware (with assets, agent conversations, etc.). */
export async function deleteCourseware(
  params: DeleteCoursewareParams,
): Promise<DeleteCoursewareResponse> {
  if (!isCoursewareApiConfigured()) {
    throw new Error("Courseware API is not configured");
  }

  const key = params.key?.trim();
  const coursewareId = params.coursewareId?.trim();
  if (!key && !coursewareId) {
    throw new Error("key or coursewareId is required");
  }

  const json = (await coursewareApi.delete("/courseware", undefined, {
    query: key ? { key } : { coursewareId: coursewareId! },
    ...COURSEWARE_AGENT_OPTS,
  })) as DeleteCoursewareResponse;

  // In agent mode a non-envelope error body may lack ok; only an explicit ok===true counts as a successful delete
  if (!json || typeof json !== "object" || json.ok !== true) {
    throw new Error(
      typeof json?.error === "string" && json.error.trim()
        ? json.error.trim()
        : "Failed to delete courseware",
    );
  }

  return json;
}

/**
 * Fetch every courseware library entry under an organization (paging until hasNextPage is false).
 * For cases such as the management dialog that need the full list + local search.
 */
export async function listAllCoursewareLibraryForOrg(
  orgId: string,
  options?: { pageSize?: number; order?: "asc" | "desc"; maxPages?: number },
): Promise<CoursewareLibraryListItem[]> {
  const oid = orgId.trim();
  if (!oid) return [];

  const pageSize = options?.pageSize ?? 100;
  const order = options?.order ?? "desc";
  const maxPages = options?.maxPages ?? 50;
  const all: CoursewareLibraryListItem[] = [];

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const response = await listCoursewareLibrary({
      orgId: oid,
      pageNumber,
      pageSize,
      order,
    });
    all.push(...response.data);
    if (!response.pagination?.hasNextPage) break;
  }

  return all;
}
