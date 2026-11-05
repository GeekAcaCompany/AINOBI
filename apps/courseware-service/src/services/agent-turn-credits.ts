// SPDX-License-Identifier: AGPL-3.0-only
import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import {
  AinobiCreditsConsumeError,
  isAgentCreditsConsumptionEnabled,
  normalizeAinobiServiceCode,
  resolveAgentCreditsServiceCode,
  resolveCreditsOrgId,
  type CreditsConsumeResult,
} from './ainobi-credits.ts';
import { consumeAinobiCredits } from './credits-consume-retry.ts';
import { getToolResultArchiveTurnStats } from './agent-tool-result-archive.ts';

export const DEFAULT_CREDITS_PREAUTH_TOKENS = 5000;

export type AgentTurnTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  numTurns: number;
};

export type AgentTurnPreauthOutcome =
  | { ok: true; result: CreditsConsumeResult; preauthTokens: number }
  | { ok: false; error: string; status?: number; preauthTokens: number };

export type AgentTurnSettlementOutcome =
  | {
      kind: 'skipped';
      usage: AgentTurnTokenUsage;
      preauthTokens: number;
      billableTokens: 0;
      reason: 'within_preauth';
    }
  | {
      kind: 'charged';
      ok: true;
      result: CreditsConsumeResult;
      usage: AgentTurnTokenUsage;
      preauthTokens: number;
      billableTokens: number;
    }
  | {
      kind: 'charged';
      ok: false;
      error: string;
      status?: number;
      usage: AgentTurnTokenUsage;
      preauthTokens: number;
      billableTokens: number;
    };

export type AgentTurnBillingOutcome = {
  usage: AgentTurnTokenUsage;
  preauth: AgentTurnPreauthOutcome | null;
  settlement: AgentTurnSettlementOutcome | null;
};

/** Tokens reserved at chat start; settlement bills max(0, totalTokens - preauth). */
export function resolveCreditsPreauthTokens(): number {
  const raw = process.env.AINOBI_CREDITS_PREAUTH_TOKENS?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return DEFAULT_CREDITS_PREAUTH_TOKENS;
}

/** Billable tokens after subtracting preauth; null means no settlement charge. */
export function computeSettlementBillableTokens(totalTokens: number): number | null {
  const billable = totalTokens - resolveCreditsPreauthTokens();
  if (billable <= 0) {
    return null;
  }
  return billable;
}

/**
 * Split incremental billable tokens across input/output/cache in proportion to
 * actual SDK usage (so settlement does not bill the entire remainder as output).
 */
export function allocateBillableTokenBreakdown(
  usage: AgentTurnTokenUsage,
  billableTokens: number,
): { inputTokens: number; outputTokens: number; cacheTokens: number } {
  const cacheTokens = usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
  if (billableTokens <= 0) {
    return { inputTokens: 0, outputTokens: 0, cacheTokens: 0 };
  }
  if (usage.totalTokens <= 0) {
    return { inputTokens: 0, outputTokens: billableTokens, cacheTokens: 0 };
  }

  const buckets: Array<{ key: 'inputTokens' | 'outputTokens' | 'cacheTokens'; count: number }> =
    [];
  if (usage.inputTokens > 0) {
    buckets.push({ key: 'inputTokens', count: usage.inputTokens });
  }
  if (usage.outputTokens > 0) {
    buckets.push({ key: 'outputTokens', count: usage.outputTokens });
  }
  if (cacheTokens > 0) {
    buckets.push({ key: 'cacheTokens', count: cacheTokens });
  }

  if (buckets.length === 0) {
    return { inputTokens: 0, outputTokens: billableTokens, cacheTokens: 0 };
  }

  const result = { inputTokens: 0, outputTokens: 0, cacheTokens: 0 };
  let remaining = billableTokens;
  for (let i = 0; i < buckets.length; i += 1) {
    const bucket = buckets[i];
    const isLast = i === buckets.length - 1;
    const share = isLast
      ? remaining
      : Math.floor((billableTokens * bucket.count) / usage.totalTokens);
    remaining -= share;
    result[bucket.key] = share;
  }
  return result;
}

function readUsageCount(usage: SDKResultMessage['usage'], key: string): number {
  const raw = usage[key as keyof typeof usage];
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/** Cumulative token usage from the SDK result message (end of one query() call). */
export function extractAgentTurnTokenUsage(message: SDKResultMessage): AgentTurnTokenUsage {
  const usage = message.usage;
  const inputTokens = readUsageCount(usage, 'input_tokens');
  const outputTokens = readUsageCount(usage, 'output_tokens');
  const cacheCreationInputTokens = readUsageCount(usage, 'cache_creation_input_tokens');
  const cacheReadInputTokens = readUsageCount(usage, 'cache_read_input_tokens');
  const totalTokens =
    inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens;

  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalTokens,
    totalCostUsd:
      typeof message.total_cost_usd === 'number' && Number.isFinite(message.total_cost_usd)
        ? message.total_cost_usd
        : 0,
    numTurns: typeof message.num_turns === 'number' ? message.num_turns : 0,
  };
}

function scopeLabel(args: { conversationId?: string; claudeSessionId?: string }): string {
  if (args.conversationId?.trim()) {
    return `conversation ${args.conversationId.trim()}`;
  }
  if (args.claudeSessionId?.trim()) {
    return `session ${args.claudeSessionId.trim()}`;
  }
  return 'courseware agent';
}

function buildPreauthContent(args: {
  conversationId?: string;
  claudeSessionId?: string;
  preauthTokens: number;
}): string {
  const content = `Courseware Agent (${scopeLabel(args)}) preauth (${args.preauthTokens})`;
  return content.length <= 300 ? content : `${content.slice(0, 297)}...`;
}

function buildSettlementContent(args: {
  usage: AgentTurnTokenUsage;
  conversationId?: string;
  claudeSessionId?: string;
  preauthTokens: number;
  billableTokens: number;
}): string {
  const parts = [
    `Courseware Agent (${scopeLabel(args)}) settlement`,
    `total=${args.usage.totalTokens}`,
    `preauth=${args.preauthTokens}`,
    `bill=${args.billableTokens}`,
    `in=${args.usage.inputTokens} out=${args.usage.outputTokens}`,
  ];
  const content = parts.join(', ');
  return content.length <= 300 ? content : `${content.slice(0, 297)}...`;
}

async function consumeTokenAmount(args: {
  session: AinobiAuthorizedSession;
  coursewareOrgId?: string | null;
  amount: number;
  content: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheTokens?: number;
  phase: 'preauth' | 'settlement';
  conversationId?: string;
  claudeSessionId?: string;
  /** Override AINOBI_MODEL_CREDITS_SERVICE_CODE from env with the requested model */
  creditsServiceCode?: string | null;
}): Promise<CreditsConsumeResult> {
  const rawServiceCode = args.creditsServiceCode?.trim() || resolveAgentCreditsServiceCode();
  if (!rawServiceCode) {
    throw new AinobiCreditsConsumeError('AINOBI_MODEL_CREDITS_SERVICE_CODE is not configured', 500);
  }
  const serviceCode = normalizeAinobiServiceCode(rawServiceCode);
  return consumeAinobiCredits(
    args.session.accessToken,
    {
      serviceCode,
      orgId: resolveCreditsOrgId(args.coursewareOrgId),
      amountUnit: 'tokens',
      amount: String(args.amount),
      content: args.content,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      cacheTokens: args.cacheTokens,
      // Feature bucket for usage breakdown: courseware authoring agent turns
      usageType: 'courseware',
    },
    {
      phase: args.phase,
      conversationId: args.conversationId,
      claudeSessionId: args.claudeSessionId,
    },
  );
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

/**
 * Pre-deduct tokens when a chat turn starts. Returns null when billing is disabled.
 * On failure the caller should abort before running the agent.
 */
export async function preauthCreditsForAgentTurn(args: {
  session: AinobiAuthorizedSession;
  coursewareOrgId?: string | null;
  conversationId?: string;
  claudeSessionId?: string;
  creditsServiceCode?: string | null;
}): Promise<AgentTurnPreauthOutcome | null> {
  if (!isAgentCreditsConsumptionEnabled()) {
    return null;
  }

  const preauthTokens = resolveCreditsPreauthTokens();
  try {
    const result = await consumeTokenAmount({
      session: args.session,
      coursewareOrgId: args.coursewareOrgId,
      amount: preauthTokens,
      inputTokens: preauthTokens,
      content: buildPreauthContent({ ...args, preauthTokens }),
      phase: 'preauth',
      conversationId: args.conversationId,
      claudeSessionId: args.claudeSessionId,
      creditsServiceCode: args.creditsServiceCode,
    });
    console.info(
      `[credits] agent preauth service=${result.serviceCode} tokens=${preauthTokens} credits=${result.creditsConsumed}`,
    );
    return { ok: true, result, preauthTokens };
  } catch (error) {
    const { message, status } = mapConsumeError(error);
    console.warn('[credits] agent preauth failed:', message);
    return { ok: false, error: message, status, preauthTokens };
  }
}

/**
 * Settle token usage at turn end: charge max(0, totalTokens - preauthTokens).
 * Skips settlement when the remainder is <= 0 (preauth already covers this turn).
 */
export async function settleCreditsForAgentTurn(args: {
  session: AinobiAuthorizedSession;
  coursewareOrgId?: string | null;
  resultMessage: SDKResultMessage;
  conversationId?: string;
  claudeSessionId?: string;
  creditsServiceCode?: string | null;
}): Promise<AgentTurnSettlementOutcome | null> {
  if (!isAgentCreditsConsumptionEnabled()) {
    return null;
  }

  const usage = extractAgentTurnTokenUsage(args.resultMessage);
  const preauthTokens = resolveCreditsPreauthTokens();
  const billableTokens = computeSettlementBillableTokens(usage.totalTokens);

  if (billableTokens == null) {
    console.info(
      `[credits] agent settlement skipped total=${usage.totalTokens} preauth=${preauthTokens}`,
    );
    return {
      kind: 'skipped',
      usage,
      preauthTokens,
      billableTokens: 0,
      reason: 'within_preauth',
    };
  }

  const breakdown = allocateBillableTokenBreakdown(usage, billableTokens);
  try {
    const result = await consumeTokenAmount({
      session: args.session,
      coursewareOrgId: args.coursewareOrgId,
      amount: billableTokens,
      inputTokens: breakdown.inputTokens,
      outputTokens: breakdown.outputTokens,
      cacheTokens: breakdown.cacheTokens,
      content: buildSettlementContent({
        usage,
        conversationId: args.conversationId,
        claudeSessionId: args.claudeSessionId,
        preauthTokens,
        billableTokens,
      }),
      phase: 'settlement',
      conversationId: args.conversationId,
      claudeSessionId: args.claudeSessionId,
      creditsServiceCode: args.creditsServiceCode,
    });
    console.info(
      `[credits] agent settlement service=${result.serviceCode} billable=${billableTokens} ` +
        `total=${usage.totalTokens} in=${breakdown.inputTokens} out=${breakdown.outputTokens} ` +
        `cache=${breakdown.cacheTokens} credits=${result.creditsConsumed}`,
    );
    return {
      kind: 'charged',
      ok: true,
      result,
      usage,
      preauthTokens,
      billableTokens,
    };
  } catch (error) {
    const { message, status } = mapConsumeError(error);
    console.warn('[credits] agent settlement failed:', message);
    return {
      kind: 'charged',
      ok: false,
      error: message,
      status,
      usage,
      preauthTokens,
      billableTokens,
    };
  }
}

/** Preauth at start + settlement at end for one agent query() call. */
export async function billAgentTurnCredits(args: {
  session: AinobiAuthorizedSession;
  coursewareOrgId?: string | null;
  resultMessage: SDKResultMessage;
  conversationId?: string;
  claudeSessionId?: string;
  preauth: AgentTurnPreauthOutcome | null;
  creditsServiceCode?: string | null;
}): Promise<AgentTurnBillingOutcome | null> {
  const settlement = await settleCreditsForAgentTurn({
    session: args.session,
    coursewareOrgId: args.coursewareOrgId,
    resultMessage: args.resultMessage,
    conversationId: args.conversationId,
    claudeSessionId: args.claudeSessionId,
    creditsServiceCode: args.creditsServiceCode,
  });
  if (!args.preauth && !settlement) {
    return null;
  }

  const usage =
    settlement?.usage ?? extractAgentTurnTokenUsage(args.resultMessage);

  const archiveStats = getToolResultArchiveTurnStats(args.conversationId);
  if (archiveStats.count > 0) {
    console.info(
      `[tool-result-archive] turn conversationId=${args.conversationId ?? '-'} ` +
        `archived=${archiveStats.count} bytes=${archiveStats.bytes} ` +
        `tokens_in=${usage.inputTokens} tokens_out=${usage.outputTokens} total=${usage.totalTokens}`,
    );
  }

  return {
    usage,
    preauth: args.preauth,
    settlement,
  };
}

export function formatAgentTurnBillingForClient(
  billing: AgentTurnBillingOutcome | null,
): Record<string, unknown> {
  if (!billing) {
    return {};
  }

  const payload: Record<string, unknown> = {
    tokenUsage: {
      totalTokens: billing.usage.totalTokens,
      inputTokens: billing.usage.inputTokens,
      outputTokens: billing.usage.outputTokens,
      cacheTokens:
        billing.usage.cacheCreationInputTokens + billing.usage.cacheReadInputTokens,
      cacheCreationInputTokens: billing.usage.cacheCreationInputTokens,
      cacheReadInputTokens: billing.usage.cacheReadInputTokens,
      totalCostUsd: billing.usage.totalCostUsd,
      preauthTokens: billing.preauth?.preauthTokens ?? resolveCreditsPreauthTokens(),
      billableTokens:
        billing.settlement?.kind === 'charged'
          ? billing.settlement.billableTokens
          : 0,
    },
  };

  if (billing.preauth?.ok === true) {
    payload.creditsPreauth = {
      serviceCode: billing.preauth.result.serviceCode,
      tokens: billing.preauth.preauthTokens,
      creditsConsumed: billing.preauth.result.creditsConsumed,
      remainingCredits: billing.preauth.result.remainingCredits,
    };
  } else if (billing.preauth?.ok === false) {
    payload.creditsPreauthError = billing.preauth.error;
  }

  const settlement = billing.settlement;
  if (settlement?.kind === 'skipped') {
    payload.creditsSettlementSkipped = true;
  } else if (settlement?.kind === 'charged' && settlement.ok === true) {
    payload.creditsSettlement = {
      serviceCode: settlement.result.serviceCode,
      tokens: settlement.billableTokens,
      creditsConsumed: settlement.result.creditsConsumed,
      remainingCredits: settlement.result.remainingCredits,
    };
  } else if (settlement?.kind === 'charged' && settlement.ok === false) {
    payload.creditsSettlementError = settlement.error;
  }

  return payload;
}
