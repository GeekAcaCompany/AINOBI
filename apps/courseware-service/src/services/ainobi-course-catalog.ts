// SPDX-License-Identifier: AGPL-3.0-only
import { ainobiBackendApiUrl } from '../config/ainobi-backend-api.ts';

type CourseListApiCourse = {
  course_id?: string;
  course_name?: string;
  course_status?: string;
  course_description?: string | null;
  org_id?: string;
  student_count?: number | null;
  chapter_count?: number | null;
  section_count?: number | null;
};

type CourseListApiPagination = {
  page_number?: number;
  page_size?: number;
  total_count?: number;
  total_pages?: number;
  has_next_page?: boolean;
  has_previous_page?: boolean;
};

type CourseListApiEnvelope = {
  code?: number;
  success?: boolean;
  message?: string;
  data?: {
    data?: CourseListApiCourse[];
    pagination?: CourseListApiPagination;
  };
};

export type AinobiCourseListItem = {
  course_id: string;
  course_name: string;
  course_status: string;
  course_description: string | null;
  org_id: string | null;
  student_count: number | null;
  chapter_count: number | null;
  section_count: number | null;
};

export type AinobiCourseListResult = {
  org_id: string;
  items: AinobiCourseListItem[];
  pagination: {
    page_number: number;
    page_size: number;
    total_count: number;
    total_pages: number;
    has_next_page: boolean;
    has_previous_page: boolean;
  };
};

export type ListAinobiCoursesInput = {
  accessToken: string;
  orgId: string;
  courseName?: string;
  pageNumber?: number;
  pageSize?: number;
};

/**
 * Proxy education `GET /organization/{org_id}/course/list` (SuccessWrapped).
 * Agent sessions need `course:query_list` (present on the agent role whitelist).
 */
export async function listAinobiCoursesForOrg(
  input: ListAinobiCoursesInput,
): Promise<AinobiCourseListResult> {
  const orgId = input.orgId.trim();
  const token = input.accessToken.trim();
  if (!orgId) {
    throw new Error('orgId is required');
  }
  if (!token) {
    throw new Error('accessToken is required');
  }

  const pageNumber = Math.max(1, Math.floor(input.pageNumber ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize ?? 20)));

  const url = new URL(
    ainobiBackendApiUrl(`/organization/${encodeURIComponent(orgId)}/course/list`),
  );
  url.searchParams.set('page_number', String(pageNumber));
  url.searchParams.set('page_size', String(pageSize));
  const courseName = input.courseName?.trim();
  if (courseName) {
    url.searchParams.set('course_name', courseName);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
    });
  } catch (error) {
    throw new Error(
      `organization/.../course/list request failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  let body: CourseListApiEnvelope;
  try {
    body = (await response.json()) as CourseListApiEnvelope;
  } catch {
    throw new Error(`organization/.../course/list returned non-JSON (status ${response.status})`);
  }

  if (!response.ok || body.code !== 0 || body.success !== true || !body.data) {
    throw new Error(
      `organization/.../course/list rejected: ${body.message ?? response.status}`,
    );
  }

  const rows = Array.isArray(body.data.data) ? body.data.data : [];
  const pagination = body.data.pagination ?? {};
  const totalCount =
    typeof pagination.total_count === 'number' ? pagination.total_count : rows.length;
  const totalPages =
    typeof pagination.total_pages === 'number'
      ? pagination.total_pages
      : totalCount === 0
        ? 0
        : Math.ceil(totalCount / pageSize);

  return {
    org_id: orgId,
    items: rows
      .map((row): AinobiCourseListItem | null => {
        const courseId = typeof row.course_id === 'string' ? row.course_id.trim() : '';
        if (!courseId) {
          return null;
        }
        return {
          course_id: courseId,
          course_name: row.course_name?.trim() || courseId,
          course_status: row.course_status?.trim() || 'unknown',
          course_description:
            typeof row.course_description === 'string' ? row.course_description : null,
          org_id: typeof row.org_id === 'string' ? row.org_id : null,
          student_count: typeof row.student_count === 'number' ? row.student_count : null,
          chapter_count: typeof row.chapter_count === 'number' ? row.chapter_count : null,
          section_count: typeof row.section_count === 'number' ? row.section_count : null,
        };
      })
      .filter((row): row is AinobiCourseListItem => Boolean(row)),
    pagination: {
      page_number: typeof pagination.page_number === 'number' ? pagination.page_number : pageNumber,
      page_size: typeof pagination.page_size === 'number' ? pagination.page_size : pageSize,
      total_count: totalCount,
      total_pages: totalPages,
      has_next_page: Boolean(pagination.has_next_page),
      has_previous_page: Boolean(pagination.has_previous_page),
    },
  };
}

// ---------------------------------------------------------------------------
// Course mutations (create / update) — proxied to the education backend with
// the caller's own Bearer token (backend enforces course:create / course:update).
// ---------------------------------------------------------------------------

export type AinobiCourseMutationResult = {
  course_id: string;
  course_name: string;
  course_status: string;
  course_description: string | null;
  org_id: string | null;
};

type CourseMutationApiEnvelope = {
  code?: number;
  success?: boolean;
  message?: string;
  data?: Record<string, unknown> | null;
};

function mapCourseMutationRow(
  orgId: string,
  row: Record<string, unknown>,
): AinobiCourseMutationResult {
  const courseId = typeof row.course_id === 'string' ? row.course_id.trim() : '';
  return {
    course_id: courseId,
    course_name: typeof row.course_name === 'string' ? row.course_name.trim() : '',
    course_status: typeof row.course_status === 'string' ? row.course_status.trim() : 'unknown',
    course_description:
      typeof row.course_description === 'string' ? row.course_description : null,
    org_id: typeof row.org_id === 'string' ? row.org_id : orgId,
  };
}

async function courseMutationRequest(
  orgId: string,
  apiPath: string,
  payload: Record<string, unknown>,
  accessToken: string,
): Promise<AinobiCourseMutationResult> {
  const url = new URL(ainobiBackendApiUrl(`/organization/${encodeURIComponent(orgId)}${apiPath}`));

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error(
      `organization/.../course request failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  let body: CourseMutationApiEnvelope;
  try {
    body = (await response.json()) as CourseMutationApiEnvelope;
  } catch {
    throw new Error(`organization/.../course returned non-JSON (status ${response.status})`);
  }

  if (!response.ok || body.code !== 0 || body.success !== true || !body.data) {
    throw new Error(`organization/.../course rejected: ${body.message ?? response.status}`);
  }
  const mapped = mapCourseMutationRow(orgId, body.data);
  if (!mapped.course_id) {
    throw new Error('organization/.../course response missing course_id');
  }
  return mapped;
}

export async function createAinobiCourse(input: {
  orgId: string;
  accessToken: string;
  courseName: string;
  description?: string | null;
  status?: string | null;
  /** Public course (joinable from outside the organization). The backend defaults to false = private to the organization; the free tier allows no private courses. */
  isPublic?: boolean | null;
}): Promise<AinobiCourseMutationResult> {
  return courseMutationRequest(
    input.orgId,
    '/course/create',
    {
      course_name: input.courseName,
      course_status: input.status?.trim() || 'draft',
      ...(input.isPublic != null ? { is_public_course: input.isPublic } : {}),
      ...(input.description?.trim() ? { course_description: input.description.trim() } : {}),
    },
    input.accessToken,
  );
}

export async function updateAinobiCourse(input: {
  orgId: string;
  courseId: string;
  accessToken: string;
  courseName?: string | null;
  description?: string | null;
  status?: string | null;
  isPublic?: boolean | null;
}): Promise<AinobiCourseMutationResult> {
  const payload: Record<string, unknown> = {};
  if (input.courseName?.trim()) payload.course_name = input.courseName.trim();
  if (input.description != null) payload.course_description = input.description;
  if (input.status?.trim()) payload.course_status = input.status.trim();
  if (input.isPublic != null) payload.is_public_course = input.isPublic;
  return courseMutationRequest(
    input.orgId,
    `/course/${encodeURIComponent(input.courseId)}/update`,
    payload,
    input.accessToken,
  );
}

/** Course-info probe (also verifies the course exists within this org). */
export async function getAinobiCourseInfo(input: {
  orgId: string;
  courseId: string;
  accessToken: string;
}): Promise<AinobiCourseMutationResult | null> {
  const url = new URL(
    ainobiBackendApiUrl(
      `/organization/${encodeURIComponent(input.orgId)}/course/${encodeURIComponent(input.courseId)}/info`,
    ),
  );
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        accept: 'application/json',
      },
    });
  } catch {
    return null;
  }
  if (!response.ok) {
    return null;
  }
  let body: CourseMutationApiEnvelope;
  try {
    body = (await response.json()) as CourseMutationApiEnvelope;
  } catch {
    return null;
  }
  if (body.code !== 0 || body.success !== true || !body.data) {
    return null;
  }
  return mapCourseMutationRow(input.orgId, body.data);
}
