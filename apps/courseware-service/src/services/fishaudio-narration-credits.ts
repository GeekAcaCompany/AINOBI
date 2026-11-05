// SPDX-License-Identifier: AGPL-3.0-only
import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import {
  AinobiCreditsConsumeError,
  isFishAudioCreditsConsumptionEnabled,
  resolveCreditsOrgId,
  resolveFishAudioCreditsServiceCode,
} from './ainobi-credits.ts';
import { consumeAinobiCredits } from './credits-consume-retry.ts';
import { countNarrationTtsCharacters, type NarrationTtsBillingOutcome } from './narration-tts-credits.ts';

export type BillFishAudioNarrationCreditsArgs = {
  session: AinobiAuthorizedSession;
  argv?: string[];
  characterCount?: number;
  coursewareOrgId?: string | null;
  conversationId?: string;
  slideRef?: string;
  aiTeacherId?: string;
};

function buildFishAudioBillingContent(args: {
  characterCount: number;
  slideRef?: string;
  conversationId?: string;
  aiTeacherId?: string;
}): string {
  const parts = ['Courseware Narration Fish Audio TTS'];
  if (args.slideRef?.trim()) {
    parts.push(`slide=${args.slideRef.trim()}`);
  }
  if (args.conversationId?.trim()) {
    parts.push(`conversation=${args.conversationId.trim()}`);
  }
  if (args.aiTeacherId?.trim()) {
    parts.push(`teacher=${args.aiTeacherId.trim()}`);
  }
  parts.push(`chars=${args.characterCount}`);
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
 * Pre-charge Fish Audio TTS usage before host narration / TTS synthesis.
 * Returns null when billing is disabled; on consume failure returns `{ kind: 'failed' }`
 * (caller must not run synthesis/narration).
 */
export async function billFishAudioNarrationCredits(
  args: BillFishAudioNarrationCreditsArgs,
): Promise<NarrationTtsBillingOutcome | null> {
  if (!isFishAudioCreditsConsumptionEnabled()) {
    return null;
  }

  const characterCount =
    args.characterCount ?? countNarrationTtsCharacters(args.argv ?? []);
  if (characterCount <= 0) {
    console.info('[credits] fishaudio narration billing skipped (no TTS source text)');
    return { kind: 'skipped', reason: 'zero_characters', characterCount: 0, provider: 'fishaudio' };
  }

  const serviceCode = resolveFishAudioCreditsServiceCode();
  if (!serviceCode) {
    throw new AinobiCreditsConsumeError(
      'AINOBI_FISHAUDIO_CREDITS_SERVICE_CODE is not configured',
      500,
    );
  }

  try {
    const result = await consumeAinobiCredits(
      args.session.accessToken,
      {
        serviceCode,
        orgId: resolveCreditsOrgId(args.coursewareOrgId),
        amountUnit: 'tokens',
        amount: String(characterCount),
        unitCount: characterCount,
        count: 1,
        content: buildFishAudioBillingContent({
          characterCount,
          slideRef: args.slideRef,
          conversationId: args.conversationId,
          aiTeacherId: args.aiTeacherId,
        }),
        // Feature bucket for usage breakdown: TTS narration is a voice service
        usageType: 'voice',
      },
      {
        phase: 'fishaudio_tts',
        conversationId: args.conversationId,
      },
    );
    console.info(
      `[credits] fishaudio narration service=${result.serviceCode} chars=${characterCount} ` +
        `credits=${result.creditsConsumed}`,
    );
    return { kind: 'charged', result, characterCount, provider: 'fishaudio' };
  } catch (error) {
    const { message, status } = mapConsumeError(error);
    console.warn('[credits] fishaudio narration billing failed:', message);
    return { kind: 'failed', error: message, status, characterCount, provider: 'fishaudio' };
  }
}
