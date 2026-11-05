// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from 'node:http';

import { getAuthorizedSession } from '../api-auth.ts';
import { sendJsonWithCors } from '../http/cors.ts';
import { readJsonBody } from '../http/request.ts';
import { preauthPromptOptimizeCredits, settlePromptOptimizeCredits } from './courseware-image-ai-credits.ts';
import { resolveCoursewarePlatformOrgId } from './courseware-platform-org.ts';
import {
  COURSEWARE_PROMPT_OPTIMIZE_MAX_PROMPT_CHARS,
  mapPromptOptimizeErrorStatus,
  runCoursewarePromptOptimize,
  type CoursewarePromptOptimizeInput,
} from './courseware-prompt-optimize-service.ts';

type PromptOptimizeBody = {
  prompt?: string;
  courseware_id?: string;
  courseware_org_id?: string;
  conversation_id?: string;
};

function parseBody(raw: PromptOptimizeBody): CoursewarePromptOptimizeInput | null {
  const prompt = raw.prompt?.trim();
  if (!prompt) {
    return null;
  }
  return {
    prompt,
    courseware_id: raw.courseware_id?.trim() || undefined,
    courseware_org_id: raw.courseware_org_id?.trim() || undefined,
    conversation_id: raw.conversation_id?.trim() || undefined,
  };
}

/**
 * POST `/courseware/prompt/optimize` — optimize an image generation prompt (text LLM) and bill it.
 */
export async function handleCoursewarePromptOptimize(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const session = getAuthorizedSession(req);
  if (!session) {
    sendJsonWithCors(res, 401, { ok: false, error: 'Unauthorized' });
    return;
  }

  let raw: PromptOptimizeBody;
  try {
    raw = await readJsonBody<PromptOptimizeBody>(req);
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
      error: 'Invalid body: non-empty prompt is required.',
    });
    return;
  }

  try {
    // Validate before charging (same rationale as the image-generate endpoint): the
    // preauth consume has no refund path, so deterministically-failing input must fail free.
    if (payload.prompt.length > COURSEWARE_PROMPT_OPTIMIZE_MAX_PROMPT_CHARS) {
      sendJsonWithCors(res, 400, {
        ok: false,
        error: `prompt must be at most ${COURSEWARE_PROMPT_OPTIMIZE_MAX_PROMPT_CHARS} characters.`,
      });
      return;
    }
    if (!process.env.OPENAI_API_KEY?.trim()) {
      sendJsonWithCors(res, 503, {
        ok: false,
        error: 'Prompt optimization requires OPENAI_API_KEY on the host.',
      });
      return;
    }

    // Bill first (same contract as the image-generate endpoint and the MCP media tool):
    // resolve the billing org the way runCoursewarePromptOptimize does, then block the LLM
    // call when the credits preauth fails — the old post-hoc billing never enforced balance.
    let billingOrgId: string | null = null;
    if (payload.courseware_id?.trim() || payload.courseware_org_id?.trim()) {
      const resolved = await resolveCoursewarePlatformOrgId(
        session,
        {
          courseware_id: payload.courseware_id,
          courseware_org_id: payload.courseware_org_id,
        },
        { access: 'manage' },
      );
      billingOrgId = resolved.orgId;
    }
    let preauthTokens = 0;
    let preauthCharged: Awaited<ReturnType<typeof preauthPromptOptimizeCredits>> | null = null;
    const preauth = await preauthPromptOptimizeCredits({
      session,
      model:
        process.env.OPENAI_PROMPT_OPTIMIZE_MODEL?.trim() ||
        process.env.OPENAI_MODEL?.trim() ||
        'prompt-optimize',
      coursewareOrgId: billingOrgId,
      coursewareId: payload.courseware_id,
      conversationId: payload.conversation_id,
    });
    if (preauth.kind === 'failed') {
      // Only the platform's 402 (insufficient balance) is the caller's fault; other
      // billing-backend statuses must not leak (the student requester force-logs-out on 401).
      sendJsonWithCors(res, preauth.status === 402 ? 402 : 502, {
        ok: false,
        error: `Prompt optimize credits preauth failed: ${preauth.error}`,
      });
      return;
    }
    if (preauth.kind === 'charged') {
      preauthTokens = preauth.preauthTokens;
      preauthCharged = preauth;
    }

    const data = await runCoursewarePromptOptimize(session, payload);

    // Settlement failure keeps the optimized prompt (the consume-retry worker re-collects).
    let creditsBilling: Record<string, unknown> | undefined;
    const billing = await settlePromptOptimizeCredits({
      session,
      usage: data.usage,
      model: data.model,
      coursewareOrgId: data.orgId,
      coursewareId: payload.courseware_id,
      conversationId: payload.conversation_id,
      preauthTokens,
    });
    if (billing.kind === 'charged') {
      creditsBilling = {
        creditsPromptOptimize: {
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
      // Preauth covered the whole turn (settlement skipped): still report the charge.
      creditsBilling = {
        creditsPromptOptimize: {
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
      creditsBilling = { creditsPromptOptimizeError: billing.error };
    }

    sendJsonWithCors(res, 200, {
      ok: true,
      data: {
        optimized_prompt: data.optimizedPrompt,
        model: data.model,
      },
      ...creditsBilling,
    });
  } catch (error) {
    const status = mapPromptOptimizeErrorStatus(error);
    sendJsonWithCors(res, status, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
