// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Base URLs of the AINOBI web frontends, used to build login-free handoff
 * links handed back to Codex via MCP (`courseware_ui_links`).
 *
 * The student base URL reuses the env already required for headless rendering
 * (`AINOBI_STUDENT_VIEW_BASE_URL`); the manage base URL has its own env.
 * When unset we fall back to the frontends' local dev ports and warn — so dev
 * works out of the box while a misconfigured prod loudly announces broken
 * links instead of silently emitting `localhost`.
 */

let warnedStudentOrigin = false;
let warnedManageOrigin = false;

function trimBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
}

/** Student-view web frontend base URL (no trailing slash). */
export function resolveStudentWebOrigin(): string {
  const raw = process.env.AINOBI_STUDENT_VIEW_BASE_URL?.trim();
  if (raw) {
    return trimBaseUrl(raw);
  }
  if (!warnedStudentOrigin) {
    warnedStudentOrigin = true;
    console.warn(
      "[agent-web-origins] AINOBI_STUDENT_VIEW_BASE_URL not set; falling back to http://localhost:5173 for handoff links",
    );
  }
  return "http://localhost:5173";
}

/**
 * Manage-view web frontend base URL (no trailing slash), or null when this
 * deployment has no manage app (AINOBI_MANAGE_VIEW_DISABLED=true).
 */
export function resolveManageWebOrigin(): string | null {
  if (process.env.AINOBI_MANAGE_VIEW_DISABLED?.trim() === 'true') {
    return null;
  }
  const raw = process.env.AINOBI_MANAGE_VIEW_BASE_URL?.trim();
  if (raw) {
    return trimBaseUrl(raw);
  }
  if (!warnedManageOrigin) {
    warnedManageOrigin = true;
    console.warn(
      "[agent-web-origins] AINOBI_MANAGE_VIEW_BASE_URL not set; falling back to http://localhost:5174 for handoff links",
    );
  }
  return "http://localhost:5174";
}
