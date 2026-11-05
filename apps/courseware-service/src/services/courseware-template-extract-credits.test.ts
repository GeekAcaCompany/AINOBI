// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import {
  isDesignTemplateExtractCreditsConsumptionEnabled,
  resolveDesignTemplateExtractCreditsServiceCode,
} from './ainobi-credits.ts';
import { billDesignTemplateExtractCredits } from './courseware-template-extract-credits.ts';

test('resolveDesignTemplateExtractCreditsServiceCode falls back to agent code', () => {
  const prevDesign = process.env.AINOBI_DESIGN_TEMPLATE_EXTRACT_CREDITS_SERVICE_CODE;
  const prevPrompt = process.env.AINOBI_PROMPT_OPTIMIZE_CREDITS_SERVICE_CODE;
  const prevAgent = process.env.AINOBI_MODEL_CREDITS_SERVICE_CODE;
  const prevDisabled = process.env.AINOBI_CREDITS_DISABLED;

  delete process.env.AINOBI_DESIGN_TEMPLATE_EXTRACT_CREDITS_SERVICE_CODE;
  delete process.env.AINOBI_PROMPT_OPTIMIZE_CREDITS_SERVICE_CODE;
  process.env.AINOBI_MODEL_CREDITS_SERVICE_CODE = 'deepseek-v4-flash';
  delete process.env.AINOBI_CREDITS_DISABLED;

  try {
    assert.equal(resolveDesignTemplateExtractCreditsServiceCode(), 'deepseek-v4-flash');
    assert.equal(isDesignTemplateExtractCreditsConsumptionEnabled(), true);
  } finally {
    if (prevDesign === undefined) {
      delete process.env.AINOBI_DESIGN_TEMPLATE_EXTRACT_CREDITS_SERVICE_CODE;
    } else {
      process.env.AINOBI_DESIGN_TEMPLATE_EXTRACT_CREDITS_SERVICE_CODE = prevDesign;
    }
    if (prevPrompt === undefined) {
      delete process.env.AINOBI_PROMPT_OPTIMIZE_CREDITS_SERVICE_CODE;
    } else {
      process.env.AINOBI_PROMPT_OPTIMIZE_CREDITS_SERVICE_CODE = prevPrompt;
    }
    if (prevAgent === undefined) {
      delete process.env.AINOBI_MODEL_CREDITS_SERVICE_CODE;
    } else {
      process.env.AINOBI_MODEL_CREDITS_SERVICE_CODE = prevAgent;
    }
    if (prevDisabled === undefined) {
      delete process.env.AINOBI_CREDITS_DISABLED;
    } else {
      process.env.AINOBI_CREDITS_DISABLED = prevDisabled;
    }
  }
});

test('billDesignTemplateExtractCredits sends token-based consume payload', async () => {
  const prevAgent = process.env.AINOBI_MODEL_CREDITS_SERVICE_CODE;
  const prevDisabled = process.env.AINOBI_CREDITS_DISABLED;
  const prevFetch = globalThis.fetch;

  process.env.AINOBI_MODEL_CREDITS_SERVICE_CODE = 'deepseek-v4-flash';
  delete process.env.AINOBI_CREDITS_DISABLED;

  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        code: 0,
        success: true,
        data: {
          service_code: 'deepseek-v4-flash',
          consumption_type: 'organization',
          amount_unit: 'tokens',
          org_id: 'org-1',
          credits_consumed: '0.05',
          remaining_credits: '99.95',
          input_tokens: 1200,
          output_tokens: 300,
          cache_tokens: 0,
          service_id: '11111111-1111-1111-1111-111111111111',
          ledger_id: '22222222-2222-2222-2222-222222222222',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  const session = { accessToken: 'token-abc', userId: 'u1' } as AinobiAuthorizedSession;

  try {
    const outcome = await billDesignTemplateExtractCredits({
      session,
      usage: { inputTokens: 1200, outputTokens: 300, totalTokens: 1500 },
      model: 'gpt-4o-mini',
      orgId: 'org-1',
      templateName: '科技蓝模板',
      sourceType: 'courseware',
      coursewareId: 'cw-1',
    });
    assert.equal(outcome.kind, 'charged');
    assert.equal(capturedBody?.service_code, 'deepseek-v4-flash');
    assert.equal(capturedBody?.amount, '1500');
    assert.equal(capturedBody?.amount_unit, 'tokens');
    assert.equal(capturedBody?.org_id, 'org-1');
    assert.equal(capturedBody?.input_tokens, 1200);
    assert.equal(capturedBody?.output_tokens, 300);
    assert.equal(capturedBody?.usage_type, 'courseware');
  } finally {
    if (prevAgent === undefined) {
      delete process.env.AINOBI_MODEL_CREDITS_SERVICE_CODE;
    } else {
      process.env.AINOBI_MODEL_CREDITS_SERVICE_CODE = prevAgent;
    }
    if (prevDisabled === undefined) {
      delete process.env.AINOBI_CREDITS_DISABLED;
    } else {
      process.env.AINOBI_CREDITS_DISABLED = prevDisabled;
    }
    globalThis.fetch = prevFetch;
  }
});
