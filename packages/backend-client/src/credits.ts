// SPDX-License-Identifier: AGPL-3.0-only
// Client for the platform credits consume API (POST /v1/credits/consume), shared by the
// Node services. Service-code policy (which code bills what) stays with each host.

import {
  AinobiCreditsConsumeError,
  type BillingPort,
  type CreditsAmountUnit,
  type CreditsConsumeParams,
  type CreditsConsumeResult,
  type CreditsConsumptionType,
} from "@ainobi/billing";

export {
  AinobiCreditsConsumeError,
  type CreditsAmountUnit,
  type CreditsConsumeParams,
  type CreditsConsumeResult,
  type CreditsConsumptionType,
};

type CreditsConsumeApiData = {
  service_code?: string;
  product_code?: string;
  consumption_type?: CreditsConsumptionType;
  amount_unit?: CreditsAmountUnit;
  org_id?: string | null;
  credits_consumed?: string | number;
  remaining_credits?: string | number;
  input_tokens?: number;
  output_tokens?: number;
  cache_tokens?: number;
  service_id?: string | null;
  ledger_id?: string | null;
};

type CreditsConsumeApiResponse = {
  code?: number;
  success?: boolean;
  message?: string;
  data?: CreditsConsumeApiData;
};

/** Matches platform `normalize_service_code` (spaces/dots → underscores). */
export function normalizeAinobiServiceCode(modelOrCode: string): string {
  return modelOrCode.trim().toLowerCase().replace(/\s+/g, '_').replace(/\./g, '_');
}

function normalizeAmount(amount: string | number): string {
  if (typeof amount === 'number') {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new AinobiCreditsConsumeError('amount must be a positive number', 400);
    }
    return String(amount);
  }

  const trimmed = amount.trim();
  if (!trimmed || Number(trimmed) <= 0) {
    throw new AinobiCreditsConsumeError('amount must be greater than 0', 400);
  }
  return trimmed;
}

function mapConsumeResult(data: CreditsConsumeApiData): CreditsConsumeResult {
  const serviceCode = (data.service_code ?? data.product_code)?.trim();
  const consumptionType = data.consumption_type;
  const amountUnit = data.amount_unit === 'credits' ? 'credits' : 'tokens';
  if (!serviceCode || (consumptionType !== 'user' && consumptionType !== 'organization')) {
    throw new AinobiCreditsConsumeError('Invalid credits consume response from platform', 502);
  }

  return {
    serviceCode,
    consumptionType,
    amountUnit,
    orgId: data.org_id?.trim() || null,
    creditsConsumed: String(data.credits_consumed ?? '0'),
    remainingCredits: String(data.remaining_credits ?? '0'),
    inputTokens: data.input_tokens ?? 0,
    outputTokens: data.output_tokens ?? 0,
    cacheTokens: data.cache_tokens ?? 0,
    serviceId: data.service_id?.trim() || null,
    ledgerId: data.ledger_id?.trim() || null,
  };
}

/**
 * Single POST to the platform consume API (no inline retry / queue); `url` is the
 * host-resolved `POST /v1/credits/consume` endpoint.
 */
export async function consumeCreditsOnce(
  url: string,
  accessToken: string,
  params: CreditsConsumeParams,
): Promise<CreditsConsumeResult> {
  const token = accessToken.trim();
  if (!token) {
    throw new AinobiCreditsConsumeError('access token is required', 401);
  }

  const serviceCode = params.serviceCode.trim();
  const content = params.content.trim();
  if (!serviceCode) {
    throw new AinobiCreditsConsumeError('serviceCode is required', 400);
  }
  if (!content) {
    throw new AinobiCreditsConsumeError('content is required', 400);
  }

  const orgId = params.orgId?.trim();
  const amountUnit = params.amountUnit ?? 'tokens';
  const body: Record<string, unknown> = {
    service_code: serviceCode,
    amount_unit: amountUnit,
    amount: normalizeAmount(params.amount),
    content,
    ...(orgId ? { org_id: orgId } : {}),
    ...(params.idempotencyKey?.trim() ? { idempotency_key: params.idempotencyKey.trim() } : {}),
    ...(params.usageType?.trim() ? { usage_type: params.usageType.trim() } : {}),
  };
  if (params.inputTokens != null && params.inputTokens > 0) {
    body.input_tokens = Math.floor(params.inputTokens);
  }
  if (params.outputTokens != null && params.outputTokens > 0) {
    body.output_tokens = Math.floor(params.outputTokens);
  }
  if (params.cacheTokens != null && params.cacheTokens > 0) {
    body.cache_tokens = Math.floor(params.cacheTokens);
  }
  if (params.unitCount != null && params.unitCount > 0) {
    body.unit_count = Math.floor(params.unitCount);
  }
  if (params.count != null && params.count > 0) {
    body.count = Math.floor(params.count);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[credits] consume request failed:', message);
    throw new AinobiCreditsConsumeError(`Credits consume request failed: ${message}`, 503);
  }

  let payload: CreditsConsumeApiResponse;
  try {
    payload = (await response.json()) as CreditsConsumeApiResponse;
  } catch {
    throw new AinobiCreditsConsumeError('Invalid JSON from credits consume API', 502);
  }

  if (!response.ok || payload.code !== 0 || payload.success !== true || !payload.data) {
    const message = payload.message?.trim() || `Credits consume rejected (${response.status})`;
    throw new AinobiCreditsConsumeError(message, response.status, payload.code);
  }

  return mapConsumeResult(payload.data);
}

/** The platform billing implementation: consume through the backend API at `consumeUrl()`. */
export function createPlatformBilling(consumeUrl: () => string): BillingPort {
  return {
    consume: (accessToken, params) => consumeCreditsOnce(consumeUrl(), accessToken, params),
  };
}
