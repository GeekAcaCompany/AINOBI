// SPDX-License-Identifier: AGPL-3.0-only
import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import {
  AinobiCreditsConsumeError,
  isContentTemplateExtractCreditsConsumptionEnabled,
  isDesignTemplateExtractCreditsConsumptionEnabled,
  resolveContentTemplateExtractCreditsServiceCode,
  resolveCreditsOrgId,
  resolveDesignTemplateExtractCreditsServiceCode,
  type CreditsConsumeResult,
} from './ainobi-credits.ts';
import { consumeAinobiCredits } from './credits-consume-retry.ts';

export type TemplateExtractTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type TemplateExtractBillingOutcome =
  | { kind: 'charged'; result: CreditsConsumeResult; serviceCode: string; usage: TemplateExtractTokenUsage }
  | { kind: 'failed'; error: string; status?: number; usage: TemplateExtractTokenUsage }
  | { kind: 'skipped'; reason: 'disabled' | 'zero_tokens'; usage: TemplateExtractTokenUsage };

export type TemplateExtractKind = 'design' | 'content';

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

function billableTotal(usage: TemplateExtractTokenUsage): number {
  const total = usage.totalTokens || usage.inputTokens + usage.outputTokens;
  return total > 0 ? total : 0;
}

function isEnabled(kind: TemplateExtractKind): boolean {
  return kind === 'design'
    ? isDesignTemplateExtractCreditsConsumptionEnabled()
    : isContentTemplateExtractCreditsConsumptionEnabled();
}

function resolveServiceCode(kind: TemplateExtractKind): string | null {
  return kind === 'design'
    ? resolveDesignTemplateExtractCreditsServiceCode()
    : resolveContentTemplateExtractCreditsServiceCode();
}

function label(kind: TemplateExtractKind): string {
  return kind === 'design' ? 'Design template extract' : 'Content template extract';
}

export type BillTemplateExtractCreditsArgs = {
  kind: TemplateExtractKind;
  session: AinobiAuthorizedSession;
  usage: TemplateExtractTokenUsage;
  model: string;
  orgId: string;
  templateName: string;
  sourceType: string;
  coursewareId?: string;
  assetId?: string;
};

/**
 * Billing for design/content template extraction (text LLM, TokenBased). Returns skipped when disabled; never throws on a consume failure.
 */
export async function billTemplateExtractCredits(
  args: BillTemplateExtractCreditsArgs,
): Promise<TemplateExtractBillingOutcome> {
  if (!isEnabled(args.kind)) {
    return { kind: 'skipped', reason: 'disabled', usage: args.usage };
  }
  const total = billableTotal(args.usage);
  if (total <= 0) {
    console.info(`[credits] ${args.kind} template extract billing skipped (no token usage reported)`);
    return { kind: 'skipped', reason: 'zero_tokens', usage: args.usage };
  }

  const serviceCode = resolveServiceCode(args.kind);
  if (!serviceCode) {
    return { kind: 'skipped', reason: 'disabled', usage: args.usage };
  }

  const contentParts = [
    label(args.kind),
    `model=${args.model}`,
    `name=${args.templateName.trim() || 'untitled'}`,
    `source=${args.sourceType}`,
  ];
  if (args.coursewareId?.trim()) contentParts.push(`courseware=${args.coursewareId.trim()}`);
  if (args.assetId?.trim()) contentParts.push(`asset=${args.assetId.trim()}`);
  contentParts.push(`tokens=${total}`);

  try {
    const result = await consumeAinobiCredits(
      args.session.accessToken,
      {
        serviceCode,
        orgId: resolveCreditsOrgId(args.orgId),
        amountUnit: 'tokens',
        amount: String(total),
        inputTokens: args.usage.inputTokens,
        outputTokens: args.usage.outputTokens,
        content: clampContent(contentParts.join(', ')),
        // Billing feature category: courseware authoring (template extraction)
        usageType: 'courseware',
      },
      { phase: 'direct' },
    );
    console.info(
      `[credits] ${args.kind} template extract service=${result.serviceCode} tokens=${total} credits=${result.creditsConsumed}`,
    );
    return { kind: 'charged', result, serviceCode, usage: args.usage };
  } catch (error) {
    const { message, status } = mapConsumeError(error);
    console.warn(`[credits] ${args.kind} template extract billing failed:`, message);
    return { kind: 'failed', error: message, status, usage: args.usage };
  }
}

export async function billDesignTemplateExtractCredits(
  args: Omit<BillTemplateExtractCreditsArgs, 'kind'>,
): Promise<TemplateExtractBillingOutcome> {
  return billTemplateExtractCredits({ ...args, kind: 'design' });
}

export async function billContentTemplateExtractCredits(
  args: Omit<BillTemplateExtractCreditsArgs, 'kind'>,
): Promise<TemplateExtractBillingOutcome> {
  return billTemplateExtractCredits({ ...args, kind: 'content' });
}
