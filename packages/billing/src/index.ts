// SPDX-License-Identifier: AGPL-3.0-only
// The open-source edition has no billing: this stands in for the platform's package under the same names and
// signatures, and nothing is ever charged or refused. Register your own BillingPort to add metering.
export type CreditsConsumptionType = 'user' | 'organization';
export type CreditsAmountUnit = 'tokens' | 'credits';

export type CreditsConsumeParams = {
  serviceCode: string;
  amount: string | number;
  amountUnit?: CreditsAmountUnit;
  inputTokens?: number;
  outputTokens?: number;
  cacheTokens?: number;
  unitCount?: number;
  count?: number;
  content: string;
  idempotencyKey?: string;
  orgId?: string;
  usageType?: string;
};

export type CreditsConsumeResult = {
  serviceCode: string;
  consumptionType: CreditsConsumptionType;
  amountUnit: CreditsAmountUnit;
  orgId: string | null;
  creditsConsumed: string;
  remainingCredits: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  serviceId: string | null;
  ledgerId: string | null;
};

export class AinobiCreditsConsumeError extends Error {
  readonly status: number;
  readonly code: number | undefined;

  constructor(message: string, status: number, code?: number) {
    super(message);
    this.name = 'AinobiCreditsConsumeError';
    this.status = status;
    this.code = code;
  }
}

export interface BillingPort {
  consume(accessToken: string, params: CreditsConsumeParams): Promise<CreditsConsumeResult>;
}

export const BILLING_NOT_CONFIGURED = 'BILLING_NOT_CONFIGURED';

export class BillingNotConfiguredError extends Error {
  readonly code = BILLING_NOT_CONFIGURED;
  constructor() {
    super('billing is not configured; register an implementation at the composition root');
    this.name = 'BillingNotConfiguredError';
  }
}

/** Every charge succeeds and debits nothing. */
export class DisabledBilling implements BillingPort {
  async consume(_accessToken: string, params: CreditsConsumeParams): Promise<CreditsConsumeResult> {
    return {
      serviceCode: params.serviceCode,
      consumptionType: params.orgId ? 'organization' : 'user',
      amountUnit: params.amountUnit ?? 'tokens',
      orgId: params.orgId ?? null,
      creditsConsumed: '0',
      remainingCredits: '0',
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
      serviceId: null,
      ledgerId: null,
    };
  }
}

export class UnconfiguredBilling extends DisabledBilling {}

let implementation: BillingPort = new DisabledBilling();

export function registerBilling(port: BillingPort): void {
  implementation = port;
}

export function unregisterBilling(): void {
  implementation = new DisabledBilling();
}

export function getBilling(): BillingPort {
  return implementation;
}

export const INSUFFICIENT_BALANCE_ERROR_CODE = 422016;
export const INSUFFICIENT_BALANCE_ERROR_KEY = 'ASSET_INSUFFICIENT_BALANCE';
export const INSUFFICIENT_BALANCE_HTTP_STATUS = 402;

export const INSUFFICIENT_CREDITS_FRAME_CODE = 'INSUFFICIENT_CREDITS';
export const AINOBI_INSUFFICIENT_ORG_CREDITS = 'AINOBI_INSUFFICIENT_ORG_CREDITS';
export const AINOBI_INSUFFICIENT_PERSONAL_CREDITS = 'AINOBI_INSUFFICIENT_PERSONAL_CREDITS';

export type InsufficientCreditsScope = 'organization' | 'personal';
export type InsufficientCreditsUiEvent = { kind: 'insufficient_org_credits' } | { kind: 'insufficient_personal_credits' };

// Nothing here refuses a charge, so no error ever means an insufficient balance.
export function isInsufficientCreditsError(_error: unknown, _status?: number): boolean {
  return false;
}

export function resolveInsufficientCreditsScope(orgId?: string | null, _error?: unknown): InsufficientCreditsScope {
  return orgId?.trim() ? 'organization' : 'personal';
}

export function buildInsufficientCreditsUiEvent(orgId?: string | null, error?: unknown): InsufficientCreditsUiEvent {
  return resolveInsufficientCreditsScope(orgId, error) === 'organization'
    ? { kind: 'insufficient_org_credits' }
    : { kind: 'insufficient_personal_credits' };
}

export function formatInsufficientCreditsStreamError(_orgId: string | null | undefined, underlying: string): string {
  return underlying;
}

export function parseInsufficientCreditsUiEvent(_message: string): InsufficientCreditsUiEvent | null {
  return null;
}
