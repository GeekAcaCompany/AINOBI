// SPDX-License-Identifier: AGPL-3.0-only
import { ZodError } from "zod";

/**
 * Resolve an HTTP status code for a caught error without leaking internal
 * error messages for unexpected (5xx-worthy) failures. Errors that carry an
 * intentional client-facing `status` (400-599) — e.g. validation, SSRF
 * blocks, auth/authz failures, payload-too-large — use that status and their
 * own message verbatim, since those messages are written to be safe to expose.
 * Anything else is treated as an opaque internal error (500, generic message).
 */
export function resolveErrorStatus(error: unknown): number {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number" && status >= 400 && status < 600) {
      return status;
    }
  }
  if (error instanceof ZodError) {
    return 400;
  }
  return 500;
}

/** True when the error is safe to surface verbatim to the client (see {@link resolveErrorStatus}). */
export function isClientFacingError(error: unknown): boolean {
  return resolveErrorStatus(error) < 500;
}
