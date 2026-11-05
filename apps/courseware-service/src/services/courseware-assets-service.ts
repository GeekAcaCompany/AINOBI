// SPDX-License-Identifier: AGPL-3.0-only
import { dataSource } from "../db/db.ts";
import { CoursewareAsset } from "../models/courseware-assets.ts";
import { refreshCoursewareAssetFileUrlForResponse } from "./courseware-object-url-response.ts";

export type PaginationResult = {
  pageNumber: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

export function assetToDto(row: CoursewareAsset) {
  return {
    fileId: row.fileId,
    contentMd5: row.contentMd5,
    orgId: row.orgId,
    coursewareId: row.coursewareId,
    fileName: row.fileName,
    fileSize: row.fileSize,
    contentType: row.contentType,
    filePath: row.filePath,
    fileUrl: refreshCoursewareAssetFileUrlForResponse(row.fileUrl),
    fileArtifactUrl: row.fileArtifactUrl,
    fileArtifactMetadata: row.fileArtifactMetadata,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt?.toISOString() ?? null,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}

export type ListCoursewareAssetsInput = {
  coursewareId: string;
  pageNumber?: number;
  pageSize?: number;
  fileName?: string;
  order?: "asc" | "desc";
};

export type ListCoursewareAssetsResult = {
  data: ReturnType<typeof assetToDto>[];
  pagination: PaginationResult;
};

export async function findCoursewareAssetByFileId(
  coursewareId: string,
  fileId: string,
): Promise<CoursewareAsset | null> {
  const repo = dataSource.getRepository(CoursewareAsset);
  return repo.findOne({ where: { coursewareId: coursewareId.trim(), fileId: fileId.trim() } });
}

/** `file_id` is globally unique; use when CLI `AINOBI_COURSEWARE_ID` may lag editor `coursewareId`. */
export async function findCoursewareAssetByFileIdOnly(fileId: string): Promise<CoursewareAsset | null> {
  const repo = dataSource.getRepository(CoursewareAsset);
  return repo.findOne({ where: { fileId: fileId.trim() } });
}

export async function listCoursewareAssets(
  input: ListCoursewareAssetsInput,
): Promise<ListCoursewareAssetsResult> {
  const pageNumber = input.pageNumber ?? 1;
  const pageSize = input.pageSize ?? 20;
  const order = input.order ?? "desc";
  const coursewareId = input.coursewareId.trim();

  const repo = dataSource.getRepository(CoursewareAsset);
  const qb = repo.createQueryBuilder("a").where("a.coursewareId = :coursewareId", { coursewareId });
  // Student quiz answer recordings (stored here by mistake in the past) must not appear in the editor's asset library.
  qb.andWhere("a.fileName NOT ILIKE :quizAnswerPrefix ESCAPE '\\'", {
    quizAnswerPrefix: "quiz-answer.%",
  });
  const fn = input.fileName?.trim();
  if (fn) {
    const escaped = fn.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    qb.andWhere("a.fileName ILIKE :pat ESCAPE '\\'", { pat: `%${escaped}%` });
  }
  const total = await qb.getCount();
  const skip = (pageNumber - 1) * pageSize;
  const rows = await qb
    .clone()
    .orderBy("a.createdAt", order === "asc" ? "ASC" : "DESC")
    .skip(skip)
    .take(pageSize)
    .getMany();

  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  return {
    data: rows.map(assetToDto),
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
