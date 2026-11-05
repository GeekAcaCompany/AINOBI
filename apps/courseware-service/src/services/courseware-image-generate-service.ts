// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AinobiCliError } from '@ainobi/courseware-cli/cli/errors.ts';
import {
  generateImageWithOpenAi,
  type GeneratedImageUsage,
} from '@ainobi/courseware-cli/cli/image-generate.ts';
import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import {
  finalizeCoursewareAssetUpload,
  CoursewareAssetUploadFinalizeError,
} from './courseware-asset-upload-finalize.ts';
import {
  CoursewareOrgAccessError,
  loadCoursewareByIdWithRequestAccess,
} from './courseware-org-guard.ts';
import { assetToDto } from './courseware-assets-service.ts';

export type CoursewareImageGenerateInput = {
  prompt: string;
  size?: string;
  quality?: string;
  file_name?: string;
  courseware_id: string;
  courseware_org_id?: string;
  conversation_id?: string;
};

export type CoursewareImageGenerateResult = {
  asset: ReturnType<typeof assetToDto>;
  model: string;
  size: string;
  quality: string;
  usage: GeneratedImageUsage;
  orgId: string;
  coursewareId: string;
};

const MAX_PROMPT_CHARS = 4000;

export const COURSEWARE_IMAGE_GENERATE_MAX_PROMPT_CHARS = MAX_PROMPT_CHARS;

function sanitizeFileName(raw: string | undefined): string {
  const fallback = `ai-image-${Date.now()}-${randomUUID().slice(0, 8)}.png`;
  const trimmed = raw?.trim();
  if (!trimmed) {
    return fallback;
  }
  // Strip path separators and invalid characters, and make sure it ends in .png.
  const base = trimmed.replace(/[\\/]+/g, '_').replace(/[\u0000-\u001f<>:"|?*]/g, '').trim();
  if (!base) {
    return fallback;
  }
  return base.toLowerCase().endsWith('.png') ? base.slice(0, 255) : `${base}.png`.slice(0, 255);
}

/**
 * Generate an image with gpt-image-2 and store it as a courseware asset (OSS + DB, with the organization storage quota).
 */
export async function runCoursewareImageGenerate(
  req: IncomingMessage,
  session: AinobiAuthorizedSession,
  input: CoursewareImageGenerateInput,
): Promise<CoursewareImageGenerateResult> {
  const prompt = input.prompt?.trim();
  if (!prompt) {
    throw new AinobiCliError('USAGE', 'prompt is required.');
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new AinobiCliError('USAGE', `prompt must be at most ${MAX_PROMPT_CHARS} characters.`);
  }

  const coursewareId = input.courseware_id?.trim();
  if (!coursewareId) {
    throw new AinobiCliError('USAGE', 'courseware_id is required.');
  }

  // Write permission check (same as asset upload), with the courseware record's org as the storage quota and billing owner.
  const { courseware } = await loadCoursewareByIdWithRequestAccess(req, coursewareId, 'write');
  const orgId = courseware.orgId ?? input.courseware_org_id?.trim() ?? null;
  if (!orgId) {
    throw new AinobiCliError('USAGE', 'Courseware org_id is not set.');
  }

  const generated = await generateImageWithOpenAi({
    prompt,
    size: input.size,
    quality: input.quality,
  });

  const buffer = Buffer.from(generated.base64, 'base64');
  if (buffer.length === 0) {
    throw new AinobiCliError('IO_ERROR', 'Generated image is empty.');
  }
  const contentMd5 = createHash('md5').update(buffer).digest('hex');
  const fileName = sanitizeFileName(input.file_name);

  const tmpDir = await mkdtemp(join(tmpdir(), 'ainobi-image-generate-'));
  const tmpFile = join(tmpDir, 'image.png');
  try {
    await writeFile(tmpFile, buffer);
    const finalized = await finalizeCoursewareAssetUpload({
      req,
      coursewareId,
      coursewareOrgId: orgId,
      fileName,
      contentMd5,
      extension: '.png',
      fileSize: buffer.length,
      tmpFilePath: tmpFile,
    });
    return {
      asset: finalized.asset,
      model: generated.model,
      size: generated.size,
      quality: generated.quality,
      usage: generated.usage,
      orgId,
      coursewareId,
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function mapImageGenerateErrorStatus(error: unknown): number {
  if (error instanceof CoursewareAssetUploadFinalizeError) {
    return error.status;
  }
  if (error instanceof CoursewareOrgAccessError) {
    return error.status;
  }
  if (error instanceof AinobiCliError) {
    if (error.code === 'USAGE' || error.code === 'INVALID_INPUT' || error.code === 'VALIDATION_ERROR') {
      return 400;
    }
    if (error.code === 'NOT_FOUND') {
      return 404;
    }
    if (error.code === 'UNSUPPORTED') {
      return 415;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/prompt is required|must be at most|Unsupported image/i.test(message)) {
    return 400;
  }
  if (/do not have access/i.test(message)) {
    return 403;
  }
  if (/not found/i.test(message)) {
    return 404;
  }
  if (/requires OPENAI_API_KEY/i.test(message)) {
    return 503;
  }
  return 502;
}
