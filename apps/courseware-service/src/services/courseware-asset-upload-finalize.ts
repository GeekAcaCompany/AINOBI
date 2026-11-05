// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { QueryFailedError, type EntityManager } from "typeorm";

import {
  persistenceUrlForObjectKey,
  uploadLocalFileAsset,
  type UploadedAsset,
} from "@ainobi/courseware-cli/cli/assets.ts";
import { getAuthorizedSession } from "../api-auth.ts";
import { actorFromSession } from "../auth/ainobi-org-access.ts";
import { dataSource } from "../db/db.ts";
import { CoursewareAsset, type CoursewareAssetFileArtifactMetadata } from "../models/courseware-assets.ts";
import {
  acquireCoursewareUploadStorageLock,
  clearAssetRefundClaim,
  confirmCoursewareUploadStorageLock,
  orgStorageErrorMessage,
  orgStorageErrorStatus,
  releaseCoursewareUploadStorageLock,
  type UploadStorageLockHandle,
} from "./courseware-asset-org-storage.ts";
import { assetToDto } from "./courseware-assets-service.ts";
import { recordCoursewareAuditLog } from "./courseware-audit-log-service.ts";
import { convertUploadedDocumentAsset } from "./courseware-document-conversion.ts";
import { CoursewareOrgAccessError } from "./courseware-org-guard.ts";

export type CoursewareAssetUploadFinalizeResult = {
  asset: ReturnType<typeof assetToDto>;
  upload: { existed: boolean; cloned?: boolean; deduped?: boolean };
};

function buildClonedAsset(
  source: CoursewareAsset,
  coursewareId: string,
  orgId: string | null,
  fileName: string,
  createdBy: string | null,
): CoursewareAsset {
  return dataSource.getRepository(CoursewareAsset).create({
    fileId: randomUUID(),
    contentMd5: source.contentMd5,
    orgId: orgId ?? source.orgId,
    coursewareId,
    fileName: fileName.slice(0, 255),
    fileSize: source.fileSize,
    contentType: source.contentType,
    filePath: source.filePath,
    fileUrl: source.fileUrl,
    fileArtifactUrl: source.fileArtifactUrl,
    fileArtifactMetadata: source.fileArtifactMetadata,
    createdBy,
    updatedBy: createdBy,
  });
}

async function saveClonedAssetOrDedupe(
  row: CoursewareAsset,
  upload: { existed: boolean; cloned?: boolean; deduped?: boolean },
  manager?: EntityManager,
): Promise<{ row: CoursewareAsset; upload: typeof upload }> {
  const assetRepo = dataSource.getRepository(CoursewareAsset);
  const saveRow = async (target: CoursewareAsset) =>
    manager ? manager.save(target) : assetRepo.save(target);
  const findRow = (where: { coursewareId: string; contentMd5: string }) =>
    manager
      ? manager.findOne(CoursewareAsset, { where })
      : assetRepo.findOne({ where });
  try {
    await saveRow(row);
    return { row, upload };
  } catch (error) {
    if (error instanceof QueryFailedError) {
      const driver = error.driverError as { code?: string } | undefined;
      if (driver?.code === "23505") {
        const raced = await findRow({
          coursewareId: row.coursewareId,
          contentMd5: row.contentMd5,
        });
        if (raced) {
          raced.fileName = row.fileName;
          raced.updatedBy = row.updatedBy;
          await saveRow(raced);
          return { row: raced, upload: { ...upload, deduped: true } };
        }
      }
    }
    throw error;
  }
}

async function auditAssetUpload(
  req: IncomingMessage,
  args: {
    coursewareId: string;
    orgId: string | null;
    fileId: string;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  const session = getAuthorizedSession(req);
  if (!session) return;
  await recordCoursewareAuditLog({
    action: "asset.upload",
    actor: actorFromSession(session),
    orgId: args.orgId ?? undefined,
    coursewareId: args.coursewareId,
    assetFileId: args.fileId,
    detail: args.detail,
  });
}

async function resolveDocumentArtifact(
  extension: string,
  fileIdMd5Hex: string,
): Promise<{
  fileArtifactUrl: string | null;
  fileArtifactMetadata: CoursewareAssetFileArtifactMetadata | null;
}> {
  if (extension !== ".pdf" && extension !== ".pptx") {
    return { fileArtifactUrl: null, fileArtifactMetadata: null };
  }
  const converted = await convertUploadedDocumentAsset(fileIdMd5Hex, extension);
  const kind: "pdf" | "pptx" = extension === ".pdf" ? "pdf" : "pptx";
  return {
    fileArtifactUrl: converted.artifact_src.slice(0, 2048),
    fileArtifactMetadata: {
      slide_count: converted.slide_count,
      kind,
      conversion: converted.conversion,
    },
  };
}

export class CoursewareAssetUploadFinalizeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CoursewareAssetUploadFinalizeError";
  }
}

export function orgStorageFinalizeErrorStatus(error: unknown): number | null {
  return error instanceof CoursewareOrgAccessError ? error.status : null;
}

/**
 * Write a file already on disk to OSS + DB (with MD5 dedupe, the organization storage lock, PDF/PPTX conversion).
 * Shared by single multipart uploads and the complete step of chunked uploads.
 */
export async function finalizeCoursewareAssetUpload(args: {
  req: IncomingMessage;
  coursewareId: string;
  coursewareOrgId: string | null;
  fileName: string;
  contentMd5: string;
  extension: string;
  fileSize: number;
  /** Single multipart upload: path of the file on disk */
  tmpFilePath?: string;
  /** After a chunked direct upload to OSS completes: the object is already in OSS, no second upload */
  uploadedAsset?: UploadedAsset;
}): Promise<CoursewareAssetUploadFinalizeResult> {
  const { req, coursewareId, coursewareOrgId, fileName, extension, fileSize, tmpFilePath, uploadedAsset } = args;
  const contentMd5 = args.contentMd5.toLowerCase();
  const session = getAuthorizedSession(req);
  const actor = session ? actorFromSession(session) : null;
  const createdBy = actor?.userId ?? null;
  const orgId = coursewareOrgId ?? actor?.orgId ?? null;
  const repo = dataSource.getRepository(CoursewareAsset);
  const trimmedName = fileName.slice(0, 255);

  const existingInCourseware = await repo.findOne({ where: { coursewareId, contentMd5 } });
  if (existingInCourseware) {
    existingInCourseware.fileName = trimmedName;
    existingInCourseware.updatedBy = createdBy;
    if (!existingInCourseware.orgId) {
      existingInCourseware.orgId = orgId;
    }
    await repo.save(existingInCourseware);
    console.info(
      `[org-storage] upload skip-lock reason=dedupe orgId=${orgId ?? "-"} ` +
        `coursewareId=${coursewareId} fileId=${existingInCourseware.fileId} ` +
        `contentMd5=${contentMd5} fileSize=${fileSize}`,
    );
    await auditAssetUpload(req, {
      coursewareId,
      orgId,
      fileId: existingInCourseware.fileId,
      detail: { deduped: true },
    });
    return {
      asset: assetToDto(existingInCourseware),
      upload: { existed: true, deduped: true },
    };
  }

  // Serialize the per-org "first reference" decision: two concurrent uploads
  // of the same content into the same org (different coursewares) must not
  // both observe no-same-org-row and double-charge — the (orgId, contentMd5)
  // advisory lock makes the check-then-insert atomic, so exactly one request
  // charges.
  let sameOrgReuse = false;
  let donor: CoursewareAsset | null = null;
  let storageLock: UploadStorageLockHandle | null = null;
  let saved: Awaited<ReturnType<typeof saveClonedAssetOrDedupe>> | null = null;
  await dataSource.transaction(async (manager) => {
    await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `courseware-row:${coursewareId}`,
    ]);
    if (orgId) {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `courseware-asset:${orgId}:${contentMd5}`,
      ]);
    }
    const existingSameOrg = orgId
      ? await manager.findOne(CoursewareAsset, { where: { orgId, contentMd5 } })
      : null;
    donor = existingSameOrg ?? (await manager.findOne(CoursewareAsset, { where: { contentMd5 } }));
    if (!donor) {
      return; // fresh upload path continues outside the transaction
    }
    sameOrgReuse = existingSameOrg !== null;
    // Cross-org content reuse must consume the NEW org's quota: the delete path
    // (decrementCoursewareAssetStorageIfUnreferenced) decrements per-org when
    // no other row of that org references the content, so an upload that never
    // locked would later subtract bytes the org never added. Same-org reuse is
    // already counted once and stays lock-free.
    if (!sameOrgReuse) {
      storageLock = await acquireCoursewareUploadStorageLock(
        session?.accessToken ?? null,
        orgId,
        donor.fileSize,
        `courseware:${coursewareId}`,
      );
    }
    const cloned = buildClonedAsset(donor, coursewareId, orgId, trimmedName, createdBy);
    saved = await saveClonedAssetOrDedupe(cloned, { existed: true, cloned: true }, manager);
    // Confirm INSIDE the courseware-row-locked transaction: deletion
    // serializes behind the whole accounting sequence, so it can never
    // capture the row before its charge landed (nor after without seeing it
    // in DELETE ... RETURNING).
    if (storageLock && !saved.upload.deduped) {
      await confirmCoursewareUploadStorageLock(
        session?.accessToken ?? null,
        storageLock,
        donor.fileSize,
      );
      await clearAssetRefundClaim(orgId, contentMd5);
    }
  });
  const existingElsewhere = donor as CoursewareAsset | null;
  // Assigned inside the transaction callback (not tracked by TypeScript).
  const clonedSaved = saved as Awaited<ReturnType<typeof saveClonedAssetOrDedupe>> | null;
  if (existingElsewhere && clonedSaved) {
    const saved = clonedSaved;
    if (storageLock && saved.upload.deduped) {
      // Lost the DB-insert race (another writer landed this courseware's
      // row): the insert was a no-op, so the pre-lock must go back instead
      // of committing. NB: `deduped` — NOT `existed`, which is the OSS
      // object-existence flag and says nothing about this row insert.
      await releaseCoursewareUploadStorageLock(session?.accessToken ?? null, storageLock);
    }
    console.info(
      `[org-storage] upload ${sameOrgReuse ? "skip-lock" : "lock-confirm"} reason=clone ` +
        `orgId=${orgId ?? "-"} coursewareId=${coursewareId} fileId=${saved.row.fileId} ` +
        `sourceFileId=${existingElsewhere.fileId} contentMd5=${contentMd5} fileSize=${fileSize}`,
    );
    await auditAssetUpload(req, {
      coursewareId,
      orgId,
      fileId: saved.row.fileId,
      detail: { cloned: true },
    });
    return { asset: assetToDto(saved.row), upload: saved.upload };
  }

  const accessToken = session?.accessToken ?? null;
  storageLock = null;
  try {
    storageLock = await acquireCoursewareUploadStorageLock(
      accessToken,
      orgId,
      fileSize,
      `courseware:${coursewareId}`,
    );
  } catch (storageErr) {
    const status = orgStorageErrorStatus(storageErr) ?? 502;
    throw new CoursewareAssetUploadFinalizeError(orgStorageErrorMessage(storageErr), status);
  }

  let uploaded: UploadedAsset;
  try {
    if (uploadedAsset) {
      uploaded = uploadedAsset;
    } else if (tmpFilePath) {
      uploaded = await uploadLocalFileAsset(tmpFilePath, contentMd5, extension, trimmedName);
    } else {
      throw new CoursewareAssetUploadFinalizeError("Missing upload source for finalize.", 500);
    }
  } catch (error) {
    await releaseCoursewareUploadStorageLock(accessToken, storageLock);
    const message = error instanceof Error ? error.message : String(error);
    const status = /Unsupported courseware asset extension/i.test(message) ? 400 : 502;
    throw new CoursewareAssetUploadFinalizeError(message, status);
  }

  let fileArtifactUrl: string | null = null;
  let fileArtifactMetadata: CoursewareAssetFileArtifactMetadata | null = null;
  try {
    const artifact = await resolveDocumentArtifact(uploaded.extension, uploaded.file_id);
    fileArtifactUrl = artifact.fileArtifactUrl;
    fileArtifactMetadata = artifact.fileArtifactMetadata;
  } catch (error) {
    await releaseCoursewareUploadStorageLock(accessToken, storageLock);
    const message = error instanceof Error ? error.message : String(error);
    throw new CoursewareAssetUploadFinalizeError(message, 502);
  }

  const row = repo.create({
    fileId: randomUUID(),
    contentMd5,
    orgId,
    coursewareId,
    fileName: trimmedName,
    fileSize: uploaded.bytes,
    contentType: uploaded.content_type.slice(0, 255),
    filePath: uploaded.object_key.slice(0, 512),
    // Stable key-derived URL (never a signed/expiring one) — responses re-sign.
    fileUrl: persistenceUrlForObjectKey(uploaded.object_key).slice(0, 2048),
    fileArtifactUrl,
    fileArtifactMetadata,
    createdBy,
    updatedBy: createdBy,
  });

  // Definitely assigned: the transaction callback sets it before resolving.
  let savedFresh!: Awaited<ReturnType<typeof saveClonedAssetOrDedupe>>;
  let sameOrgReferenceExisted = false;
  try {
    // The fresh-path insert joins the (org, md5) advisory section too: two
    // concurrent FIRST copies of the same content would otherwise both pass
    // the donor check (no rows at all), both upload, and both confirm a full
    // charge while deletion refunds the content only once.
    await dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `courseware-row:${coursewareId}`,
      ]);
      if (orgId) {
        await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `courseware-asset:${orgId}:${contentMd5}`,
        ]);
      }
      const sameOrgRow = orgId
        ? await manager.findOne(CoursewareAsset, { where: { orgId, contentMd5 } })
        : null;
      sameOrgReferenceExisted = sameOrgRow !== null;
      savedFresh = await saveClonedAssetOrDedupe(
        row,
        { existed: uploaded.existed },
        manager,
      );
      // Confirm INSIDE the courseware-row-locked transaction (see the clone
      // path comment) so deletion cannot capture the row unaccounted.
      if (storageLock && !savedFresh.upload.deduped && !sameOrgReferenceExisted) {
        await confirmCoursewareUploadStorageLock(
          accessToken,
          storageLock,
          uploaded.bytes,
        );
        await clearAssetRefundClaim(orgId, contentMd5);
      }
    });
  } catch (error) {
    await releaseCoursewareUploadStorageLock(accessToken, storageLock);
    const message = error instanceof Error ? error.message : String(error);
    throw new CoursewareAssetUploadFinalizeError(message, 500);
  }
  try {
    if (savedFresh.upload.deduped || sameOrgReferenceExisted) {
      // Lost the DB-insert race, or another request already charged this
      // org's first reference to the content: nothing to commit — give the
      // pre-lock back. NB: `deduped` — NOT `existed`: a globally-existing OSS
      // object with no asset row (rows deleted, object retained) still
      // inserts a fresh logical reference that MUST be charged unless a
      // same-org reference (and thus the charge) already exists.
      await releaseCoursewareUploadStorageLock(accessToken, storageLock);
    }
    // The non-degenerate confirm ran inside the locked transaction above.
  } catch (error) {
    // Quota accounting failed after the row was saved: roll the row back and
    // release the pre-lock so records and storage_used_bytes stay consistent.
    // The OSS object is content-addressed — a retry re-uses the same key.
    try {
      await dataSource.getRepository(CoursewareAsset).remove(savedFresh.row);
    } catch (rollbackError) {
      console.error(
        `[org-storage] row rollback after confirm failure failed fileId=${savedFresh.row.fileId}: ` +
          `${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
      );
    }
    await releaseCoursewareUploadStorageLock(accessToken, storageLock);
    const message = error instanceof Error ? error.message : String(error);
    throw new CoursewareAssetUploadFinalizeError(
      `Organization storage accounting failed, upload rolled back — please retry: ${message}`,
      502,
    );
  }
  await auditAssetUpload(req, {
    coursewareId,
    orgId,
    fileId: savedFresh.row.fileId,
    detail: { fileName: trimmedName },
  });
  return { asset: assetToDto(savedFresh.row), upload: savedFresh.upload };
}
