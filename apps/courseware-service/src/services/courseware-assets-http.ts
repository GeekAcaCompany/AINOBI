// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import busboy from "busboy";
import { In, Like } from "typeorm";
import { z } from "zod";

import {
  activeStorageBackend,
  storageBackendForStoredObjectUrl,
  SUPPORTED_COURSEWARE_ASSET_EXTENSIONS,
  signObjectReadUrl,
} from "@ainobi/courseware-cli/cli/assets.ts";
import { signS3ObjectReadUrl } from "./aws-s3-presign.ts";
import {
  bucketFromOciUrl,
  coursewareContentReferencesObjectKey,
  evidenceRankForCoursewarePresign,
  isAgentDirectOssObjectKey,
  isAwsS3ObjectKey,
  isOssKeyAllowedForCoursewarePresign,
  normalizeObjectKeyFromInput,
  PUBLIC_BY_DESIGN_KEY_PREFIXES,
  publicBucketEchoUrlForCoursewarePresign,
  publicEchoUrlForCoursewarePresign,
} from "./courseware-asset-presign.ts";
import { getAuthorizedSession } from "../api-auth.ts";
import { actorFromSession } from "../auth/ainobi-org-access.ts";
import { sendJsonWithCors } from "../http/cors.ts";
import { ensureDataSource } from "../db/ensure-data-source.ts";
import { dataSource } from "../db/db.ts";
import { CoursewareAsset } from "../models/courseware-assets.ts";
import { recordCoursewareAuditLog } from "./courseware-audit-log-service.ts";
import {
  assetToDto,
  findCoursewareAssetByFileId,
  findCoursewareAssetByFileIdOnly,
  listCoursewareAssets,
} from "./courseware-assets-service.ts";
import {
  decrementCoursewareObjectStorage,
  markAssetRefundClaimComplete,
} from "./courseware-asset-org-storage.ts";
import {
  CoursewareAssetUploadFinalizeError,
  finalizeCoursewareAssetUpload,
} from "./courseware-asset-upload-finalize.ts";
import { readCoursewareAssetText } from "./courseware-asset-read-text.ts";
import {
  handleCoursewareAssetUploadAbort,
  handleCoursewareAssetUploadChunk,
  handleCoursewareAssetUploadComplete,
  handleCoursewareAssetUploadInit,
} from "./courseware-assets-chunked-upload.ts";
import {
  CoursewareOrgAccessError,
  loadCoursewareByIdWithRequestAccess,
} from "./courseware-org-guard.ts";
import { getCoursewareEntityById } from "./courseware-service.ts";
import { verifyCoursewareRenderToken } from "./courseware-render-token.ts";
import type { Courseware } from "../models/courseware.ts";

export { assetToDto } from "./courseware-assets-service.ts";

/**
 * aliyun evidence falls back to active (oci_s3): after the migration the bytes are all in example-storage and the aliyun bucket
 * is abandoned (everything is OCI-signed — the same handling as the existing fallback of AWS-host evidence to active).
 * Otherwise aliyun URL evidence would make presign produce "freshly signed Aliyun URLs" (short-lived Expires,
 * all dead once the aliyun credentials/bucket go offline).
 */
const backendForStoredObjectUrl = (value: string | null | undefined) => {
  // [aliyun-test] Single private bucket architecture (example-storage, Shenzhen): with STORAGE_BACKEND=aliyun_oss
  // the bytes of aliyun evidence are in this bucket, signed directly by the active backend; no more fallback to oci_s3 (a mirror-stack leftover).
  if (activeStorageBackend() === "aliyun_oss") return "aliyun_oss";
  const backend = storageBackendForStoredObjectUrl(value);
  return backend === "aliyun_oss" ? "oci_s3" : backend;
};

const coursewareIdSchema = z.uuid();
const fileIdSchema = z.uuid();

function orgAccessStatus(error: unknown): number | null {
  return error instanceof CoursewareOrgAccessError ? error.status : null;
}

async function auditAssetAction(
  action: "asset.upload" | "asset.delete" | "asset.presign",
  args: {
    coursewareId: string;
    orgId: string | null;
    fileId?: string;
    detail?: Record<string, unknown>;
  },
  req: IncomingMessage,
): Promise<void> {
  const session = getAuthorizedSession(req);
  if (!session) {
    return;
  }
  await recordCoursewareAuditLog({
    action,
    actor: actorFromSession(session),
    orgId: args.orgId ?? undefined,
    coursewareId: args.coursewareId,
    assetFileId: args.fileId,
    detail: args.detail,
  });
}

function readJsonBody<T>(req: IncomingMessage): Promise<T> {
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

const defaultMaxUploadBytes = 500 * 1024 * 1024;

function maxUploadBytes(): number {
  const n = Number(process.env.COURSEWARE_ASSET_UPLOAD_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : defaultMaxUploadBytes;
}

type ParsedMultipart = {
  fields: Record<string, string>;
  md5Hex: string;
  originalName: string;
  partMime: string;
};

function normalizeUploadedFileName(name: string): string {
  const trimmed = name.trim() || "upload";
  // multipart filenames are often parsed as latin1; when they are really UTF-8 bytes they turn into mojibake (e.g. ç¾å…)
  if (/[\u00c0-\u00ff]/.test(trimmed) && !/[\u4e00-\u9fff]/.test(trimmed)) {
    const repaired = Buffer.from(trimmed, "latin1").toString("utf8");
    if (repaired && !repaired.includes("\uFFFD")) {
      return repaired;
    }
  }
  return trimmed;
}

function parseMultipartToTempFile(
  req: IncomingMessage,
  tmpFile: string,
  maxBytes: number,
): Promise<ParsedMultipart> {
  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {};
    let sawFile = false;
    let fileWrite: Promise<void> = Promise.resolve();
    let md5Hex = "";
    let rawOriginalName = "upload";
    let partMime = "application/octet-stream";

    const bb = busboy({
      headers: req.headers,
      defParamCharset: "utf8",
      limits: {
        fileSize: maxBytes,
        files: 1,
        fields: 16,
        fieldSize: 4096,
        parts: 32,
      },
    });

    bb.on("field", (name, val) => {
      fields[name] = val;
    });

    bb.on("file", (name, file, info) => {
      if (name !== "file") {
        file.resume();
        return;
      }
      if (sawFile) {
        file.resume();
        reject(new Error('Only one "file" part is allowed.'));
        return;
      }
      sawFile = true;
      rawOriginalName = (info.filename && String(info.filename).trim()) || "upload";
      partMime = (info.mimeType && String(info.mimeType)) || "application/octet-stream";

      const hasher = createHash("md5");
      const counter = new Transform({
        transform(chunk, _enc, cb) {
          hasher.update(chunk);
          cb(null, chunk);
        },
      });

      fileWrite = pipeline(file, counter, createWriteStream(tmpFile)).then(() => {
        md5Hex = hasher.digest("hex");
      });
    });

    bb.on("error", (err) => reject(err));
    bb.on("partsLimit", () => reject(new Error("Too many multipart parts.")));
    bb.on("filesLimit", () => reject(new Error("Too many files in multipart request.")));
    bb.on("fieldsLimit", () => reject(new Error("Too many form fields.")));

    bb.on("finish", () => {
      void fileWrite
        .then(() => {
          if (!sawFile) {
            reject(new Error('Missing multipart field "file".'));
            return;
          }
          resolve({
            fields,
            md5Hex,
            originalName: normalizeUploadedFileName(fields.fileName?.trim() || rawOriginalName),
            partMime,
          });
        })
        .catch((err) => reject(err));
    });

    req.on("error", reject);
    req.pipe(bb);
  });
}

/**
 * POST `/courseware/assets/upload`, `multipart/form-data`:
 * - field `coursewareId` (uuid, required)
 * - field `fileName` (the original utf-8 file name, optional; takes priority over the multipart `filename` header)
 * `createdBy` / `updatedBy` are written from the server session; never trust client fields.
 * - file field name `file` (required)
 *
 * Parses multipart as a stream, temp disk + incremental MD5, OSS through `uploadLocalFileAsset`.
 */
export async function handleCoursewareAssetUpload(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    await ensureDataSource();
  } catch (error) {
    sendJsonWithCors(res, 503, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const contentType = req.headers["content-type"];
  const ct = typeof contentType === "string" ? contentType : contentType?.[0];
  if (!ct?.toLowerCase().startsWith("multipart/form-data")) {
    sendJsonWithCors(res, 400, { ok: false, error: "Expected Content-Type: multipart/form-data." });
    return;
  }

  const tmpDir = await mkdtemp(join(tmpdir(), "cw-asset-"));
  const tmpFile = join(tmpDir, "upload.bin");
  const limit = maxUploadBytes();

  try {
    const parsed = await parseMultipartToTempFile(req, tmpFile, limit);
    const fileSize = (await stat(tmpFile)).size;
    if (fileSize === 0) {
      sendJsonWithCors(res, 400, { ok: false, error: 'Empty file in multipart field "file".' });
      return;
    }
    if (fileSize > limit) {
      sendJsonWithCors(res, 400, { ok: false, error: `Request body too large (max ${limit} bytes)` });
      return;
    }

    const coursewareRaw = parsed.fields.coursewareId?.trim();
    const coursewareParsed = coursewareIdSchema.safeParse(coursewareRaw);
    if (!coursewareParsed.success) {
      sendJsonWithCors(res, 400, {
        ok: false,
        error: 'Invalid or missing multipart field "coursewareId" (uuid required).',
      });
      return;
    }
    const coursewareId = coursewareParsed.data;

    let courseware;
    try {
      ({ courseware } = await loadCoursewareByIdWithRequestAccess(req, coursewareId, "write"));
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
        filename: parsed.originalName,
        contentType: parsed.partMime,
      });
    } catch (error) {
      sendJsonWithCors(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      return;
    }

    const fileName = parsed.originalName.slice(0, 255);

    try {
      const result = await finalizeCoursewareAssetUpload({
        req,
        coursewareId,
        coursewareOrgId: courseware.orgId ?? null,
        fileName,
        contentMd5: parsed.md5Hex.toLowerCase(),
        extension,
        fileSize,
        tmpFilePath: tmpFile,
      });
      sendJsonWithCors(res, 200, { ok: true, asset: result.asset, upload: result.upload });
      return;
    } catch (error) {
      if (error instanceof CoursewareAssetUploadFinalizeError) {
        sendJsonWithCors(res, error.status, { ok: false, error: error.message });
        return;
      }
      throw error;
    }
  } catch (error) {
    sendJsonWithCors(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

const listBodySchema = z.object({
  coursewareId: coursewareIdSchema,
  pageNumber: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  fileName: z.string().max(255).optional(),
  order: z.enum(["asc", "desc"]).optional().default("desc"),
});

const deleteBodySchema = z.object({
  coursewareId: coursewareIdSchema,
  fileId: fileIdSchema,
});

const batchPresignBodySchema = z.object({
  /**
   * Optional (2026-09-09): signing default assets without a courseware context (the student dashboard's default AI teacher,
   * the AI teacher create page preview on the manage side). When omitted it enters publicOnlyMode — every key must match
   * PUBLIC_BY_DESIGN_KEY_PREFIXES (default assets public by design, which never had access control),
   * otherwise each is refused. With a coursewareId the behavior is unchanged (courseware read permission check).
   */
  coursewareId: coursewareIdSchema.optional(),
  filePaths: z.array(z.string().min(1).max(512)).min(1).max(100),
  /** Signature lifetime in seconds, default 86400 (24 hours); range 60 to 7 days (same as the CLI's `signObjectReadUrl`) */
  expiresIn: z.coerce.number().int().min(60).max(60 * 60 * 24 * 7).optional(),
  /**
   * `internal`: the OSS branch's signed URLs swap to the region's internal host (reachable only from Aliyun ECS/FC in the same region).
   * Only for the FC headless render page (`courseware-renderer?hf=1`) when fetching scene assets;
   * a real student browser must never pass this value (the internal host is unreachable from the internet, so passing it by mistake just makes resources fail to load,
   * not an auth/privilege problem — asset visibility is still decided entirely by the courseware access check below).
   */
  network: z.enum(["public", "internal"]).optional(),
  /**
   * Dedicated to the FC headless render page: a short-lived HMAC from the same source as `GET /courseware?render_token=`,
   * whose user permission was already checked when the task was created. Allows batch presigning of scene assets without a login session.
   * Required with `network: "internal"` (so a public browser can't ask for the internal host by mistake).
   */
  render_token: z.string().min(1).max(512).optional(),
});

const getBodySchema = z.object({
  coursewareId: coursewareIdSchema,
  fileId: fileIdSchema,
  /** Signature lifetime in seconds, default 86400 (24 hours); range 60 to 7 days */
  expiresIn: z.coerce.number().int().min(60).max(60 * 60 * 24 * 7).optional(),
});

const readTextBodySchema = z.object({
  coursewareId: coursewareIdSchema,
  /** OSS/S3 object key or signed courseware asset URL. */
  filePath: z.string().min(1).max(512),
});

function pathnameFromUrl(url: string | undefined): string {
  if (!url) return "/";
  return new URL(url, "http://localhost").pathname.replace(/\/$/, "") || "/";
}

/**
 * Batch presign auth: normal write session, or narrow `render_token` (headless renderer).
 * Internal OSS host presign is restricted to the render_token path.
 */
export async function loadCoursewareForBatchPresign(
  req: IncomingMessage,
  coursewareId: string,
  options: { renderToken?: string; network?: "public" | "internal" },
): Promise<Courseware> {
  const renderToken = options.renderToken?.trim();
  if (options.network === "internal" && !renderToken) {
    throw new Error("render_token is required when network is internal");
  }
  if (renderToken) {
    const courseware = await getCoursewareEntityById(coursewareId);
    if (!courseware) {
      throw new Error("courseware not found");
    }
    if (!verifyCoursewareRenderToken(renderToken, courseware.id)) {
      throw new Error("invalid or expired render_token");
    }
    return courseware;
  }
  // presign is a read (it signs a GET URL), so the access level must be read:
  // all three read flows — anonymous public courseware preview / students (through a course binding) / organization members — must pass.
  // Using write would 403 every student and anonymous preview ("no access to this organization
  // courseware"), so avatars/Live2D and narration audio couldn't be signed — every resource on the private bucket dies.
  // An anonymous user + non-public courseware is still refused in the read branch, so the privilege surface is unchanged; the render_token path returned above.
  const { courseware } = await loadCoursewareByIdWithRequestAccess(req, coursewareId, "read");
  return courseware;
}

export function batchPresignAccessStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "invalid or expired render_token") return 401;
  if (message === "render_token is required when network is internal") return 400;
  if (message.includes("not found")) return 404;
  if (message === "Unauthorized") return 401;
  if (error instanceof CoursewareOrgAccessError) return error.status;
  return 403;
}

/**
 * POST `/courseware/assets/list` — JSON: `coursewareId` (required), `pageNumber`, `pageSize`, `fileName`, `order`.
 */
async function handleCoursewareAssetsList(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsed = listBodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    sendJsonWithCors(res, 400, { ok: false, error: parsed.error.message });
    return;
  }
  const { coursewareId, pageNumber, pageSize, fileName, order } = parsed.data;
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
  const result = await listCoursewareAssets({
    coursewareId,
    pageNumber,
    pageSize,
    fileName,
    order,
  });
  sendJsonWithCors(res, 200, { ok: true, ...result });
}

const assetsListQuerySchema = listBodySchema;

/**
 * GET `/courseware/assets?coursewareId=...` — the same pagination parameters as POST list (query string).
 */
export async function handleCoursewareAssetsGet(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname.replace(/\/$/, "") || "/";
  if (pathname !== "/courseware/assets" || req.method !== "GET") {
    return false;
  }

  try {
    await ensureDataSource();
  } catch (error) {
    sendJsonWithCors(res, 503, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }

  const parsed = assetsListQuerySchema.safeParse({
    coursewareId: url.searchParams.get("coursewareId") ?? undefined,
    pageNumber: url.searchParams.get("pageNumber") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
    fileName: url.searchParams.get("fileName") ?? undefined,
    order: url.searchParams.get("order") ?? undefined,
  });
  if (!parsed.success) {
    sendJsonWithCors(res, 400, { ok: false, error: parsed.error.message });
    return true;
  }

  const { coursewareId, pageNumber, pageSize, fileName, order } = parsed.data;
  try {
    await loadCoursewareByIdWithRequestAccess(req, coursewareId, "write");
    const result = await listCoursewareAssets({
      coursewareId,
      pageNumber,
      pageSize,
      fileName,
      order,
    });
    sendJsonWithCors(res, 200, { ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      orgAccessStatus(error) ??
      (message === "Unauthorized" ? 401 : message.includes("not found") ? 404 : 403);
    sendJsonWithCors(res, status, { ok: false, error: message });
  }
  return true;
}

/**
 * POST `/courseware/assets/delete` — JSON: `coursewareId`, `fileId` (uuid).
 */
async function handleCoursewareAssetsDelete(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsed = deleteBodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    sendJsonWithCors(res, 400, { ok: false, error: parsed.error.message });
    return;
  }
  const { coursewareId, fileId } = parsed.data;
  let courseware;
  try {
    ({ courseware } = await loadCoursewareByIdWithRequestAccess(req, coursewareId, "write"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      orgAccessStatus(error) ??
      (message === "Unauthorized" ? 401 : message.includes("not found") ? 404 : 403);
    sendJsonWithCors(res, status, { ok: false, error: message });
    return;
  }
  const repo = dataSource.getRepository(CoursewareAsset);
  const row = await repo.findOne({ where: { fileId, coursewareId } });
  if (!row) {
    sendJsonWithCors(res, 404, { ok: false, error: "Asset not found for this courseware." });
    return;
  }
  const session = getAuthorizedSession(req);
  const effectiveOrgId = courseware.orgId ?? row.orgId;
  // Refund decision INSIDE the removal transaction: (org, md5) advisory
  // lock + remaining count + durable claim — a same-content upload landing
  // after the commit charges its own bytes while the owed refund below
  // still returns the old ones.
  let refundOwed = false;
  if (effectiveOrgId) {
    await dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `courseware-asset:${effectiveOrgId}:${row.contentMd5}`,
      ]);
      const remaining = await manager
        .createQueryBuilder()
        .select("1")
        .from(CoursewareAsset, "a")
        .where(
          "a.org_id = :orgId AND a.content_md5 = :md5 AND a.file_id <> :fileId",
          { orgId: effectiveOrgId, md5: row.contentMd5, fileId: row.fileId },
        )
        .limit(1)
        .getRawMany();
      if (remaining.length === 0) {
        const { CoursewareAssetRefundClaim } = await import(
          "../models/courseware-asset-refund-claims.ts"
        );
        const claimResult = await manager
          .createQueryBuilder()
          .insert()
          .into(CoursewareAssetRefundClaim)
          .values({ orgId: effectiveOrgId, contentMd5: row.contentMd5 })
          .orIgnore("(org_id, content_md5)")
          .returning("org_id")
          .execute();
        if ((claimResult.raw as unknown[]).length > 0) {
          refundOwed = true; // fresh claim → this caller owes the decrement
        } else {
          // Existing claim: owed only when its refund never completed
          // (retryable reconciliation state).
          const existing = await manager.findOne(CoursewareAssetRefundClaim, {
            where: { orgId: effectiveOrgId, contentMd5: row.contentMd5 },
          });
          refundOwed = existing ? !existing.refunded : false;
        }
      }
      // The removal ALWAYS runs — only the refund decision is conditional.
      await manager.remove(row);
    });
  } else {
    await repo.remove(row);
  }
  if (refundOwed && effectiveOrgId) {
    const refunded = await decrementCoursewareObjectStorage(
      session?.accessToken,
      effectiveOrgId,
      Number(row.fileSize ?? 0),
      `courseware-asset:${row.contentMd5}`,
    );
    if (refunded) {
      await markAssetRefundClaimComplete(effectiveOrgId, row.contentMd5);
    }
  }
  await auditAssetAction(
    "asset.delete",
    { coursewareId: courseware.id, orgId: courseware.orgId ?? row.orgId, fileId },
    req,
  );
  sendJsonWithCors(res, 200, { ok: true, deleted: { fileId, coursewareId } });
}

/**
 * POST `/courseware/assets/get` — JSON: `coursewareId`, `fileId` (uuid), optional `expiresIn`.
 * Returns the asset row plus a fresh signed `fileUrl` for agent/CLI use.
 */
async function handleCoursewareAssetsGetById(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsed = getBodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    sendJsonWithCors(res, 400, { ok: false, error: parsed.error.message });
    return;
  }
  const { coursewareId: requestedCoursewareId, fileId, expiresIn } = parsed.data;
  const expires = expiresIn ?? 60 * 60 * 24;

  let row = await findCoursewareAssetByFileId(requestedCoursewareId, fileId);
  if (!row) {
    row = await findCoursewareAssetByFileIdOnly(fileId);
  }
  if (!row) {
    sendJsonWithCors(res, 404, {
      ok: false,
      error: `Asset not found (fileId=${fileId}, coursewareId=${requestedCoursewareId}).`,
    });
    return;
  }

  const assetCoursewareId = row.coursewareId;
  let courseware;
  try {
    ({ courseware } = await loadCoursewareByIdWithRequestAccess(req, assetCoursewareId, "write"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      orgAccessStatus(error) ??
      (message === "Unauthorized" ? 401 : message.includes("not found") ? 404 : 403);
    sendJsonWithCors(res, status, { ok: false, error: message });
    return;
  }

  const objectKey = row.filePath.trim().replace(/^\/+/, "");
  if (!objectKey) {
    sendJsonWithCors(res, 502, { ok: false, error: "Asset has no storage path." });
    return;
  }

  let fileUrl: string;
  try {
    fileUrl = await signObjectReadUrl(objectKey, expires, {
      // Grayscale transition: presign against the backend that actually
      // holds the bytes (stored URL host family; active backend for bare keys).
      // After the migration the bytes of old AWS prefixes (organization/ etc.) are all in OCI — the AWS branch would produce
      // mixed "OCI host + AWS region signature" URLs (400 region malformed), so it was removed.
      backend: backendForStoredObjectUrl(row.fileUrl || objectKey),
    });
  } catch (error) {
    sendJsonWithCors(res, 502, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  await auditAssetAction(
    "asset.presign",
    {
      coursewareId: courseware.id,
      orgId: courseware.orgId,
      fileId,
      detail: {
        via: "asset.get",
        ...(assetCoursewareId !== requestedCoursewareId
          ? { requestedCoursewareId, resolvedCoursewareId: assetCoursewareId }
          : {}),
      },
    },
    req,
  );

  sendJsonWithCors(res, 200, {
    ok: true,
    asset: { ...assetToDto(row), fileUrl },
    ...(assetCoursewareId !== requestedCoursewareId
      ? {
          resolvedCoursewareId: assetCoursewareId,
          requestedCoursewareId,
        }
      : {}),
  });
}

/**
 * POST `/courseware/assets/batch_presign_urls` — JSON: `coursewareId`, `filePaths` (URLs or object keys),
 * optional `expiresIn`, optional `network` (with `internal` the OSS branch's signed URLs use the region's internal host; see the schema comment).
 * OSS (`raw/`, `artifact/`): paths registered in the asset library, or agent direct-upload OSS keys referenced in the courseware scene JSON.
 * S3 (`courseware_assets/`, `tts_outputs/`, `organization/`): S3-presigned directly after checking courseware write permission (unaffected by `network`).
 */
async function handleCoursewareAssetsBatchPresign(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsed = batchPresignBodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    sendJsonWithCors(res, 400, { ok: false, error: parsed.error.message });
    return;
  }
  const { coursewareId, filePaths, expiresIn, network, render_token: renderToken } = parsed.data;
  const expires = expiresIn ?? 60 * 60 * 24;

  // 2026-09-09 publicOnlyMode: coursewareId omitted → only PUBLIC_BY_DESIGN_KEY_PREFIXES pass
  // (default AI teacher models / default avatars). No session or courseware check — these keys are public by design,
  // so signing them opens no privilege surface; every other key is silently skipped (consistent with the existing gate semantics).
  const publicOnlyMode = !coursewareId;

  let courseware;
  if (!publicOnlyMode) {
    try {
      courseware = await loadCoursewareForBatchPresign(req, coursewareId, {
        renderToken,
        network,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJsonWithCors(res, batchPresignAccessStatus(error), { ok: false, error: message });
      return;
    }
  }

  const keyByInput = new Map<string, string>();
  const evidenceByKey = new Map<string, string>();
  const ociMode = activeStorageBackend() === "oci_s3";
  for (const input of filePaths) {
    // Legacy poison pattern (the old extraction bug): keys like
    // "public/o/<key>" — the bytes live in the PUBLIC bucket (example-public)
    // under <key>. Normalize the input URL so presign targets the right
    // bucket+key without any data cleanup.
    let normalizedInput = input;
    const poisonMatch = input.match(
      /^(https?:\/\/[^/]+\/n\/[^/]+\/b\/)example-storage(\/o\/)public\/o\/(.+)$/,
    );
    if (poisonMatch) {
      normalizedInput = `${poisonMatch[1]}example-public${poisonMatch[2]}${poisonMatch[3]}`;
    }
    const key = normalizeObjectKeyFromInput(normalizedInput);
    if (process.env.DEBUG_PRESIGN) {
      console.log('[presign-debug] input:', input.slice(0, 120), '| normalized:', normalizedInput.slice(0, 120), '| key:', key);
    }
    if (!key) continue;
    if (publicOnlyMode && !PUBLIC_BY_DESIGN_KEY_PREFIXES.some((p) => key.startsWith(p))) {
      continue;
    }
    keyByInput.set(input, key);
    // Best evidence per key: the same key may appear as an aliyun URL / OCI native URL /
    // signed URL / bare key; evidenceRank picks the strongest evidence to decide how it is served
    // (aliyun public CDN / OCI public bucket → echo the public URL; everything else → presign).
    const prevEvidence = evidenceByKey.get(key);
    if (
      prevEvidence === undefined ||
      evidenceRankForCoursewarePresign(normalizedInput) <
        evidenceRankForCoursewarePresign(prevEvidence)
    ) {
      evidenceByKey.set(key, normalizedInput);
    }
  }

  // Transition-safe presign: the URL host decides which backend holds the
  // bytes (legacy aliyun vs OCI); bare object keys follow the active backend.
  // Both maps are keyed by KEY (previously stored by input key and read by key — always undefined for URL inputs,
  // so public bucket URLs in the scene were wrongly signed against the private bucket).
  const backendByKey = new Map<string, "aliyun_oss" | "oci_s3">();
  const bucketByKey = new Map<string, string>();
  for (const [key, evidence] of evidenceByKey) {
    backendByKey.set(key, backendForStoredObjectUrl(evidence));
    const bucket = bucketFromOciUrl(evidence);
    // example-public went private: its objects were all copied to example-storage,
    // so the signing target bucket of such evidence is always example-storage (the echo branch already short-circuits in presign.ts).
    if (bucket === "example-public") {
      bucketByKey.set(key, "example-storage");
    } else if (bucket) {
      bucketByKey.set(key, bucket);
    }
    // OCI mode: derived artifacts (artifact/**) were unified into OCI after conversion (migrated) —
    // dropping them onto aliyun by the host rule would 404 the mirrored artifacts.
    if (ociMode && key.startsWith("artifact/")) {
      backendByKey.set(key, "oci_s3");
    }
  }

  const uniqueKeys = [...new Set(keyByInput.values())];
  if (uniqueKeys.length === 0) {
    sendJsonWithCors(res, 200, { ok: true, items: [] as { filePath: string; fileUrl: string }[] });
    return;
  }

  const ossKeys = uniqueKeys.filter((key) => !isAwsS3ObjectKey(key));
  const allowedOss = new Set<string>();
  if (ossKeys.length > 0 && !publicOnlyMode) {
    const repo = dataSource.getRepository(CoursewareAsset);
    const rows = await repo.find({ where: { coursewareId, filePath: In(ossKeys) } });
    for (const row of rows) allowedOss.add(row.filePath);
  }

  // Derived artifact subtrees: a requested `artifact/<ext>/<md5>/…` (slide HTML
  // etc., the pdf2html/pptx2html outputs) unlocks via its registered raw upload
  // (`raw/<ext>/<md5>.<ext>`). OCI private bucket requires per-file presign for
  // slide HTML — the aliyun public CDN never needed it.
  const derivedRawKeys: string[] = [];
  for (const key of uniqueKeys) {
    const match = key.match(/^artifact\/(pdf|pptx)\/([0-9a-f]{32})\//i);
    if (match) derivedRawKeys.push(`raw/${match[1]}/${match[2]}.${match[1]}`);
  }
  if (derivedRawKeys.length > 0 && !publicOnlyMode) {
    const repo = dataSource.getRepository(CoursewareAsset);
    const rawRows = await repo.find({
      where: { coursewareId, filePath: In(derivedRawKeys) },
    });
    for (const row of rawRows) allowedOss.add(row.filePath);
  }

  // Slide HTML derived assets (raw/html/assets/*): when the request includes such keys, merge the courseware's
  // registered raw/html/*.html rows into allowedOss — the gate uses that to let the conversion output family through
  // (relative references assets/… are not registered individually in the asset library/content).
  if (uniqueKeys.some((k) => k.startsWith("raw/html/assets/")) && !publicOnlyMode) {
    const repo = dataSource.getRepository(CoursewareAsset);
    const htmlRows = await repo.find({
      where: { coursewareId, filePath: Like("raw/html/%") },
    });
    for (const row of htmlRows) allowedOss.add(row.filePath);
  }

  if (process.env.DEBUG_PRESIGN) {
    const contentStr = publicOnlyMode ? "null" : JSON.stringify(courseware.content ?? null);
    console.log('[presign-debug] content type:', publicOnlyMode ? 'null' : typeof courseware.content, '| strLen:', contentStr?.length, '| ossKeys:', ossKeys.length, '| allowedOss:', [...allowedOss]);
  }
  const signedByKey = new Map<string, string>();
  for (const key of uniqueKeys) {
    // In publicOnlyMode courseware is undefined: content checks always count as "not referenced"
    // (PUBLIC_BY_DESIGN keys pass inside the gate through the prefix table, independent of content).
    const contentHas = publicOnlyMode ? false : JSON.stringify(courseware.content ?? {}).includes(key);
    const gateOk = isAwsS3ObjectKey(key) || isOssKeyAllowedForCoursewarePresign(key, publicOnlyMode ? {} : courseware.content, allowedOss);
    if (process.env.DEBUG_PRESIGN) {
      console.log('[presign-debug] gate:', key, '| aws:', isAwsS3ObjectKey(key), '| registered:', allowedOss.has(key), '| contentHas:', contentHas, '| ->', gateOk);
    }
    if (!gateOk) {
      continue;
    }
    try {
      // `public/`-prefixed keys (public bucket assets such as live2d_models) → the public bucket native URL:
      // Live2D fetches moc3/textures by relative path, and a signature query isn't passed on to relative requests, so it must be the unsigned public form.
      const publicBucketEcho = publicBucketEchoUrlForCoursewarePresign(key, evidenceByKey.get(key));
      if (publicBucketEcho) {
        signedByKey.set(key, publicBucketEcho);
        continue;
      }
      // Public serving during the migration transition: aliyun public CDN / OCI public bucket evidence → echo the stable public
      // URL (anonymously readable; the aliyun credentials were revoked, so the signing path would 502). Everything else goes through normal presign.
      const echoUrl = publicEchoUrlForCoursewarePresign(key, evidenceByKey.get(key));
      // After the migration the objects of old AWS prefixes such as organization/ are all in OCI (example-storage),
      // so they always go through signObjectReadUrl: the AWS client's endpoint was pointed at OCI compat by the migration,
      // and signing again with AWS credentials would produce mixed "OCI host + AWS region signature" URLs (400 region
      // malformed). backendByKey correctly falls back to active (oci_s3) for AWS-host evidence.
      const signed = echoUrl ?? (await signObjectReadUrl(key, expires, {
        network,
        backend: backendByKey.get(key),
        bucket: bucketByKey.get(key),
      }));
      signedByKey.set(key, signed);
    } catch (error) {
      sendJsonWithCors(res, 502, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  }

  const items = [...signedByKey.entries()].map(([filePath, fileUrl]) => ({ filePath, fileUrl }));

  if (items.length > 0 && !publicOnlyMode) {
    await auditAssetAction(
      "asset.presign",
      {
        coursewareId: courseware.id,
        orgId: courseware.orgId,
        detail: { pathCount: items.length },
      },
      req,
    );
  }

  sendJsonWithCors(res, 200, { ok: true, items });
}

/**
 * POST `/courseware/assets/read_text` — JSON: `coursewareId`, `filePath` (URL or object key).
 * Server-side read for small HTML assets so the editor can inject autofit measurement (avoids OSS CORS).
 */
async function handleCoursewareAssetsReadText(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsed = readTextBodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    sendJsonWithCors(res, 400, { ok: false, error: parsed.error.message });
    return;
  }
  const { coursewareId, filePath } = parsed.data;
  const key = normalizeObjectKeyFromInput(filePath);
  if (!key) {
    sendJsonWithCors(res, 400, { ok: false, error: "Unsupported or empty file path." });
    return;
  }
  const lower = key.toLowerCase();
  if (!lower.endsWith(".html") && !lower.endsWith(".htm")) {
    sendJsonWithCors(res, 400, { ok: false, error: "Only .html / .htm assets can be read as text." });
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

  // R14: the association check runs unconditionally for every key (AWS S3 prefixes used to be skipped) — authorization only proves
  // "may read this courseware", while filePath is still client input; without the check, any session that can read could use
  // a known key to read another courseware's HTML assets. A hit in either the asset rows or the scene references counts as associated.
  {
    const repo = dataSource.getRepository(CoursewareAsset);
    const row = await repo.findOne({ where: { coursewareId: courseware.id, filePath: key } });
    const sceneReferenced =
      (isAwsS3ObjectKey(key) || isAgentDirectOssObjectKey(key)) &&
      coursewareContentReferencesObjectKey(courseware.content, key);
    if (!row && !sceneReferenced) {
      sendJsonWithCors(res, 404, {
        ok: false,
        error: `Asset not registered for this courseware (filePath=${key}).`,
      });
      return;
    }
  }

  try {
    const text = await readCoursewareAssetText(key, undefined, {
      backend: backendForStoredObjectUrl(filePath),
    });
    sendJsonWithCors(res, 200, { ok: true, text, filePath: key });
  } catch (error) {
    sendJsonWithCors(res, 502, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export { isCoursewareAssetsPostPath } from "./courseware-assets-paths.ts";

/**
 * Courseware asset POSTs: `/courseware/assets/upload` | `list` | `delete` | `batch_presign_urls`.
 */
export async function handleCoursewareAssetsPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const pathname = pathnameFromUrl(req.url);
  if (pathname === "/courseware/assets/upload") {
    return handleCoursewareAssetUpload(req, res);
  }
  if (pathname === "/courseware/assets/upload/init") {
    return handleCoursewareAssetUploadInit(req, res);
  }
  if (pathname === "/courseware/assets/upload/chunk") {
    return handleCoursewareAssetUploadChunk(req, res);
  }
  if (pathname === "/courseware/assets/upload/complete") {
    return handleCoursewareAssetUploadComplete(req, res);
  }
  if (pathname === "/courseware/assets/upload/abort") {
    return handleCoursewareAssetUploadAbort(req, res);
  }

  try {
    await ensureDataSource();
  } catch (error) {
    sendJsonWithCors(res, 503, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (req.method !== "POST") {
    sendJsonWithCors(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  if (pathname === "/courseware/assets/list") {
    return handleCoursewareAssetsList(req, res);
  }
  if (pathname === "/courseware/assets/delete") {
    return handleCoursewareAssetsDelete(req, res);
  }
  if (pathname === "/courseware/assets/batch_presign_urls") {
    return handleCoursewareAssetsBatchPresign(req, res);
  }
  if (pathname === "/courseware/assets/get") {
    return handleCoursewareAssetsGetById(req, res);
  }
  if (pathname === "/courseware/assets/read_text") {
    return handleCoursewareAssetsReadText(req, res);
  }

  sendJsonWithCors(res, 404, { ok: false, error: "Not found" });
}
