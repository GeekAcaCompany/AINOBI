// SPDX-License-Identifier: AGPL-3.0-only
/**
 * File name sanitizing for courseware asset uploads.
 * `[` `]` and similar break the AI panel's `@[name](file:id)` wire token / `@name` parsing, so file_id can't expand.
 */

/** Path separators, control characters, and characters that interfere with @mentions / URLs */
const ILLEGAL_ASSET_FILENAME_CHARS = /[\\/[\]?#%*:|"<>@\u0000-\u001f\u007f]/g;

export function sanitizeCoursewareAssetFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) return "file";

  const lastDot = trimmed.lastIndexOf(".");
  const hasExt = lastDot > 0 && lastDot < trimmed.length - 1;
  const rawBase = hasExt ? trimmed.slice(0, lastDot) : trimmed;
  const rawExt = hasExt ? trimmed.slice(lastDot + 1) : "";

  const base = rawBase
    .replace(ILLEGAL_ASSET_FILENAME_CHARS, "_")
    .replace(/_+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/_+\s+/g, "_")
    .replace(/\s+_+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[\s_]+|[\s_]+$/g, "");

  const ext = rawExt.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const safeBase = base || "file";
  return ext ? `${safeBase}.${ext}` : safeBase;
}

/** When the file name contains invalid characters, return a new File with the same content and a sanitized name; otherwise the original File. */
export function fileWithSanitizedAssetName(file: File): File {
  const nextName = sanitizeCoursewareAssetFileName(file.name);
  if (nextName === file.name) return file;
  return new File([file], nextName, {
    type: file.type,
    lastModified: file.lastModified,
  });
}
