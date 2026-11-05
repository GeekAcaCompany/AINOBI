// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Agent insufficient-credits handling — the contract (HTTP 402 / 422016, SSE prefix, detection and formatting)
 * lives in @ainobi/billing; this file keeps the export names this service already uses.
 */
import {
  buildInsufficientCreditsUiEvent,
  formatInsufficientCreditsStreamError,
  isInsufficientCreditsError,
  parseInsufficientCreditsUiEvent,
  resolveInsufficientCreditsScope,
  type InsufficientCreditsScope,
  type InsufficientCreditsUiEvent,
} from "@ainobi/billing";

export { AINOBI_INSUFFICIENT_ORG_CREDITS, AINOBI_INSUFFICIENT_PERSONAL_CREDITS } from "@ainobi/billing";

export type AgentCreditsInsufficientUiEvent = InsufficientCreditsUiEvent;
export type AgentCreditsInsufficientScope = InsufficientCreditsScope;

export const resolveAgentCreditsInsufficientScope = resolveInsufficientCreditsScope;
export const buildAgentCreditsInsufficientUiEvent = buildInsufficientCreditsUiEvent;
export const isAgentCreditsInsufficientError = isInsufficientCreditsError;
export const formatAgentCreditsInsufficientStreamError = formatInsufficientCreditsStreamError;
export const resolveAgentCreditsInsufficientUiEventFromMessage = parseInsufficientCreditsUiEvent;

export function throwAgentCreditsPreauthFailure(
  coursewareOrgId: string | null | undefined,
  underlying: string,
  status?: number,
): never {
  if (isInsufficientCreditsError(underlying, status)) {
    throw new Error(formatInsufficientCreditsStreamError(coursewareOrgId, underlying));
  }
  throw new Error(underlying.trim() || "Credits preauth failed");
}
