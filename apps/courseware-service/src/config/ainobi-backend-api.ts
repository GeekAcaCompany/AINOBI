// SPDX-License-Identifier: AGPL-3.0-only
/** Platform backend API base — implemented in @ainobi/backend-client; this service reads AINOBI_BACKEND_API_BASE per call. */
import {
  joinAinobiBackendApiUrl,
  resolveAinobiBackendApiBase as resolveConfiguredBase,
} from "@ainobi/backend-client";

export { DEFAULT_AINOBI_BACKEND_API_BASE } from "@ainobi/backend-client";

export function resolveAinobiBackendApiBase(): string {
  return resolveConfiguredBase(process.env.AINOBI_BACKEND_API_BASE);
}

/** Join {@link resolveAinobiBackendApiBase} with an API path (e.g. `/user/check_session`). */
export function ainobiBackendApiUrl(path: string): string {
  return joinAinobiBackendApiUrl(resolveAinobiBackendApiBase(), path);
}
