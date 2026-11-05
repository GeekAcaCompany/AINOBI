// SPDX-License-Identifier: AGPL-3.0-only
import type { CoursewareAsset } from '../models/courseware-assets.ts';
import {
  AinobiOrgStorageError,
  confirmOrganizationStorage,
  decrementOrganizationStorage,
  isOrgStorageIntegrationEnabled,
  lockOrganizationStorage,
  releaseOrganizationStorageLock,
} from './ainobi-org-storage.ts';

export type UploadStorageLockHandle = {
  lockId: string;
  orgId: string;
};

type ErrorDescriptor = { status: number | string; code: number | string; message: string };

function describeError(error: unknown): ErrorDescriptor {
  if (error instanceof AinobiOrgStorageError) {
    return {
      status: error.status,
      code: error.code ?? 'unknown',
      message: error.message,
    };
  }
  return {
    status: 'unknown',
    code: 'unknown',
    message: error instanceof Error ? error.message : String(error),
  };
}

/** Pre-lock org storage for a new OSS upload. Returns null when integration is off. */
export async function acquireCoursewareUploadStorageLock(
  accessToken: string | null | undefined,
  orgId: string | null | undefined,
  sizeBytes: number,
  remark?: string,
): Promise<UploadStorageLockHandle | null> {
  if (!isOrgStorageIntegrationEnabled(orgId) || !accessToken?.trim()) {
    return null;
  }
  const effectiveOrgId = orgId!.trim();
  try {
    const lock = await lockOrganizationStorage(
      accessToken,
      effectiveOrgId,
      sizeBytes,
      remark,
    );
    console.info(
      `[org-storage] lock acquired orgId=${lock.orgId} sizeBytes=${lock.sizeBytes} ` +
        `lockId=${lock.lockId} ttlSeconds=${lock.ttlSeconds}${remark ? ` remark=${remark}` : ''}`,
    );
    return { lockId: lock.lockId, orgId: lock.orgId };
  } catch (error) {
    const { status, code, message } = describeError(error);
    console.warn(
      `[org-storage] lock acquire failed orgId=${effectiveOrgId} sizeBytes=${sizeBytes} ` +
        `status=${status} code=${code} message=${message}`,
    );
    throw error;
  }
}

/** Pre-lock org storage for a cloned courseware's copied assets. Returns null when integration is off. */
export async function acquireCoursewareCloneStorageLock(
  accessToken: string | null | undefined,
  orgId: string | null | undefined,
  sizeBytes: number,
  remark?: string,
): Promise<UploadStorageLockHandle | null> {
  if (!isOrgStorageIntegrationEnabled(orgId) || !accessToken?.trim() || sizeBytes <= 0) {
    return null;
  }
  const effectiveOrgId = orgId!.trim();
  try {
    const lock = await lockOrganizationStorage(
      accessToken,
      effectiveOrgId,
      sizeBytes,
      remark,
    );
    console.info(
      `[org-storage] clone lock acquired orgId=${lock.orgId} sizeBytes=${lock.sizeBytes} ` +
        `lockId=${lock.lockId} ttlSeconds=${lock.ttlSeconds}${remark ? ` remark=${remark}` : ''}`,
    );
    return { lockId: lock.lockId, orgId: lock.orgId };
  } catch (error) {
    const { status, code, message } = describeError(error);
    console.warn(
      `[org-storage] clone lock acquire failed orgId=${effectiveOrgId} sizeBytes=${sizeBytes} ` +
        `status=${status} code=${code} message=${message}`,
    );
    throw error;
  }
}

/**
 * Confirm storage consumption after the DB row is saved. Retries transient
 * failures, then THROWS: swallowing the error would leave an asset row + OSS
 * object that never lands in storage_used_bytes (and the delete path would
 * later decrement quota that was never added). Callers must roll the row back
 * and release the pre-lock when this throws.
 */
export async function confirmCoursewareUploadStorageLock(
  accessToken: string | null | undefined,
  handle: UploadStorageLockHandle | null,
  actualSizeBytes: number,
): Promise<void> {
  if (!handle || !accessToken?.trim()) {
    return;
  }
  const maxAttempts = 3;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await confirmOrganizationStorage(
        accessToken,
        handle.orgId,
        handle.lockId,
        actualSizeBytes,
      );
      console.info(
        `[org-storage] consumption confirmed orgId=${result.orgId} lockId=${result.lockId} ` +
          `committedBytes=${result.committedBytes} releasedBytes=${result.releasedBytes} ` +
          `used=${result.storage.usedBytes} locked=${result.storage.lockedBytes} ` +
          `available=${result.storage.availableBytes}`,
      );
      return;
    } catch (error) {
      lastError = error;
      const { status, code, message } = describeError(error);
      console.warn(
        `[org-storage] confirm failed (attempt ${attempt}/${maxAttempts}) ` +
          `orgId=${handle.orgId} lockId=${handle.lockId} actualSizeBytes=${actualSizeBytes} ` +
          `status=${status} code=${code} message=${message}`,
      );
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`storage confirm failed after ${maxAttempts} attempts`);
}

/** Confirm storage consumption after a courseware clone succeeds. Throws on failure. */
export async function confirmCoursewareCloneStorageLock(
  accessToken: string | null | undefined,
  handle: UploadStorageLockHandle | null,
  actualSizeBytes: number,
): Promise<void> {
  if (!handle || !accessToken?.trim()) {
    return;
  }
  try {
    const result = await confirmOrganizationStorage(
      accessToken,
      handle.orgId,
      handle.lockId,
      actualSizeBytes,
    );
    console.info(
      `[org-storage] clone consumption confirmed orgId=${result.orgId} lockId=${result.lockId} ` +
        `committedBytes=${result.committedBytes} releasedBytes=${result.releasedBytes} ` +
        `used=${result.storage.usedBytes} locked=${result.storage.lockedBytes} ` +
        `available=${result.storage.availableBytes}`,
    );
  } catch (error) {
    const { status, code, message } = describeError(error);
    console.warn(
      `[org-storage] clone confirm failed orgId=${handle.orgId} lockId=${handle.lockId} ` +
        `actualSizeBytes=${actualSizeBytes} status=${status} code=${code} message=${message}`,
    );
    throw error;
  }
}

/** Release a pre-lock when upload/OSS/DB failed. Best-effort. */
export async function releaseCoursewareUploadStorageLock(
  accessToken: string | null | undefined,
  handle: UploadStorageLockHandle | null,
): Promise<void> {
  if (!handle || !accessToken?.trim()) {
    return;
  }
  try {
    await releaseOrganizationStorageLock(accessToken, handle.orgId, handle.lockId);
    console.info(
      `[org-storage] pre-lock released orgId=${handle.orgId} lockId=${handle.lockId}`,
    );
  } catch (error) {
    const { status, code, message } = describeError(error);
    console.warn(
      `[org-storage] release pre-lock failed orgId=${handle.orgId} lockId=${handle.lockId} ` +
        `status=${status} code=${code} message=${message}`,
    );
  }
}

/** Release a clone pre-lock when the clone fails. Best-effort. */
export async function releaseCoursewareCloneStorageLock(
  accessToken: string | null | undefined,
  handle: UploadStorageLockHandle | null,
): Promise<void> {
  if (!handle || !accessToken?.trim()) {
    return;
  }
  try {
    await releaseOrganizationStorageLock(accessToken, handle.orgId, handle.lockId);
    console.info(
      `[org-storage] clone pre-lock released orgId=${handle.orgId} lockId=${handle.lockId}`,
    );
  } catch (error) {
    const { status, code, message } = describeError(error);
    console.warn(
      `[org-storage] clone release pre-lock failed orgId=${handle.orgId} lockId=${handle.lockId} ` +
        `status=${status} code=${code} message=${message}`,
    );
  }
}

/**
 * After deleting an asset row, return committed quota when no other org asset
 * shares the same content MD5.
 */
export async function decrementCoursewareAssetStorageIfUnreferenced(
  accessToken: string | null | undefined,
  orgId: string | null | undefined,
  asset: Pick<CoursewareAsset, 'fileId' | 'contentMd5' | 'fileSize'>,
): Promise<void> {
  if (!isOrgStorageIntegrationEnabled(orgId)) {
    console.info(
      `[org-storage] decrement skip reason=${orgId?.trim() ? 'disabled' : 'no-org'} ` +
        `fileId=${asset.fileId} contentMd5=${asset.contentMd5} fileSize=${asset.fileSize}`,
    );
    return;
  }
  if (!accessToken?.trim()) {
    console.info(
      `[org-storage] decrement skip reason=no-token orgId=${orgId} ` +
        `fileId=${asset.fileId} contentMd5=${asset.contentMd5} fileSize=${asset.fileSize}`,
    );
    return;
  }
  const sizeBytes = Number(asset.fileSize);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    console.info(
      `[org-storage] decrement skip reason=invalid-size orgId=${orgId} ` +
        `fileId=${asset.fileId} fileSize=${asset.fileSize}`,
    );
    return;
  }
  const effectiveOrgId = orgId!.trim();

  // Lazy import so the DB / TypeORM entity layer isn't required for callers
  // that never reach this branch (and for unit tests running without DB).
  const [{ Not }, { dataSource }, { CoursewareAsset: AssetEntity }] = await Promise.all([
    import('typeorm'),
    import('../db/db.ts'),
    import('../models/courseware-assets.ts'),
  ]);
  // Serialize the last-reference decision per (org, md5): two concurrent
  // courseware deletes of the last two references would otherwise both count
  // zero remaining rows and double-decrement. The HTTP decrement runs inside
  // the advisory transaction so followers re-count only after this decision
  // (and its refund) committed. Failures stay best-effort (warn + continue)
  // so one flaky storage call cannot break a bulk delete's refund loop.
  try {
  await dataSource.transaction(async (manager) => {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `courseware-asset:${effectiveOrgId}:${asset.contentMd5}`,
    ]);
    const remainingRefs = await manager.count(AssetEntity, {
      where: {
        orgId: effectiveOrgId,
        contentMd5: asset.contentMd5,
        fileId: Not(asset.fileId),
      },
    });
    if (remainingRefs > 0) {
      console.info(
        `[org-storage] decrement skipped (still referenced) orgId=${effectiveOrgId} ` +
          `fileId=${asset.fileId} contentMd5=${asset.contentMd5} sizeBytes=${sizeBytes} ` +
          `remainingRefs=${remainingRefs}`,
      );
      return;
    }

    // Durable claim: both concurrent last-reference deletes see zero rows
    // after both transactions committed — the advisory lock serializes them
    // but cannot make the second one a no-op. The claim row (PK org+md5,
    // INSERT ... ON CONFLICT DO NOTHING) is won exactly once; the loser
    // skips its decrement. Cleared when a new charge for the same (org, md5)
    // lands (see clearAssetRefundClaim in the finalize path).
    const { CoursewareAssetRefundClaim } = await import(
      '../models/courseware-asset-refund-claims.ts'
    );
    const claimResult = await manager
      .createQueryBuilder()
      .insert()
      .into(CoursewareAssetRefundClaim)
      .values({ orgId: effectiveOrgId, contentMd5: asset.contentMd5 })
      .orIgnore("(org_id, content_md5)")
      .execute();
    const claimed = (claimResult.raw as unknown[]).length > 0;
    if (!claimed) {
      console.info(
        `[org-storage] decrement skipped (refund already claimed) orgId=${effectiveOrgId} ` +
          `fileId=${asset.fileId} contentMd5=${asset.contentMd5} sizeBytes=${sizeBytes}`,
      );
      return;
    }

    const result = await decrementOrganizationStorage(accessToken, effectiveOrgId, sizeBytes);
    console.info(
      `[org-storage] storage decremented orgId=${result.orgId} fileId=${asset.fileId} ` +
        `contentMd5=${asset.contentMd5} sizeBytes=${result.decrementedBytes} ` +
        `used=${result.storage.usedBytes} available=${result.storage.availableBytes}`,
    );
  });
  } catch (error) {
    const { status, code, message } = describeError(error);
    console.warn(
      `[org-storage] decrement failed orgId=${effectiveOrgId} fileId=${asset.fileId} ` +
        `contentMd5=${asset.contentMd5} sizeBytes=${sizeBytes} ` +
        `status=${status} code=${code} message=${message}`,
    );
  }
}

/**
 * Return committed quota for a NON-asset org object (quiz recordings, covers,
 * TTS audio) whose bytes were lock+confirmed at write time. Unlike assets
 * these objects are not content-shared across rows, so no MD5 refcount check
 * is needed — the bytes are handed straight back. Best-effort (logs on
 * failure); the SQL decrement clamps at zero on the education side.
 */
export async function decrementCoursewareObjectStorage(
  accessToken: string | null | undefined,
  orgId: string | null | undefined,
  sizeBytes: number,
  label: string,
): Promise<boolean> {
  if (!isOrgStorageIntegrationEnabled(orgId)) {
    console.info(
      `[org-storage] object decrement skip reason=${orgId?.trim() ? "disabled" : "no-org"} label=${label} sizeBytes=${sizeBytes}`,
    );
    return false;
  }
  if (!accessToken?.trim()) {
    console.info(
      `[org-storage] object decrement skip reason=no-token orgId=${orgId} label=${label} sizeBytes=${sizeBytes}`,
    );
    return false;
  }
  const size = Number(sizeBytes);
  if (!Number.isFinite(size) || size <= 0) {
    console.info(
      `[org-storage] object decrement skip reason=invalid-size orgId=${orgId} label=${label} sizeBytes=${sizeBytes}`,
    );
    return false;
  }
  try {
    const result = await decrementOrganizationStorage(
      accessToken,
      orgId!.trim(),
      size,
    );
    console.info(
      `[org-storage] object storage decremented orgId=${result.orgId} label=${label} ` +
        `sizeBytes=${result.decrementedBytes} used=${result.storage.usedBytes} ` +
        `available=${result.storage.availableBytes}`,
    );
    return true;
  } catch (error) {
    const { status, code, message } = describeError(error);
    console.warn(
      `[org-storage] object decrement failed orgId=${orgId} label=${label} ` +
        `sizeBytes=${size} status=${status} code=${code} message=${message}`,
    );
    return false;
  }
}

/**
 * Clear the durable refund claim for (org, md5) after a NEW charge lands so
 * a future delete of that reference can refund again. Best-effort.
 */
export async function clearAssetRefundClaim(
  orgId: string | null | undefined,
  contentMd5: string,
): Promise<void> {
  if (!orgId?.trim() || !contentMd5) {
    return;
  }
  try {
    const { dataSource } = await import('../db/db.ts');
    const { CoursewareAssetRefundClaim } = await import(
      '../models/courseware-asset-refund-claims.ts'
    );
    await dataSource
      .getRepository(CoursewareAssetRefundClaim)
      .delete({ orgId: orgId.trim(), contentMd5 });
  } catch (error) {
    console.warn(
      `[org-storage] refund-claim clear failed org=${orgId} md5=${contentMd5}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Mark a claimed (org, md5) refund as completed after a successful decrement. */
export async function markAssetRefundClaimComplete(
  orgId: string,
  contentMd5: string,
): Promise<void> {
  try {
    const { dataSource } = await import('../db/db.ts');
    const { CoursewareAssetRefundClaim } = await import(
      '../models/courseware-asset-refund-claims.ts'
    );
    await dataSource
      .getRepository(CoursewareAssetRefundClaim)
      .update({ orgId, contentMd5 }, { refunded: true });
  } catch (error) {
    console.warn(
      `[org-storage] refund-claim completion write failed org=${orgId} md5=${contentMd5}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function orgStorageErrorStatus(error: unknown): number | null {
  if (error instanceof AinobiOrgStorageError) {
    if (error.isQuotaExceeded) {
      return 422;
    }
    return error.status >= 400 && error.status < 600 ? error.status : 502;
  }
  return null;
}

/** True when education rejected storage ops for missing organization:file_upload. */
export function isOrgStorageFileUploadPermissionError(error: unknown): boolean {
  if (!(error instanceof AinobiOrgStorageError)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes('organization:file_upload') ||
    (error.status === 403 &&
      (message.includes('file_upload') || message.includes('permission denied')))
  );
}

export function orgStorageErrorMessage(error: unknown): string {
  if (error instanceof AinobiOrgStorageError) {
    if (isOrgStorageFileUploadPermissionError(error)) {
      return (
        'Organization storage pre-lock rejected: session lacks organization:file_upload. ' +
        'courseware-agent locks quota with the MCP Bearer (ainobi_ak_* short token); ' +
        'Codex does not call education storage. Ensure education Agent role ∩ owner ' +
        'includes organization:file_upload, restart education if needed, re-exchange the ' +
        'MCP Bearer, and open a new chat.'
      );
    }
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
