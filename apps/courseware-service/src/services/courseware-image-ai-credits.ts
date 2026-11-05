// SPDX-License-Identifier: AGPL-3.0-only
import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import {
  AinobiCreditsConsumeError,
  isImageGenerateCreditsConsumptionEnabled,
  isPromptOptimizeCreditsConsumptionEnabled,
  resolveCreditsOrgId,
  resolveImageGenerateCreditsServiceCode,
  resolvePromptOptimizeCreditsServiceCode,
  type CreditsConsumeResult,
} from './ainobi-credits.ts';
import { consumeAinobiCredits } from './credits-consume-retry.ts';

export type ImageAiTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type ImageAiBillingOutcome =
  | { kind: 'charged'; result: CreditsConsumeResult; serviceCode: string; usage: ImageAiTokenUsage }
  | { kind: 'failed'; error: string; status?: number; usage: ImageAiTokenUsage }
  | { kind: 'skipped'; reason: 'disabled' | 'zero_tokens'; usage: ImageAiTokenUsage };

function clampContent(content: string): string {
  return content.length <= 300 ? content : `${content.slice(0, 297)}...`;
}

function mapConsumeError(error: unknown): { message: string; status?: number } {
  if (error instanceof AinobiCreditsConsumeError) {
    return { message: error.message, status: error.status };
  }
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: String(error) };
}

function billableTotal(usage: ImageAiTokenUsage): number {
  const total = usage.totalTokens || usage.inputTokens + usage.outputTokens;
  return total > 0 ? total : 0;
}

export type BillImageAiArgs = {
  session: AinobiAuthorizedSession;
  usage: ImageAiTokenUsage;
  model: string;
  coursewareOrgId?: string | null;
  coursewareId?: string;
  conversationId?: string;
};

/**
 * Tokens reserved before OpenAI image generation; settlement bills the remainder, so a turn's
 * total charge is max(actual usage, preauth). Keep the default at or below the typical usage
 * (observed gpt-image-2 totals: 236-370 tokens) so users are billed the actual usage, not the
 * reservation — the preauth exists to gate availability, not to round the price up.
 */
export function resolveImageGeneratePreauthTokens(): number {
  const n = Number(process.env.AINOBI_IMAGE_GENERATE_PREAUTH_TOKENS ?? 200);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200;
}

/** Same reservation semantics for prompt optimization (observed text-LLM totals: ~1400-1500 tokens). */
export function resolvePromptOptimizePreauthTokens(): number {
  const n = Number(process.env.AINOBI_PROMPT_OPTIMIZE_PREAUTH_TOKENS ?? 500);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 500;
}

export type ImageGeneratePreauthOutcome =
  | { kind: 'charged'; result: CreditsConsumeResult; serviceCode: string; preauthTokens: number }
  | { kind: 'failed'; error: string; status?: number; preauthTokens: number }
  | { kind: 'skipped'; reason: 'disabled'; preauthTokens: number };

export type ImageAiPreauthArgs = {
  session: AinobiAuthorizedSession;
  model: string;
  coursewareOrgId?: string | null;
  coursewareId?: string;
  conversationId?: string;
};

async function preauthImageAiCredits(
  logLabel: string,
  contentLabel: string,
  isEnabled: () => boolean,
  serviceCodeOf: () => string | null,
  preauthTokens: number,
  args: ImageAiPreauthArgs,
): Promise<ImageGeneratePreauthOutcome> {
  if (!isEnabled()) {
    return { kind: 'skipped', reason: 'disabled', preauthTokens };
  }
  const serviceCode = serviceCodeOf();
  if (!serviceCode) {
    return { kind: 'skipped', reason: 'disabled', preauthTokens };
  }

  const contentParts = [contentLabel, `model=${args.model}`];
  if (args.coursewareId?.trim()) contentParts.push(`courseware=${args.coursewareId.trim()}`);
  if (args.conversationId?.trim()) contentParts.push(`conversation=${args.conversationId.trim()}`);
  contentParts.push(`tokens=${preauthTokens}`);

  try {
    const result = await consumeAinobiCredits(
      args.session.accessToken,
      {
        serviceCode,
        orgId: resolveCreditsOrgId(args.coursewareOrgId),
        amountUnit: 'tokens',
        amount: String(preauthTokens),
        inputTokens: preauthTokens,
        outputTokens: 0,
        content: clampContent(contentParts.join(', ')),
        usageType: 'courseware',
      },
      { phase: 'preauth', conversationId: args.conversationId },
    );
    console.info(
      `[credits] ${logLabel} preauth service=${result.serviceCode} tokens=${preauthTokens} credits=${result.creditsConsumed}`,
    );
    return { kind: 'charged', result, serviceCode, preauthTokens };
  } catch (error) {
    const { message, status } = mapConsumeError(error);
    console.warn(`[credits] ${logLabel} preauth failed:`, message);
    return { kind: 'failed', error: message, status, preauthTokens };
  }
}

/** Pre-authorize image credits before calling OpenAI (blocks generation when charge fails). */
export async function preauthImageGenerateCredits(
  args: ImageAiPreauthArgs,
): Promise<ImageGeneratePreauthOutcome> {
  return preauthImageAiCredits(
    'image generate',
    'Courseware AI Image Generation preauth',
    isImageGenerateCreditsConsumptionEnabled,
    resolveImageGenerateCreditsServiceCode,
    resolveImageGeneratePreauthTokens(),
    args,
  );
}

/** Pre-authorize prompt-optimization credits before the text LLM call (blocks it when charge fails). */
export async function preauthPromptOptimizeCredits(
  args: ImageAiPreauthArgs,
): Promise<ImageGeneratePreauthOutcome> {
  return preauthImageAiCredits(
    'prompt optimize',
    'Courseware AI Prompt Optimization preauth',
    isPromptOptimizeCreditsConsumptionEnabled,
    resolvePromptOptimizeCreditsServiceCode,
    resolvePromptOptimizePreauthTokens(),
    args,
  );
}

/** Usage left to settle after a preauth consumed `preauthTokens`; null when the preauth already covers it. */
export function settleRemainderUsage(
  usage: ImageAiTokenUsage,
  preauthTokens: number,
): ImageAiTokenUsage | null {
  const total = billableTotal(usage);
  const remainder = Math.max(0, total - preauthTokens);
  if (remainder <= 0) {
    return null;
  }
  return {
    inputTokens: Math.max(0, usage.inputTokens - preauthTokens),
    outputTokens: usage.outputTokens,
    totalTokens: remainder,
  };
}

async function settleImageAiCredits(
  logLabel: string,
  preauthTokens: number,
  usage: ImageAiTokenUsage,
  bill: (usage: ImageAiTokenUsage) => Promise<ImageAiBillingOutcome>,
): Promise<ImageAiBillingOutcome> {
  const remainder = settleRemainderUsage(usage, preauthTokens);
  if (!remainder) {
    console.info(
      `[credits] ${logLabel} settlement skipped total=${billableTotal(usage)} preauth=${preauthTokens}`,
    );
    return { kind: 'skipped', reason: 'zero_tokens', usage };
  }
  return bill(remainder);
}

/**
 * Settle image token usage after generation: charge max(0, total - preauth).
 */
export async function settleImageGenerateCredits(args: BillImageAiArgs & {
  preauthTokens: number;
}): Promise<ImageAiBillingOutcome> {
  return settleImageAiCredits('image generate', args.preauthTokens, args.usage, (usage) =>
    billImageGenerateCredits({ ...args, usage }),
  );
}

/** Settle prompt-optimization token usage: charge max(0, total - preauth). */
export async function settlePromptOptimizeCredits(args: BillImageAiArgs & {
  preauthTokens: number;
}): Promise<ImageAiBillingOutcome> {
  return settleImageAiCredits('prompt optimize', args.preauthTokens, args.usage, (usage) =>
    billPromptOptimizeCredits({ ...args, usage }),
  );
}

/**
 * Image generation billing (gpt-image-2, TokenBased). Returns skipped when disabled; never throws on a consume failure (the caller records it).
 */
export async function billImageGenerateCredits(
  args: BillImageAiArgs,
): Promise<ImageAiBillingOutcome> {
  if (!isImageGenerateCreditsConsumptionEnabled()) {
    return { kind: 'skipped', reason: 'disabled', usage: args.usage };
  }
  const total = billableTotal(args.usage);
  if (total <= 0) {
    console.info('[credits] image generate billing skipped (no token usage reported)');
    return { kind: 'skipped', reason: 'zero_tokens', usage: args.usage };
  }

  const serviceCode = resolveImageGenerateCreditsServiceCode();
  if (!serviceCode) {
    return { kind: 'skipped', reason: 'disabled', usage: args.usage };
  }

  const contentParts = ['Courseware AI Image Generation', `model=${args.model}`];
  if (args.coursewareId?.trim()) contentParts.push(`courseware=${args.coursewareId.trim()}`);
  if (args.conversationId?.trim()) contentParts.push(`conversation=${args.conversationId.trim()}`);
  contentParts.push(`tokens=${total}`);

  try {
    const result = await consumeAinobiCredits(
      args.session.accessToken,
      {
        serviceCode,
        orgId: resolveCreditsOrgId(args.coursewareOrgId),
        amountUnit: 'tokens',
        amount: String(total),
        inputTokens: args.usage.inputTokens,
        outputTokens: args.usage.outputTokens,
        content: clampContent(contentParts.join(', ')),
        // Billing feature category: courseware authoring (image generation)
        usageType: 'courseware',
      },
      { phase: 'direct', conversationId: args.conversationId },
    );
    console.info(
      `[credits] image generate service=${result.serviceCode} tokens=${total} credits=${result.creditsConsumed}`,
    );
    return { kind: 'charged', result, serviceCode, usage: args.usage };
  } catch (error) {
    const { message, status } = mapConsumeError(error);
    console.warn('[credits] image generate billing failed:', message);
    return { kind: 'failed', error: message, status, usage: args.usage };
  }
}

/**
 * Prompt optimization billing (text LLM, TokenBased). Same behavior as above.
 */
export async function billPromptOptimizeCredits(
  args: BillImageAiArgs,
): Promise<ImageAiBillingOutcome> {
  if (!isPromptOptimizeCreditsConsumptionEnabled()) {
    return { kind: 'skipped', reason: 'disabled', usage: args.usage };
  }
  const total = billableTotal(args.usage);
  if (total <= 0) {
    console.info('[credits] prompt optimize billing skipped (no token usage reported)');
    return { kind: 'skipped', reason: 'zero_tokens', usage: args.usage };
  }

  const serviceCode = resolvePromptOptimizeCreditsServiceCode();
  if (!serviceCode) {
    return { kind: 'skipped', reason: 'disabled', usage: args.usage };
  }

  const contentParts = ['Courseware Image Prompt Optimization', `model=${args.model}`];
  if (args.coursewareId?.trim()) contentParts.push(`courseware=${args.coursewareId.trim()}`);
  if (args.conversationId?.trim()) contentParts.push(`conversation=${args.conversationId.trim()}`);
  contentParts.push(`tokens=${total}`);

  try {
    const result = await consumeAinobiCredits(
      args.session.accessToken,
      {
        serviceCode,
        orgId: resolveCreditsOrgId(args.coursewareOrgId),
        amountUnit: 'tokens',
        amount: String(total),
        inputTokens: args.usage.inputTokens,
        outputTokens: args.usage.outputTokens,
        content: clampContent(contentParts.join(', ')),
        // Billing feature category: courseware authoring (prompt optimization)
        usageType: 'courseware',
      },
      { phase: 'direct', conversationId: args.conversationId },
    );
    console.info(
      `[credits] prompt optimize service=${result.serviceCode} tokens=${total} credits=${result.creditsConsumed}`,
    );
    return { kind: 'charged', result, serviceCode, usage: args.usage };
  } catch (error) {
    const { message, status } = mapConsumeError(error);
    console.warn('[credits] prompt optimize billing failed:', message);
    return { kind: 'failed', error: message, status, usage: args.usage };
  }
}
