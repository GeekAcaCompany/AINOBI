// SPDX-License-Identifier: AGPL-3.0-only
import { dataSource } from '../db/db.ts';
import type { CoursewareActorContext } from '../auth/ainobi-org-access.ts';
import {
  CoursewareAuditLog,
  type CoursewareAuditAction,
} from '../models/courseware-audit-log.ts';
import { Courseware } from '../models/courseware.ts';
import type { PaginationResult } from './courseware-assets-service.ts';

const COURSEWARE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Always stored as the courseware primary key id (callers may pass the business key). */
async function resolveAuditCoursewareId(coursewareId: string | null | undefined): Promise<string | null> {
  const raw = coursewareId?.trim();
  if (!raw) {
    return null;
  }
  const repo = dataSource.getRepository(Courseware);
  if (COURSEWARE_UUID_RE.test(raw)) {
    const byId = await repo.findOne({ where: { id: raw } });
    if (byId) {
      return byId.id;
    }
  }
  const byKey = await repo.findOne({ where: { key: raw } });
  return byKey?.id ?? raw;
}

export type CoursewareAuditLogDto = {
  id: string;
  orgId: string;
  coursewareId: string | null;
  conversationId: string | null;
  assetFileId: string | null;
  action: CoursewareAuditAction;
  userId: string;
  accountName: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
};

function auditLogToDto(row: CoursewareAuditLog): CoursewareAuditLogDto {
  return {
    id: row.id,
    orgId: row.orgId,
    coursewareId: row.coursewareId,
    conversationId: row.conversationId,
    assetFileId: row.assetFileId,
    action: row.action,
    userId: row.userId,
    accountName: row.accountName,
    detail: row.detail,
    createdAt: row.createdAt.toISOString(),
  };
}

export type ListCoursewareAuditLogsInput = {
  coursewareId: string;
  pageNumber?: number;
  pageSize?: number;
  action?: CoursewareAuditAction;
  order?: 'asc' | 'desc';
};

export type ListCoursewareAuditLogsResult = {
  data: CoursewareAuditLogDto[];
  pagination: PaginationResult;
};

export async function listCoursewareAuditLogs(
  input: ListCoursewareAuditLogsInput,
): Promise<ListCoursewareAuditLogsResult> {
  const pageNumber = input.pageNumber ?? 1;
  const pageSize = input.pageSize ?? 20;
  const order = input.order ?? 'desc';
  const coursewareId = input.coursewareId.trim();

  const repo = dataSource.getRepository(CoursewareAuditLog);
  const qb = repo
    .createQueryBuilder('log')
    .where('log.coursewareId = :coursewareId', { coursewareId });

  if (input.action) {
    qb.andWhere('log.action = :action', { action: input.action });
  }

  const total = await qb.getCount();
  const skip = (pageNumber - 1) * pageSize;
  const rows = await qb
    .clone()
    .orderBy('log.createdAt', order === 'asc' ? 'ASC' : 'DESC')
    .skip(skip)
    .take(pageSize)
    .getMany();

  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  return {
    data: rows.map(auditLogToDto),
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

export type RecordCoursewareAuditLogInput = {
  action: CoursewareAuditAction;
  actor: CoursewareActorContext;
  orgId?: string;
  coursewareId?: string | null;
  conversationId?: string | null;
  assetFileId?: string | null;
  detail?: Record<string, unknown> | null;
};

/** Write an operation audit entry (failures are only logged, never blocking the main flow). */
export async function recordCoursewareAuditLog(input: RecordCoursewareAuditLogInput): Promise<void> {
  if (!dataSource.isInitialized) {
    return;
  }

  const orgId = (input.orgId ?? input.actor.orgId).trim();
  if (!orgId) {
    return;
  }

  try {
    const coursewareId = await resolveAuditCoursewareId(input.coursewareId);
    const repo = dataSource.getRepository(CoursewareAuditLog);
    await repo.save(
      repo.create({
        orgId,
        coursewareId,
        conversationId: input.conversationId?.trim() || null,
        assetFileId: input.assetFileId?.trim() || null,
        action: input.action,
        userId: input.actor.userId,
        accountName: input.actor.accountName,
        detail: input.detail ?? null,
      }),
    );
  } catch (error) {
    console.warn(
      '[audit] failed to record courseware audit log:',
      error instanceof Error ? error.message : error,
    );
  }
}
