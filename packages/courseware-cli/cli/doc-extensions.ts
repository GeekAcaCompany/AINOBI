// SPDX-License-Identifier: AGPL-3.0-only
import { extname } from "node:path";

/** Extensions supported by `ainobi doc read` (markitdown-ts converters). */
export const DOC_READ_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".xlsx",
  ".html",
  ".htm",
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".xml",
  ".rss",
  ".atom",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
  ".mp3",
  ".wav",
  ".ogg",
  ".aac",
  ".m4a",
  ".flac",
  ".ipynb",
  ".zip",
]);

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
]);

export const normalizeDocReadExtension = (extension: string): string => {
  const raw = extension.trim().toLowerCase();
  if (!raw) return "";
  return raw.startsWith(".") ? raw : `.${raw}`;
};

export const extensionFromPath = (filePath: string): string =>
  normalizeDocReadExtension(extname(filePath));

export const isDocReadExtensionSupported = (extension: string): boolean =>
  DOC_READ_EXTENSIONS.has(normalizeDocReadExtension(extension));

export const isDocReadImageExtension = (extension: string): boolean =>
  IMAGE_EXTENSIONS.has(normalizeDocReadExtension(extension));

export const formatDocReadExtensionsHint = (): string =>
  [...DOC_READ_EXTENSIONS].sort().join(", ");
