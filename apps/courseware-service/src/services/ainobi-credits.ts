// SPDX-License-Identifier: AGPL-3.0-only
import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import { ainobiBackendApiUrl } from '../config/ainobi-backend-api.ts';
import { getBilling, registerBilling } from "@ainobi/billing";
import {
  createPlatformBilling,
  type CreditsConsumeParams,
  type CreditsConsumeResult,
} from "@ainobi/backend-client";

export {
  AinobiCreditsConsumeError,
  normalizeAinobiServiceCode,
  type CreditsAmountUnit,
  type CreditsConsumeParams,
  type CreditsConsumeResult,
  type CreditsConsumptionType,
} from "@ainobi/backend-client";

/** Platform billing service code for agent LLM token consumption (separate from ANTHROPIC_MODEL). */
export function resolveAgentCreditsServiceCode(): string | null {
  const code = process.env.AINOBI_MODEL_CREDITS_SERVICE_CODE?.trim();
  return code || null;
}

/** @deprecated Use {@link resolveAgentCreditsServiceCode}. */
export function resolveCreditsProductCode(): string | null {
  return resolveAgentCreditsServiceCode();
}

/** Default MiniMax TTS model in service_prices.csv (CountBased; output ratio → count_credit_ratio). */
export const DEFAULT_MINIMAX_CREDITS_SERVICE_CODE = 'speech-2.8-hd';
/** Default Google Gemini TTS model in service_prices.csv (CountBased, per character). */
export const DEFAULT_GOOGLE_TTS_CREDITS_SERVICE_CODE = 'gemini-3.8-flash-tts';
/** Default Fish Audio TTS model in service_prices.csv (CountBased). */
export const DEFAULT_FISHAUDIO_CREDITS_SERVICE_CODE = 'fishaudio-s2.1-pro';

/** Default Tavily search billing code in service_prices.csv (CountBased; one credit per search). */
export const DEFAULT_TAVILY_CREDITS_SERVICE_CODE = 'tavily-search';

/** Default OpenAI image generation model in service_prices.csv (TokenBased). */
export const DEFAULT_IMAGE_GENERATE_CREDITS_SERVICE_CODE = 'gpt-image-2.5-sunburst';

/** Platform billing service code for MiniMax TTS narration (separate from agent LLM). */
export function resolveMinimaxCreditsServiceCode(): string | null {
  const code = process.env.AINOBI_MINIMAX_CREDITS_SERVICE_CODE?.trim();
  return code || null;
}

/**
 * Platform billing service code for Google Gemini TTS (separate from agent LLM).
 * Defaults to `gemini-3.8-flash-tts` so Google TTS is never synthesized unbilled.
 */
export function resolveGoogleTtsCreditsServiceCode(): string {
  const code = process.env.AINOBI_GOOGLE_TTS_CREDITS_SERVICE_CODE?.trim();
  return code || DEFAULT_GOOGLE_TTS_CREDITS_SERVICE_CODE;
}

/** Platform billing service code for FishAudio TTS narration (separate from agent LLM). */
export function resolveFishAudioCreditsServiceCode(): string | null {
  const code = process.env.AINOBI_FISHAUDIO_CREDITS_SERVICE_CODE?.trim();
  return code || null;
}

/** Platform billing service code for Tavily web search (per-request / CountBased). */
export function resolveTavilyCreditsServiceCode(): string | null {
  const code = process.env.AINOBI_TAVILY_CREDITS_SERVICE_CODE?.trim();
  return code || null;
}

/**
 * Platform billing service code for video export renders (CountBased).
 * Billed per minute of **aggregated instance compute** (`render.computeTakes`, falling back to
 * wall-clock `render.takes` for older tasks) — ceil(ms/60000), minimum 1.
 * `computeTakes` = plan instance + Σ chunk instances + assemble instance, so distributed
 * parallelization still aligns credits with total FC work.
 */
export function resolveVideoRenderCreditsServiceCode(): string | null {
  const code = process.env.AINOBI_VIDEO_RENDER_CREDITS_SERVICE_CODE?.trim();
  return code || null;
}

/**
 * Platform billing service code for OpenAI image generation (TokenBased).
 * Defaults to `gpt-image-2.5-sunburst` (present in service_prices.csv) so image billing works out of the box.
 */
export function resolveImageGenerateCreditsServiceCode(): string | null {
  const code = process.env.AINOBI_IMAGE_GENERATE_CREDITS_SERVICE_CODE?.trim();
  return code || DEFAULT_IMAGE_GENERATE_CREDITS_SERVICE_CODE;
}

/**
 * Platform billing service code for prompt optimization (text LLM, TokenBased).
 * Falls back to the agent LLM billing code so it reuses the same wallet routing.
 */
export function resolvePromptOptimizeCreditsServiceCode(): string | null {
  const code = process.env.AINOBI_PROMPT_OPTIMIZE_CREDITS_SERVICE_CODE?.trim();
  return code || resolveAgentCreditsServiceCode();
}

/**
 * Platform billing service code for design template extraction (text/vision LLM, TokenBased).
 * Falls back to prompt optimization / agent LLM billing code.
 */
export function resolveDesignTemplateExtractCreditsServiceCode(): string | null {
  const code = process.env.AINOBI_DESIGN_TEMPLATE_EXTRACT_CREDITS_SERVICE_CODE?.trim();
  return code || resolvePromptOptimizeCreditsServiceCode();
}

/**
 * Platform billing service code for content template extraction (text/vision LLM, TokenBased).
 * Falls back to prompt optimization / agent LLM billing code.
 */
export function resolveContentTemplateExtractCreditsServiceCode(): string | null {
  const code = process.env.AINOBI_CONTENT_TEMPLATE_EXTRACT_CREDITS_SERVICE_CODE?.trim();
  return code || resolvePromptOptimizeCreditsServiceCode();
}

export function isCreditsConsumptionGloballyDisabled(): boolean {
  return (
    process.env.AINOBI_CREDITS_DISABLED === '1' ||
    process.env.AINOBI_CREDITS_DISABLED === 'true'
  );
}

export function isAgentCreditsConsumptionEnabled(): boolean {
  if (isCreditsConsumptionGloballyDisabled()) {
    return false;
  }
  return resolveAgentCreditsServiceCode() != null;
}

export function isMinimaxCreditsConsumptionEnabled(): boolean {
  if (isCreditsConsumptionGloballyDisabled()) {
    return false;
  }
  return resolveMinimaxCreditsServiceCode() != null;
}

export function isGoogleTtsCreditsConsumptionEnabled(): boolean {
  return !isCreditsConsumptionGloballyDisabled();
}

export function isFishAudioCreditsConsumptionEnabled(): boolean {
  if (isCreditsConsumptionGloballyDisabled()) {
    return false;
  }
  return resolveFishAudioCreditsServiceCode() != null;
}

export function isTavilyCreditsConsumptionEnabled(): boolean {
  if (isCreditsConsumptionGloballyDisabled()) {
    return false;
  }
  return resolveTavilyCreditsServiceCode() != null;
}

export function isVideoRenderCreditsConsumptionEnabled(): boolean {
  if (isCreditsConsumptionGloballyDisabled()) {
    return false;
  }
  return resolveVideoRenderCreditsServiceCode() != null;
}

export function isImageGenerateCreditsConsumptionEnabled(): boolean {
  if (isCreditsConsumptionGloballyDisabled()) {
    return false;
  }
  return resolveImageGenerateCreditsServiceCode() != null;
}

export function isPromptOptimizeCreditsConsumptionEnabled(): boolean {
  if (isCreditsConsumptionGloballyDisabled()) {
    return false;
  }
  return resolvePromptOptimizeCreditsServiceCode() != null;
}

export function isDesignTemplateExtractCreditsConsumptionEnabled(): boolean {
  if (isCreditsConsumptionGloballyDisabled()) {
    return false;
  }
  return resolveDesignTemplateExtractCreditsServiceCode() != null;
}

export function isContentTemplateExtractCreditsConsumptionEnabled(): boolean {
  if (isCreditsConsumptionGloballyDisabled()) {
    return false;
  }
  return resolveContentTemplateExtractCreditsServiceCode() != null;
}

export function resolveCreditsOrgId(coursewareOrgId?: string | null): string | undefined {
  return coursewareOrgId?.trim() || undefined;
}

/** Platform endpoint for POST /v1/credits/consume */
export function resolveCreditsConsumeUrl(): string {
  return ainobiBackendApiUrl('/credits/consume');
}

/**
 * Single POST to the platform consume API (no inline retry / queue).
 * Prefer {@link consumeAinobiCredits} from `./credits-consume-retry.ts` for production billing.
 */
export function consumeAinobiCreditsOnce(
  accessToken: string,
  params: CreditsConsumeParams,
): Promise<CreditsConsumeResult> {
  return getBilling().consume(accessToken, params);
}

// NOTE: the owner-specific wrappers (consumePersonalCredits /
// consumeOrganizationCredits) were removed — every caller goes through
// consumeAinobiCreditsOnce directly; the optional orgId decides attribution.

// Composition root of billing for this service: charges go through the platform credits API.
// An embedding host may registerBilling(...) its own implementation (or DisabledBilling) after.
registerBilling(createPlatformBilling(resolveCreditsConsumeUrl));
