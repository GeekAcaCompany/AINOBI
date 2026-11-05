// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import {
  normalizeCoursewareCoverExtension,
  persistenceUrlForObjectKey,
  putOssObjectBuffer,
  publicUrlForObjectKey,
  coursewareCoverObjectKey,
  objectExists,
  deleteOssObject,
} from "@ainobi/courseware-cli/cli/assets.ts";
import { getAuthorizedSession } from "../api-auth.ts";
import { actorFromSession } from "../auth/ainobi-org-access.ts";
import { sendJsonWithCors } from "../http/cors.ts";
import { requestPathname } from "../http/request.ts";
import { ensureDataSource } from "../db/ensure-data-source.ts";
import { dataSource } from "../db/db.ts";
import { Courseware } from "../models/courseware.ts";
import { recordCoursewareAuditLog } from "./courseware-audit-log-service.ts";
import {
  COURSEWARE_KEY_FOLD_LOCK_CLASS,
  coverObjectMd5FromKey,
  coursewareKeyFoldLockPayload,
  hasCaseCollidingCoursewareKey,
} from "./courseware-service.ts";
import {
  acquireCoursewareUploadStorageLock,
  clearAssetRefundClaim,
  confirmCoursewareUploadStorageLock,
  decrementCoursewareObjectStorage,
  markAssetRefundClaimComplete,
  orgStorageErrorStatus,
  releaseCoursewareUploadStorageLock,
  type UploadStorageLockHandle,
} from "./courseware-asset-org-storage.ts";
import {
  CoursewareOrgAccessError,
  loadCoursewareByIdWithRequestAccess,
} from "./courseware-org-guard.ts";
import { parseCoursewareMultipartToTempFile } from "./courseware-multipart-upload.ts";

const coursewareIdSchema = z.string().uuid();

/**
 * Recover the cover object key from a stored cover URL. Cover keys always sit
 * under the `courseware_covers/` prefix, so locating that prefix in the URL is
 * independent of the configured public base URL.
 */
function coverObjectKeyFromUrl(coverUrl: string): string | null {
  const idx = coverUrl.indexOf("courseware_covers/");
  if (idx < 0) return null;
  const key = coverUrl
    .slice(idx)
    .split("?")[0]
    .split("#")[0]
    .trim();
  return key || null;
}

const COVER_MAX_BYTES = 5 * 1024 * 1024;

const COVER_CONTENT_TYPE_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

function orgAccessStatus(error: unknown): number | null {
  return error instanceof CoursewareOrgAccessError ? error.status : null;
}

function resolveCoverExtension(filename: string, contentType: string): string {
  const fromName = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
  if (fromName) {
    try {
      return normalizeCoursewareCoverExtension(fromName);
    } catch {
      /* fall through */
    }
  }
  const fromCt = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const ext = fromCt ? COVER_CONTENT_TYPE_TO_EXT[fromCt] : "";
  if (!ext) {
    throw new Error("Unsupported cover image type. Use PNG, JPEG, or WebP.");
  }
  return normalizeCoursewareCoverExtension(ext);
}

export function isCoursewareCoverUploadPath(url: string | undefined): boolean {
  return requestPathname(url) === "/courseware/cover/upload";
}

/**
 * POST `/courseware/cover/upload`, `multipart/form-data`:
 * - field `coursewareId` (uuid, required)
 * - file field name `file` (required, PNG/JPEG/WebP)
 */
export async function handleCoursewareCoverUpload(
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

  const contentType = req.headers["content-type"];
  const ct = typeof contentType === "string" ? contentType : contentType?.[0];
  if (!ct?.toLowerCase().startsWith("multipart/form-data")) {
    sendJsonWithCors(res, 400, { ok: false, error: "Expected Content-Type: multipart/form-data." });
    return;
  }

  const tmpDir = await mkdtemp(join(tmpdir(), "cw-cover-"));
  const tmpFile = join(tmpDir, "cover.bin");

  try {
    const parsed = await parseCoursewareMultipartToTempFile(req, tmpFile, COVER_MAX_BYTES);
    const fileBuffer = await readFile(tmpFile);
    if (fileBuffer.length === 0) {
      sendJsonWithCors(res, 400, { ok: false, error: 'Empty file in multipart field "file".' });
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

    const orgId = courseware.orgId?.trim();
    if (!orgId) {
      sendJsonWithCors(res, 400, { ok: false, error: "Courseware orgId is missing." });
      return;
    }

    let extension: string;
    try {
      extension = resolveCoverExtension(parsed.originalName, parsed.partMime);
    } catch (error) {
      sendJsonWithCors(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const contentMd5 = createHash("md5").update(fileBuffer).digest("hex").toLowerCase();
    const objectKey = coursewareCoverObjectKey(orgId, coursewareId, contentMd5, extension);
    const mimeType =
      parsed.partMime.split(";")[0]?.trim() ||
      (extension === ".png"
        ? "image/png"
        : extension === ".webp"
          ? "image/webp"
          : "image/jpeg");

    // --- org storage accounting (covers count toward the org quota) ---
    // Two distinct notions, deliberately separated (codex P1):
    // 1. Charging identity — POINTER equality: the same content-addressed key
    //    is the same physical object, so a re-upload of the currently stored
    //    key is never a new charge, regardless of namespace ownership.
    // 2. Refund/delete permission — OWNERSHIP: only a previous key under OUR
    //    namespace is ours to refund and delete — the save API lets writers
    //    point coverUrl at arbitrary URLs, so an unguarded key could belong
    //    to (and delete) another tenant's cover. Uploads key objects by the
    //    client-sent id-or-key value (this row, resolved from it), and
    //    editors pass the business key: the row-id namespace is always ours;
    //    the key namespace only when no case-colliding sibling shares
    //    lower(key) — the physical path casefolds while the key unique index
    //    does not (same rule as coverUrlForSave in courseware-service). The
    //    authoritative ownership verdict is re-read inside the replacement
    //    transaction under the folded lock (see below).
    const ownedCoverKey = (
      value: string | null | undefined,
      keyAliasOwned: boolean,
      rowIdContested: boolean,
    ): string | null => {
      if (!value) return null;
      const key = coverObjectKeyFromUrl(value);
      if (!key) return null;
      const lowered = key.toLowerCase();
      const orgPrefix = `courseware_covers/${orgId.toLowerCase()}/`;
      const owned =
        (!rowIdContested &&
          lowered.startsWith(`${orgPrefix}${courseware.id.toLowerCase()}/`)) ||
        (keyAliasOwned &&
          !!courseware.key &&
          lowered.startsWith(`${orgPrefix}${courseware.key.toLowerCase()}/`));
      return owned ? key : null;
    };
    const previousCoverKey = courseware.coverUrl
      ? coverObjectKeyFromUrl(courseware.coverUrl)
      : null;
    const previousCoverSize = courseware.coverFileSize ?? null;
    const accessToken = getAuthorizedSession(req)?.accessToken ?? null;
    // Re-uploading the identical cover hits the same content-addressed key and
    // is already counted — no new lock. A genuinely new cover locks its bytes.
    // Note the charge gate below: coverFileSize is persisted ONLY when this
    // request actually charged (lock acquired + confirmed). Legacy rows
    // (NULL size) and identical re-uploads stay unaccounted rather than
    // recording a size that was never added to the org quota.
    const isNewCover = previousCoverKey !== objectKey;
    let storageLock: UploadStorageLockHandle | null = null;
    // Set when the transaction callback already wrote a 409 (CAS loser / ambiguous alias refusal): after the transaction
    // the handler must stop and must not go on to the audit log and the 200 response (write-after-end, codex P1).
    let responded = false;
    if (isNewCover) {
      try {
        storageLock = await acquireCoursewareUploadStorageLock(
          accessToken,
          orgId,
          fileBuffer.length,
          `courseware-cover:${coursewareId}`,
        );
      } catch (storageErr) {
        const status = orgStorageErrorStatus(storageErr) ?? 502;
        sendJsonWithCors(res, status, {
          ok: false,
          error:
            storageErr instanceof Error ? storageErr.message : String(storageErr),
        });
        return;
      }
    }
    const chargePending = storageLock !== null;
    let coverUrl = "";

    try {
      // Serialize replacement end-to-end (CAS → confirm → size publish →
      // old-cover refund) under a per-courseware cover lock: without it a
      // concurrent upload can load the intermediate row (new URL, not-yet-
      // confirmed size) and refund a charge that was never committed.
      await dataSource.transaction(async (txManager) => {
        // Row lock FIRST (same lock deletion holds; global ordering row →
        // cover keeps lock acquisition deadlock-free): deletion can never
        // capture the courseware row while a cover replacement is mid-
        // accounting, so the newly charged size always has a surviving row
        // to refund from.
        await txManager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `courseware-row:${courseware.id}`,
        ]);
        await txManager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `courseware-cover:${courseware.id}`,
        ]);
        // Re-read the previous cover under the lock — an earlier concurrent
        // replacement may have changed it after this request's initial load.
        const freshRow = await txManager
          .getRepository(Courseware)
          .findOne({ where: { id: courseware.id } });
        if (!freshRow) {
          throw new Error("Courseware no longer exists.");
        }
        // The authoritative decision rereads inside the 4202 fold lock (mutually exclusive with the create path, codex P1): fold siblings created
        // concurrently cannot land between this transaction's criterion read and its commit. Races in both the key alias and the row id
        // namespaces are checked (codex P0: when another row's key folds equal to this row's id, the id
        // prefix is shared as well, so ownership on the id side is refused too).
        let freshKeyAliasOwned = false;
        let freshRowIdContested = false;
        if (freshRow.key) {
          await txManager.query(
            "SELECT pg_advisory_xact_lock($1, hashtext($2))",
            [
              COURSEWARE_KEY_FOLD_LOCK_CLASS,
              coursewareKeyFoldLockPayload(orgId, freshRow.key),
            ],
          );
          freshKeyAliasOwned = !(await hasCaseCollidingCoursewareKey(
            txManager,
            orgId,
            freshRow.key,
            freshRow.id,
          ));
          freshRowIdContested = await hasCaseCollidingCoursewareKey(
            txManager,
            orgId,
            freshRow.id,
            freshRow.id,
          );
        }
        const freshPrevUrl = freshRow.coverUrl;
        // Billing identity = pointer equality (unrelated to ownership): when the stored key equals this upload's key it is
        // the same physical object, and even with ownership undecidable under a fold conflict (freshPrevKey=null) that
        // still holds — repeated uploads of the same key are never billed twice (codex P1).
        const freshPointerKey = freshPrevUrl
          ? coverObjectKeyFromUrl(freshPrevUrl)
          : null;
        // Delete/refund permission = the ownership decision (both namespaces require no fold race).
        const freshPrevKey = ownedCoverKey(
          freshPrevUrl,
          freshKeyAliasOwned,
          freshRowIdContested,
        );
        const freshPrevSize = freshRow.coverFileSize ?? null;
        const freshIsNewCover = freshPointerKey !== objectKey;

        // Replacing an old cover that "is billed but has undecidable ownership" can't refund first and then overwrite its size marker
        // (overwriting leaks) — refuse directly; resolve the key conflict or settle the account first (codex P1).
        // After responding 409 the whole handler must stop (see the responded gate after the transaction),
        // otherwise it would continue to the audit log and the 200 response (write-after-end).
        if (freshIsNewCover && !freshPrevKey && (freshPrevSize ?? 0) > 0) {
          if (storageLock) {
            await releaseCoursewareUploadStorageLock(accessToken, storageLock);
            storageLock = null;
          }
          sendJsonWithCors(res, 409, {
            ok: false,
            error:
              "Previous cover storage accounting cannot be resolved (ambiguous cover namespace — case-colliding courseware key). Resolve the key collision before replacing this cover.",
          });
          responded = true;
          return;
        }

        // Re-evaluate charging under the lock: a concurrent identical upload
        // may have committed while this request waited — its key equals ours,
        // the row already carries ITS confirmed charge, and our stale
        // pre-lock must go back instead of confirming a second full charge.
        if (!freshIsNewCover && storageLock) {
          await releaseCoursewareUploadStorageLock(accessToken, storageLock);
          storageLock = null;
        }
        const effectiveChargePending = storageLock !== null;

        if (!(await objectExists(objectKey))) {
          await putOssObjectBuffer(objectKey, fileBuffer, mimeType);
        }

        coverUrl = publicUrlForObjectKey(objectKey, extension);
        // DB keeps the stable key-derived URL (never a signature); the signed
        // `coverUrl` above is response-only.
        const coverUrlStored = persistenceUrlForObjectKey(objectKey, extension).slice(0, 2048);
        const repo = txManager.getRepository(Courseware);

        // CAS on the previous cover pointer (under the cover lock this only
        // loses to a save-API writer). coverFileSize is NOT published here —
        // it lands only after the charge confirms, so an intermediate row
        // never carries a size that was not actually charged.
        const casUpdate = repo
          .createQueryBuilder()
          .update(Courseware)
          .set({ coverUrl: coverUrlStored })
          .where("id = :id", { id: courseware.id });
        if (freshPrevUrl == null) {
          casUpdate.andWhere("cover_url IS NULL");
        } else {
          casUpdate.andWhere("cover_url = :previousCoverUrl", {
            previousCoverUrl: freshPrevUrl,
          });
        }
        const casResult = await casUpdate.execute();
        const casWon = (casResult.affected ?? 0) > 0;
        if (!casWon) {
          // Lost the pointer race: give the pre-lock back; the winner owns
          // the old-cover refund. Our object is only dropped when the winner
          // adopted a DIFFERENT key — identical content shares the
          // content-addressed key with the winner's row.
          await releaseCoursewareUploadStorageLock(accessToken, storageLock);
          const currentRow = await repo.findOne({
            where: { id: courseware.id },
            select: { coverUrl: true },
          });
          const currentKey = currentRow?.coverUrl
            ? coverObjectKeyFromUrl(currentRow.coverUrl)
            : null;
          if (currentKey !== objectKey) {
            await deleteOssObject(objectKey).catch(() => {});
          }
          sendJsonWithCors(res, 409, {
            ok: false,
            error: "Cover was replaced by a concurrent upload — please retry.",
          });
          responded = true;
          return;
        }

        if (effectiveChargePending) {
          try {
            await confirmCoursewareUploadStorageLock(
              accessToken,
              storageLock,
              fileBuffer.length,
            );
          } catch (confirmError) {
            // Restore the previous cover pointer and give the pre-lock back;
            // the just-written object stays (content-addressed; a retry
            // reuses it). No size was published yet — nothing to un-refund.
            await repo
              .createQueryBuilder()
              .update(Courseware)
              .set({ coverUrl: freshPrevUrl })
              .where("id = :id AND cover_url = :mine", {
                id: courseware.id,
                mine: coverUrlStored,
              })
              .execute()
              .catch(() => {});
            await releaseCoursewareUploadStorageLock(accessToken, storageLock);
            const message =
              confirmError instanceof Error ? confirmError.message : String(confirmError);
            sendJsonWithCors(res, 502, {
              ok: false,
              error: `Organization storage accounting failed, cover not replaced — please retry: ${message}`,
            });
            return;
          }
          // Charge landed — NOW publish the size (post-confirm, so every
          // persisted size corresponds to a real charge).
          await repo
            .createQueryBuilder()
            .update(Courseware)
            .set({ coverFileSize: fileBuffer.length })
            .where("id = :id AND cover_url = :mine", {
              id: courseware.id,
              mine: coverUrlStored,
            })
            .execute();
          // Once new billing lands, revoke historical refund claims of the same (org, md5) (same as assets finalize):
          // otherwise later refunds of that content would be blocked forever by a leftover claim and leak.
          await clearAssetRefundClaim(orgId, contentMd5);
        }

        // Replaced a different OWNED cover that was charged: hand the old
        // bytes back, then remove the old object only when the decrement
        // actually landed. A persistent claim from the same source as the save-side refund protocol (claim OR IGNORE):
        // a refund for the same (org, md5) is issued only once globally, and even if the debit fails it cannot be repeated
        // by later paths (courseware deletion etc.) from the retained size.
        if (freshIsNewCover && freshPrevKey && freshPrevSize && freshPrevSize > 0) {
          const refundMd5 = coverObjectMd5FromKey(freshPrevKey);
          let refundClaimed = false;
          if (refundMd5) {
            const { CoursewareAssetRefundClaim } = await import(
              "../models/courseware-asset-refund-claims.ts"
            );
            const claimResult = await repo
              .createQueryBuilder()
              .insert()
              .into(CoursewareAssetRefundClaim)
              .values({ orgId, contentMd5: refundMd5 })
              .orIgnore("(org_id, content_md5)")
              .execute();
            refundClaimed = (claimResult.raw as unknown[]).length > 0;
            if (!refundClaimed) {
              console.info(
                `[org-storage] cover refund already claimed for this content orgId=${orgId} md5=${refundMd5} coursewareId=${coursewareId}`,
              );
            }
          } else {
            console.error(
              `[org-storage] previous cover key is not content-addressed — refusing refund, ` +
                `manual reconciliation needed orgId=${orgId} coursewareId=${coursewareId} objectKey=${freshPrevKey}`,
            );
          }
          if (!refundClaimed) {
            // Not claimed (already claimed or the key isn't addressable) — skip the debit and the delete; the size marker stays
            // in the claim/log for reconciliation until the new billing overwrites it.
          } else {
            const refunded = await decrementCoursewareObjectStorage(
              accessToken,
              orgId,
              freshPrevSize,
              `courseware-cover-replaced:${coursewareId}`,
            );
            if (refunded) {
              await markAssetRefundClaimComplete(orgId, refundMd5!);
              await deleteOssObject(freshPrevKey).catch(() => {});
            }
          }
        }
      });
    } catch (coverError) {
      // Anything between the pre-lock and the confirm must give the lock
      // back — otherwise transient OSS/DB failures pin org quota until the
      // lock TTL expires.
      await releaseCoursewareUploadStorageLock(accessToken, storageLock);
      throw coverError;
    }

    // The transaction already responded 409 (CAS loser / ambiguous alias refusal) — stop the handler;
    // it must not go on to the audit log and the 200 response (codex P1: write-after-end).
    if (responded) {
      return;
    }

    const session = getAuthorizedSession(req);
    if (session) {
      await recordCoursewareAuditLog({
        action: "cover.upload",
        actor: actorFromSession(session),
        orgId,
        coursewareId: courseware.id,
        detail: {
          contentMd5,
          bytes: fileBuffer.length,
          objectKey,
        },
      });
    }

    const updatedRow = await dataSource.getRepository(Courseware).findOne({
      where: { id: courseware.id },
      select: { updatedAt: true },
    });

    sendJsonWithCors(res, 200, {
      ok: true,
      coverUrl,
      filePath: objectKey,
      updatedAt: updatedRow?.updatedAt?.toISOString(),
    });
  } catch (error) {
    sendJsonWithCors(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
