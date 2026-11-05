// SPDX-License-Identifier: AGPL-3.0-only
// Platform backend API base for the Node services. The host passes its configured base
// (AINOBI_BACKEND_API_BASE in the services); empty falls back to the hosted platform.

export const DEFAULT_AINOBI_BACKEND_API_BASE = 'https://api.example.com/v1';

export function resolveAinobiBackendApiBase(configured: string | undefined): string {
  return configured?.trim() || DEFAULT_AINOBI_BACKEND_API_BASE;
}

/** Join an API base with an API path (e.g. `/user/check_session`). */
export function joinAinobiBackendApiUrl(base: string, path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base.replace(/\/+$/, '')}${suffix}`;
}
