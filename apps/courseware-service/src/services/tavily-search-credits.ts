// SPDX-License-Identifier: AGPL-3.0-only
import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import {
  AinobiCreditsConsumeError,
  isTavilyCreditsConsumptionEnabled,
  resolveCreditsOrgId,
  resolveTavilyCreditsServiceCode,
  type CreditsConsumeResult,
} from './ainobi-credits.ts';
import { consumeAinobiCredits } from './credits-consume-retry.ts';

/** Billable units per successful Tavily search (CountBased on platform). */
export const TAVILY_SEARCH_BILLABLE_COUNT = 1;

export type TavilySearchBillingOutcome =
  | { kind: 'charged'; result: CreditsConsumeResult }
  | { kind: 'failed'; error: string; status?: number };

function truncateQuery(query: string, maxLen: number): string {
  const trimmed = query.trim();
  if (trimmed.length <= maxLen) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLen - 3)}...`;
}

function buildTavilyBillingContent(args: {
  query: string;
  conversationId?: string;
}): string {
  const parts = ['Courseware Tavily search'];
  const querySnippet = truncateQuery(args.query, 120);
  if (querySnippet) {
    parts.push(`q=${querySnippet}`);
  }
  if (args.conversationId?.trim()) {
    parts.push(`conversation=${args.conversationId.trim()}`);
  }
  parts.push(`count=${TAVILY_SEARCH_BILLABLE_COUNT}`);
  const content = parts.join(', ');
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

/**
 * Charge one Tavily search after a successful host search run.
 * Returns null when billing is disabled; does not throw on consume failure (caller logs).
 */
export async function billTavilySearchCredits(args: {
  session: AinobiAuthorizedSession;
  query: string;
  coursewareOrgId?: string | null;
  conversationId?: string;
}): Promise<TavilySearchBillingOutcome | null> {
  if (!isTavilyCreditsConsumptionEnabled()) {
    return null;
  }

  const serviceCode = resolveTavilyCreditsServiceCode();
  if (!serviceCode) {
    throw new AinobiCreditsConsumeError('AINOBI_TAVILY_CREDITS_SERVICE_CODE is not configured', 500);
  }

  try {
    const result = await consumeAinobiCredits(
      args.session.accessToken,
      {
        serviceCode,
        orgId: resolveCreditsOrgId(args.coursewareOrgId),
        amountUnit: 'tokens',
        amount: String(TAVILY_SEARCH_BILLABLE_COUNT),
        unitCount: TAVILY_SEARCH_BILLABLE_COUNT,
        count: TAVILY_SEARCH_BILLABLE_COUNT,
        content: buildTavilyBillingContent({
          query: args.query,
          conversationId: args.conversationId,
        }),
        // Feature bucket for usage breakdown: web search inside courseware authoring
        usageType: 'courseware',
      },
      {
        phase: 'tavily_search',
        conversationId: args.conversationId,
      },
    );
    console.info(
      `[credits] tavily search service=${result.serviceCode} count=${TAVILY_SEARCH_BILLABLE_COUNT} ` +
        `credits=${result.creditsConsumed}`,
    );
    return { kind: 'charged', result };
  } catch (error) {
    const { message, status } = mapConsumeError(error);
    console.warn('[credits] tavily search billing failed:', message);
    return { kind: 'failed', error: message, status };
  }
}
