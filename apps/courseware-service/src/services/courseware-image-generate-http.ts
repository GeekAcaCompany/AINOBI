// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from 'node:http';

import { getAuthorizedSession } from '../api-auth.ts';
import { ensureDataSource } from '../db/ensure-data-source.ts';
import { sendJsonWithCors } from '../http/cors.ts';
import { readJsonBody } from '../http/request.ts';
import { preauthImageGenerateCredits, settleImageGenerateCredits } from './courseware-image-ai-credits.ts';
import { loadCoursewareByIdWithRequestAccess } from './courseware-org-guard.ts';
import {
  COURSEWARE_IMAGE_GENERATE_MAX_PROMPT_CHARS,
  mapImageGenerateErrorStatus,
  runCoursewareImageGenerate,
  type CoursewareImageGenerateInput,
} from './courseware-image-generate-service.ts';
import {
  normalizeImageQuality,
  normalizeImageSize,
  resolveImageModel,
} from '@ainobi/courseware-cli/cli/image-generate.ts';

type ImageGenerateBody = {
  prompt?: string;
  size?: string;
  quality?: string;
  file_name?: string;
  courseware_id?: string;
  courseware_org_id?: string;
  conversation_id?: string;
};

function parseBody(raw: ImageGenerateBody): CoursewareImageGenerateInput | null {
  const prompt = raw.prompt?.trim();
  const coursewareId = raw.courseware_id?.trim();
  if (!prompt || !coursewareId) {
    return null;
  }
  return {
    prompt,
    size: raw.size?.trim() || undefined,
    quality: raw.quality?.trim() || undefined,
    file_name: raw.file_name?.trim() || undefined,
    courseware_id: coursewareId,
    courseware_org_id: raw.courseware_org_id?.trim() || undefined,
    conversation_id: raw.conversation_id?.trim() || undefined,
  };
}

/**
 * POST `/courseware/image/generate` — generate an image with gpt-image-2, store it as a courseware asset and bill it.
 * Shared by manual image generation in the editor and the agent CLI (host flush).
 */
export async function handleCoursewareImageGenerate(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const session = getAuthorizedSession(req);
  if (!session) {
    sendJsonWithCors(res, 401, { ok: false, error: 'Unauthorized' });
    return;
  }

  let raw: ImageGenerateBody;
  try {
    raw = await readJsonBody<ImageGenerateBody>(req);
  } catch (error) {
    sendJsonWithCors(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const payload = parseBody(raw);
  if (!payload) {
    sendJsonWithCors(res, 400, {
      ok: false,
      error: 'Invalid body: non-empty prompt and courseware_id are required.',
    });
    return;
  }

  try {
    await ensureDataSource();

    // Validate before charging: everything the service would deterministically reject
    // (oversized prompt, malformed size/quality, missing provider config) must fail for
    // free — the preauth consume has no refund path, so charging first would bill
    // requests that can never run (the agent CLI host-flush path forwards model-authored
    // prompts unvalidated, so this is reachable, not hypothetical).
    if (payload.prompt.length > COURSEWARE_IMAGE_GENERATE_MAX_PROMPT_CHARS) {
      sendJsonWithCors(res, 400, {
        ok: false,
        error: `prompt must be at most ${COURSEWARE_IMAGE_GENERATE_MAX_PROMPT_CHARS} characters.`,
      });
      return;
    }
    try {
      normalizeImageSize(payload.size);
      normalizeImageQuality(payload.quality);
    } catch (error) {
      sendJsonWithCors(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (!process.env.OPENAI_API_KEY?.trim()) {
      sendJsonWithCors(res, 503, {
        ok: false,
        error: 'Image generation requires OPENAI_API_KEY on the host.',
      });
      return;
    }

    // Bill first (same contract as the MCP media tool): resolve the billing org from the
    // courseware record the way runCoursewareImageGenerate does, and refuse the OpenAI/OSS
    // work when the credits preauth fails. Without this gate a zero-balance account could
    // generate images for free (the post-hoc billing failure was only recorded, never enforced).
    const { courseware } = await loadCoursewareByIdWithRequestAccess(req, payload.courseware_id, 'write');
    const billingOrgId = courseware.orgId ?? payload.courseware_org_id?.trim() ?? null;
    let preauthTokens = 0;
    let preauthCharged: Awaited<ReturnType<typeof preauthImageGenerateCredits>> | null = null;
    if (billingOrgId) {
      const preauth = await preauthImageGenerateCredits({
        session,
        model: resolveImageModel(),
        coursewareOrgId: billingOrgId,
        coursewareId: payload.courseware_id,
        conversationId: payload.conversation_id,
      });
      if (preauth.kind === 'failed') {
        // Only the platform's 402 (insufficient balance) is the caller's fault; any other
        // billing-backend status (401/403/5xx) must not leak through as this endpoint's
        // status — the student requester force-logs-out on 401.
        sendJsonWithCors(res, preauth.status === 402 ? 402 : 502, {
          ok: false,
          error: `Image credits preauth failed: ${preauth.error}`,
        });
        return;
      }
      if (preauth.kind === 'charged') {
        preauthTokens = preauth.preauthTokens;
        preauthCharged = preauth;
      }
    }

    const data = await runCoursewareImageGenerate(req, session, payload);

    // Settlement failure keeps the generated asset (the consume-retry worker re-collects);
    // the response records the error the way the old post-hoc billing did.
    let creditsBilling: Record<string, unknown> | undefined;
    const billing = await settleImageGenerateCredits({
      session,
      usage: data.usage,
      model: data.model,
      coursewareOrgId: data.orgId,
      coursewareId: data.coursewareId,
      conversationId: payload.conversation_id,
      preauthTokens,
    });
    if (billing.kind === 'charged') {
      creditsBilling = {
        creditsImage: {
          serviceCode: billing.result.serviceCode,
          inputTokens: data.usage.inputTokens,
          outputTokens: data.usage.outputTokens,
          totalTokens: data.usage.totalTokens,
          preauthTokens,
          creditsConsumed: billing.result.creditsConsumed,
          remainingCredits: billing.result.remainingCredits,
        },
      };
    } else if (preauthCharged) {
      // Preauth covered the whole turn (settlement skipped): still report the charge,
      // the same fallback the MCP media tool uses.
      creditsBilling = {
        creditsImage: {
          serviceCode: preauthCharged.serviceCode,
          inputTokens: data.usage.inputTokens,
          outputTokens: data.usage.outputTokens,
          totalTokens: data.usage.totalTokens,
          preauthTokens,
          creditsConsumed: preauthCharged.result.creditsConsumed,
          remainingCredits: preauthCharged.result.remainingCredits,
        },
      };
    } else if (billing.kind === 'failed') {
      creditsBilling = { creditsImageError: billing.error };
    }

    sendJsonWithCors(res, 200, {
      ok: true,
      data: {
        asset: data.asset,
        model: data.model,
        size: data.size,
        quality: data.quality,
        usage: data.usage,
      },
      ...creditsBilling,
    });
  } catch (error) {
    const status = mapImageGenerateErrorStatus(error);
    sendJsonWithCors(res, status, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
