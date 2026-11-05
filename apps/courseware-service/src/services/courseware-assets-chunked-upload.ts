// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import busboy from "busboy";
import { z } from "zod";

import {
  abortOssMultipartUploadSession,
  completeOssMultipartUploadParts,
  deleteOssObject,
  initOssMultipartUpload,
  objectExists,
  promoteStagingObjectToAsset,
  putOssObjectBuffer,
  SUPPORTED_COURSEWARE_ASSET_EXTENSIONS,
  stagingChunkUploadObjectKey,
  uploadOssMultipartPartBuffer,
  type OssMultipartPartRecord,
} from "@ainobi/courseware-cli/cli/assets.ts";
import { sendJsonWithCors } from "../http/cors.ts";
import { ensureDataSource } from "../db/ensure-data-source.ts";
import { dataSource } from "../db/db.ts";
import { CoursewareAsset } from "../models/courseware-assets.ts";
import { assetToDto } from "./courseware-assets-service.ts";
import {
  CoursewareAssetUploadFinalizeError,
  finalizeCoursewareAssetUpload,
  orgStorageFinalizeErrorStatus,
} from "./courseware-asset-upload-finalize.ts";
import {
  CoursewareOrgAccessError,
  loadCoursewareByIdWithRequestAccess,
} from "./courseware-org-guard.ts";

const coursewareIdSchema = z.uuid();
const uploadIdSchema = z.uuid();
const md5HexSchema = z.string().regex(/^[0-9a-fA-F]{32}$/);

const defaultChunkSizeBytes = 4 * 1024 * 1024;
const defaultSessionTtlMs = 24 * 60 * 60 * 1000;
const defaultMaxUploadBytes = 500 * 1024 * 1024;

const SESSIONS_ROOT = join(tmpdir(), "cw-chunk-sessions");

type UploadSessionManifest = {
  uploadId: string;
  coursewareId: string;
  fileName: string;
  fileSize: number;
  extension: string;
  mimeType: string;
  chunkSize: number;
  totalChunks: number;
  receivedChunks: number[];
  ossStagingKey: string;
  /** OSS multipart uploadId; null for a single-chunk direct put */
  ossUploadId: string | null;
  ossParts: OssMultipartPartRecord[];
  uploadMode: "multipart" | "single_put";
  /** multipart completed or single_put on disk, safe to promote */
  ossStagingReady?: boolean;
  createdAt: string;
  expiresAt: string;
};

function numberEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function uploadChunkSizeBytes(): number {
  return Math.max(256 * 1024, numberEnv("COURSEWARE_ASSET_UPLOAD_CHUNK_SIZE_BYTES", defaultChunkSizeBytes));
}

function uploadSessionTtlMs(): number {
  return Math.max(60_000, numberEnv("COURSEWARE_ASSET_UPLOAD_SESSION_TTL_MS", defaultSessionTtlMs));
}

export function maxUploadBytes(): number {
  return numberEnv("COURSEWARE_ASSET_UPLOAD_MAX_BYTES", defaultMaxUploadBytes);
}

function totalChunksForSize(fileSize: number, chunkSize: number): number {
  return Math.max(1, Math.ceil(fileSize / chunkSize));
}

function sessionDir(uploadId: string): string {
  return join(SESSIONS_ROOT, uploadId);
}

function manifestPath(uploadId: string): string {
  return join(sessionDir(uploadId), "manifest.json");
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("error", reject);
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

async function writeManifest(manifest: UploadSessionManifest): Promise<void> {
  await writeFile(manifestPath(manifest.uploadId), JSON.stringify(manifest), "utf8");
}

async function readManifest(uploadId: string): Promise<UploadSessionManifest | null> {
  try {
    const raw = await readFile(manifestPath(uploadId), "utf8");
    return JSON.parse(raw) as UploadSessionManifest;
  } catch {
    return null;
  }
}

function isSessionExpired(manifest: UploadSessionManifest): boolean {
  return Date.now() > Date.parse(manifest.expiresAt);
}

async function cleanupOssStaging(manifest: UploadSessionManifest): Promise<void> {
  if (manifest.uploadMode === "multipart" && manifest.ossUploadId) {
    await abortOssMultipartUploadSession(manifest.ossStagingKey, manifest.ossUploadId);
  }
  await deleteOssObject(manifest.ossStagingKey);
}

async function removeSession(uploadId: string): Promise<void> {
  const manifest = await readManifest(uploadId);
  if (manifest) {
    await cleanupOssStaging(manifest).catch(() => {});
  }
  await rm(sessionDir(uploadId), { recursive: true, force: true }).catch(() => {});
}

async function cleanupExpiredSessions(): Promise<void> {
  try {
    const entries = await readdir(SESSIONS_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifest = await readManifest(entry.name);
      if (!manifest || isSessionExpired(manifest)) {
        await removeSession(entry.name);
      }
    }
  } catch {
    // sessions root may not exist yet
  }
}

function orgAccessStatus(error: unknown): number | null {
  return error instanceof CoursewareOrgAccessError ? error.status : null;
}

const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  "text/html": ".html",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "text/x-markdown": ".md",
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/svg+xml": ".svg",
  "image/tiff": ".tiff",
  "video/mp4": ".mp4",
  "audio/mpeg": ".mp3",
  "audio/aac": ".aac",
  "audio/wav": ".wav",
  "audio/ogg": ".ogg",
  "video/webm": ".webm",
};

function resolveExtensionForUpload(part: { filename: string; contentType: string }): string {
  const name = part.filename?.trim() ?? "";
  const fromName = name ? extname(name).toLowerCase() : "";
  if (fromName && SUPPORTED_COURSEWARE_ASSET_EXTENSIONS.has(fromName)) {
    return fromName;
  }
  const ct = part.contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  const fromCt = ct ? CONTENT_TYPE_TO_EXT[ct] : "";
  if (fromCt && SUPPORTED_COURSEWARE_ASSET_EXTENSIONS.has(fromCt)) {
    return fromCt;
  }
  const supported = Array.from(SUPPORTED_COURSEWARE_ASSET_EXTENSIONS).join(", ");
  throw new Error(
    `Unsupported or missing file type. Use a filename with a supported extension (${supported}) or a known Content-Type.`,
  );
}

const initBodySchema = z.object({
  coursewareId: coursewareIdSchema,
  fileName: z.string().min(1).max(255),
  fileSize: z.number().int().min(1),
  contentMd5: md5HexSchema.optional(),
  mimeType: z.string().max(255).optional(),
});

const completeBodySchema = z.object({
  uploadId: uploadIdSchema,
  contentMd5: md5HexSchema,
});

const abortBodySchema = z.object({
  uploadId: uploadIdSchema,
});

/**
 * POST `/courseware/assets/upload/init`
 * Initialize the OSS staging multipart (several chunks) or wait for the single-chunk direct put.
 */
export async function handleCoursewareAssetUploadInit(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    await ensureDataSource();
  } catch (error) {
    sendJsonWithCors(res, 503, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  void cleanupExpiredSessions();

  const parsed = initBodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    sendJsonWithCors(res, 400, { ok: false, error: parsed.error.message });
    return;
  }

  const { coursewareId, fileName, fileSize, contentMd5, mimeType } = parsed.data;
  const limit = maxUploadBytes();
  if (fileSize > limit) {
    sendJsonWithCors(res, 400, { ok: false, error: `File too large (max ${limit} bytes)` });
    return;
  }

  try {
    await loadCoursewareByIdWithRequestAccess(req, coursewareId, "write");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      orgAccessStatus(error) ??
      (message === "Unauthorized" ? 401 : message.includes("not found") ? 404 : 403);
    sendJsonWithCors(res, status, { ok: false, error: message });
    return;
  }

  let extension: string;
  try {
    extension = resolveExtensionForUpload({
      filename: fileName,
      contentType: mimeType ?? "",
    });
  } catch (error) {
    sendJsonWithCors(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    return;
  }

  if (contentMd5) {
    const existing = await dataSource.getRepository(CoursewareAsset).findOne({
      where: { coursewareId, contentMd5: contentMd5.toLowerCase() },
    });
    if (existing) {
      existing.fileName = fileName.slice(0, 255);
      await dataSource.getRepository(CoursewareAsset).save(existing);
      sendJsonWithCors(res, 200, {
        ok: true,
        deduped: true,
        asset: assetToDto(existing),
        upload: { existed: true, deduped: true },
      });
      return;
    }
  }

  const uploadId = randomUUID();
  const chunkSize = uploadChunkSizeBytes();
  const totalChunks = totalChunksForSize(fileSize, chunkSize);
  const now = Date.now();
  const contentType = (mimeType ?? "application/octet-stream").slice(0, 255);
  const ossStagingKey = stagingChunkUploadObjectKey(uploadId, extension);

  let ossUploadId: string | null = null;
  const uploadMode: UploadSessionManifest["uploadMode"] =
    totalChunks > 1 ? "multipart" : "single_put";

  try {
    if (uploadMode === "multipart") {
      const initOss = await initOssMultipartUpload(ossStagingKey, contentType);
      ossUploadId = initOss.uploadId;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJsonWithCors(res, 502, { ok: false, error: message });
    return;
  }

  const manifest: UploadSessionManifest = {
    uploadId,
    coursewareId,
    fileName: fileName.slice(0, 255),
    fileSize,
    extension,
    mimeType: contentType,
    chunkSize,
    totalChunks,
    receivedChunks: [],
    ossStagingKey,
    ossUploadId,
    ossParts: [],
    uploadMode,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + uploadSessionTtlMs()).toISOString(),
  };

  await mkdir(sessionDir(uploadId), { recursive: true });
  await writeManifest(manifest);

  sendJsonWithCors(res, 200, {
    ok: true,
    uploadId,
    chunkSize,
    totalChunks,
    expiresAt: manifest.expiresAt,
    deduped: false,
  });
}

type ParsedChunkMultipart = {
  fields: Record<string, string>;
  buffer: Buffer;
};

function parseChunkMultipartToBuffer(
  req: IncomingMessage,
  maxBytes: number,
): Promise<ParsedChunkMultipart> {
  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {};
    const parts: Buffer[] = [];
    let sawChunk = false;
    let totalBytes = 0;

    const bb = busboy({
      headers: req.headers,
      defParamCharset: "utf8",
      limits: {
        fileSize: maxBytes,
        files: 1,
        fields: 8,
        fieldSize: 4096,
        parts: 16,
      },
    });

    bb.on("field", (name, val) => {
      fields[name] = val;
    });

    bb.on("file", (name, file, _info) => {
      if (name !== "chunk") {
        file.resume();
        return;
      }
      if (sawChunk) {
        file.resume();
        reject(new Error('Only one "chunk" part is allowed.'));
        return;
      }
      sawChunk = true;
      file.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        parts.push(chunk);
      });
      file.on("error", reject);
    });

    bb.on("error", (err) => reject(err));
    bb.on("finish", () => {
      if (!sawChunk) {
        reject(new Error('Missing multipart field "chunk".'));
        return;
      }
      resolve({ fields, buffer: Buffer.concat(parts) });
    });

    req.on("error", reject);
    req.pipe(bb);
  });
}

/**
 * POST `/courseware/assets/upload/chunk`
 * Each chunk is written to OSS immediately (a multipart part or a single-chunk put); the server stores only the manifest.
 */
export async function handleCoursewareAssetUploadChunk(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const contentType = req.headers["content-type"];
  const ct = typeof contentType === "string" ? contentType : contentType?.[0];
  if (!ct?.toLowerCase().startsWith("multipart/form-data")) {
    sendJsonWithCors(res, 400, { ok: false, error: "Expected Content-Type: multipart/form-data." });
    return;
  }

  try {
    const parsed = await parseChunkMultipartToBuffer(req, uploadChunkSizeBytes() + 1024 * 1024);
    const uploadIdRaw = parsed.fields.uploadId?.trim();
    const uploadParsed = uploadIdSchema.safeParse(uploadIdRaw);
    if (!uploadParsed.success) {
      sendJsonWithCors(res, 400, { ok: false, error: 'Invalid or missing field "uploadId".' });
      return;
    }
    const uploadId = uploadParsed.data;

    const chunkIndex = Number.parseInt(parsed.fields.chunkIndex ?? "", 10);
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      sendJsonWithCors(res, 400, { ok: false, error: 'Invalid or missing field "chunkIndex".' });
      return;
    }

    const manifest = await readManifest(uploadId);
    if (!manifest) {
      sendJsonWithCors(res, 404, { ok: false, error: "Upload session not found." });
      return;
    }
    if (isSessionExpired(manifest)) {
      await removeSession(uploadId);
      sendJsonWithCors(res, 410, { ok: false, error: "Upload session expired." });
      return;
    }

    try {
      await loadCoursewareByIdWithRequestAccess(req, manifest.coursewareId, "write");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status =
        orgAccessStatus(error) ??
        (message === "Unauthorized" ? 401 : message.includes("not found") ? 404 : 403);
      sendJsonWithCors(res, status, { ok: false, error: message });
      return;
    }

    if (chunkIndex >= manifest.totalChunks) {
      sendJsonWithCors(res, 400, {
        ok: false,
        error: `chunkIndex out of range (max ${manifest.totalChunks - 1}).`,
      });
      return;
    }

    const expectedStart = chunkIndex * manifest.chunkSize;
    const expectedSize =
      chunkIndex < manifest.totalChunks - 1
        ? manifest.chunkSize
        : manifest.fileSize - expectedStart;

    if (parsed.buffer.length === 0) {
      sendJsonWithCors(res, 400, { ok: false, error: "Empty chunk." });
      return;
    }
    if (parsed.buffer.length > expectedSize) {
      sendJsonWithCors(res, 400, {
        ok: false,
        error: `Chunk ${chunkIndex} exceeds expected size (${expectedSize} bytes).`,
      });
      return;
    }

    if (manifest.receivedChunks.includes(chunkIndex)) {
      sendJsonWithCors(res, 200, {
        ok: true,
        uploadId,
        chunkIndex,
        receivedBytes: parsed.buffer.length,
        receivedChunks: manifest.receivedChunks,
        totalChunks: manifest.totalChunks,
        dedupedChunk: true,
      });
      return;
    }

    try {
      if (manifest.uploadMode === "single_put") {
        await putOssObjectBuffer(manifest.ossStagingKey, parsed.buffer, manifest.mimeType);
        manifest.ossStagingReady = true;
      } else {
        if (!manifest.ossUploadId) {
          throw new Error("Missing OSS multipart uploadId on session.");
        }
        const part = await uploadOssMultipartPartBuffer({
          objectKey: manifest.ossStagingKey,
          uploadId: manifest.ossUploadId,
          partNumber: chunkIndex + 1,
          chunk: parsed.buffer,
          contentType: manifest.mimeType,
        });
        manifest.ossParts = manifest.ossParts.filter((p) => p.partNumber !== part.partNumber);
        manifest.ossParts.push(part);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isOssStaleUploadError(message) && manifest.uploadMode === "multipart") {
        if (manifest.ossUploadId) {
          await abortOssMultipartUploadSession(manifest.ossStagingKey, manifest.ossUploadId);
        }
        manifest.receivedChunks = [];
        manifest.ossParts = [];
        manifest.ossStagingReady = false;
        const { uploadId: freshOssUploadId } = await initOssMultipartUpload(
          manifest.ossStagingKey,
          manifest.mimeType,
        );
        manifest.ossUploadId = freshOssUploadId;
        await writeManifest(manifest);
        sendJsonWithCors(res, 410, {
          ok: false,
          error: "OSS multipart session expired; please re-upload all chunks.",
          staleSession: true,
          resetAll: true,
        });
        return;
      }
      sendJsonWithCors(res, 502, { ok: false, error: message });
      return;
    }

    manifest.receivedChunks.push(chunkIndex);
    manifest.receivedChunks.sort((a, b) => a - b);
    await writeManifest(manifest);

    sendJsonWithCors(res, 200, {
      ok: true,
      uploadId,
      chunkIndex,
      receivedBytes: parsed.buffer.length,
      receivedChunks: manifest.receivedChunks,
      totalChunks: manifest.totalChunks,
    });
  } catch (error) {
    sendJsonWithCors(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * GET `/courseware/assets/upload/status?uploadId=`
 */
export async function handleCoursewareAssetUploadStatusGet(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname.replace(/\/$/, "") || "/";
  if (pathname !== "/courseware/assets/upload/status" || req.method !== "GET") {
    return false;
  }

  const uploadIdRaw = url.searchParams.get("uploadId")?.trim();
  const uploadParsed = uploadIdSchema.safeParse(uploadIdRaw);
  if (!uploadParsed.success) {
    sendJsonWithCors(res, 400, { ok: false, error: 'Invalid or missing query "uploadId".' });
    return true;
  }
  const uploadId = uploadParsed.data;

  const manifest = await readManifest(uploadId);
  if (!manifest) {
    sendJsonWithCors(res, 404, { ok: false, error: "Upload session not found." });
    return true;
  }
  if (isSessionExpired(manifest)) {
    await removeSession(uploadId);
    sendJsonWithCors(res, 410, { ok: false, error: "Upload session expired." });
    return true;
  }

  try {
    await loadCoursewareByIdWithRequestAccess(req, manifest.coursewareId, "write");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      orgAccessStatus(error) ??
      (message === "Unauthorized" ? 401 : message.includes("not found") ? 404 : 403);
    sendJsonWithCors(res, status, { ok: false, error: message });
    return true;
  }

  sendJsonWithCors(res, 200, {
    ok: true,
    uploadId: manifest.uploadId,
    coursewareId: manifest.coursewareId,
    fileName: manifest.fileName,
    fileSize: manifest.fileSize,
    chunkSize: manifest.chunkSize,
    totalChunks: manifest.totalChunks,
    receivedChunks: manifest.receivedChunks,
    expiresAt: manifest.expiresAt,
  });
  return true;
}

function assertAllChunksReceived(manifest: UploadSessionManifest): void {
  const missing: number[] = [];
  for (let i = 0; i < manifest.totalChunks; i += 1) {
    if (!manifest.receivedChunks.includes(i)) missing.push(i);
  }
  if (missing.length > 0) {
    throw new Error(`Missing chunks: ${missing.join(", ")}`);
  }
}

function isOssStaleUploadError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("upload does not exist") ||
    m.includes("upload id may be invalid") ||
    m.includes("specified key does not exist")
  );
}

async function ensureOssStagingReady(manifest: UploadSessionManifest): Promise<UploadSessionManifest> {
  // Once the staging object was assembled, a retried complete must not assemble it again: a
  // previous attempt may already have promoted it to the final key and deleted it before a later
  // step failed. Promotion then reuses the final object, or reports the missing staging object.
  if (manifest.ossStagingReady) {
    return manifest;
  }

  if (await objectExists(manifest.ossStagingKey)) {
    const next = { ...manifest, ossStagingReady: true };
    await writeManifest(next);
    return next;
  }

  if (manifest.uploadMode === "single_put") {
    throw new Error(
      "Staging object missing (upload session may have expired). Please re-upload the file.",
    );
  }

  if (!manifest.ossUploadId) {
    throw new Error("Missing OSS multipart uploadId on session.");
  }

  if (manifest.ossParts.length !== manifest.totalChunks) {
    throw new Error(
      `OSS parts incomplete (${manifest.ossParts.length}/${manifest.totalChunks}). Re-upload missing chunks.`,
    );
  }

  try {
    await completeOssMultipartUploadParts({
      objectKey: manifest.ossStagingKey,
      uploadId: manifest.ossUploadId,
      parts: manifest.ossParts,
      contentType: manifest.mimeType,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isOssStaleUploadError(message) && (await objectExists(manifest.ossStagingKey))) {
      const next = { ...manifest, ossStagingReady: true };
      await writeManifest(next);
      return next;
    }
    if (isOssStaleUploadError(message)) {
      throw new Error(
        "OSS upload session expired or was aborted. Please re-upload the file.",
      );
    }
    throw error;
  }

  const next = { ...manifest, ossStagingReady: true };
  await writeManifest(next);
  return next;
}

/**
 * POST `/courseware/assets/upload/complete`
 * Complete the OSS multipart → copy to the final MD5 object key → store in the DB (no more disk writes / OSS re-uploads).
 */
export async function handleCoursewareAssetUploadComplete(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    await ensureDataSource();
  } catch (error) {
    sendJsonWithCors(res, 503, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const parsed = completeBodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    sendJsonWithCors(res, 400, { ok: false, error: parsed.error.message });
    return;
  }

  const { uploadId, contentMd5 } = parsed.data;
  const manifest = await readManifest(uploadId);
  if (!manifest) {
    sendJsonWithCors(res, 404, { ok: false, error: "Upload session not found." });
    return;
  }
  if (isSessionExpired(manifest)) {
    await removeSession(uploadId);
    sendJsonWithCors(res, 410, { ok: false, error: "Upload session expired." });
    return;
  }

  let courseware;
  try {
    ({ courseware } = await loadCoursewareByIdWithRequestAccess(req, manifest.coursewareId, "write"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      orgAccessStatus(error) ??
      (message === "Unauthorized" ? 401 : message.includes("not found") ? 404 : 403);
    sendJsonWithCors(res, status, { ok: false, error: message });
    return;
  }

  try {
    assertAllChunksReceived(manifest);
    const readyManifest = await ensureOssStagingReady(manifest);

    const uploadedAsset = await promoteStagingObjectToAsset({
      stagingKey: readyManifest.ossStagingKey,
      contentMd5: contentMd5.toLowerCase(),
      extension: readyManifest.extension,
      fileName: readyManifest.fileName,
      fileSize: readyManifest.fileSize,
      contentType: readyManifest.mimeType,
    });

    const result = await finalizeCoursewareAssetUpload({
      req,
      coursewareId: readyManifest.coursewareId,
      coursewareOrgId: courseware.orgId ?? null,
      fileName: readyManifest.fileName,
      contentMd5: contentMd5.toLowerCase(),
      extension: readyManifest.extension,
      fileSize: readyManifest.fileSize,
      uploadedAsset,
    });

    await rm(sessionDir(uploadId), { recursive: true, force: true }).catch(() => {});
    sendJsonWithCors(res, 200, { ok: true, asset: result.asset, upload: result.upload });
  } catch (error) {
    if (error instanceof CoursewareAssetUploadFinalizeError) {
      sendJsonWithCors(res, error.status, { ok: false, error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const status = orgStorageFinalizeErrorStatus(error) ?? 400;
    sendJsonWithCors(res, status, { ok: false, error: message });
  }
}

/**
 * POST `/courseware/assets/upload/abort`
 */
export async function handleCoursewareAssetUploadAbort(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const parsed = abortBodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    sendJsonWithCors(res, 400, { ok: false, error: parsed.error.message });
    return;
  }

  const manifest = await readManifest(parsed.data.uploadId);
  if (manifest) {
    try {
      await loadCoursewareByIdWithRequestAccess(req, manifest.coursewareId, "write");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status =
        orgAccessStatus(error) ??
        (message === "Unauthorized" ? 401 : message.includes("not found") ? 404 : 403);
      sendJsonWithCors(res, status, { ok: false, error: message });
      return;
    }
  }

  await removeSession(parsed.data.uploadId);
  sendJsonWithCors(res, 200, { ok: true, aborted: true, uploadId: parsed.data.uploadId });
}
