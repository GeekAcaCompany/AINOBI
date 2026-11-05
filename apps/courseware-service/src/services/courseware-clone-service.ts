// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import path from "node:path";

import type { EntityManager } from "typeorm";

import {
  assetObjectKey,
  copyStoredObject,
  coursewareCoverObjectKey,
  deleteOssObject,
  normalizeCoursewareCoverExtension,
  persistenceUrlForObjectKey,
  publicUrlForObjectKey,
  type CoursewareStorageBackend,
} from "@ainobi/courseware-cli/cli/assets.ts";
import type { CoursewareActorContext } from "../auth/ainobi-org-access.ts";
import { dataSource } from "../db/db.ts";
import { CoursewareAsset } from "../models/courseware-assets.ts";
import { CoursewareCourseBinding } from "../models/courseware-course-binding.ts";
import { Courseware } from "../models/courseware.ts";
import { copyS3Object, deleteS3Object } from "./aws-s3-presign.ts";
import {
  acquireCoursewareCloneStorageLock,
  confirmCoursewareCloneStorageLock,
  releaseCoursewareCloneStorageLock,
} from "./courseware-asset-org-storage.ts";
import { isAwsS3ObjectKey, normalizeObjectKeyFromInput } from "./courseware-asset-presign.ts";
import {
  ensureCoursewareSectionBinding,
  findCoursewareSectionBinding,
} from "./courseware-section-binding-service.ts";
import { ensureCoursewareCourseBinding } from "./courseware-course-binding-service.ts";

export type CloneCoursewareToSectionInput = {
  sourceCoursewareId: string;
  sourceSectionId: string;
  sourceCourseId: string;
  targetSectionId: string;
  targetCourseId: string;
  targetOrgId: string;
  targetChapterId: string;
  isCurrent: boolean;
  actor?: CoursewareActorContext;
  accessToken?: string | null;
};

export type CloneCoursewareToCourseInput = {
  sourceCoursewareId: string;
  sourceCourseId: string;
  targetCourseId: string;
  targetOrgId: string;
  actor?: CoursewareActorContext;
  accessToken?: string | null;
};

type ClonedAsset = {
  sourceFileId: string;
  cloned: CoursewareAsset;
  copiedObjectKeys: string[];
};

function buildReplacementMap(input: {
  sourceCourseware: Courseware;
  targetCourseware: Courseware;
  sourceAssets: CoursewareAsset[];
  clonedAssets: ClonedAsset[];
  sourceCoverUrl: string | null;
  targetCoverUrl: string | null;
}): Map<string, string> {
  const replacements = new Map<string, string>([
    [input.sourceCourseware.id, input.targetCourseware.id],
    [input.sourceCourseware.key, input.targetCourseware.key],
  ]);
  if (input.sourceCoverUrl && input.targetCoverUrl) {
    // Replacement values stay in the playable URL form (content convention);
    // rows themselves hold bare keys.
    const targetCoverKey = normalizeObjectKeyFromInput(input.targetCoverUrl);
    const targetCoverPlayable = targetCoverKey
      ? publicUrlForObjectKey(targetCoverKey)
      : input.targetCoverUrl;
    replacements.set(input.sourceCoverUrl, targetCoverPlayable);
    const sourceCoverKey = normalizeObjectKeyFromInput(input.sourceCoverUrl);
    if (sourceCoverKey && targetCoverKey) {
      replacements.set(sourceCoverKey, targetCoverPlayable);
    }
  }
  for (const cloned of input.clonedAssets) {
    const source = input.sourceAssets.find((asset) => asset.fileId === cloned.sourceFileId);
    if (!source) continue;
    replacements.set(source.fileId, cloned.cloned.fileId);
    replacements.set(source.filePath, cloned.cloned.filePath);
    const targetFileKey = normalizeObjectKeyFromInput(cloned.cloned.fileUrl);
    const targetFilePlayable = targetFileKey
      ? publicUrlForObjectKey(targetFileKey, path.extname(targetFileKey))
      : cloned.cloned.fileUrl;
    replacements.set(source.fileUrl, targetFilePlayable);
    const sourceFileKey = normalizeObjectKeyFromInput(source.fileUrl);
    if (sourceFileKey) {
      replacements.set(sourceFileKey, targetFilePlayable);
    }
    if (source.fileArtifactUrl && cloned.cloned.fileArtifactUrl) {
      const targetArtifactPlayable = /^https?:\/\//i.test(cloned.cloned.fileArtifactUrl)
        ? cloned.cloned.fileArtifactUrl
        : publicUrlForObjectKey(
            cloned.cloned.fileArtifactUrl,
            path.extname(cloned.cloned.fileArtifactUrl),
          );
      replacements.set(source.fileArtifactUrl, targetArtifactPlayable);
      const sourceArtifactKey = normalizeObjectKeyFromInput(source.fileArtifactUrl);
      const targetArtifactKey = normalizeObjectKeyFromInput(cloned.cloned.fileArtifactUrl);
      if (sourceArtifactKey && targetArtifactKey) {
        replacements.set(sourceArtifactKey, targetArtifactPlayable);
      }
    }
  }
  return replacements;
}

function rewriteStringValue(value: string, replacements: Map<string, string>): string {
  let next = value;
  for (const [source, target] of [...replacements.entries()].sort(
    (a, b) => b[0].length - a[0].length,
  )) {
    if (!source || source === target || !next.includes(source)) continue;
    next = next.split(source).join(target);
  }
  return next;
}

function rewriteContentReferences(value: unknown, replacements: Map<string, string>): unknown {
  if (typeof value === "string") {
    return rewriteStringValue(value, replacements);
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteContentReferences(item, replacements));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        rewriteContentReferences(item, replacements),
      ]),
    );
  }
  return value;
}

/** Where a copied object's bytes ended up (aws_s3 keys keep their legacy URL form). */
type StoredObjectLocation = "aws_s3" | "aliyun_oss" | "oci_s3";

const urlBackendForLocation = (location: StoredObjectLocation): CoursewareStorageBackend =>
  location === "oci_s3" ? "oci_s3" : "aliyun_oss";

/**
 * Copy a managed object and report where the bytes ended up: AWS S3 prefixes
 * copy inside the backend AWS S3 bucket; OCI/aliyun keys are copied
 * server-side inside the active backend, falling back to a legacy aliyun→
 * aliyun copy when the source object only exists there (grayscale transition).
 * Callers must persist a URL matching the reported location.
 */
async function copyManagedObject(
  sourceObjectKey: string,
  targetObjectKey: string,
): Promise<StoredObjectLocation> {
  if (isAwsS3ObjectKey(sourceObjectKey) || isAwsS3ObjectKey(targetObjectKey)) {
    await copyS3Object(sourceObjectKey, targetObjectKey);
    return "aws_s3";
  }
  return copyStoredObject(targetObjectKey, sourceObjectKey);
}

async function deleteManagedObject(objectKey: string): Promise<void> {
  if (isAwsS3ObjectKey(objectKey)) {
    await deleteS3Object(objectKey).catch(() => {});
    return;
  }
  await deleteOssObject(objectKey);
}

function cloneAssetObjectKey(source: CoursewareAsset, newFileId: string): string {
  const sourceKey = normalizeObjectKeyFromInput(source.filePath) ?? source.filePath;
  const extension = path.extname(sourceKey || source.fileName);
  if (sourceKey.startsWith("raw/")) {
    return assetObjectKey(newFileId, extension);
  }
  if (sourceKey.startsWith("artifact/")) {
    return `artifact/${newFileId}${extension || ".html"}`;
  }
  if (sourceKey.startsWith("courseware_assets/")) {
    return `courseware_assets/${newFileId}${extension}`;
  }
  if (sourceKey.startsWith("tts_outputs/")) {
    return `tts_outputs/${newFileId}${extension}`;
  }
  if (sourceKey.startsWith("organization/")) {
    return `organization/${newFileId}${extension}`;
  }
  return `raw/cloned/${newFileId}${extension}`;
}

function cloneArtifactObjectKey(sourceUrl: string, newFileId: string): string {
  const sourceKey = normalizeObjectKeyFromInput(sourceUrl) ?? sourceUrl;
  const extension = path.extname(sourceKey);
  if (sourceKey.startsWith("artifact/")) {
    return `artifact/${newFileId}${extension || ".html"}`;
  }
  return `artifact/${newFileId}${extension || ".html"}`;
}

function isDocumentArtifactBasePrefix(value: string): boolean {
  const objectKey = normalizeObjectKeyFromInput(value) ?? value.trim().replace(/^\/+/, "");
  return /^artifact\/(pdf|pptx)\/[^/]+$/i.test(objectKey);
}

async function cloneCoursewareAssets(
  manager: EntityManager,
  sourceAssets: CoursewareAsset[],
  targetCourseware: Courseware,
  actor?: CoursewareActorContext,
): Promise<{ clonedAssets: ClonedAsset[] }> {
  const repo = manager.getRepository(CoursewareAsset);
  const clonedAssets: ClonedAsset[] = [];
  for (const source of sourceAssets) {
    const newFileId = randomUUID();
    const copiedObjectKeys: string[] = [];
    const nextFilePath = cloneAssetObjectKey(source, newFileId);
    const filePathLocation = await copyManagedObject(source.filePath, nextFilePath);
    copiedObjectKeys.push(nextFilePath);

    let nextArtifactUrl = source.fileArtifactUrl;
    if (source.fileArtifactUrl) {
      if (isDocumentArtifactBasePrefix(source.fileArtifactUrl)) {
        // Converted PDF/PPTX assets store an artifact base prefix, not one HTML file.
        // Reuse that immutable content-addressed tree instead of collapsing it to artifact/<uuid>.html.
        nextArtifactUrl = source.fileArtifactUrl;
      } else {
        const sourceArtifactKey = normalizeObjectKeyFromInput(source.fileArtifactUrl);
        if (sourceArtifactKey) {
          const targetArtifactKey = cloneArtifactObjectKey(source.fileArtifactUrl, newFileId);
          const artifactLocation = await copyManagedObject(sourceArtifactKey, targetArtifactKey);
          copiedObjectKeys.push(targetArtifactKey);
          // Artifact URLs are served through the HTML CDN — a permanent web URL,
          // not an object-storage reference; keep the playable form.
          nextArtifactUrl = publicUrlForObjectKey(
            targetArtifactKey,
            path.extname(targetArtifactKey),
            { backend: urlBackendForLocation(artifactLocation) },
          );
        }
      }
    }

    const cloned = repo.create({
      fileId: newFileId,
      contentMd5: source.contentMd5,
      orgId: targetCourseware.orgId,
      coursewareId: targetCourseware.id,
      fileName: source.fileName,
      fileSize: source.fileSize,
      contentType: source.contentType,
      markdownContent: source.markdownContent,
      filePath: nextFilePath,
      // Stable key-derived URL (never signed) — responses re-sign.
      fileUrl: persistenceUrlForObjectKey(nextFilePath, path.extname(nextFilePath), {
        backend: urlBackendForLocation(filePathLocation),
      }),
      fileArtifactUrl: nextArtifactUrl,
      fileArtifactMetadata: source.fileArtifactMetadata,
      createdBy: actor?.userId ?? null,
      updatedBy: actor?.userId ?? null,
    });
    await repo.save(cloned);
    clonedAssets.push({ sourceFileId: source.fileId, cloned, copiedObjectKeys });
  }

  return { clonedAssets };
}

async function cloneCoverUrl(
  sourceCourseware: Courseware,
  targetCourseware: Courseware,
): Promise<{ targetCoverUrl: string | null; copiedObjectKey: string | null }> {
  if (!sourceCourseware.coverUrl || !targetCourseware.orgId) {
    return { targetCoverUrl: null, copiedObjectKey: null };
  }
  const sourceCoverKey = normalizeObjectKeyFromInput(sourceCourseware.coverUrl);
  if (!sourceCoverKey) {
    return { targetCoverUrl: sourceCourseware.coverUrl, copiedObjectKey: null };
  }
  const extension = normalizeCoursewareCoverExtension(sourceCoverKey);
  const md5Hex =
    path.basename(sourceCoverKey, path.extname(sourceCoverKey)) ||
    randomUUID().replace(/-/g, "");
  const targetCoverKey = coursewareCoverObjectKey(
    targetCourseware.orgId,
    targetCourseware.id,
    md5Hex,
    extension,
  );
  const coverLocation = await copyManagedObject(sourceCoverKey, targetCoverKey);
  return {
    // Persistence URL (stable) — the clone row stores it; DTOs re-sign per response.
    targetCoverUrl: persistenceUrlForObjectKey(targetCoverKey, extension, {
      backend: urlBackendForLocation(coverLocation),
    }),
    copiedObjectKey: targetCoverKey,
  };
}

async function cloneCoursewareRecord(
  manager: EntityManager,
  sourceCourseware: Courseware,
  targetOrgId: string,
  accessToken?: string | null,
  actor?: CoursewareActorContext,
): Promise<{
  targetCourseware: Courseware;
  copiedObjectKeys: string[];
  cloneStorageLock: { lockId: string; orgId: string } | null;
  cloneAssetTotalBytes: number;
}> {
  const coursewareRepo = manager.getRepository(Courseware);
  const assetRepo = manager.getRepository(CoursewareAsset);
  const targetCourseware = coursewareRepo.create({
    key: randomUUID(),
    orgId: targetOrgId,
    title: sourceCourseware.title,
    coverUrl: null,
    isPublic: false,
    isShare: false,
    content: sourceCourseware.content,
    createdBy: actor?.userId ?? null,
    updatedBy: actor?.userId ?? null,
    // Inherit the source courseware's created_at: the courseware list is sorted by created_at, so if a clone took now(),
    // the coursewares of a copied/cloned course would be in a different order from the source course (one of the root causes of the
    // courseware library order "getting shuffled"). The list side also has an id tiebreaker for ties.
    createdAt: sourceCourseware.createdAt,
  });
  await coursewareRepo.save(targetCourseware);

  const copiedObjectKeys: string[] = [];
  const sourceAssets = await assetRepo.find({
    where: { coursewareId: sourceCourseware.id },
    order: { createdAt: "ASC" },
  });
  const cloneAssetTotalBytes = sourceAssets.reduce(
    (total, asset) => total + (Number.isFinite(asset.fileSize) ? Math.max(0, asset.fileSize) : 0),
    0,
  );
  const cloneStorageLock = await acquireCoursewareCloneStorageLock(
    accessToken,
    targetOrgId,
    cloneAssetTotalBytes,
    `courseware-clone:${sourceCourseware.id}->${targetCourseware.id}`,
  );
  console.info(
    `[org-storage] clone asset summary sourceCoursewareId=${sourceCourseware.id} ` +
      `targetCoursewareId=${targetCourseware.id} targetOrgId=${targetOrgId} ` +
      `assetCount=${sourceAssets.length} totalBytes=${cloneAssetTotalBytes}`,
  );

  try {
    const { targetCoverUrl, copiedObjectKey } = await cloneCoverUrl(
      sourceCourseware,
      targetCourseware,
    );
    if (copiedObjectKey) {
      copiedObjectKeys.push(copiedObjectKey);
    }
    targetCourseware.coverUrl = targetCoverUrl;
    await coursewareRepo.save(targetCourseware);

    const { clonedAssets } = await cloneCoursewareAssets(
      manager,
      sourceAssets,
      targetCourseware,
      actor,
    );
    for (const cloned of clonedAssets) {
      copiedObjectKeys.push(...cloned.copiedObjectKeys);
    }

    const replacements = buildReplacementMap({
      sourceCourseware,
      targetCourseware,
      sourceAssets,
      clonedAssets,
      sourceCoverUrl: sourceCourseware.coverUrl,
      targetCoverUrl,
    });
    targetCourseware.content = rewriteContentReferences(
      sourceCourseware.content,
      replacements,
    ) as Record<string, unknown>;
    await coursewareRepo.save(targetCourseware);

    return {
      targetCourseware,
      copiedObjectKeys,
      cloneStorageLock,
      cloneAssetTotalBytes,
    };
  } catch (error) {
    await releaseCoursewareCloneStorageLock(accessToken, cloneStorageLock);
    throw error;
  }
}

export async function cloneCoursewareToSection(input: CloneCoursewareToSectionInput) {
  const sourceCoursewareId = input.sourceCoursewareId.trim();
  const sourceSectionId = input.sourceSectionId.trim();
  const sourceCourseId = input.sourceCourseId.trim();
  const targetSectionId = input.targetSectionId.trim();
  const targetCourseId = input.targetCourseId.trim();
  const targetOrgId = input.targetOrgId.trim();
  const targetChapterId = input.targetChapterId.trim();
  if (
    !sourceCoursewareId ||
    !sourceSectionId ||
    !sourceCourseId ||
    !targetSectionId ||
    !targetCourseId ||
    !targetOrgId ||
    !targetChapterId
  ) {
    throw new Error("source/target courseware clone identifiers are required");
  }

  return await dataSource.transaction(async (manager) => {
    const coursewareRepo = manager.getRepository(Courseware);
    const sourceCourseware = await coursewareRepo.findOne({
      where: { id: sourceCoursewareId },
    });
    if (!sourceCourseware) {
      throw new Error("source courseware not found");
    }
    const sourceBinding = await findCoursewareSectionBinding({
      coursewareId: sourceCoursewareId,
      sectionId: sourceSectionId,
      courseId: sourceCourseId,
      orgId: sourceCourseware.orgId?.trim() || targetOrgId,
    });
    if (!sourceBinding) {
      throw new Error("source courseware section binding not found");
    }

    const copiedObjectKeys: string[] = [];
    let cloneStorageLock: { lockId: string; orgId: string } | null = null;
    try {
      const {
        targetCourseware,
        copiedObjectKeys: clonedObjectKeys,
        cloneStorageLock: acquiredCloneStorageLock,
        cloneAssetTotalBytes,
      } =
        await cloneCoursewareRecord(
          manager,
          sourceCourseware,
          targetOrgId,
          input.accessToken,
          input.actor,
        );
      cloneStorageLock = acquiredCloneStorageLock;
      copiedObjectKeys.push(...clonedObjectKeys);

      await ensureCoursewareCourseBinding(
        {
          coursewareId: targetCourseware.id,
          courseId: targetCourseId,
          orgId: targetOrgId,
          createdBy: input.actor?.userId ?? null,
        },
        manager,
      );
      await ensureCoursewareSectionBinding(
        {
          coursewareId: targetCourseware.id,
          sectionId: targetSectionId,
          courseId: targetCourseId,
          orgId: targetOrgId,
          chapterId: targetChapterId,
          isCurrent: input.isCurrent,
          createdBy: input.actor?.userId ?? null,
        },
        manager,
      );
      // isCurrent is already handled inside ensureCoursewareSectionBinding; no need to set it again

      await confirmCoursewareCloneStorageLock(
        input.accessToken,
        cloneStorageLock,
        cloneAssetTotalBytes,
      );

      return {
        sourceCoursewareId,
        coursewareId: targetCourseware.id,
        coursewareKey: targetCourseware.key,
        sectionId: targetSectionId,
        courseId: targetCourseId,
        orgId: targetOrgId,
        chapterId: targetChapterId,
        isCurrent: input.isCurrent,
      };
    } catch (error) {
      await releaseCoursewareCloneStorageLock(input.accessToken, cloneStorageLock);
      for (const objectKey of copiedObjectKeys.reverse()) {
        await deleteManagedObject(objectKey);
      }
      throw error;
    }
  });
}

export async function cloneCoursewareToCourse(input: CloneCoursewareToCourseInput) {
  const sourceCoursewareId = input.sourceCoursewareId.trim();
  const sourceCourseId = input.sourceCourseId.trim();
  const targetCourseId = input.targetCourseId.trim();
  const targetOrgId = input.targetOrgId.trim();
  if (!sourceCoursewareId || !sourceCourseId || !targetCourseId || !targetOrgId) {
    throw new Error("source/target courseware clone identifiers are required");
  }

  return await dataSource.transaction(async (manager) => {
    const coursewareRepo = manager.getRepository(Courseware);
    const sourceCourseware = await coursewareRepo.findOne({
      where: { id: sourceCoursewareId },
    });
    if (!sourceCourseware) {
      throw new Error("source courseware not found");
    }
    const sourceCourseBinding = await manager.getRepository(CoursewareCourseBinding).findOne({
      where: {
        coursewareId: sourceCoursewareId,
        courseId: sourceCourseId,
      },
    });
    if (!sourceCourseBinding) {
      throw new Error("source courseware course binding not found");
    }

    const copiedObjectKeys: string[] = [];
    let cloneStorageLock: { lockId: string; orgId: string } | null = null;
    try {
      const {
        targetCourseware,
        copiedObjectKeys: clonedObjectKeys,
        cloneStorageLock: acquiredCloneStorageLock,
        cloneAssetTotalBytes,
      } =
        await cloneCoursewareRecord(
          manager,
          sourceCourseware,
          targetOrgId,
          input.accessToken,
          input.actor,
        );
      cloneStorageLock = acquiredCloneStorageLock;
      copiedObjectKeys.push(...clonedObjectKeys);

      await ensureCoursewareCourseBinding(
        {
          coursewareId: targetCourseware.id,
          courseId: targetCourseId,
          orgId: targetOrgId,
          createdBy: input.actor?.userId ?? null,
        },
        manager,
      );

      await confirmCoursewareCloneStorageLock(
        input.accessToken,
        cloneStorageLock,
        cloneAssetTotalBytes,
      );

      return {
        sourceCoursewareId,
        sourceCourseId,
        coursewareId: targetCourseware.id,
        coursewareKey: targetCourseware.key,
        courseId: targetCourseId,
        orgId: targetOrgId,
      };
    } catch (error) {
      await releaseCoursewareCloneStorageLock(input.accessToken, cloneStorageLock);
      for (const objectKey of copiedObjectKeys.reverse()) {
        await deleteManagedObject(objectKey);
      }
      throw error;
    }
  });
}
