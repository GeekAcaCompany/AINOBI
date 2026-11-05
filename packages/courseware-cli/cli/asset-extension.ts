// SPDX-License-Identifier: AGPL-3.0-only
import { extname } from "node:path";

import { AinobiCliError } from "./errors.ts";

export const SUPPORTED_COURSEWARE_ASSET_EXTENSIONS = new Set([
  ".html",
  ".txt",
  ".md",
  ".pdf",
  ".pptx",
  ".docx",
  ".xlsx",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".svg",
  ".tiff",
  ".mp4",
  ".mp3",
  ".aac",
  ".wav",
  ".ogg",
  ".webm",
]);

export const normalizeAssetExtension = (pathOrExt: string): string => {
  const raw = pathOrExt.startsWith(".") ? pathOrExt : extname(pathOrExt);
  const extension = raw.toLowerCase();
  if (!SUPPORTED_COURSEWARE_ASSET_EXTENSIONS.has(extension)) {
    throw new AinobiCliError(
      "UNSUPPORTED",
      `Unsupported courseware asset extension "${extension || "(none)"}".`,
      { hint: `Supported: ${Array.from(SUPPORTED_COURSEWARE_ASSET_EXTENSIONS).join(", ")}` },
    );
  }
  return extension;
};
