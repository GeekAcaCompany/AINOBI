// SPDX-License-Identifier: AGPL-3.0-only
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { normalizeAssetExtension } from "./asset-extension.ts";

export interface UploadedAsset {
  file_id: string;
  file_name: string;
  extension: string;
  bytes: number;
  content_type: string;
  object_key: string;
  object_path: string;
  url: string;
  existed: boolean;
}

export interface ConvertedDocumentAsset extends UploadedAsset {
  artifact_src: string;
  slide_count: number;
  conversion: Record<string, unknown>;
}
import { AinobiCliError } from "./errors.ts";
import { cliEnv } from "./env.ts";

type HostAssetDto = {
  fileId: string;
  contentMd5: string;
  coursewareId: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  filePath: string;
  fileUrl: string;
  fileArtifactUrl: string | null;
  fileArtifactMetadata: {
    slide_count?: number;
    kind?: string;
    conversion?: Record<string, unknown>;
  } | null;
};

type HostUploadResponse = {
  ok?: boolean;
  error?: string;
  asset?: HostAssetDto;
  upload?: { existed?: boolean; cloned?: boolean; deduped?: boolean };
};

const assetUploadEndpoint = (): string => {
  const raw = cliEnv().AINOBI_COURSEWARE_ASSET_UPLOAD_URL?.trim();
  if (!raw) {
    throw new AinobiCliError(
      "USAGE",
      "Agent asset upload requires `AINOBI_COURSEWARE_ASSET_UPLOAD_URL` (set by the AINOBI host).",
      {
        hint:
          "Run `ainobi asset upload` from the courseware agent chat environment, or configure the host to inject the upload URL.",
      },
    );
  }
  return raw.replace(/\/$/, "");
};

const assetGetEndpoint = (): string => {
  const configured = cliEnv().AINOBI_COURSEWARE_ASSET_GET_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }
  const upload = cliEnv().AINOBI_COURSEWARE_ASSET_UPLOAD_URL?.trim();
  if (upload) {
    return upload.replace(/\/upload\/?$/i, "/get").replace(/\/$/, "");
  }
  throw new AinobiCliError(
    "USAGE",
    "Agent asset get requires `AINOBI_COURSEWARE_ASSET_GET_URL` (set by the AINOBI host).",
    {
      hint:
        "Run `ainobi asset get` from the courseware agent chat environment, or configure the host to inject the get URL.",
    },
  );
};

const coursewareId = (): string => {
  const id = cliEnv().AINOBI_COURSEWARE_ID?.trim();
  if (!id) {
    throw new AinobiCliError(
      "USAGE",
      "Agent asset upload requires `AINOBI_COURSEWARE_ID` (set by the AINOBI host for this chat).",
      {
        hint: "Bind the chat to a courseware record before uploading assets.",
      },
    );
  }
  return id;
};

const uploadAuthHeaders = (): Record<string, string> => {
  const key = cliEnv().AINOBI_AGENT_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
};

const hostAssetToUploadedAsset = (
  asset: HostAssetDto,
  extension: string,
  upload: HostUploadResponse["upload"],
): UploadedAsset => {
  const objectKey = asset.filePath.replace(/^\/+/, "");
  return {
    file_id: asset.contentMd5,
    file_name: asset.fileName,
    extension,
    bytes: asset.fileSize,
    content_type: asset.contentType,
    object_key: objectKey,
    object_path: `/${objectKey}`,
    url: asset.fileUrl,
    existed: Boolean(upload?.existed || upload?.deduped),
  };
};

const parseHostUploadResponse = async (
  response: Response,
  url: string,
): Promise<{ asset: HostAssetDto; upload: HostUploadResponse["upload"] }> => {
  const text = await response.text();
  let parsed: HostUploadResponse;
  try {
    parsed = JSON.parse(text) as HostUploadResponse;
  } catch {
    throw new AinobiCliError(
      "IO_ERROR",
      `Courseware asset upload returned non-JSON (HTTP ${response.status}).`,
      { hint: `POST ${url}` },
    );
  }

  if (!response.ok || parsed.ok === false || !parsed.asset) {
    throw new AinobiCliError(
      "IO_ERROR",
      parsed.error ?? `Courseware asset upload failed (HTTP ${response.status}).`,
      { hint: `POST ${url}` },
    );
  }

  return { asset: parsed.asset, upload: parsed.upload };
};

const postHostAssetUpload = async (
  filePath: string,
): Promise<{ asset: HostAssetDto; upload: HostUploadResponse["upload"] }> => {
  const absolutePath = filePath.trim();
  const fileName = basename(absolutePath);
  const endpoint = assetUploadEndpoint();
  const content = await readFile(absolutePath);

  const form = new FormData();
  form.append("coursewareId", coursewareId());
  form.append("fileName", fileName);
  form.append("file", new Blob([content]), fileName);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: uploadAuthHeaders(),
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    throw new AinobiCliError(
      "IO_ERROR",
      `Courseware asset upload request failed: ${error instanceof Error ? error.message : String(error)}`,
      { hint: `POST ${endpoint}` },
    );
  }

  return parseHostUploadResponse(response, endpoint);
};

/**
 * POST multipart to the host `/courseware/assets/upload` (OSS + DB on the host, not in the agent sandbox).
 */
export const uploadFileAssetViaHost = async (filePath: string): Promise<UploadedAsset> => {
  const extension = normalizeAssetExtension(filePath);
  const { asset, upload } = await postHostAssetUpload(filePath);
  return hostAssetToUploadedAsset(asset, extension, upload);
};

type HostGetResponse = {
  ok?: boolean;
  error?: string;
  asset?: HostAssetDto;
};

const hostAssetToResolvedAsset = (asset: HostAssetDto, extension: string): UploadedAsset => {
  const objectKey = asset.filePath.replace(/^\/+/, "");
  return {
    file_id: asset.fileId,
    file_name: asset.fileName,
    extension,
    bytes: asset.fileSize,
    content_type: asset.contentType,
    object_key: objectKey,
    object_path: `/${objectKey}`,
    url: asset.fileUrl,
    existed: true,
  };
};

const parseHostGetResponse = async (
  response: Response,
  url: string,
): Promise<HostAssetDto> => {
  const text = await response.text();
  let parsed: HostGetResponse;
  try {
    parsed = JSON.parse(text) as HostGetResponse;
  } catch {
    throw new AinobiCliError(
      "IO_ERROR",
      `Courseware asset get returned non-JSON (HTTP ${response.status}).`,
      { hint: `POST ${url}` },
    );
  }

  if (!response.ok || parsed.ok === false || !parsed.asset) {
    throw new AinobiCliError(
      "IO_ERROR",
      parsed.error ?? `Courseware asset get failed (HTTP ${response.status}).`,
      { hint: `POST ${url}` },
    );
  }

  return parsed.asset;
};

/**
 * POST JSON to the host `/courseware/assets/get` (DB row + signed read URL).
 */
export const getFileAssetViaHost = async (fileId: string): Promise<UploadedAsset> => {
  const id = fileId.trim();
  if (!id) {
    throw new AinobiCliError("USAGE", "Missing file_id (uuid).", {
      hint: "ainobi asset get <file_id>",
    });
  }

  const endpoint = assetGetEndpoint();
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...uploadAuthHeaders(),
      },
      body: JSON.stringify({ coursewareId: coursewareId(), fileId: id }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new AinobiCliError(
      "IO_ERROR",
      `Courseware asset get request failed: ${error instanceof Error ? error.message : String(error)}`,
      { hint: `POST ${endpoint}` },
    );
  }

  const asset = await parseHostGetResponse(response, endpoint);
  const extension = normalizeAssetExtension(asset.fileName || asset.filePath || ".bin");
  return hostAssetToResolvedAsset(asset, extension);
};

export const convertDocumentAssetViaHost = async (filePath: string): Promise<ConvertedDocumentAsset> => {
  const extension = normalizeAssetExtension(filePath);
  if (extension !== ".pdf" && extension !== ".pptx") {
    throw new AinobiCliError("UNSUPPORTED", "Only .pdf and .pptx assets can be converted to embedded PPT sources.");
  }

  const { asset, upload } = await postHostAssetUpload(filePath);
  const uploaded = hostAssetToUploadedAsset(asset, extension, upload);
  const meta = asset.fileArtifactMetadata;

  return {
    ...uploaded,
    artifact_src: asset.fileArtifactUrl?.trim() ?? "",
    slide_count: Number(meta?.slide_count ?? 0),
    conversion: (meta?.conversion as Record<string, unknown> | undefined) ?? {},
  };
};
