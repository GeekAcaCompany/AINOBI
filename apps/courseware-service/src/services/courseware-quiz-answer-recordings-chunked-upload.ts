// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  persistenceUrlForObjectKey,
  promoteStagingToQuizAnswerRecording,
  putOssObjectBuffer,
  SUPPORTED_QUIZ_ANSWER_RECORDING_EXTENSIONS,
  stagingChunkUploadObjectKey,
  uploadOssMultipartPartBuffer,
  type OssMultipartPartRecord,
} from "@ainobi/courseware-cli/cli/assets.ts";
import { getAuthorizedSession, requireRequestSession } from "../api-auth.ts";
import { sendJsonWithCors } from "../http/cors.ts";
import { ensureDataSource } from "../db/ensure-data-source.ts";
import { dataSource } from "../db/db.ts";
import { CoursewareQuizAnswerRecording } from "../models/courseware-quiz-answer-recordings.ts";
import {
  acquireCoursewareUploadStorageLock,
  confirmCoursewareUploadStorageLock,
  decrementCoursewareObjectStorage,
  isOrgStorageFileUploadPermissionError,
  orgStorageErrorStatus,
  releaseCoursewareUploadStorageLock,
  type UploadStorageLockHandle,
} from "./courseware-asset-org-storage.ts";
import { uploadChunkSizeBytes } from "./courseware-assets-chunked-upload.ts";
import {
  CoursewareOrgAccessError,
  loadCoursewareByIdWithRequestAccess,
} from "./courseware-org-guard.ts";
import { quizAnswerRecordingToDto } from "./courseware-quiz-answer-recordings-service.ts";

const coursewareIdSchema = z.uuid();
const uploadIdSchema = z.uuid();
const md5HexSchema = z.string().regex(/^[0-9a-fA-F]{32}$/);
const defaultSessionTtlMs = 24 * 60 * 60 * 1000;
const defaultMaxUploadBytes = 50 * 1024 * 1024;

const SESSIONS_ROOT = join(tmpdir(), "cw-quiz-answer-recording-chunk-sessions");

type UploadSessionManifest = {
  uploadId: string;
  recordingId: string;
  coursewareId: string;
  orgId: string;
  userId: string;
  fileName: string;
  fileSize: number;
  extension: string;
  mimeType: string;
  chunkSize: number;
  totalChunks: number;
  receivedChunks: number[];
  ossStagingKey: string;
  ossUploadId: string | null;
  ossParts: OssMultipartPartRecord[];
  uploadMode: "multipart" | "single_put";
  ossStagingReady?: boolean;
  sceneId: string | null;
  questionWrapperId: string | null;
  createdAt: string;
  expiresAt: string;
};

function numberEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function uploadSessionTtlMs(): number {
  return Math.max(60_000, numberEnv("COURSEWARE_QUIZ_ANSWER_RECORDING_UPLOAD_SESSION_TTL_MS", defaultSessionTtlMs));
}

function maxUploadBytes(): number {
  return numberEnv("COURSEWARE_QUIZ_ANSWER_RECORDING_UPLOAD_MAX_BYTES", defaultMaxUploadBytes);
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

function orgAccessStatus(error: unknown): number | null {
  return error instanceof CoursewareOrgAccessError ? error.status : null;
}

function resolveExtensionForUpload(args: { filename: string; contentType: string }): string {
  const fromName = extname(args.filename).toLowerCase();
  if (fromName && SUPPORTED_QUIZ_ANSWER_RECORDING_EXTENSIONS.has(fromName)) {
    return fromName;
  }
  const ct = args.contentType.toLowerCase();
  if (ct.includes("webm")) return ".webm";
  if (ct.includes("mpeg") || ct.includes("mp3")) return ".mp3";
  if (ct.includes("wav")) return ".wav";
  if (ct.includes("ogg")) return ".ogg";
  if (ct.includes("flac")) return ".flac";
  if (ct.includes("mp4") || ct.includes("m4a")) return ".m4a";
  if (ct.includes("aac")) return ".aac";
  const supported = Array.from(SUPPORTED_QUIZ_ANSWER_RECORDING_EXTENSIONS).join(", ");
  throw new Error(
    `Unsupported or missing recording file type. Use a filename with a supported extension (${supported}) or a known audio Content-Type.`,
  );
}

/** The courseware runtime's scene_id (e.g. `sc_12fcbf7311`), not a UUID. */
const sceneIdSchema = z.string().min(1).max(128).optional();

const initBodySchema = z.object({
  coursewareId: coursewareIdSchema,
  /** @deprecated The server resolves it from the courseware; when passed it must match the courseware org */
  orgId: z.uuid().optional(),
  fileName: z.string().min(1).max(255),
  fileSize: z.number().int().min(1),
  mimeType: z.string().max(255).optional(),
  sceneId: sceneIdSchema,
  questionWrapperId: z.string().min(1).max(128).optional(),
});

const completeBodySchema = z.object({
  uploadId: uploadIdSchema,
  contentMd5: md5HexSchema,
  durationSec: z.number().finite().nonnegative().optional(),
  sceneId: sceneIdSchema,
  questionWrapperId: z.string().min(1).max(128).optional(),
});

const abortBodySchema = z.object({
  uploadId: uploadIdSchema,
});

async function requireUploadOwnerSession(
  req: IncomingMessage,
  manifestUserId: string,
): Promise<void> {
  const session = await requireRequestSession(req);
  if (session.userId !== manifestUserId) {
    throw new Error("Forbidden");
  }
}

/**
 * POST `/courseware/quiz_answer_recordings/upload/init`
 */
export async function handleCoursewareQuizAnswerRecordingUploadInit(
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

  const parsed = initBodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    sendJsonWithCors(res, 400, { ok: false, error: parsed.error.message });
    return;
  }

  let userId: string;
  try {
    userId = (await requireRequestSession(req)).userId;
  } catch {
    sendJsonWithCors(res, 401, { ok: false, error: "Unauthorized" });
    return;
  }

  const {
    coursewareId,
    orgId: requestedOrgId,
    fileName,
    fileSize,
    mimeType,
    sceneId,
    questionWrapperId,
  } = parsed.data;
  const limit = maxUploadBytes();
  if (fileSize > limit) {
    sendJsonWithCors(res, 400, { ok: false, error: `File too large (max ${limit} bytes)` });
    return;
  }

  let courseware;
  try {
    ({ courseware } = await loadCoursewareByIdWithRequestAccess(req, coursewareId, "read", {
      allowEnrolledSectionRead: true,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      orgAccessStatus(error) ??
      (message === "Unauthorized" ? 401 : message.includes("not found") ? 404 : 403);
    sendJsonWithCors(res, status, { ok: false, error: message });
    return;
  }

  const orgId = courseware.orgId?.trim();
  if (!orgId) {
    sendJsonWithCors(res, 400, {
      ok: false,
      error: "Courseware is missing org_id for quiz answer recording upload",
    });
    return;
  }
  if (requestedOrgId?.trim() && requestedOrgId.trim() !== orgId) {
    sendJsonWithCors(res, 400, {
      ok: false,
      error: "Quiz answer recording org_id does not match courseware org_id",
    });
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

  const uploadId = randomUUID();
  const recordingId = randomUUID();
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
    recordingId,
    coursewareId: courseware.id,
    orgId,
    userId,
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
    sceneId: sceneId ?? null,
    questionWrapperId: questionWrapperId?.trim() ?? null,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + uploadSessionTtlMs()).toISOString(),
  };

  await mkdir(sessionDir(uploadId), { recursive: true });
  await writeManifest(manifest);

  sendJsonWithCors(res, 200, {
    ok: true,
    uploadId,
    recordingId,
    chunkSize,
    totalChunks,
    expiresAt: manifest.expiresAt,
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
        parts: 16,
      },
    });

    bb.on("field", (name, val) => {
      fields[name] = val;
    });

    bb.on("file", (name, file) => {
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

function isOssStaleUploadError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("upload does not exist") ||
    m.includes("upload id may be invalid") ||
    m.includes("specified key does not exist")
  );
}

async function assertCoursewareReadAccess(
  req: IncomingMessage,
  coursewareId: string,
): Promise<void> {
  await loadCoursewareByIdWithRequestAccess(req, coursewareId, "read", {
    allowEnrolledSectionRead: true,
  });
}

/**
 * POST `/courseware/quiz_answer_recordings/upload/chunk`
 */
export async function handleCoursewareQuizAnswerRecordingUploadChunk(
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
    const uploadParsed = uploadIdSchema.safeParse(parsed.fields.uploadId?.trim());
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
      await requireUploadOwnerSession(req, manifest.userId);
      await assertCoursewareReadAccess(req, manifest.coursewareId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status =
        orgAccessStatus(error) ??
        (message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : message.includes("not found") ? 404 : 403);
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
    if (parsed.buffer.length < expectedSize) {
      // Exact sizes keep Σ(chunks) == manifest.fileSize: completion charges
      // the manifest size, so a short chunk would charge bytes that were
      // never stored.
      sendJsonWithCors(res, 400, {
        ok: false,
        error: `Chunk ${chunkIndex} is shorter than expected (${expectedSize} bytes; got ${parsed.buffer.length}). Re-send the full chunk.`,
      });
      return;
    }

    if (manifest.receivedChunks.includes(chunkIndex)) {
      sendJsonWithCors(res, 200, {
        ok: true,
        uploadId,
        chunkIndex,
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
      receivedChunks: manifest.receivedChunks,
      totalChunks: manifest.totalChunks,
    });
  } catch (error) {
    sendJsonWithCors(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
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
  await completeOssMultipartUploadParts({
    objectKey: manifest.ossStagingKey,
    uploadId: manifest.ossUploadId,
    parts: manifest.ossParts,
    contentType: manifest.mimeType,
  });
  const next = { ...manifest, ossStagingReady: true };
  await writeManifest(next);
  return next;
}

/**
 * GET `/courseware/quiz_answer_recordings/upload/status?uploadId=`
 */
export async function handleCoursewareQuizAnswerRecordingUploadStatusGet(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const uploadParsed = uploadIdSchema.safeParse(url.searchParams.get("uploadId")?.trim());
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
    await requireUploadOwnerSession(req, manifest.userId);
    await assertCoursewareReadAccess(req, manifest.coursewareId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      orgAccessStatus(error) ??
      (message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : message.includes("not found") ? 404 : 403);
    sendJsonWithCors(res, status, { ok: false, error: message });
    return true;
  }
  sendJsonWithCors(res, 200, {
    ok: true,
    uploadId: manifest.uploadId,
    recordingId: manifest.recordingId,
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

/**
 * POST `/courseware/quiz_answer_recordings/upload/complete`
 */
export async function handleCoursewareQuizAnswerRecordingUploadComplete(
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

  const { uploadId, contentMd5, durationSec, sceneId, questionWrapperId } = parsed.data;
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
    await requireUploadOwnerSession(req, manifest.userId);
    await assertCoursewareReadAccess(req, manifest.coursewareId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      orgAccessStatus(error) ??
      (message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : message.includes("not found") ? 404 : 403);
    sendJsonWithCors(res, status, { ok: false, error: message });
    return;
  }

  try {
    assertAllChunksReceived(manifest);
    // Org storage gate + accounting: lock before the promote (quota rejection
    // aborts before any server-side copy), confirm after the row is saved,
    // roll the row (and best-effort the promoted object) back if the confirm
    // fails — same contract as courseware asset finalize.
    const accessToken = getAuthorizedSession(req)?.accessToken ?? null;
    // Idempotent completion: concurrent complete requests for the same
    // recordingId would otherwise each confirm a quota lock while only one
    // row survives (recordingId is the PK) — the loser's charge is never
    // refunded. Serialize by recordingId; an existing row short-circuits.
    const existingRecording = await dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `quiz-recording:${manifest.recordingId}`,
      ]);
      return manager.findOne(CoursewareQuizAnswerRecording, {
        where: { recordingId: manifest.recordingId },
      });
    });
    if (existingRecording) {
      await rm(sessionDir(uploadId), { recursive: true, force: true }).catch(() => {});
      sendJsonWithCors(res, 200, {
        ok: true,
        recording: quizAnswerRecordingToDto(existingRecording),
        dedupedCompletion: true,
      });
      return;
    }
    let storageLock: UploadStorageLockHandle | null = null;
    try {
      storageLock = await acquireCoursewareUploadStorageLock(
        accessToken,
        manifest.orgId,
        manifest.fileSize,
        `quiz-recording:${manifest.recordingId}`,
      );
    } catch (lockError) {
      // Learners complete their own recordings but their token lacks
      // organization:file_upload — blocking here would break answer saving
      // entirely. Permission failures degrade to lockless (recording stays
      // unaccounted, pre-change behavior); real quota rejections still fail.
      if (!isOrgStorageFileUploadPermissionError(lockError)) {
        throw lockError;
      }
      console.warn(
        `[org-storage] quiz recording proceeding without storage accounting ` +
          `(caller lacks organization:file_upload) recordingId=${manifest.recordingId}`,
      );
    }
    let readyManifest;
    let promoted;
    try {
      readyManifest = await ensureOssStagingReady(manifest);
      promoted = await promoteStagingToQuizAnswerRecording({
        stagingKey: readyManifest.ossStagingKey,
        orgId: readyManifest.orgId,
        recordingId: readyManifest.recordingId,
        extension: readyManifest.extension,
        fileName: readyManifest.fileName,
        fileSize: readyManifest.fileSize,
        contentType: readyManifest.mimeType,
      });
    } catch (stagingError) {
      // Between the pre-lock and the row save anything failing must give the
      // lock back — a leaked pre-lock would pin quota until its TTL.
      await releaseCoursewareUploadStorageLock(accessToken, storageLock);
      throw stagingError;
    }

    const repo = dataSource.getRepository(CoursewareQuizAnswerRecording);
    const row = repo.create({
      recordingId: readyManifest.recordingId,
      orgId: readyManifest.orgId,
      coursewareId: readyManifest.coursewareId,
      userId: readyManifest.userId,
      sceneId: sceneId ?? readyManifest.sceneId,
      questionWrapperId: questionWrapperId?.trim() ?? readyManifest.questionWrapperId,
      fileName: readyManifest.fileName,
      fileSize: readyManifest.fileSize,
      contentType: promoted.content_type,
      contentMd5: contentMd5.toLowerCase(),
      filePath: promoted.object_key,
      // Stable key-derived URL (never signed) — DTOs/scoring re-sign at read.
      fileUrl: persistenceUrlForObjectKey(promoted.object_key),
      durationSec: typeof durationSec === "number" ? durationSec : null,
    });
    // Confirm the charge BEFORE saving the row, then persist row + accounted
    // marker atomically: the marker can never lag a landed charge (which
    // would make deletes skip a real refund), and a failed row save after a
    // landed charge is compensated by an immediate refund.
    try {
      await confirmCoursewareUploadStorageLock(
        accessToken,
        storageLock,
        readyManifest.fileSize,
      );
    } catch (confirmError) {
      await releaseCoursewareUploadStorageLock(accessToken, storageLock);
      // The recording object is content-addressed per recordingId — deleting
      // it is safe here (this request created it; no other row can reference
      // the key), but the failure itself is an upstream accounting outage,
      // not a client error: 502 so clients retry instead of discarding.
      await deleteOssObject(promoted.object_key).catch(() => {});
      const message = confirmError instanceof Error ? confirmError.message : String(confirmError);
      sendJsonWithCors(res, 502, {
        ok: false,
        error: `Organization storage accounting failed, recording rolled back — please retry: ${message}`,
      });
      return;
    }
    row.storageAccounted = storageLock !== null;
    // INSERT ... ON CONFLICT DO NOTHING: a completion that lost the race
    // above (row appeared between the advisory check and here) must not
    // overwrite the winner's row; its already-confirmed charge is refunded.
    // The insert joins the courseware-row advisory lock (same lock the
    // deletion transaction holds) and re-validates the courseware: without
    // it a completion that passed its access check just before a deletion
    // lands an orphan row whose confirmed charge can never be reclaimed.
    let insertResult;
    let coursewareGone = false;
    await dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `courseware-row:${readyManifest.coursewareId}`,
      ]);
      const liveCourseware = await manager
        .createQueryBuilder()
        .select("1")
        .from("courseware", "c")
        .where("c.id = :id", { id: readyManifest.coursewareId })
        .limit(1)
        .getRawMany();
      if (liveCourseware.length === 0) {
        coursewareGone = true;
        return;
      }
      insertResult = await manager
        .createQueryBuilder()
        .insert()
        .into(CoursewareQuizAnswerRecording)
        .values(row)
        .returning("recording_id")
        .orIgnore("(recording_id)")
        .execute();
    });
    if (coursewareGone) {
      if (storageLock) {
        await decrementCoursewareObjectStorage(
          accessToken,
          readyManifest.orgId,
          readyManifest.fileSize,
          `quiz-recording-orphaned:${readyManifest.recordingId}`,
        );
      }
      await deleteOssObject(promoted.object_key).catch(() => {});
      sendJsonWithCors(res, 404, {
        ok: false,
        error: "Courseware was deleted before the recording completed.",
      });
      return;
    }
    const inserted = ((insertResult?.raw as Array<{ recording_id: string }>) ?? []).length > 0;
    if (!inserted) {
      if (storageLock) {
        await decrementCoursewareObjectStorage(
          accessToken,
          readyManifest.orgId,
          readyManifest.fileSize,
          `quiz-recording-raced:${readyManifest.recordingId}`,
        );
      }
      const winner = await repo.findOne({
        where: { recordingId: readyManifest.recordingId },
      });
      await rm(sessionDir(uploadId), { recursive: true, force: true }).catch(() => {});
      sendJsonWithCors(res, 200, {
        ok: true,
        recording: winner ? quizAnswerRecordingToDto(winner) : null,
        dedupedCompletion: true,
      });
      return;
    }
    await rm(sessionDir(uploadId), { recursive: true, force: true }).catch(() => {});
    sendJsonWithCors(res, 200, { ok: true, recording: quizAnswerRecordingToDto(row) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = orgStorageErrorStatus(error) ?? 400;
    sendJsonWithCors(res, status, { ok: false, error: message });
  }
}

/**
 * POST `/courseware/quiz_answer_recordings/upload/abort`
 */
export async function handleCoursewareQuizAnswerRecordingUploadAbort(
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
      await requireUploadOwnerSession(req, manifest.userId);
      await assertCoursewareReadAccess(req, manifest.coursewareId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status =
        orgAccessStatus(error) ??
        (message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : message.includes("not found") ? 404 : 403);
      sendJsonWithCors(res, status, { ok: false, error: message });
      return;
    }
  }

  await removeSession(parsed.data.uploadId);
  sendJsonWithCors(res, 200, { ok: true, aborted: true, uploadId: parsed.data.uploadId });
}
