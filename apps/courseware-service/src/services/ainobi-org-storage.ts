// SPDX-License-Identifier: AGPL-3.0-only
import { ainobiBackendApiUrl } from '../config/ainobi-backend-api.ts';

/** Platform business code for storage quota exceeded (422030). */
export const ORG_STORAGE_QUOTA_EXCEEDED_CODE = 422030;

export type OrganizationStorageInfo = {
  orgId: string;
  quotaBytes: number;
  usedBytes: number;
  lockedBytes: number;
  availableBytes: number;
  unlimited: boolean;
};

export type OrganizationStorageLockInfo = {
  lockId: string;
  orgId: string;
  sizeBytes: number;
  createdAt: string;
  expiresAt: string;
  ttlSeconds: number;
};

export type OrganizationStorageConfirmResult = {
  lockId: string;
  orgId: string;
  committedBytes: number;
  releasedBytes: number;
  storage: OrganizationStorageInfo;
};

export type OrganizationStorageDecrementResult = {
  orgId: string;
  decrementedBytes: number;
  storage: OrganizationStorageInfo;
};

type ApiStorageInfo = {
  org_id?: string;
  quota_bytes?: number;
  used_bytes?: number;
  locked_bytes?: number;
  available_bytes?: number;
  unlimited?: boolean;
};

type ApiLockInfo = {
  lock_id?: string;
  org_id?: string;
  size_bytes?: number;
  created_at?: string;
  expires_at?: string;
  ttl_seconds?: number;
};

type ApiConfirmResult = {
  lock_id?: string;
  org_id?: string;
  committed_bytes?: number;
  released_bytes?: number;
  storage?: ApiStorageInfo;
};

type ApiDecrementResult = {
  org_id?: string;
  decremented_bytes?: number;
  storage?: ApiStorageInfo;
};

type ApiResponse<T> = {
  code?: number;
  success?: boolean;
  message?: string;
  data?: T;
};

export class AinobiOrgStorageError extends Error {
  readonly status: number;
  readonly code: number | undefined;

  constructor(message: string, status: number, code?: number) {
    super(message);
    this.name = 'AinobiOrgStorageError';
    this.status = status;
    this.code = code;
  }

  get isQuotaExceeded(): boolean {
    return this.code === ORG_STORAGE_QUOTA_EXCEEDED_CODE;
  }
}

export function isOrgStorageIntegrationDisabled(): boolean {
  return (
    process.env.AINOBI_ORG_STORAGE_DISABLED === '1' ||
    process.env.AINOBI_ORG_STORAGE_DISABLED === 'true'
  );
}

/** When false/0, skip lock/confirm/decrement (no quota enforcement or usage accounting). Default: on. */
export function isOrgStorageQuotaCheckEnabled(): boolean {
  const raw = process.env.AINOBI_ORG_STORAGE_QUOTA_CHECK?.trim().toLowerCase();
  if (raw === undefined || raw === '') {
    return true;
  }
  return raw !== '0' && raw !== 'false' && raw !== 'off' && raw !== 'no';
}

export function isOrgStorageIntegrationEnabled(orgId?: string | null): boolean {
  if (isOrgStorageIntegrationDisabled() || !isOrgStorageQuotaCheckEnabled()) {
    return false;
  }
  return Boolean(orgId?.trim());
}

function orgStorageUrl(orgId: string, suffix: string): string {
  const id = orgId.trim();
  const path = suffix.startsWith('/') ? suffix : `/${suffix}`;
  return ainobiBackendApiUrl(`/organization/${id}/storage${path}`);
}

function mapStorageInfo(data: ApiStorageInfo): OrganizationStorageInfo {
  const orgId = data.org_id?.trim();
  if (!orgId) {
    throw new AinobiOrgStorageError('Invalid storage info response from platform', 502);
  }
  return {
    orgId,
    quotaBytes: Number(data.quota_bytes ?? 0),
    usedBytes: Number(data.used_bytes ?? 0),
    lockedBytes: Number(data.locked_bytes ?? 0),
    availableBytes: Number(data.available_bytes ?? 0),
    unlimited: Boolean(data.unlimited),
  };
}

function mapLockInfo(data: ApiLockInfo): OrganizationStorageLockInfo {
  const lockId = data.lock_id?.trim();
  const orgId = data.org_id?.trim();
  if (!lockId || !orgId) {
    throw new AinobiOrgStorageError('Invalid storage lock response from platform', 502);
  }
  return {
    lockId,
    orgId,
    sizeBytes: Number(data.size_bytes ?? 0),
    createdAt: data.created_at?.trim() || '',
    expiresAt: data.expires_at?.trim() || '',
    ttlSeconds: Number(data.ttl_seconds ?? 0),
  };
}

function mapConfirmResult(data: ApiConfirmResult): OrganizationStorageConfirmResult {
  const lockId = data.lock_id?.trim();
  const orgId = data.org_id?.trim();
  if (!lockId || !orgId || !data.storage) {
    throw new AinobiOrgStorageError('Invalid storage confirm response from platform', 502);
  }
  return {
    lockId,
    orgId,
    committedBytes: Number(data.committed_bytes ?? 0),
    releasedBytes: Number(data.released_bytes ?? 0),
    storage: mapStorageInfo(data.storage),
  };
}

function mapDecrementResult(data: ApiDecrementResult): OrganizationStorageDecrementResult {
  const orgId = data.org_id?.trim();
  if (!orgId || !data.storage) {
    throw new AinobiOrgStorageError('Invalid storage decrement response from platform', 502);
  }
  return {
    orgId,
    decrementedBytes: Number(data.decremented_bytes ?? 0),
    storage: mapStorageInfo(data.storage),
  };
}

/** Extract the `…/storage/<op>…` tail from a full backend URL for compact logging. */
function logTagForUrl(url: string): string {
  const match = url.match(/\/organization\/[^/]+\/storage(\/.*)?$/);
  return match ? `org-storage${match[1] ?? ''}` : 'org-storage';
}

async function postOrgStorage<T>(
  accessToken: string,
  url: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const token = accessToken.trim();
  if (!token) {
    throw new AinobiOrgStorageError('access token is required', 401);
  }

  const tag = logTagForUrl(url);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[org-storage] network failure tag=${tag} message=${message}`);
    throw new AinobiOrgStorageError(`Organization storage request failed: ${message}`, 503);
  }

  let payload: ApiResponse<T>;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    console.warn(`[org-storage] invalid JSON tag=${tag} status=${response.status}`);
    throw new AinobiOrgStorageError('Invalid JSON from organization storage API', 502);
  }

  if (!response.ok || payload.code !== 0 || payload.success !== true || !payload.data) {
    const message =
      payload.message?.trim() || `Organization storage rejected (${response.status})`;
    // Business rejections (quota exceeded, lock not found, etc.) are logged at warn so
    // even callers that swallow the throw still leave a trail.
    console.warn(
      `[org-storage] api rejected tag=${tag} status=${response.status} code=${payload.code ?? 'unknown'} message=${message}`,
    );
    throw new AinobiOrgStorageError(message, response.status, payload.code);
  }

  return payload.data;
}

/** Pre-lock organization storage before uploading a new asset. */
export async function lockOrganizationStorage(
  accessToken: string,
  orgId: string,
  sizeBytes: number,
  remark?: string,
): Promise<OrganizationStorageLockInfo> {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new AinobiOrgStorageError('sizeBytes must be positive', 400);
  }
  const data = await postOrgStorage<ApiLockInfo>(accessToken, orgStorageUrl(orgId, '/lock'), {
    size_bytes: Math.floor(sizeBytes),
    ...(remark?.trim() ? { remark: remark.trim().slice(0, 300) } : {}),
  });
  return mapLockInfo(data);
}

/** Commit a pre-lock after the asset is persisted. */
export async function confirmOrganizationStorage(
  accessToken: string,
  orgId: string,
  lockId: string,
  actualSizeBytes?: number,
): Promise<OrganizationStorageConfirmResult> {
  const body: Record<string, unknown> = {};
  if (actualSizeBytes != null && actualSizeBytes > 0) {
    body.actual_size_bytes = Math.floor(actualSizeBytes);
  }
  const data = await postOrgStorage<ApiConfirmResult>(
    accessToken,
    orgStorageUrl(orgId, `/lock/${lockId.trim()}/confirm`),
    body,
  );
  return mapConfirmResult(data);
}

/** Drop a pre-lock without consuming quota (upload failed or aborted). */
export async function releaseOrganizationStorageLock(
  accessToken: string,
  orgId: string,
  lockId: string,
): Promise<void> {
  await postOrgStorage<Record<string, never>>(
    accessToken,
    orgStorageUrl(orgId, `/lock/${lockId.trim()}/release`),
    {},
  );
}

/** Return committed bytes after deleting an asset (when content is no longer referenced). */
export async function decrementOrganizationStorage(
  accessToken: string,
  orgId: string,
  sizeBytes: number,
): Promise<OrganizationStorageDecrementResult> {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new AinobiOrgStorageError('sizeBytes must be positive', 400);
  }
  const data = await postOrgStorage<ApiDecrementResult>(
    accessToken,
    orgStorageUrl(orgId, '/decrement'),
    { size_bytes: Math.floor(sizeBytes) },
  );
  return mapDecrementResult(data);
}
