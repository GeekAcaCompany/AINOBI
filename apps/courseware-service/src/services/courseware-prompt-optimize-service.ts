// SPDX-License-Identifier: AGPL-3.0-only
import { AinobiCliError } from '@ainobi/courseware-cli/cli/errors.ts';
import {
  optimizeImagePrompt,
  type OptimizePromptUsage,
} from '@ainobi/courseware-cli/cli/prompt-optimize.ts';
import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import { resolveCoursewarePlatformOrgId } from './courseware-platform-org.ts';

export type CoursewarePromptOptimizeInput = {
  prompt: string;
  courseware_id?: string;
  courseware_org_id?: string;
  conversation_id?: string;
};

export type CoursewarePromptOptimizeResult = {
  optimizedPrompt: string;
  model: string;
  usage: OptimizePromptUsage;
  orgId: string | null;
};

const MAX_PROMPT_CHARS = 4000;

export const COURSEWARE_PROMPT_OPTIMIZE_MAX_PROMPT_CHARS = MAX_PROMPT_CHARS;

/**
 * Optimize an image generation prompt (text LLM). With a courseware context, the platform organization is resolved for billing ownership.
 */
export async function runCoursewarePromptOptimize(
  session: AinobiAuthorizedSession,
  input: CoursewarePromptOptimizeInput,
): Promise<CoursewarePromptOptimizeResult> {
  const prompt = input.prompt?.trim();
  if (!prompt) {
    throw new AinobiCliError('USAGE', 'prompt is required.');
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new AinobiCliError('USAGE', `prompt must be at most ${MAX_PROMPT_CHARS} characters.`);
  }

  let orgId: string | null = null;
  if (input.courseware_id?.trim() || input.courseware_org_id?.trim()) {
    const resolved = await resolveCoursewarePlatformOrgId(
      session,
      {
        courseware_id: input.courseware_id,
        courseware_org_id: input.courseware_org_id,
      },
      { access: 'manage' },
    );
    orgId = resolved.orgId;
  }

  const optimized = await optimizeImagePrompt(prompt);
  return {
    optimizedPrompt: optimized.optimizedPrompt,
    model: optimized.model,
    usage: optimized.usage,
    orgId,
  };
}

export function mapPromptOptimizeErrorStatus(error: unknown): number {
  if (error instanceof AinobiCliError) {
    if (error.code === 'USAGE' || error.code === 'INVALID_INPUT' || error.code === 'VALIDATION_ERROR') {
      return 400;
    }
    if (error.code === 'NOT_FOUND') {
      return 404;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/prompt is required|must be at most/i.test(message)) {
    return 400;
  }
  if (/do not have access/i.test(message)) {
    return 403;
  }
  if (/requires OPENAI_API_KEY/i.test(message)) {
    return 503;
  }
  return 502;
}
